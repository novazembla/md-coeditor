import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePluginList } from "../claude-plugins";
import type { Io } from "../run";
import { compareVersions, type InitDeps, runInit } from "./init";

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

function listFiles(dir: string): string[] {
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

describe("init", () => {
	let root: string;
	let repo: string;
	let vault: string;
	let dist: string;
	let deps: InitDeps;

	beforeEach(() => {
		root = mkdtempSync(path.join(os.tmpdir(), "coedit-init-"));
		repo = path.join(root, "repo");
		vault = path.join(repo, "notes");
		dist = path.join(root, "obsidian-dist");
		mkdirSync(path.join(repo, ".git"), { recursive: true });
		mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
		mkdirSync(dist);
		writeFileSync(path.join(dist, "main.js"), "// main 1");
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
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	const run = async (args: string[] = []) => {
		const f = fakeIo();
		const code = await runInit(args, f.io, deps);
		return { code, out: f.stdout(), err: f.stderr() };
	};
	const plugin = () => path.join(vault, ".obsidian", "plugins", "md-coeditor");

	it("first run: config, gitignore, plugin copy, community list, reload hint", async () => {
		const r = await run();
		expect(r.code).toBe(0);
		expect(
			readFileSync(path.join(vault, ".coedit", "config.json"), "utf8"),
		).toContain('{"digestBudget": 8000}');
		const ignore = readFileSync(
			path.join(vault, ".coedit", ".gitignore"),
			"utf8",
		);
		expect(ignore.split("\n")).toEqual(
			expect.arrayContaining(["local/", "snapshots/", "*.sock", "*.lock"]),
		);
		expect(existsSync(path.join(plugin(), "main.js"))).toBe(true);
		expect(existsSync(path.join(plugin(), "manifest.json"))).toBe(true);
		expect(
			JSON.parse(
				readFileSync(
					path.join(vault, ".obsidian", "community-plugins.json"),
					"utf8",
				),
			),
		).toEqual(["md-coeditor"]);
		expect(r.out).toContain("Reload Obsidian");
	});

	it("works from a subfolder of the vault", async () => {
		mkdirSync(path.join(vault, "projects"));
		deps.cwd = path.join(vault, "projects");
		expect((await run()).code).toBe(0);
		expect(existsSync(path.join(vault, ".coedit"))).toBe(true);
	});

	it("not in a vault: message, no change, exit 1", async () => {
		const bare = path.join(root, "bare");
		mkdirSync(bare);
		deps.cwd = bare;
		const before = listFiles(root);
		const r = await run();
		expect(r.code).toBe(1);
		expect(r.err).toContain("Not inside an Obsidian vault");
		expect(listFiles(root)).toEqual(before);
	});

	it("second run keeps config.json and the user's gitignore lines", async () => {
		mkdirSync(path.join(vault, ".coedit"));
		writeFileSync(
			path.join(vault, ".coedit", "config.json"),
			'{"digestBudget": 4000}',
		);
		writeFileSync(path.join(vault, ".coedit", ".gitignore"), "drafts/\nlocal/");
		writeFileSync(
			path.join(vault, ".obsidian", "community-plugins.json"),
			'["other-plugin"]',
		);
		await run();
		await run();
		expect(
			readFileSync(path.join(vault, ".coedit", "config.json"), "utf8"),
		).toBe('{"digestBudget": 4000}');
		const lines = readFileSync(
			path.join(vault, ".coedit", ".gitignore"),
			"utf8",
		)
			.split("\n")
			.filter(Boolean);
		expect(lines).toEqual([
			"drafts/",
			"local/",
			"snapshots/",
			"*.sock",
			"*.lock",
		]);
		expect(
			JSON.parse(
				readFileSync(
					path.join(vault, ".obsidian", "community-plugins.json"),
					"utf8",
				),
			),
		).toEqual(["other-plugin", "md-coeditor"]);
	});

	it("copies again for an older version or a changed main.js, not for a newer one", async () => {
		await run();
		writeFileSync(path.join(dist, "manifest.json"), '{"version":"1.1.0"}');
		writeFileSync(path.join(dist, "main.js"), "// main 2");
		await run();
		expect(readFileSync(path.join(plugin(), "main.js"), "utf8")).toBe(
			"// main 2",
		);
		writeFileSync(path.join(dist, "main.js"), "// main 3");
		await run();
		expect(readFileSync(path.join(plugin(), "main.js"), "utf8")).toBe(
			"// main 3",
		);
		writeFileSync(path.join(dist, "manifest.json"), '{"version":"1.0.5"}');
		writeFileSync(path.join(dist, "main.js"), "// old build");
		await run();
		expect(readFileSync(path.join(plugin(), "main.js"), "utf8")).toBe(
			"// main 3",
		);
	});

	it("--dev links the plugin folder to the build folder", async () => {
		const r = await run(["--dev"]);
		expect(r.code).toBe(0);
		expect(lstatSync(plugin()).isSymbolicLink()).toBe(true);
		expect(path.resolve(path.dirname(plugin()), readlinkSync(plugin()))).toBe(
			dist,
		);
		expect((await run(["--dev"])).out).toContain("already linked");
	});

	it("--dev refuses to replace a real folder", async () => {
		await run();
		const r = await run(["--dev"]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("real folder");
		expect(lstatSync(plugin()).isSymbolicLink()).toBe(false);
	});

	it("plugin files not found: says so, other steps run, exit 1", async () => {
		deps.env = { PATH: "/fake/bin" };
		const r = await run();
		expect(r.code).toBe(1);
		expect(r.err).toContain("plugin files not found");
		expect(existsSync(path.join(vault, ".coedit", "config.json"))).toBe(true);
		expect(existsSync(plugin())).toBe(false);
	});

	it("prints the deny rule for a vault in a repo and writes no .claude folder", async () => {
		const r = await run();
		expect(r.out).toContain('"deny": ["Edit(/notes/**/*.md)"]');
		expect(r.out).toContain('"permissions"');
		expect(r.out).toContain(path.join(repo, ".claude", "settings.json"));
		expect(r.out).toContain("coedit claude starts in");
		expect(r.out).toContain("does not stop scripts");
		expect(r.out).toContain("sandbox");
		expect(existsSync(path.join(repo, ".claude"))).toBe(false);
		expect(existsSync(path.join(vault, ".claude"))).toBe(false);
	});

	it("vault is the git root: rule without a folder", async () => {
		mkdirSync(path.join(vault, ".git"));
		expect((await run()).out).toContain('"deny": ["Edit(/**/*.md)"]');
	});

	it("does not change notes or the vault's .gitignore", async () => {
		writeFileSync(path.join(vault, "a.md"), "hello");
		writeFileSync(path.join(vault, ".gitignore"), "x\n");
		await run();
		expect(readFileSync(path.join(vault, "a.md"), "utf8")).toBe("hello");
		expect(readFileSync(path.join(vault, ".gitignore"), "utf8")).toBe("x\n");
	});

	it("claude not installed: tells how to install, exit 0, no Claude files", async () => {
		const r = await run();
		expect(r.code).toBe(0);
		expect(r.out).toContain("coedit claude works without an install");
		expect(r.out).toContain("claude plugin install md-coeditor@md-coeditor");
		expect(r.out).toContain("claude plugin marketplace add");
	});

	it("claude not found: warning on stdout, exit 0", async () => {
		deps.exists = (f) => existsSync(f);
		const r = await run();
		expect(r.code).toBe(0);
		expect(r.out).toContain("claude was not found");
	});

	it("plugin on at user scope: warning and the disable command", async () => {
		deps.listPlugins = async () => [
			{ id: "md-coeditor@md-coeditor", scope: "user", enabled: true },
		];
		const r = await run();
		expect(r.out).toContain("md-coeditor@md-coeditor");
		expect(r.out).toContain("claude plugin disable md-coeditor@md-coeditor");
	});

	it("plugin installed but off: shows the id, no warning", async () => {
		deps.listPlugins = async () => [
			{ id: "md-coeditor@md-coeditor", scope: "user", enabled: false },
		];
		const r = await run();
		expect(r.out).toContain("md-coeditor@md-coeditor");
		expect(r.out).not.toContain("claude plugin disable");
	});

	it("the fixture list (real claude output) counts as not installed", async () => {
		deps.listPlugins = async () => parsePluginList(fixture);
		expect((await run()).out).toContain(
			"coedit claude works without an install",
		);
	});
});

describe("compareVersions", () => {
	it("compares numeric parts", () => {
		expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
		expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
		expect(compareVersions("1.0", "1.0.0")).toBe(0);
	});
});
