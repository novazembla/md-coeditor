import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	type ClaudeCommand,
	type Env,
	findClaude,
	findClaudePlugin,
	findPluginDir,
	type ListPlugins,
	listInstalledPlugins,
	type Platform,
	type PluginEntry,
	resolveClaude,
	runningFile,
} from "../claude-plugins";
import type { Io, Subcommand } from "../run";
import { discoverVault } from "../vault";

// Same values as EXIT_* in run.ts; not imported, to avoid an import cycle.
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

export const DEFAULT_AGENT = "md-coeditor:co-editor";
const INLINE_ID = "md-coeditor@inline";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const CLAUDE_USAGE = `Usage: coedit claude [--vault <path>] [--agent [name]] [-- <claude arguments>]

Start Claude Code with the co-editor plugin switched on for this session only.

Options:
  --vault <path>   Use this vault (default: found from the current folder)
  --agent [name]   Start an agent profile (default: ${DEFAULT_AGENT})
  -h, --help       Show this help

Arguments after -- go to claude unchanged.
`;

// ---------------------------------------------------------------- arguments

export interface ClaudeArgs {
	vault?: string;
	agent?: string;
	help: boolean;
	passThrough: string[];
}

/** Read `--agent` by hand (optional value), then `parseArgs` for the rest. */
export function parseClaudeArgs(args: string[]): ClaudeArgs {
	const dashDash = args.indexOf("--");
	const own = dashDash === -1 ? args : args.slice(0, dashDash);
	const passThrough = dashDash === -1 ? [] : args.slice(dashDash + 1);

	let agent: string | undefined;
	const rest: string[] = [];
	for (let i = 0; i < own.length; i++) {
		const a = own[i] as string;
		if (a === "--agent") {
			const next = own[i + 1];
			if (next === undefined || next.startsWith("-")) {
				agent = DEFAULT_AGENT;
			} else {
				agent = next;
				i++;
			}
		} else if (a.startsWith("--agent=")) {
			agent = a.slice("--agent=".length) || DEFAULT_AGENT;
		} else {
			rest.push(a);
		}
	}

	const { values } = parseArgs({
		args: rest,
		strict: true,
		allowPositionals: false,
		options: {
			vault: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	return {
		vault: values.vault,
		agent,
		help: values.help === true,
		passThrough,
	};
}

// ------------------------------------------------------------ launch (pure)

export interface LaunchOptions {
	platform: Platform;
	/** Parsed `claude plugin list --json`. */
	pluginList: readonly PluginEntry[];
	/** Folder where `claude` starts. */
	cwd: string;
	/** Absolute vault path. */
	vault: string;
	session: string;
	/** `process.execPath` of the running launcher. */
	execPath: string;
	/** Program and leading arguments (exe path, or node plus shim target). */
	claude: ClaudeCommand;
	/** Bundled plugin folder; needed only when the plugin is not installed. */
	pluginDir?: string;
	tempSettingsPath: string;
	agent?: string;
	passThrough: readonly string[];
}

export interface ClaudeLaunch {
	command: string;
	args: string[];
	settings: {
		enabledPlugins: Record<string, true>;
		env: { COEDIT_VAULT: string; COEDIT_SESSION: string; COEDIT_NODE: string };
	};
}

export function buildClaudeLaunch(options: LaunchOptions): ClaudeLaunch {
	const installed = findClaudePlugin(
		options.pluginList,
		options.cwd,
		options.platform,
	);
	const args = [
		...options.claude.prefixArgs,
		"--settings",
		options.tempSettingsPath,
	];
	let id: string;
	if (installed) {
		id = installed.id;
	} else {
		if (options.pluginDir === undefined) {
			throw new Error(
				"the md-coeditor plugin is not installed and the bundled plugin folder was not found (set COEDIT_PLUGIN_DIR)",
			);
		}
		id = INLINE_ID;
		args.push("--plugin-dir", options.pluginDir);
	}
	if (options.agent !== undefined) args.push("--agent", options.agent);
	args.push(...options.passThrough);
	return {
		command: options.claude.command,
		args,
		settings: {
			enabledPlugins: { [id]: true },
			env: {
				COEDIT_VAULT: options.vault,
				COEDIT_SESSION: options.session,
				COEDIT_NODE: options.execPath,
			},
		},
	};
}

// ----------------------------------------------------------------- the run

/** The part of a child process that the launcher uses. */
export type ChildLike = Pick<ChildProcess, "on" | "kill">;

export interface SignalSource {
	on(signal: NodeJS.Signals, handler: () => void): unknown;
	removeListener(signal: NodeJS.Signals, handler: () => void): unknown;
}

export interface ClaudeDeps {
	cwd: string;
	env: Env;
	platform: Platform;
	execPath: string;
	runningFile: string;
	tmpdir: string;
	now: () => number;
	session: () => string;
	exists: (file: string) => boolean;
	readFile: (file: string) => string;
	listPlugins: ListPlugins;
	spawn: (
		command: string,
		args: string[],
		options: { stdio: "inherit"; cwd: string },
	) => ChildLike;
	signals: SignalSource;
}

function defaultDeps(): ClaudeDeps {
	return {
		cwd: process.cwd(),
		env: process.env,
		platform: process.platform,
		execPath: process.execPath,
		runningFile: runningFile(),
		tmpdir: os.tmpdir(),
		now: Date.now,
		session: randomUUID,
		exists: existsSync,
		readFile: (f) => readFileSync(f, "utf8"),
		listPlugins: listInstalledPlugins,
		spawn: (command, args, options) => nodeSpawn(command, args, options),
		signals: process,
	};
}

/** True when a process with this pid runs (EPERM: it runs, but is not ours). */
function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

function ownerRuns(dir: string): boolean {
	try {
		const pid = Number.parseInt(
			readFileSync(path.join(dir, "pid"), "utf8").trim(),
			10,
		);
		return Number.isInteger(pid) && pid > 0 && pidAlive(pid);
	} catch {
		return false;
	}
}

/**
 * Delete `coedit-*` folders older than one day (runs that ended without
 * clean-up). A folder whose `pid` file names a running process stays.
 */
export function pruneTempFolders(tmp: string, now: number): void {
	let names: string[];
	try {
		names = readdirSync(tmp);
	} catch {
		return;
	}
	for (const name of names) {
		if (!name.startsWith("coedit-")) continue;
		const dir = path.join(tmp, name);
		try {
			const st = statSync(dir);
			if (
				st.isDirectory() &&
				now - st.mtimeMs > ONE_DAY_MS &&
				!ownerRuns(dir)
			) {
				rmSync(dir, { recursive: true, force: true });
			}
		} catch {
			// Ignore folders that vanish or that we cannot read.
		}
	}
}

function exitCodeOf(
	code: number | null,
	signal: NodeJS.Signals | null,
): number {
	if (code !== null) return code;
	if (signal !== null) {
		const n = os.constants.signals[signal];
		return n === undefined ? 1 : 128 + n;
	}
	return 1;
}

function isVault(dir: string): boolean {
	try {
		return statSync(path.join(dir, ".obsidian")).isDirectory();
	} catch {
		return false;
	}
}

function chooseVault(
	args: ClaudeArgs,
	cwd: string,
): { vault: string } | { error: string } {
	if (args.vault !== undefined) {
		const vault = path.resolve(cwd, args.vault);
		return isVault(vault)
			? { vault }
			: { error: `${vault} is not an Obsidian vault (no .obsidian folder).\n` };
	}
	const found = discoverVault(cwd);
	if (found.kind === "found") return { vault: found.vault };
	if (found.kind === "none") {
		return {
			error: `no Obsidian vault found at or above ${cwd}, or below it. Use --vault <path>.\n`,
		};
	}
	const list = found.vaults.map((v) => `  ${v}`).join("\n");
	return {
		error: `more than one Obsidian vault found below ${cwd}:\n${list}\nUse --vault <path> to choose one.\n`,
	};
}

export function createClaudeCommand(
	overrides: Partial<ClaudeDeps> = {},
): Subcommand {
	return {
		name: "claude",
		description: "Start Claude Code with the co-editor for one session",
		handler: (args, io) =>
			runClaude(args, io, { ...defaultDeps(), ...overrides }),
	};
}

export const claudeCommand: Subcommand = createClaudeCommand();

export async function runClaude(
	argv: string[],
	io: Io,
	deps: ClaudeDeps,
): Promise<number> {
	let args: ClaudeArgs;
	try {
		args = parseClaudeArgs(argv);
	} catch (err) {
		io.stderr(
			`coedit claude: ${err instanceof Error ? err.message : String(err)}\n${CLAUDE_USAGE}`,
		);
		return EXIT_USAGE;
	}
	if (args.help) {
		io.stdout(CLAUDE_USAGE);
		return EXIT_OK;
	}

	const chosen = chooseVault(args, deps.cwd);
	if ("error" in chosen) {
		io.stderr(`coedit claude: ${chosen.error}`);
		return EXIT_ERROR;
	}

	const location = findClaude({
		env: deps.env,
		platform: deps.platform,
		exists: deps.exists,
	});
	if (location === undefined) {
		io.stderr(
			"coedit claude: claude not found on the PATH. Install Claude Code first.\n",
		);
		return EXIT_ERROR;
	}
	const resolved = resolveClaude(
		location,
		deps.platform,
		deps.execPath,
		deps.readFile,
		deps.exists,
	);
	if (!resolved.ok) {
		io.stderr(`coedit claude: ${resolved.message}\n`);
		return EXIT_ERROR;
	}

	const pluginList = await deps.listPlugins(resolved.claude);
	const pluginDir = findPluginDir(deps.env, deps.runningFile, deps.exists);

	pruneTempFolders(deps.tmpdir, deps.now());
	const tempDir = mkdtempSync(path.join(deps.tmpdir, "coedit-"));
	const tempSettingsPath = path.join(tempDir, "settings.json");
	try {
		writeFileSync(path.join(tempDir, "pid"), String(process.pid));
	} catch {
		// Without a pid file the age rule applies.
	}
	const cleanup = () => rmSync(tempDir, { recursive: true, force: true });

	let launch: ClaudeLaunch;
	try {
		launch = buildClaudeLaunch({
			platform: deps.platform,
			pluginList,
			cwd: deps.cwd,
			vault: chosen.vault,
			session: deps.session(),
			execPath: deps.execPath,
			claude: resolved.claude,
			pluginDir,
			tempSettingsPath,
			agent: args.agent,
			passThrough: args.passThrough,
		});
		writeFileSync(
			tempSettingsPath,
			`${JSON.stringify(launch.settings, null, 2)}\n`,
		);
	} catch (err) {
		cleanup();
		io.stderr(
			`coedit claude: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return EXIT_ERROR;
	}

	return new Promise<number>((resolve) => {
		let child: ChildLike;
		const ignore = () => {};
		const forward = (signal: NodeJS.Signals) => () => {
			child?.kill(signal);
		};
		const onTerm = forward("SIGTERM");
		const onHup = forward("SIGHUP");
		const attach = () => {
			deps.signals.on("SIGINT", ignore);
			deps.signals.on("SIGTERM", onTerm);
			deps.signals.on("SIGHUP", onHup);
		};
		const detach = () => {
			deps.signals.removeListener("SIGINT", ignore);
			deps.signals.removeListener("SIGTERM", onTerm);
			deps.signals.removeListener("SIGHUP", onHup);
		};
		let done = false;
		const finish = (code: number) => {
			if (done) return;
			done = true;
			detach();
			cleanup();
			resolve(code);
		};

		attach();
		try {
			child = deps.spawn(launch.command, launch.args, {
				stdio: "inherit",
				cwd: deps.cwd,
			});
		} catch (err) {
			io.stderr(
				`coedit claude: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			finish(EXIT_ERROR);
			return;
		}
		child.on("error", (err: Error) => {
			io.stderr(`coedit claude: cannot start claude: ${err.message}\n`);
			finish(EXIT_ERROR);
		});
		child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
			finish(exitCodeOf(code, signal));
		});
	});
}
