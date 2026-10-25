import { EventEmitter } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	findClaude,
	findClaudePlugin,
	findPluginDir,
	parsePluginList,
	resolveShim,
} from "../claude-plugins";
import type { Io } from "../run";
import {
	buildClaudeLaunch,
	type ChildLike,
	type ClaudeDeps,
	type LaunchOptions,
	parseClaudeArgs,
	runClaude,
} from "./claude";

const fixture = readFileSync(
	path.join(
		import.meta.dirname,
		"..",
		"..",
		"test",
		"fixtures",
		"plugin-list.json",
	),
	"utf8",
);

// Realistic npm cmd-shim text (npm 10, cmd-shim 6) for a `.js` target.
const SHIM_JS = [
	"@ECHO off",
	"GOTO start",
	":find_dp0",
	"SET dp0=%~dp0",
	"EXIT /b",
	":start",
	"SETLOCAL",
	"CALL :find_dp0",
	"",
	'IF EXIST "%dp0%\\node.exe" (',
	'  SET "_prog=%dp0%\\node.exe"',
	") ELSE (",
	'  SET "_prog=node"',
	"  SET PATHEXT=%PATHEXT:;.JS;=;%",
	")",
	"",
	'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
	"",
].join("\r\n");

const SHIM_EXE = SHIM_JS.replace("cli.js", "bin\\claude.exe");

const base: LaunchOptions = {
	platform: "darwin",
	pluginList: [],
	cwd: "/work/repo",
	vault: "/work/repo/notes",
	session: "sess-1",
	execPath: "/usr/local/bin/node",
	claude: { command: "/usr/local/bin/claude", prefixArgs: [] },
	pluginDir: "/opt/coedit/plugin",
	tempSettingsPath: "/tmp/coedit-abc/settings.json",
	passThrough: [],
};

describe("parseClaudeArgs", () => {
	it("--agent without a name uses the shipped profile", () => {
		expect(parseClaudeArgs(["--agent"]).agent).toBe("md-coeditor:co-editor");
		expect(parseClaudeArgs(["--agent", "--vault", "v"]).agent).toBe(
			"md-coeditor:co-editor",
		);
		expect(parseClaudeArgs(["--agent", "--", "--model", "x"]).agent).toBe(
			"md-coeditor:co-editor",
		);
	});
	it("--agent with a name uses it", () => {
		expect(parseClaudeArgs(["--agent", "my-editor"]).agent).toBe("my-editor");
		expect(parseClaudeArgs(["--agent=my-editor"]).agent).toBe("my-editor");
	});
	it("no --agent gives no agent", () => {
		expect(parseClaudeArgs([]).agent).toBeUndefined();
	});
	it("passes everything after -- through unchanged", () => {
		const a = parseClaudeArgs([
			"--vault",
			"v",
			"--",
			"--agent",
			"x",
			"--vault",
			"y",
		]);
		expect(a.vault).toBe("v");
		expect(a.agent).toBeUndefined();
		expect(a.passThrough).toEqual(["--agent", "x", "--vault", "y"]);
	});
	it("rejects unknown options", () => {
		expect(() => parseClaudeArgs(["--nope"])).toThrow();
	});
});

describe("parsePluginList (fixture of claude 2.1.310)", () => {
	it("reads id, scope and enabled", () => {
		const list = parsePluginList(fixture);
		expect(list).toHaveLength(2);
		expect(list[1]).toMatchObject({
			id: "vvu-research@skills-dir",
			scope: "user",
			enabled: true,
		});
		expect(findClaudePlugin(list, "/x")).toBeUndefined();
	});
	it("treats an unknown shape as not installed", () => {
		expect(parsePluginList("not json")).toEqual([]);
		expect(parsePluginList('{"plugins": []}')).toEqual([]);
		expect(parsePluginList('[{"name": "md-coeditor@x"}, 3, null]')).toEqual([]);
	});
});

describe("findClaudePlugin", () => {
	const entry = (id: string, scope: string, extra = {}) => ({
		id,
		scope,
		enabled: true,
		...extra,
	});
	it("prefers user scope", () => {
		const list = [
			entry("md-coeditor@a", "project", { projectPath: "/work/repo" }),
			entry("md-coeditor@b", "user"),
		];
		expect(findClaudePlugin(list, "/work/repo")?.id).toBe("md-coeditor@b");
	});
	it("ignores project and local entries of another folder", () => {
		const list = [
			entry("md-coeditor@a", "project", { projectPath: "/other" }),
			entry("md-coeditor@b", "local"),
		];
		expect(findClaudePlugin(list, "/work/repo")).toBeUndefined();
	});
	it("uses a project entry of this folder", () => {
		const list = [
			entry("md-coeditor@a", "project", { projectPath: "/work/repo" }),
		];
		expect(findClaudePlugin(list, "/work/repo")?.id).toBe("md-coeditor@a");
	});
	it("compares Windows paths without case", () => {
		const list = [
			entry("md-coeditor@a", "local", { projectPath: "C:\\Work\\Repo" }),
		];
		expect(findClaudePlugin(list, "c:\\work\\repo", "win32")?.id).toBe(
			"md-coeditor@a",
		);
	});
});

