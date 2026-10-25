import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Shared helpers for `coedit claude` and `coedit init`: find and run `claude`, read its plugin list. */

export const PLUGIN_NAME = "md-coeditor";

export type Platform = NodeJS.Platform;
export type Env = Record<string, string | undefined>;

/** One entry of `claude plugin list --json` (task 8.3 records the shape). */
export interface PluginEntry {
	id: string;
	scope?: string;
	enabled?: boolean;
	version?: string;
	projectPath?: string;
}

/**
 * Tolerant parser. Anything that is not an array, and any entry without a
 * string `id`, is dropped. So an unknown shape means "not installed".
 */
export function parsePluginList(text: string): PluginEntry[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(data)) return [];
	const entries: PluginEntry[] = [];
	for (const item of data) {
		if (typeof item !== "object" || item === null) continue;
		const r = item as Record<string, unknown>;
		if (typeof r.id !== "string") continue;
		const entry: PluginEntry = { id: r.id };
		if (typeof r.scope === "string") entry.scope = r.scope;
		if (typeof r.enabled === "boolean") entry.enabled = r.enabled;
		if (typeof r.version === "string") entry.version = r.version;
		if (typeof r.projectPath === "string") entry.projectPath = r.projectPath;
		entries.push(entry);
	}
	return entries;
}

function pathApi(platform: Platform): typeof path.posix {
	return platform === "win32" ? path.win32 : path.posix;
}

function samePath(a: string, b: string, platform: Platform): boolean {
	const p = pathApi(platform);
	const norm = (x: string) => {
		const r = p.resolve(x);
		return platform === "win32" ? r.toLowerCase() : r;
	};
	return norm(a) === norm(b);
}

/**
 * The installed md-coeditor plugin for the folder `cwd`: an entry whose id
 * starts with `md-coeditor@`. `project` and `local` entries of another folder
 * are ignored. Scope `user` wins.
 */
export function findClaudePlugin(
	entries: readonly PluginEntry[],
	cwd: string,
	platform: Platform = process.platform,
): PluginEntry | undefined {
	const candidates = entries.filter((e) => {
		if (!e.id.startsWith(`${PLUGIN_NAME}@`)) return false;
		if (e.scope === "project" || e.scope === "local") {
			return (
				e.projectPath !== undefined && samePath(e.projectPath, cwd, platform)
			);
		}
		return true;
	});
	return candidates.find((e) => e.scope === "user") ?? candidates[0];
}

export interface FindClaudeOptions {
	env: Env;
	platform: Platform;
	exists: (file: string) => boolean;
}

export interface ClaudeLocation {
	kind: "exe" | "cmd";
	path: string;
}

/** `claude` on the PATH. On Windows: `claude.exe` first, then `claude.cmd`. */
export function findClaude(
	options: FindClaudeOptions,
): ClaudeLocation | undefined {
	const { env, platform, exists } = options;
	const p = pathApi(platform);
	const key =
		platform === "win32"
			? (Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH")
			: "PATH";
	const dirs = (env[key] ?? "")
		.split(platform === "win32" ? ";" : ":")
		.map((d) => (platform === "win32" ? d.replace(/^"(.*)"$/, "$1") : d))
		.filter((d) => d !== "");
	const names: [string, "exe" | "cmd"][] =
		platform === "win32"
			? [
					["claude.exe", "exe"],
					["claude.cmd", "cmd"],
				]
			: [["claude", "exe"]];
	for (const [name, kind] of names) {
		for (const dir of dirs) {
			const file = p.join(dir, name);
			if (exists(file)) return { kind, path: file };
		}
	}
	return undefined;
}

/** What to start: a program and the arguments that come before the user's arguments. */
export interface ClaudeCommand {
	command: string;
	prefixArgs: string[];
}

export type ResolvedClaude =
	| { ok: true; claude: ClaudeCommand }
	| { ok: false; message: string };

const SHIM_TARGET = /"(?:%dp0%|%~dp0)[\\/]*([^"%]+\.(?:js|cjs|mjs|exe))"/gi;

/**
 * Read an npm `.cmd` shim and find its target below `%dp0%`: a script runs as
 * `node <script>`, an `.exe` runs directly. No shell is involved.
 */
export function resolveShim(
	shim: string,
	execPath: string,
	readFile: (file: string) => string,
	exists: (file: string) => boolean,
): ResolvedClaude {
	const fail: ResolvedClaude = {
		ok: false,
		message: `cannot read the target of ${shim}. Install the native claude.exe (see the Claude Code setup docs).`,
	};
	let text: string;
	try {
		text = readFile(shim);
	} catch {
		return fail;
	}
	for (const match of text.matchAll(SHIM_TARGET)) {
		const rel = match[1] as string;
		if (/(^|[\\/])node\.exe$/i.test(rel)) continue;
		const target = path.win32.join(path.win32.dirname(shim), rel);
		if (!exists(target)) continue;
		return /\.exe$/i.test(rel)
			? { ok: true, claude: { command: target, prefixArgs: [] } }
			: { ok: true, claude: { command: execPath, prefixArgs: [target] } };
	}
	return fail;
}

export function resolveClaude(
	location: ClaudeLocation,
	platform: Platform,
	execPath: string,
	readFile: (file: string) => string = (f) => readFileSync(f, "utf8"),
	exists: (file: string) => boolean = existsSync,
): ResolvedClaude {
	if (platform === "win32" && location.kind === "cmd") {
		return resolveShim(location.path, execPath, readFile, exists);
	}
	return { ok: true, claude: { command: location.path, prefixArgs: [] } };
}

export type ListPlugins = (claude: ClaudeCommand) => Promise<PluginEntry[]>;

/** Runs `claude plugin list --json`. Any failure gives an empty list. */
export const listInstalledPlugins: ListPlugins = (claude) =>
	new Promise((resolve) => {
		execFile(
			claude.command,
			[...claude.prefixArgs, "plugin", "list", "--json"],
			{ timeout: 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
			(err, stdout) => resolve(err ? [] : parsePluginList(String(stdout))),
		);
	});

/** The file that runs now: `dist/coedit.mjs` in the bundle. */
export function runningFile(): string {
	return fileURLToPath(import.meta.url);
}

/**
 * Bundled Claude plugin folder (D12 step 4): `COEDIT_PLUGIN_DIR`; the parent of
 * the folder of the running file when it has `.claude-plugin/plugin.json`; the
 * repo layout `packages/bridge/dist/../../../adapters/claude`.
 */
export function findPluginDir(
	env: Env,
	running: string,
	exists: (file: string) => boolean = existsSync,
): string | undefined {
	const dir = path.dirname(running);
	const has = (d: string) =>
		exists(path.join(d, ".claude-plugin", "plugin.json"));
	const fromEnv = env.COEDIT_PLUGIN_DIR;
	if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
	const own = path.resolve(dir, "..");
	if (has(own)) return own;
	const repo = path.resolve(dir, "..", "..", "..", "adapters", "claude");
	return has(repo) ? repo : undefined;
}
