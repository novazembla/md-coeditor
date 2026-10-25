import { hostname } from "node:os";
import type { Readable, Writable } from "node:stream";
import { machineName } from "@md-coeditor/protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { activeNoteFromHub } from "../active-note";
import { ensureCursor } from "../cursor";
import { NO_NEW_DECISIONS, takeDigest } from "../digest";
import { createHubClient, type HubClient, type HubResult } from "../hub-client";
import { markDetail, readLog } from "../log-read";
import type { Io, Subcommand } from "../run";
import { bridgeSession } from "../session";
import { type VaultResult, vaultFromEnv } from "../vault";

export const SERVER_NAME = "md-coeditor";

export const SERVER_INSTRUCTIONS = [
	"MD-Coeditor: the user reviews your changes to Markdown notes as track changes in Obsidian.",
	"You do not edit vault notes directly (no Write or Edit on notes). Change a note only with suggest_edit: the user then accepts or rejects each change.",
	"Start with get_context to see the active note and the user's selection.",
	"A digest of the user's decisions arrives with each prompt. During a long task, call get_digest to get it at once. Call get_digest only in the main conversation, not in a subagent.",
	"Use read_note to read a note as the user sees it, and get_detail to see the history of one mark.",
].join("\n");

type ToolResult = {
	[key: string]: unknown;
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

const text = (value: string): ToolResult => ({
	content: [{ type: "text", text: value }],
});
const json = (value: unknown): ToolResult =>
	text(JSON.stringify(value, null, 2));
const toolError = (
	code: string,
	message: string,
	details?: Record<string, unknown>,
): ToolResult => ({
	isError: true,
	content: [
		{
			type: "text",
			text: JSON.stringify(
				details === undefined ? { code, message } : { code, message, details },
			),
		},
	],
});

function vaultProblem(result: VaultResult): string {
	if (result.kind === "found") return "";
	if (result.kind === "none") {
		return "No vault found: set COEDIT_VAULT or start in a folder with a vault (a .obsidian folder).";
	}
	return `More than one vault found (${result.vaults.join(", ")}): set COEDIT_VAULT.`;
}

export interface McpDeps {
	env: Record<string, string | undefined>;
	cwd: string;
	hostname: string;
	stdin: Readable;
	stdout: Writable;
	stderr: (text: string) => void;
	version: string;
	/** Test hook. */
	createClient?: typeof createHubClient;
}

export interface McpApp {
	server: McpServer;
	close(): void;
}

/** Builds the server. Does not connect a transport. */
export async function createMcpApp(deps: McpDeps): Promise<McpApp> {
	const machine = machineName(deps.hostname);
	const session = bridgeSession(deps.env);
	const found = vaultFromEnv(deps.env, deps.cwd);
	const vault = found.kind === "found" ? found.vault : undefined;
	let client: HubClient | undefined;

	if (vault === undefined) {
		deps.stderr(`coedit mcp: ${vaultProblem(found)}\n`);
	} else {
		try {
			const log = await readLog(vault, machine);
			await ensureCursor(vault, machine, session, log);
		} catch (err) {
			deps.stderr(
				`coedit mcp: cursor not created: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}
		client = (deps.createClient ?? createHubClient)({
			vault,
			machine,
			session,
		});
	}

	const callHub = async (
		method: string,
		params: unknown,
	): Promise<HubResult> => {
		if (client === undefined) {
			return {
				ok: false,
				error: {
					code: "hub_unavailable",
					message: `Obsidian not connected. ${vaultProblem(found)}`.trim(),
				},
			};
		}
		return client.call(method, params);
	};
	const fromHub = (answer: HubResult): ToolResult =>
		answer.ok
			? json(answer.result)
			: toolError(
					answer.error.code,
					answer.error.message,
					answer.error.details,
				);
	const noVault = (): ToolResult =>
		toolError("hub_unavailable", vaultProblem(found));

	const server = new McpServer(
		{ name: SERVER_NAME, version: deps.version },
		{ instructions: SERVER_INSTRUCTIONS },
	);

	server.registerTool(
		"get_context",
		{
			description:
				"Get what the user looks at in Obsidian: the active note, the selected text with its start and end line and column (agent view: line from 1, column from 0), and the number of pending marks in the active note. Returns hubConnected false when Obsidian is not connected. Call this first.",
		},
		async () => {
			const answer = await callHub("get_context", {});
			if (answer.ok) {
				return json({ hubConnected: true, ...(answer.result as object) });
			}
			if (answer.error.code === "hub_unavailable") {
				return json({
					hubConnected: false,
					activeNote: null,
					selection: null,
					openMarks: null,
				});
			}
			return fromHub(answer);
		},
	);

	server.registerTool(
		"read_note",
		{
			description:
				"Read a note as the user sees it: the text as if all pending marks were accepted, and the list of pending insertions and deletions. The path is relative to the vault, with / as separator. Needs Obsidian.",
			inputSchema: {
				path: z.string().describe("Vault-relative path of a .md note"),
			},
		},
		async ({ path }) => fromHub(await callHub("read_note", { path })),
	);

	server.registerTool(
		"suggest_edit",
		{
			description:
				"Suggest a change to a note. This is the only way to change a vault note: the change shows as track changes and the user accepts or rejects it. Replaces `find` with `replace`. `find` must match exactly one place; use `before` and `after` to pick the place. Needs Obsidian.",
			inputSchema: {
				path: z.string().describe("Vault-relative path of a .md note"),
				find: z.string().describe("Text to replace, as in read_note"),
				replace: z.string().describe("New text"),
				before: z
					.string()
					.optional()
					.describe("Text right before `find`, to pick one place"),
				after: z
					.string()
					.optional()
					.describe("Text right after `find`, to pick one place"),
			},
		},
		async (args) => fromHub(await callHub("suggest_edit", args)),
	);

	server.registerTool(
		"get_detail",
		{
			description:
				"Get the history of one mark: its log events and the current state (accepted, rejected or pending). Give `path` when the id is in more than one note. Works without Obsidian.",
			inputSchema: {
				id: z.string().describe("Mark id, for example i1bbbb"),
				path: z.string().optional().describe("Vault-relative path of the note"),
			},
		},
		async ({ id, path }) => {
			if (vault === undefined) return noVault();
			const log = await readLog(vault, machine);
			const detail = markDetail(log.events, id, path);
			if (!detail.ok) {
				return toolError(detail.code, detail.message, detail.details);
			}
			return json({
				path: detail.path,
				id: detail.id,
				events: detail.events,
				current: detail.current,
			});
		},
	);

	server.registerTool(
		"get_digest",
		{
			description:
				"Get the digest of the user's decisions (accepted and rejected suggestions) since the last digest, and mark it as read. The same digest comes with each prompt; call this during a long task to learn at once. For the main conversation only, not for subagents. Works without Obsidian.",
		},
		async () => {
			if (vault === undefined || client === undefined) return noVault();
			const activeNote = await activeNoteFromHub(client, 1000);
			const result = await takeDigest({
				vault,
				machine,
				session,
				activeNote,
				markRead: true,
				stderr: (m) => deps.stderr(`${m}\n`),
			});
			return text(result.text === "" ? NO_NEW_DECISIONS : result.text);
		},
	);

	return { server, close: () => client?.close() };
}

export async function runMcp(_argv: string[], io: Io, deps: McpDeps) {
	const app = await createMcpApp(deps);
	const transport = new StdioServerTransport(deps.stdin, deps.stdout);
	await new Promise<void>((resolve) => {
		transport.onclose = () => resolve();
		deps.stdin.once("end", () => resolve());
		deps.stdin.once("close", () => resolve());
		app.server.connect(transport).catch((err: unknown) => {
			io.stderr(
				`coedit mcp: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			resolve();
		});
	});
	app.close();
	await app.server.close().catch(() => {});
	return 0;
}

export const mcpCommand: Subcommand = {
	name: "mcp",
	description: "Run the MCP server (stdio) for the agent",
	handler: (argv, io) =>
		runMcp(argv, io, {
			env: process.env,
			cwd: process.cwd(),
			hostname: hostname(),
			stdin: process.stdin,
			stdout: process.stdout,
			stderr: io.stderr,
			version: io.version,
		}),
};