describe("buildClaudeLaunch", () => {
	it("installed from the marketplace: id from the list, no --plugin-dir", () => {
		const l = buildClaudeLaunch({
			...base,
			pluginList: [
				{ id: "md-coeditor@md-coeditor", scope: "user", enabled: false },
			],
		});
		expect(l.settings.enabledPlugins).toEqual({
			"md-coeditor@md-coeditor": true,
		});
		expect(l.args).toEqual(["--settings", base.tempSettingsPath]);
		expect(l.command).toBe("/usr/local/bin/claude");
	});
	it("not installed: --plugin-dir and the inline id", () => {
		const l = buildClaudeLaunch(base);
		expect(l.settings.enabledPlugins).toEqual({ "md-coeditor@inline": true });
		expect(l.args).toEqual([
			"--settings",
			base.tempSettingsPath,
			"--plugin-dir",
			"/opt/coedit/plugin",
		]);
	});
	it("not installed and no bundled plugin: throws", () => {
		expect(() => buildClaudeLaunch({ ...base, pluginDir: undefined })).toThrow(
			/COEDIT_PLUGIN_DIR/,
		);
	});
	it("puts the session values in env", () => {
		expect(buildClaudeLaunch(base).settings.env).toEqual({
			COEDIT_VAULT: "/work/repo/notes",
			COEDIT_SESSION: "sess-1",
			COEDIT_NODE: "/usr/local/bin/node",
		});
	});
	it("orders arguments: settings, plugin-dir, agent, pass-through", () => {
		const l = buildClaudeLaunch({
			...base,
			agent: "my-editor",
			passThrough: ["--model", "sonnet"],
		});
		expect(l.args).toEqual([
			"--settings",
			base.tempSettingsPath,
			"--plugin-dir",
			"/opt/coedit/plugin",
			"--agent",
			"my-editor",
			"--model",
			"sonnet",
		]);
	});
	it("keeps spaces, % and ^ in arguments and paths unchanged (Windows)", () => {
		const l = buildClaudeLaunch({
			...base,
			platform: "win32",
			cwd: "C:\\Users\\A B\\repo",
			vault: "C:\\Users\\A B\\vault",
			tempSettingsPath: "C:\\Temp\\coedit-x\\settings.json",
			execPath: "C:\\Program Files\\nodejs\\node.exe",
			pluginDir: "C:\\Program Files\\coedit\\plugin",
			claude: {
				command: "C:\\Program Files\\nodejs\\node.exe",
				prefixArgs: ["C:\\npm\\node_modules\\claude\\cli.js"],
			},
			passThrough: ["--append-system-prompt", "make it 50% shorter ^ now!"],
		});
		expect(l.settings.env.COEDIT_VAULT).toBe("C:\\Users\\A B\\vault");
		expect(l.args.slice(-2)).toEqual([
			"--append-system-prompt",
			"make it 50% shorter ^ now!",
		]);
		expect(l.args[0]).toBe("C:\\npm\\node_modules\\claude\\cli.js");
	});
});

