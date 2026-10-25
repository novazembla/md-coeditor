// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal Claude Code variables
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, describe, expect, it, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(root, "..", "..");
const bundle = path.join(root, "dist", "coedit.mjs");
const built = existsSync(bundle);
const SKIP_NOTE = `${bundle} not found: run "pnpm build" first`;
if (!built)
	console.warn(`[claude-plugin] Skipping bundle tests. ${SKIP_NOTE}.`);

const MANUAL =
	"manual check 12.3 in openspec/changes/archive/2026-10-25-add-claude-suggest-loop/tasks.md";

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const read = (...parts: string[]) =>
	readFileSync(path.join(root, ...parts), "utf8");

const TOOL_PREFIX = "mcp__plugin_md-coeditor_md-coeditor__";
const FIVE_TOOLS = [
	"get_context",
	"get_detail",
	"get_digest",
	"read_note",
	"suggest_edit",
];

function profile() {
	const text = read("agents", "co-editor.md");
	const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
	if (!m) throw new Error("co-editor.md has no frontmatter");
	const front = Object.fromEntries(
		(m[1] as string).split("\n").map((l) => {
			const i = l.indexOf(":");
			return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
		}),
	);
	const tools = (front.tools ?? "").split(",").map((t) => t.trim());
	return { front, tools, body: m[2] as string };
}

describe("Off unless the launcher switches it on", () => {
	it("Plain claude session", () => {
		// The files that keep a plain session clean. The session itself: real claude.
		expect(
			readJson(path.join(root, ".claude-plugin", "plugin.json")),
		).toMatchObject({ defaultEnabled: false });
		const market = readJson(
			path.join(repoRoot, ".claude-plugin", "marketplace.json"),
		);
		const entry = market.plugins.find(
			(p: { name: string }) => p.name === "md-coeditor",
		);
		expect(entry.defaultEnabled).toBe(false);
		expect(
			readJson(path.join(root, ".claude-plugin", "plugin.json")).agent,
		).toBeUndefined();
		expect(
			readJson(path.join(root, ".claude-plugin", "plugin.json")).settings,
		).toBeUndefined();
	});
	test.todo(`Plain claude session (real session): ${MANUAL}`);

	test.todo(`Started by the launcher: ${MANUAL}`);
});

describe("The plugin starts the MCP server", () => {
	test.todo(`Server in the session: ${MANUAL}`);

	it("Server config", () => {
		const config = readJson(path.join(root, ".mcp.json"));
		expect(Object.keys(config.mcpServers)).toEqual(["md-coeditor"]);
		const server = config.mcpServers["md-coeditor"];
		expect(server.command).toBe("${COEDIT_NODE:-node}");
		expect(server.args).toEqual([
			"${CLAUDE_PLUGIN_ROOT}/dist/coedit.mjs",
			"mcp",
		]);
		expect(Object.keys(server.env).sort()).toEqual([
			"COEDIT_SESSION",
			"COEDIT_VAULT",
		]);
	});
});

describe("The plugin runs the digest hook", () => {
	it("hooks.json declares one UserPromptSubmit hook (timeout at most 10)", () => {
		const { hooks } = readJson(path.join(root, "hooks", "hooks.json"));
		expect(Object.keys(hooks)).toEqual(["UserPromptSubmit"]);
		expect(hooks.UserPromptSubmit).toHaveLength(1);
		expect(hooks.UserPromptSubmit[0].hooks).toHaveLength(1);
		const hook = hooks.UserPromptSubmit[0].hooks[0];
		expect(hook.type).toBe("command");
		expect(hook.command).toBe(
			'node "${CLAUDE_PLUGIN_ROOT}/dist/coedit.mjs" inbox --digest --mark-read',
		);
		expect(hook.timeout).toBeGreaterThan(0);
		expect(hook.timeout).toBeLessThanOrEqual(10);
	});
	test.todo(`Prompt after a decision: ${MANUAL}`);
});

describe("Optional agent profile", () => {
	it("The profile has the right tools and text", () => {
		const { front, tools, body } = profile();
		expect(front.name).toBe("co-editor");
		expect([...tools].sort()).toEqual(
			[
				...FIVE_TOOLS.map((t) => `${TOOL_PREFIX}${t}`),
				"Read",
				"Grep",
				"Glob",
				"WebFetch",
			].sort(),
		);
		for (const forbidden of ["Edit", "Write", "Bash"]) {
			expect(tools).not.toContain(forbidden);
		}
		expect(body).toContain("suggest_edit");
		expect(body).toContain("get_context");
		expect(body).toContain("digest");
		expect(body).toContain("get_detail");
		expect(body).toMatch(/subagent, do not call `get_digest`/);
	});

	it("The plugin sets no default agent", () => {
		const manifest = readJson(path.join(root, ".claude-plugin", "plugin.json"));
		expect(manifest).not.toHaveProperty("agent");
		expect(JSON.stringify(manifest)).not.toContain("agent");
	});

	test.todo(`Default session: ${MANUAL}`);
	test.todo(`Profile on request: ${MANUAL}`);
});

describe("The plugin is self-contained", () => {
	const copies: string[] = [];
	afterAll(() => {
		for (const dir of copies) rmSync(dir, { recursive: true, force: true });
	});

	it("has no bin/ folder and no reference outside its folder", () => {
		expect(existsSync(path.join(root, "bin"))).toBe(false);
		const config = [
			".mcp.json",
			path.join("hooks", "hooks.json"),
			path.join(".claude-plugin", "plugin.json"),
		];
		for (const file of config) {
			const text = read(file);
			// A path that goes up (`..`) leaves the plugin folder.
			expect(text, file).not.toMatch(/(^|[\\/"\s])\.\.([\\/"\s]|$)/);
		}
	});

	if (!built) {
		it("Plugin folder alone (not built)", (ctx) => ctx.skip(SKIP_NOTE));
	}

	it.skipIf(!built)(
		"Plugin folder alone",
		async () => {
			const copy = mkdtempSync(path.join(os.tmpdir(), "coedit-plugin-copy-"));
			copies.push(copy);
			for (const name of [
				".claude-plugin",
				".mcp.json",
				"hooks",
				"agents",
				"dist",
			]) {
				cpSync(path.join(root, name), path.join(copy, name), {
					recursive: true,
				});
			}
			const empty = mkdtempSync(path.join(os.tmpdir(), "coedit-plugin-cwd-"));
			copies.push(empty);
			const transport = new StdioClientTransport({
				command: process.execPath,
				args: [path.join(copy, "dist", "coedit.mjs"), "mcp"],
				cwd: empty,
				env: {
					PATH: process.env.PATH ?? "",
					COEDIT_VAULT: "",
					COEDIT_SESSION: "",
				},
				stderr: "ignore",
			});
			const client = new Client({ name: "test", version: "1" });
			try {
				await client.connect(transport);
				const { tools } = await client.listTools();
				expect(tools.map((t) => t.name).sort()).toEqual(FIVE_TOOLS);
			} finally {
				await client.close();
			}
		},
		30_000,
	);

	test.todo(
		`Plugin folder alone, loaded with --plugin-dir by claude: ${MANUAL}`,
	);
});
