import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	endpointPath,
	eventsPath,
	logIdPath,
	machineDir,
	machineName,
} from "@md-coeditor/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { waitFor } from "./wait";

const here = fileURLToPath(new URL(".", import.meta.url));
/** The bridge bundle. The e2e scripts build it first (root `test:e2e`). */
export const COEDIT = join(here, "..", "..", "bridge", "dist", "coedit.mjs");

/** The launcher's session. The other ids differ, so the tests prove that this one wins. */
export const SESSION = "e2e-run";
export const CLAUDE_SESSION = "claude-code-other";
export const HOOK_SESSION = "hook-other";

/** The machine folder of the sandbox vault. Test runner, bridge and Obsidian share one host. */
export function machineFolder(): string {
	return machineDir(obsidianPage.getVaultPath(), machineName(hostname()));
}

export interface Endpoint {
	port: number;
	token: string;
	pid: number;
	host: string;
}

/** `endpoint.json` of the sandbox vault, or null when there is none. */
export function readEndpoint(): Endpoint | null {
	const path = endpointPath(
		obsidianPage.getVaultPath(),
		machineName(hostname()),
	);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Endpoint;
	} catch {
		return null;
	}
}

/** Wait until `endpoint.json` exists (and, with `not`, holds another token). */
export function waitForEndpoint(not?: string): Promise<Endpoint> {
	return waitFor(
		async () => readEndpoint(),
		(e) => e !== null && e.token !== not,
		not === undefined ? "endpoint.json" : "endpoint.json with a new token",
	) as Promise<Endpoint>;
}

/** A log event (the envelope and the body fields). */
export type LogEvent = Record<string, unknown> & {
	seq: number;
	type: string;
	path: string;
};

/** The events of the sandbox log, in file order. */
export function logEvents(): LogEvent[] {
	const path = eventsPath(obsidianPage.getVaultPath(), machineName(hostname()));
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => JSON.parse(l) as LogEvent);
}

/** The highest `seq` in the log, 0 when the log is empty. */
export function lastSeq(): number {
	return logEvents().reduce((max, e) => Math.max(max, e.seq), 0);
}

/** The events after `seq`. */
export function eventsAfter(seq: number): LogEvent[] {
	return logEvents().filter((e) => e.seq > seq);
}

/** Wait until the log has `count` events after `seq`, and return them. */
export function waitForEvents(seq: number, count: number): Promise<LogEvent[]> {
	return waitFor(
		async () => eventsAfter(seq),
		(e) => e.length >= count,
		`${count} log events after seq ${seq}`,
	);
}

/** The log id, or null. */
export function logId(): string | null {
	const path = logIdPath(obsidianPage.getVaultPath(), machineName(hostname()));
	return existsSync(path) ? readFileSync(path, "utf8").trim() : null;
}

function bridgeEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) env[k] = v;
	}
	return {
		...env,
		COEDIT_VAULT: obsidianPage.getVaultPath(),
		COEDIT_SESSION: SESSION,
		CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION,
	};
}

/** A tool result: the text, and the text as JSON when it parses. */
export interface ToolOutput {
	isError: boolean;
	text: string;
	json: unknown;
}

export interface Bridge {
	client: Client;
	/** Call a tool and return its text and JSON. */
	call(name: string, args?: Record<string, unknown>): Promise<ToolOutput>;
	/** The JSON of a successful call; throws on a tool error. */
	json<T = Record<string, unknown>>(
		name: string,
		args?: Record<string, unknown>,
	): Promise<T>;
	/** Standard error of `coedit mcp`. */
	stderr(): string;
	close(): Promise<void>;
}

/** Start `coedit mcp` for the sandbox vault and connect an MCP client over stdio. */
export async function startBridge(): Promise<Bridge> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [COEDIT, "mcp"],
		env: bridgeEnv(),
		stderr: "pipe",
	});
	let err = "";
	transport.stderr?.on("data", (chunk: Buffer) => {
		err += chunk.toString("utf8");
	});
	const client = new Client({ name: "md-coeditor-e2e", version: "0.0.0" });
	await client.connect(transport);

	const call = async (
		name: string,
		args: Record<string, unknown> = {},
	): Promise<ToolOutput> => {
		const result = await client.callTool({ name, arguments: args });
		const content = result.content as { type: string; text?: string }[];
		const text = content.map((c) => c.text ?? "").join("");
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			json = undefined;
		}
		return { isError: result.isError === true, text, json };
	};

	return {
		client,
		call,
		async json<T>(name: string, args: Record<string, unknown> = {}) {
			const out = await call(name, args);
			if (out.isError) throw new Error(`${name} failed: ${out.text}`);
			return out.json as T;
		},
		stderr: () => err,
		close: () => client.close(),
	};
}

export interface InboxResult {
	code: number | null;
	stdout: string;
	stderr: string;
	/** `hookSpecificOutput.additionalContext`, or "" when there is no output. */
	digest: string;
}

/**
 * Run `coedit inbox --digest --mark-read` as the UserPromptSubmit hook does:
 * hook JSON on stdin, with a `session_id` that differs from the launcher's session.
 */
export function runInbox(): Promise<InboxResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[COEDIT, "inbox", "--digest", "--mark-read"],
			{ env: bridgeEnv(), stdio: ["pipe", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c: Buffer) => {
			stdout += c.toString("utf8");
		});
		child.stderr.on("data", (c: Buffer) => {
			stderr += c.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", (code) => {
			let digest = "";
			if (stdout.trim() !== "") {
				const out = JSON.parse(stdout) as {
					hookSpecificOutput?: { additionalContext?: string };
				};
				digest = out.hookSpecificOutput?.additionalContext ?? "";
			}
			resolve({ code, stdout, stderr, digest });
		});
		child.stdin.end(
			JSON.stringify({
				session_id: HOOK_SESSION,
				hook_event_name: "UserPromptSubmit",
				prompt: "next",
				cwd: obsidianPage.getVaultPath(),
			}),
		);
	});
}

const PLUGIN_ID = "md-coeditor";

/** Switch the plugin off, as in Obsidian's settings. */
export async function pluginOff(): Promise<void> {
	await obsidianPage.disablePlugin(PLUGIN_ID);
}

/** Switch the plugin on, and wait until its hub has written a new endpoint. */
export async function pluginOn(oldToken?: string): Promise<Endpoint> {
	await obsidianPage.enablePlugin(PLUGIN_ID);
	return waitForEndpoint(oldToken);
}

/** True when the plugin is loaded. */
export function pluginIsOn(): Promise<boolean> {
	return browser.executeObsidian(
		({ app }, id) =>
			// app.plugins is not in the public types.
			(app as unknown as { plugins: { plugins: Record<string, unknown> } })
				.plugins.plugins[id] !== undefined,
		PLUGIN_ID,
	);
}

/** Unload and load the plugin. Returns the new endpoint. */
export async function restartPlugin(): Promise<Endpoint> {
	const old = readEndpoint()?.token;
	await pluginOff();
	return pluginOn(old);
}

/** The local date of the Obsidian process as `YYYY-MM-DD`. */
export function obsidianDate(): Promise<string> {
	return browser.execute(() => {
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	});
}

/** The path of the active Markdown note, or null. */
export function activeNote(): Promise<string | null> {
	return browser.executeObsidian(
		({ app, obsidian }) =>
			app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.file?.path ??
			null,
	);
}