describe("findClaude and shims", () => {
	it("macOS: finds claude on the PATH", () => {
		const hit = "/usr/local/bin/claude";
		expect(
			findClaude({
				env: { PATH: "/bin:/usr/local/bin" },
				platform: "darwin",
				exists: (f) => f === hit,
			}),
		).toEqual({ kind: "exe", path: hit });
		expect(
			findClaude({
				env: { PATH: "/bin" },
				platform: "darwin",
				exists: () => false,
			}),
		).toBeUndefined();
	});
	it("Windows: claude.exe wins over claude.cmd", () => {
		const exe = "C:\\a\\claude.exe";
		const cmd = "C:\\b\\claude.cmd";
		const found = findClaude({
			env: { Path: "C:\\b;C:\\a" },
			platform: "win32",
			exists: (f) => f === exe || f === cmd,
		});
		expect(found).toEqual({ kind: "exe", path: exe });
		expect(
			findClaude({
				env: { Path: "C:\\b;C:\\a" },
				platform: "win32",
				exists: (f) => f === cmd,
			}),
		).toEqual({ kind: "cmd", path: cmd });
	});
	const shim = "C:\\Users\\A B\\AppData\\Roaming\\npm\\claude.cmd";
	it("shim with a .js target runs through node", () => {
		const r = resolveShim(
			shim,
			"C:\\node\\node.exe",
			() => SHIM_JS,
			() => true,
		);
		expect(r).toEqual({
			ok: true,
			claude: {
				command: "C:\\node\\node.exe",
				prefixArgs: [
					"C:\\Users\\A B\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
				],
			},
		});
	});
	it("shim with an .exe target starts it directly", () => {
		const r = resolveShim(
			shim,
			"C:\\node\\node.exe",
			() => SHIM_EXE,
			() => true,
		);
		expect(r).toEqual({
			ok: true,
			claude: {
				command:
					"C:\\Users\\A B\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
				prefixArgs: [],
			},
		});
	});
	it("an unreadable shim asks for the native claude.exe", () => {
		const r = resolveShim(
			shim,
			"node",
			() => {
				throw new Error("EACCES");
			},
			() => true,
		);
		expect(r.ok).toBe(false);
		expect(r.ok === false && r.message).toContain("claude.exe");
		const r2 = resolveShim(
			shim,
			"node",
			() => "@echo off\r\n",
			() => true,
		);
		expect(r2.ok).toBe(false);
	});
});

describe("findPluginDir", () => {
	it("order: env, own parent, repo layout", () => {
		const has = new Set([
			path.normalize("/r/adapters/claude/.claude-plugin/plugin.json"),
		]);
		const exists = (f: string) => has.has(path.normalize(f));
		expect(
			findPluginDir(
				{ COEDIT_PLUGIN_DIR: "/env" },
				"/x/dist/coedit.mjs",
				exists,
			),
		).toBe("/env");
		has.add(path.normalize("/x/.claude-plugin/plugin.json"));
		expect(findPluginDir({}, "/x/dist/coedit.mjs", exists)).toBe(
			path.resolve("/x"),
		);
		expect(
			findPluginDir({}, "/r/packages/bridge/dist/coedit.mjs", exists),
		).toBe(path.resolve("/r/adapters/claude"));
		expect(
			findPluginDir({}, "/nowhere/dist/coedit.mjs", exists),
		).toBeUndefined();
	});
});

// ------------------------------------------------------------ the run

class FakeChild extends EventEmitter {
	killed: string[] = [];
	kill(signal?: NodeJS.Signals | number) {
		this.killed.push(String(signal));
		return true;
	}
}

class FakeSignals {
	handlers = new Map<string, Set<() => void>>();
	on(s: string, h: () => void) {
		if (!this.handlers.has(s)) this.handlers.set(s, new Set());
		this.handlers.get(s)?.add(h);
	}
	removeListener(s: string, h: () => void) {
		this.handlers.get(s)?.delete(h);
	}
	count(s: string) {
		return this.handlers.get(s)?.size ?? 0;
	}
	emit(s: string) {
		for (const h of this.handlers.get(s) ?? []) h();
	}
}

