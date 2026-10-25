import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { machineName } from "@md-coeditor/protocol";
import { activeNoteFromHub } from "../active-note";
import { takeDigest } from "../digest";
import { createHubClient } from "../hub-client";
import type { Io, Subcommand } from "../run";
import { hookSession } from "../session";
import { vaultFromEnv } from "../vault";

const EXIT_OK = 0;
const EXIT_USAGE = 2;

export const INBOX_USAGE = `Usage: coedit inbox --digest [--mark-read] [--session <id>]

  --digest         Print the digest of new decisions
  --mark-read      Move the cursor of the session past the digest
  --session <id>   Set the session by hand
`;

export interface InboxDeps {
	env: Record<string, string | undefined>;
	cwd: string;
	hostname: string;
	stdinIsTTY: boolean;
	readStdin: () => Promise<string>;
	createClient?: typeof createHubClient;
}

const STDIN_TIMEOUT_MS = 1000;

/** Reads stdin to the end, or for at most `ms`; gives what was read so far. */
export async function readAll(
	stream: NodeJS.ReadableStream = process.stdin,
	ms = STDIN_TIMEOUT_MS,
): Promise<string> {
	stream.setEncoding("utf8");
	let data = "";
	return new Promise<string>((resolve) => {
		const finish = (): void => {
			clearTimeout(timer);
			stream.removeListener("data", onData);
			stream.removeListener("end", finish);
			stream.removeListener("error", finish);
			stream.removeListener("close", finish);
			resolve(data);
		};
		const onData = (chunk: string | Buffer): void => {
			data += chunk.toString();
		};
		const timer = setTimeout(finish, ms);
		stream.on("data", onData);
		stream.on("end", finish);
		stream.on("error", finish);
		stream.on("close", finish);
	});
}

/** Lenient: any text that is not a JSON object is "no input". */
function parseHookInput(raw: string): Record<string, unknown> | undefined {
	if (raw.trim() === "") return undefined;
	try {
		const value: unknown = JSON.parse(raw);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * The digest, for the UserPromptSubmit hook. Exit 0 on every runtime error
 * (stderr only), so a problem never blocks the prompt.
 */
export async function runInbox(
	argv: string[],
	io: Io,
	deps: InboxDeps,
): Promise<number> {
	// Hook mode (stdin is a pipe, or --mark-read): exit 2 would block the prompt.
	const usageExit =
		!deps.stdinIsTTY || argv.includes("--mark-read") ? EXIT_OK : EXIT_USAGE;
	let values: { digest?: boolean; "mark-read"?: boolean; session?: string };
	try {
		({ values } = parseArgs({
			args: argv,
			strict: true,
			allowPositionals: false,
			options: {
				digest: { type: "boolean" },
				"mark-read": { type: "boolean" },
				session: { type: "string" },
			},
		}));
	} catch (err) {
		io.stderr(
			`coedit inbox: ${err instanceof Error ? err.message : String(err)}\n${INBOX_USAGE}`,
		);
		return usageExit;
	}
	if (!values.digest) {
		io.stderr(`coedit inbox: --digest is needed\n${INBOX_USAGE}`);
		return usageExit;
	}

	let client: ReturnType<typeof createHubClient> | undefined;
	try {
		let input: Record<string, unknown> | undefined;
		if (!deps.stdinIsTTY) {
			try {
				input = parseHookInput(await deps.readStdin());
			} catch {
				input = undefined;
			}
		}
		const session = hookSession(values.session, deps.env, input);
		if (session === undefined) {
			io.stderr(
				"coedit inbox: no session: set COEDIT_SESSION or use --session\n",
			);
			return EXIT_OK;
		}
		const found = vaultFromEnv(deps.env, deps.cwd);
		if (found.kind !== "found") {
			io.stderr(
				found.kind === "none"
					? "coedit inbox: no vault found\n"
					: `coedit inbox: more than one vault found: ${found.vaults.join(", ")}\n`,
			);
			return EXIT_OK;
		}
		const machine = machineName(deps.hostname);
		client = (deps.createClient ?? createHubClient)({
			vault: found.vault,
			machine,
			session,
			timeoutMs: 1000,
		});
		const activeNote = await activeNoteFromHub(client, 1000);
		const result = await takeDigest({
			vault: found.vault,
			machine,
			session,
			activeNote,
			markRead: values["mark-read"] === true,
			stderr: (m) => io.stderr(`${m}\n`),
		});
		if (result.text === "") return EXIT_OK;
		if (input !== undefined) {
			io.stdout(
				`${JSON.stringify({
					hookSpecificOutput: {
						hookEventName: "UserPromptSubmit",
						additionalContext: result.text,
					},
				})}\n`,
			);
		} else {
			io.stdout(`${result.text}\n`);
		}
	} catch (err) {
		io.stderr(
			`coedit inbox: ${err instanceof Error ? err.message : String(err)}\n`,
		);
	} finally {
		client?.close();
	}
	return EXIT_OK;
}

export const inboxCommand: Subcommand = {
	name: "inbox",
	description: "Print the digest of new decisions (UserPromptSubmit hook)",
	handler: (argv, io) =>
		runInbox(argv, io, {
			env: process.env,
			cwd: process.cwd(),
			hostname: hostname(),
			stdinIsTTY: process.stdin.isTTY === true,
			readStdin: () => readAll(),
		}),
};
