// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal unexpanded variable
import { EventEmitter } from "node:events";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { endpointPath } from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import {
	buildClaudeLaunch,
	type ChildLike,
	type ClaudeDeps,
	runClaude,
} from "../src/commands/claude";
import { type InitDeps, runInit } from "../src/commands/init";
import { readCursor } from "../src/cursor";
import { type Io, run } from "../src/run";
import { decision, suggestion, tempVault, writeLog } from "../src/testkit";
import { startFakeHub } from "./fake-hub";
import { startMcp } from "./harness";
import { inbox } from "./inbox-harness";

const REAL_CLAUDE =
	"manual check 12.3 in openspec/changes/archive/2026-10-25-add-claude-suggest-loop/tasks.md";
const WINDOWS = "on Windows, see openspec/docs/windows-check-list.md";

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

class FakeChild extends EventEmitter {
	kill() {
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
	emit(s: string) {
		for (const h of this.handlers.get(s) ?? []) h();
	}
}

// Realistic npm cmd-shim text for a `.js` target.
const SHIM_JS = [
	"@ECHO off",
	"GOTO start",
	":find_dp0",
	"SET dp0=%~dp0",
	"EXIT /b",
	":start",
	"SETLOCAL",
	"CALL :find_dp0",
	'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
	"",
].join("\r\n");

let root: string;
beforeEach(() => {
	root = mkdtempSync(path.join(os.tmpdir(), "coedit-cli-spec-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const mkVault = (...parts: string[]) => {
	const dir = path.join(root, ...parts);
	mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
	return dir;
};

// ------------------------------------------------------------------ help

describe("The four subcommands", () => {
	it("Help lists the subcommands", async () => {
		const f = fakeIo();
		expect(await run(["--help"], f.io)).toBe(0);
		const lines = f.stdout().split("\n");
		for (const name of ["init", "claude", "inbox", "mcp"]) {
			const line = lines.find((l) => l.trim().startsWith(`${name} `));
			expect(line, name).toBeDefined();
			expect((line as string).trim().length).toBeGreaterThan(name.length + 2);
		}
	});
});

// ------------------------------------------------------------------ init

describe("init", () => {
	let repo: string;
	let vault: string;
	let dist: string;
	let deps: InitDeps;

	beforeEach(() => {
		repo = path.join(root, "repo");
		vault = path.join(repo, "notes");
		dist = path.join(root, "obsidian-dist");
		mkdirSync(path.join(repo, ".git"), { recursive: true });
		mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
		mkdirSync(dist);
		writeFileSync(path.join(dist, "main.js"), "// main");
		writeFileSync(
			path.join(dist, "manifest.json"),
			'{"id":"md-coeditor","version":"1.0.0"}',
		);
		writeFileSync(path.join(dist, "styles.css"), "/* css */");
		deps = {
			cwd: vault,
			env: { PATH: "/fake/bin", COEDIT_OBSIDIAN_PLUGIN_DIR: dist },
			platform: "darwin",
			execPath: "/usr/bin/node",
			runningFile: path.join(root, "nowhere", "dist", "coedit.mjs"),
			exists: (f) => f === "/fake/bin/claude" || existsSync(f),
			readFile: () => "",
			listPlugins: async () => [],
		};
	});

	const init = async (args: string[] = []) => {
		const f = fakeIo();
		const code = await runInit(args, f.io, deps);
		return { code, out: f.stdout(), err: f.stderr() };
	};
	const plugin = () => path.join(vault, ".obsidian", "plugins", "md-coeditor");

	describe("Init finds the vault", () => {
		it("Run in a subfolder of a vault", async () => {
			mkdirSync(path.join(vault, "projects"));
			deps.cwd = path.join(vault, "projects");
			await init();
			expect(existsSync(path.join(vault, ".coedit"))).toBe(true);
		});

		it("Not in a vault", async () => {
			const bare = path.join(root, "bare");
			mkdirSync(bare);
			deps.cwd = bare;
			const before = readdirOf(root);
			const r = await init();
			expect(r.err).toContain("Not inside an Obsidian vault");
			expect(readdirOf(root)).toEqual(before);
			expect(r.code).toBe(1);
		});
	});

	describe("Init prepares the coedit folder", () => {
		it("First run", async () => {
			await init();
			expect(
				JSON.parse(
					readFileSync(path.join(vault, ".coedit", "config.json"), "utf8"),
				),
			).toEqual({ digestBudget: 8000 });
			expect(
				readFileSync(path.join(vault, ".coedit", ".gitignore"), "utf8"),
			).toContain("local/");
		});

		it("Second run keeps settings", async () => {
			mkdirSync(path.join(vault, ".coedit"));
			writeFileSync(
				path.join(vault, ".coedit", "config.json"),
				'{"digestBudget": 4000}',
			);
			writeFileSync(path.join(vault, ".coedit", ".gitignore"), "drafts/\n");
			await init();
			expect(
				JSON.parse(
					readFileSync(path.join(vault, ".coedit", "config.json"), "utf8"),
				),
			).toEqual({ digestBudget: 4000 });
			const ignore = readFileSync(
				path.join(vault, ".coedit", ".gitignore"),
				"utf8",
			);
			expect(ignore).toContain("drafts/");
			expect(ignore).toContain("local/");
		});
	});

	describe("Init installs the Obsidian plugin", () => {
		it("Plugin copied", async () => {
			const r = await init();
			expect(existsSync(path.join(plugin(), "main.js"))).toBe(true);
			expect(existsSync(path.join(plugin(), "manifest.json"))).toBe(true);
			expect(
				JSON.parse(
					readFileSync(
						path.join(vault, ".obsidian", "community-plugins.json"),
						"utf8",
					),
				),
			).toContain("md-coeditor");
			expect(r.out).toContain("Reload Obsidian");
		});

		it("Dev link", async () => {
			expect((await init(["--dev"])).code).toBe(0);
			expect(lstatSync(plugin()).isSymbolicLink()).toBe(true);
			expect(path.resolve(path.dirname(plugin()), readlinkSync(plugin()))).toBe(
				dist,
			);
		});

		it("Plugin files not found", async () => {
			deps.env = { PATH: "/fake/bin" };
			const r = await init();
			expect(r.err).toContain("plugin files not found");
			expect(existsSync(path.join(vault, ".coedit", "config.json"))).toBe(true);
			expect(r.code).toBe(1);
		});
	});

	describe("Init reports the Claude plugin", () => {
		it("Not installed", async () => {
			const r = await init();
			expect(r.out).toContain("coedit claude works without an install");
			expect(r.out).toContain("claude plugin install");
			expect(existsSync(path.join(repo, ".claude"))).toBe(false);
		});

		it("Claude not found", async () => {
			deps.exists = (f) => existsSync(f);
			const r = await init();
			expect(r.out).toContain("claude was not found");
			expect(r.code).toBe(0);
		});
	});

	describe("Init warns about a plugin that is always on", () => {
		it("Installed and on at user scope", async () => {
			deps.listPlugins = async () => [
				{ id: "md-coeditor@md-coeditor", scope: "user", enabled: true },
			];
			const r = await init();
			expect(r.out).toContain("md-coeditor@md-coeditor");
			expect(r.out).toContain("claude plugin disable md-coeditor@md-coeditor");
		});
	});

	describe("Init shows the deny rule", () => {
		it("Vault in a repo", async () => {
			const r = await init();
			expect(r.out).toContain('"deny": ["Edit(/notes/**/*.md)"]');
			expect(r.out).toContain(path.join(repo, ".claude", "settings.json"));
			expect(existsSync(path.join(repo, ".claude"))).toBe(false);
		});
	});
});

function readdirOf(dir: string): string[] {
	const found: string[] = [];
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else found.push(path.relative(dir, p));
		}
	};
	walk(dir);
	return found.sort();
}

// ---------------------------------------------------------------- launcher

describe("claude launcher", () => {
	let tmp: string;
	let repo: string;
	let child: FakeChild;
	let signals: FakeSignals;
	let spawned: { command: string; args: string[]; cwd: string }[];
	let settingsSeen: string[];
	let deps: ClaudeDeps;
	let sessionN: number;

	beforeEach(() => {
		tmp = path.join(root, "tmp");
		repo = path.join(root, "repo");
		mkdirSync(tmp);
		mkdirSync(repo);
		child = new FakeChild();
		signals = new FakeSignals();
		spawned = [];
		settingsSeen = [];
		sessionN = 0;
		deps = {
			cwd: repo,
			env: { PATH: "/fake/bin", COEDIT_PLUGIN_DIR: "/bundled/plugin" },
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
	});

	const start = (args: string[]) => {
		const f = fakeIo();
		return { f, done: runClaude(args, f.io, deps) };
	};
	const tick = () => new Promise((r) => setTimeout(r, 5));
	const settings = (n = 0) => JSON.parse(settingsSeen[n] as string);
	/** One complete run: start, wait for the spawn, let claude exit. */
	async function session(args: string[] = []) {
		child = new FakeChild();
		const r = start(args);
		await tick();
		child.emit("exit", 0, null);
		return { ...r, code: await r.done };
	}

	describe("The launcher finds the vault", () => {
		it("Vault below the repo", async () => {
			const vault = mkVault("repo", "docs", "vault");
			await session();
			expect(settings().env.COEDIT_VAULT).toBe(vault);
			expect(spawned[0]?.cwd).toBe(repo);
		});

		it("Two vaults below", async () => {
			mkVault("repo", "a");
			mkVault("repo", "b");
			const { f, code } = await session();
			expect(f.stderr()).toContain(path.join(repo, "a"));
			expect(f.stderr()).toContain(path.join(repo, "b"));
			expect(f.stderr()).toContain("--vault");
			expect(code).toBe(1);
			expect(spawned).toHaveLength(0);
		});

		it("Vault option is not a vault", async () => {
			mkdirSync(path.join(repo, "docs"));
			const { f, done } = start(["--vault", "docs"]);
			expect(await done).toBe(1);
			expect(f.stderr()).toContain("docs");
			expect(f.stderr()).toContain("not an Obsidian vault");
		});
	});

	describe("The launcher switches the plugin on for one session", () => {
		beforeEach(() => {
			mkVault("repo", "notes");
		});

		it("Plugin installed from the marketplace", async () => {
			deps.listPlugins = async () => [
				{ id: "md-coeditor@md-coeditor", scope: "user", enabled: true },
			];
			await session();
			expect(settings().enabledPlugins).toEqual({
				"md-coeditor@md-coeditor": true,
			});
			expect(spawned[0]?.args).toContain("--settings");
			expect(spawned[0]?.args).not.toContain("--plugin-dir");
		});

		it("Plugin not installed", async () => {
			await session();
			const args = spawned[0]?.args as string[];
			expect(args[args.indexOf("--plugin-dir") + 1]).toBe("/bundled/plugin");
			expect(settings().enabledPlugins).toEqual({ "md-coeditor@inline": true });
		});

		it("Settings file removed", async () => {
			await session();
			const file = spawned[0]?.args[1] as string;
			expect(existsSync(file)).toBe(false);
			expect(existsSync(path.dirname(file))).toBe(false);
		});
	});

	describe("The launcher passes the session values", () => {
		it("A new session id for each run", async () => {
			const vault = mkVault("repo", "notes");
			await session();
			await session();
			expect(settings(0).env.COEDIT_VAULT).toBe(vault);
			expect(settings(1).env.COEDIT_VAULT).toBe(vault);
			expect(settings(0).env.COEDIT_SESSION).not.toBe(
				settings(1).env.COEDIT_SESSION,
			);
			expect(settings(0).env.COEDIT_NODE).toBe("/usr/bin/node");
		});
	});

	describe("The launcher survives Ctrl+C", () => {
		beforeEach(() => {
			mkVault("repo", "notes");
		});

		it("Ctrl+C during an agent turn", async () => {
			const { done } = start([]);
			await tick();
			const file = spawned[0]?.args[1] as string;
			signals.emit("SIGINT");
			expect(existsSync(file)).toBe(true);
			// The launcher still waits for claude: it has not finished.
			let finished = false;
			done.then(() => {
				finished = true;
			});
			await tick();
			expect(finished).toBe(false);
			child.emit("exit", 0, null);
			await done;
		});

		it("Left-over folder", async () => {
			const old = path.join(tmp, "coedit-old");
			mkdirSync(old);
			const twoDays = new Date(Date.now() - 2 * 24 * 3600 * 1000);
			utimesSync(old, twoDays, twoDays);
			await session();
			expect(existsSync(old)).toBe(false);
		});
	});

	describe("The launcher starts an agent profile on request", () => {
		beforeEach(() => {
			mkVault("repo", "notes");
		});

		it("Shipped profile", async () => {
			await session(["--agent"]);
			const args = spawned[0]?.args as string[];
			expect(args[args.indexOf("--agent") + 1]).toBe("md-coeditor:co-editor");
		});

		it("Own profile", async () => {
			await session(["--agent", "my-editor"]);
			const args = spawned[0]?.args as string[];
			expect(args[args.indexOf("--agent") + 1]).toBe("my-editor");
		});
	});

	describe("The launcher passes other arguments through", () => {
		it("Pass a model", async () => {
			mkVault("repo", "notes");
			await session(["--", "--model", "sonnet"]);
			expect(spawned[0]?.args.slice(-2)).toEqual(["--model", "sonnet"]);
		});

		it("Claude missing", async () => {
			mkVault("repo", "notes");
			deps.exists = () => false;
			const { f, code } = await session();
			expect(f.stderr()).toContain("claude");
			expect(f.stderr()).toContain("not found");
			expect(code).toBe(1);
		});
	});

	describe("The launcher starts claude on Windows without a shell", () => {
		it("npm install on Windows", async () => {
			// Pure launch plan with the Windows path from the spec.
			const winVault = "C:\\Users\\A B\\vault";
			const launch = buildClaudeLaunch({
				platform: "win32",
				pluginList: [],
				cwd: "C:\\Users\\A B",
				vault: winVault,
				session: "s",
				execPath: "C:\\node\\node.exe",
				claude: {
					command: "C:\\node\\node.exe",
					prefixArgs: [
						"C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
					],
				},
				pluginDir: "C:\\plugin",
				tempSettingsPath: "C:\\Temp\\coedit-x\\settings.json",
				passThrough: [],
			});
			expect(launch.settings.env.COEDIT_VAULT).toBe(winVault);
			// The program is node or claude.exe, never cmd.exe.
			expect(launch.command).not.toMatch(/cmd(\.exe)?$/i);

			// The run: only claude.cmd is found, its target starts directly.
			mkVault("repo", "notes");
			deps.platform = "win32";
			deps.env = { Path: "C:\\npm", COEDIT_PLUGIN_DIR: "C:\\plugin" };
			deps.execPath = "C:\\node\\node.exe";
			deps.exists = (f) => f !== "C:\\npm\\claude.exe";
			deps.readFile = () => SHIM_JS;
			await session();
			expect(spawned[0]?.command).toBe("C:\\node\\node.exe");
			expect(spawned[0]?.args[0]).toMatch(/claude-code\\cli\.js$/);
		});
		test.todo(`npm install on Windows: ${WINDOWS}`);

		it("Percent sign in an argument", async () => {
			mkVault("repo", "notes");
			deps.platform = "win32";
			deps.env = { Path: "C:\\npm", COEDIT_PLUGIN_DIR: "C:\\plugin" };
			deps.execPath = "C:\\node\\node.exe";
			deps.exists = (f) => f !== "C:\\npm\\claude.exe";
			deps.readFile = () => SHIM_JS;
			const tricky = ["make it 50% shorter", "a ^ b", "wow!", "two  spaces"];
			await session(["--", "--append-system-prompt", ...tricky]);
			expect(spawned[0]?.args.slice(-(tricky.length + 1))).toEqual([
				"--append-system-prompt",
				...tricky,
			]);
		});
		test.todo(`Percent sign in an argument: ${WINDOWS}`);
	});

	test.todo(`Real claude session behind the launcher: ${REAL_CLAUDE}`);
});

// -------------------------------------------------------- bridge and hook

describe("Bridge and hook find the vault", () => {
	let vault: string;
	let cleanup: () => Promise<void>;
	let hubStop: (() => Promise<void>) | undefined;

	beforeEach(async () => {
		({ vault, cleanup } = await tempVault());
	});
	afterEach(async () => {
		await hubStop?.();
		hubStop = undefined;
		await cleanup();
	});

	it("Variable set by the launcher", async () => {
		const hub = await startFakeHub({ vault, machine: "work-mac" });
		hubStop = hub.stop;
		const elsewhere = path.join(vault, "..");
		const m = await startMcp({
			env: { COEDIT_VAULT: vault, COEDIT_SESSION: "s1" },
			cwd: elsewhere,
			hostname: "work-mac",
		});
		try {
			expect(existsSync(endpointPath(vault, "work-mac"))).toBe(true);
			expect((await m.call("get_context")).json).toMatchObject({
				hubConnected: true,
			});
		} finally {
			await m.close();
		}
	});

	it("Unexpanded variable", async () => {
		mkdirSync(path.join(vault, ".obsidian"));
		mkdirSync(path.join(vault, "projects"));
		await writeLog(vault, [suggestion(1, "essay.md", "i1bbbb")]);
		const hookJson = JSON.stringify({ session_id: "x" });
		const env = {
			COEDIT_VAULT: "${COEDIT_VAULT}",
			COEDIT_SESSION: "unexpanded",
		};
		await inbox(["--digest", "--mark-read"], {
			env,
			cwd: path.join(vault, "projects"),
			stdin: hookJson,
		});
		// The cursor of this session is in the vault that was found by discovery.
		expect((await readCursor(vault, "mac", "unexpanded"))?.seq).toBe(1);
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			decision(2, "essay.md", "i1bbbb", "accepted", "slow"),
		]);
		const r = await inbox(["--digest", "--mark-read"], {
			env,
			cwd: path.join(vault, "projects"),
			stdin: hookJson,
		});
		expect(r.stdout).toContain("slow");
	});

	it("Vault below without the variable", async () => {
		const repo = path.join(vault, "repo");
		const below = path.join(repo, "docs", "vault");
		mkdirSync(path.join(below, ".obsidian"), { recursive: true });
		const hub = await startFakeHub({ vault: below, machine: "mac" });
		hubStop = hub.stop;
		const m = await startMcp({
			env: { COEDIT_VAULT: "", COEDIT_SESSION: "s1" },
			cwd: repo,
		});
		try {
			expect((await m.call("get_context")).json).toMatchObject({
				hubConnected: true,
			});
		} finally {
			await m.close();
		}
	});

	it("Endpoint of another machine", async () => {
		const hub = await startFakeHub({ vault, machine: "work-mac" });
		hubStop = hub.stop;
		const file = endpointPath(vault, "work-mac");
		const data = JSON.parse(readFileSync(file, "utf8"));
		writeFileSync(file, JSON.stringify({ ...data, host: "home-pc" }));
		const m = await startMcp({
			env: { COEDIT_VAULT: vault, COEDIT_SESSION: "s1" },
			hostname: "work-mac",
		});
		try {
			expect((await m.call("get_context")).json).toMatchObject({
				hubConnected: false,
			});
		} finally {
			await m.close();
		}
	});
});