function fakeIo() {
	const out: string[] = [];
	const err: string[] = [];
	const io: Io = {
		stdout: (t) => out.push(t),
		stderr: (t) => err.push(t),
		version: "0",
	};
	return { io, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("runClaude", () => {
	let root: string;
	let tmp: string;
	let repo: string;
	let vault: string;
	let signals: FakeSignals;
	let child: FakeChild;
	let spawned: { command: string; args: string[]; cwd: string }[];
	let settingsSeen: string[];
	let deps: ClaudeDeps;
	let sessionN: number;

	beforeEach(() => {
		root = mkdtempSync(path.join(os.tmpdir(), "coedit-test-"));
		tmp = path.join(root, "tmp");
		repo = path.join(root, "repo");
		vault = path.join(repo, "notes");
		mkdirSync(tmp);
		mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
		signals = new FakeSignals();
		child = new FakeChild();
		spawned = [];
		settingsSeen = [];
		sessionN = 0;
		deps = {
			cwd: repo,
			env: { PATH: "/fake/bin" },
			platform: "darwin",
			execPath: "/usr/bin/node",
			runningFile: path.join(root, "nowhere", "dist", "coedit.mjs"),
			tmpdir: tmp,
			now: () => Date.now(),
			session: () => `s${++sessionN}`,
			exists: (f) => f === "/fake/bin/claude",
			readFile: () => "",
			listPlugins: async () => [],
			spawn: (command, args, options) => {
				spawned.push({ command, args, cwd: options.cwd });
				const i = args.indexOf("--settings");
				settingsSeen.push(readFileSync(args[i + 1] as string, "utf8"));
				return child as unknown as ChildLike;
			},
			signals,
		};
		deps.env = { PATH: "/fake/bin", COEDIT_PLUGIN_DIR: "/bundled/plugin" };
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	const start = (args: string[]) => {
		const f = fakeIo();
		return { f, done: runClaude(args, f.io, deps) };
	};
	const tick = () => new Promise((r) => setTimeout(r, 5));

	it("vault below the repo: runs in the repo with that vault", async () => {
		const { done } = start([]);
		await tick();
		expect(spawned[0]?.cwd).toBe(repo);
		expect(JSON.parse(settingsSeen[0] as string).env.COEDIT_VAULT).toBe(vault);
		child.emit("exit", 0, null);
		expect(await done).toBe(0);
	});

	it("plugin not installed: --plugin-dir and the inline id; installed: marketplace id", async () => {
		let r = start([]);
		await tick();
		expect(spawned[0]?.args).toContain("--plugin-dir");
		expect(JSON.parse(settingsSeen[0] as string).enabledPlugins).toEqual({
			"md-coeditor@inline": true,
		});
		child.emit("exit", 0, null);
		await r.done;

		deps.listPlugins = async () => [
			{ id: "md-coeditor@md-coeditor", scope: "user", enabled: true },
		];
		child = new FakeChild();
		r = start([]);
		await tick();
		expect(spawned[1]?.args).not.toContain("--plugin-dir");
		expect(JSON.parse(settingsSeen[1] as string).enabledPlugins).toEqual({
			"md-coeditor@md-coeditor": true,
		});
		child.emit("exit", 0, null);
		await r.done;
	});

	it("a new session id for each run", async () => {
		for (let i = 0; i < 2; i++) {
			child = new FakeChild();
			const r = start([]);
			await tick();
			child.emit("exit", 0, null);
			await r.done;
		}
		const ids = settingsSeen.map((s) => JSON.parse(s).env.COEDIT_SESSION);
		expect(ids[0]).not.toBe(ids[1]);
	});

	it("passes --agent and the arguments after -- to claude", async () => {
		const { done } = start(["--agent", "--", "--model", "sonnet"]);
		await tick();
		expect(spawned[0]?.args.slice(-4)).toEqual([
			"--agent",
			"md-coeditor:co-editor",
			"--model",
			"sonnet",
		]);
		child.emit("exit", 0, null);
		await done;
	});

	it("exits with the exit code of claude, and with 128+n for a signal", async () => {
		let r = start([]);
		await tick();
		child.emit("exit", 7, null);
		expect(await r.done).toBe(7);
		child = new FakeChild();
		r = start([]);
		await tick();
		child.emit("exit", null, "SIGTERM");
		expect(await r.done).toBe(128 + os.constants.signals.SIGTERM);
	});

	it("ignores SIGINT, forwards SIGTERM and SIGHUP, keeps the settings file while running", async () => {
		const { done } = start([]);
		await tick();
		const file = spawned[0]?.args[1] as string;
		expect(signals.count("SIGINT")).toBe(1);
		signals.emit("SIGINT");
		expect(child.killed).toEqual([]);
		expect(existsSync(file)).toBe(true);
		signals.emit("SIGTERM");
		signals.emit("SIGHUP");
		expect(child.killed).toEqual(["SIGTERM", "SIGHUP"]);
		child.emit("exit", 0, null);
		await done;
		expect(existsSync(file)).toBe(false);
		expect(existsSync(path.dirname(file))).toBe(false);
		expect(signals.count("SIGINT")).toBe(0);
		expect(signals.count("SIGTERM")).toBe(0);
	});

	it("deletes the temp folder when claude cannot start", async () => {
		const { f, done } = start([]);
		await tick();
		const dir = path.dirname(spawned[0]?.args[1] as string);
		child.emit("error", new Error("ENOENT"));
		expect(await done).toBe(1);
		expect(f.stderr()).toContain("cannot start claude");
		expect(existsSync(dir)).toBe(false);
	});

	it("prunes coedit- folders older than one day, keeps newer ones", async () => {
		const old = path.join(tmp, "coedit-old");
		const fresh = path.join(tmp, "coedit-fresh");
		const other = path.join(tmp, "other-old");
		for (const d of [old, fresh, other]) mkdirSync(d);
		const twoDays = new Date(Date.now() - 2 * 24 * 3600 * 1000);
		utimesSync(old, twoDays, twoDays);
		utimesSync(other, twoDays, twoDays);
		const { done } = start([]);
		await tick();
		expect(existsSync(old)).toBe(false);
		expect(existsSync(fresh)).toBe(true);
		expect(existsSync(other)).toBe(true);
		child.emit("exit", 0, null);
		await done;
	});

	it("keeps an old folder whose pid file names a running process", async () => {
		const live = path.join(tmp, "coedit-live");
		const dead = path.join(tmp, "coedit-dead");
		mkdirSync(live);
		mkdirSync(dead);
		writeFileSync(path.join(live, "pid"), String(process.pid));
		writeFileSync(path.join(dead, "pid"), "2147483646");
		const twoDays = new Date(Date.now() - 2 * 24 * 3600 * 1000);
		utimesSync(live, twoDays, twoDays);
		utimesSync(dead, twoDays, twoDays);
		const { done } = start([]);
		await tick();
		expect(existsSync(live)).toBe(true);
		expect(existsSync(dead)).toBe(false);
		const own = readdirSync(tmp).filter(
			(n) => n.startsWith("coedit-") && n !== "coedit-live",
		);
		expect(own.some((n) => existsSync(path.join(tmp, n, "pid")))).toBe(true);
		child.emit("exit", 0, null);
		await done;
	});

	it("claude not found: stderr says so, exit 1", async () => {
		deps.exists = () => false;
		const { f, done } = start([]);
		expect(await done).toBe(1);
		expect(f.stderr()).toContain("claude");
		expect(f.stderr()).toContain("not found");
		expect(spawned).toHaveLength(0);
	});

	it("--vault without .obsidian: names the path, exit 1", async () => {
		mkdirSync(path.join(repo, "docs"));
		const { f, done } = start(["--vault", "docs"]);
		expect(await done).toBe(1);
		expect(f.stderr()).toContain("docs");
		expect(f.stderr()).toContain("not an Obsidian vault");
	});

	it("--vault with .obsidian is used (relative path resolved)", async () => {
		const other = path.join(repo, "other");
		mkdirSync(path.join(other, ".obsidian"), { recursive: true });
		const { done } = start(["--vault", "other"]);
		await tick();
		expect(JSON.parse(settingsSeen[0] as string).env.COEDIT_VAULT).toBe(other);
		child.emit("exit", 0, null);
		await done;
	});

	it("two vaults below: lists both, mentions --vault, exit 1", async () => {
		rmSync(vault, { recursive: true });
		for (const n of ["a", "b"])
			mkdirSync(path.join(repo, n, ".obsidian"), { recursive: true });
		const { f, done } = start([]);
		expect(await done).toBe(1);
		expect(f.stderr()).toContain(path.join(repo, "a"));
		expect(f.stderr()).toContain(path.join(repo, "b"));
		expect(f.stderr()).toContain("--vault");
	});

	it("no vault: mentions --vault, exit 1", async () => {
		rmSync(vault, { recursive: true });
		const { f, done } = start([]);
		expect(await done).toBe(1);
		expect(f.stderr()).toContain("--vault");
	});

	it("Windows with only claude.cmd: starts the shim target without a shell", async () => {
		deps.platform = "win32";
		deps.env = { Path: "C:\\npm", COEDIT_PLUGIN_DIR: "C:\\plugin" };
		deps.exists = () => true;
		deps.readFile = () => SHIM_JS;
		deps.execPath = "C:\\node\\node.exe";
		deps.exists = (f) => f !== "C:\\npm\\claude.exe";
		const { done } = start([
			"--",
			"--append-system-prompt",
			"make it 50% shorter",
		]);
		await tick();
		expect(spawned[0]?.command).toBe("C:\\node\\node.exe");
		expect(spawned[0]?.args[0]).toMatch(/claude-code\\cli\.js$/);
		expect(spawned[0]?.args.slice(-1)).toEqual(["make it 50% shorter"]);
		child.emit("exit", 0, null);
		await done;
	});

	it("unreadable Windows shim: asks for claude.exe, exit 1", async () => {
		deps.platform = "win32";
		deps.env = { Path: "C:\\npm" };
		deps.exists = (f) => f.endsWith("claude.cmd");
		deps.readFile = () => {
			throw new Error("EACCES");
		};
		const { f, done } = start([]);
		expect(await done).toBe(1);
		expect(f.stderr()).toContain("claude.exe");
	});

	it("--help prints usage and does not start claude", async () => {
		const { f, done } = start(["--help"]);
		expect(await done).toBe(0);
		expect(f.stdout()).toContain("--agent");
		expect(spawned).toHaveLength(0);
	});
});
