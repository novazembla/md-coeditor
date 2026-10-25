import { existsSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { machineName } from "@md-coeditor/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeHub, startFakeHub } from "../../test/fake-hub";
import { outcome, startMcp } from "../../test/harness";
import { readCursor } from "../cursor";
import { decision, MACHINE, suggestion, tempVault, writeLog } from "../testkit";

const bundle = path.join(__dirname, "..", "..", "dist", "coedit.mjs");
const built = existsSync(bundle);
const SKIP_NOTE = `${bundle} not found: run "pnpm build" first`;
if (!built) console.warn(`[bridge] Skipping mcp stdio tests. ${SKIP_NOTE}.`);
if (!built) {
	it("coedit mcp over stdio (not built)", (ctx) => ctx.skip(SKIP_NOTE));
}

const machine = machineName(hostname());

let vault: string;
let cleanup: () => Promise<void>;
let hub: FakeHub | undefined;
let client: Client | undefined;
beforeEach(async () => {
	({ vault, cleanup } = await tempVault());
});
afterEach(async () => {
	await client?.close();
	await hub?.stop();
	client = hub = undefined;
	await cleanup();
});

async function connect(env: Record<string, string> = {}): Promise<Client> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [bundle, "mcp"],
		cwd: path.parse(vault).root,
		env: {
			...(process.env as Record<string, string>),
			COEDIT_VAULT: vault,
			COEDIT_SESSION: "stdio-1",
			...env,
		},
		stderr: "ignore",
	});
	client = new Client({ name: "test", version: "1" });
	await client.connect(transport);
	return client;
}

const call = async (c: Client, name: string, args = {}) =>
	outcome(await c.callTool({ name, arguments: args }));

describe.skipIf(!built)("coedit mcp over stdio", () => {
	it("initializes with instructions and lists five tools", async () => {
		const c = await connect();
		expect(c.getServerVersion()?.name).toBe("md-coeditor");
		const text = c.getInstructions() ?? "";
		expect(text).toContain("suggest_edit");
		expect(text).toContain("get_digest");
		const { tools } = await c.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual([
			"get_context",
			"get_detail",
			"get_digest",
			"read_note",
			"suggest_edit",
		]);
		const digest = tools.find((t) => t.name === "get_digest");
		expect(digest?.description).toMatch(/not for subagents/);
	});

	it("passes a refusal with its code and details through", async () => {
		hub = await startFakeHub({
			vault,
			machine,
			respond: () => ({
				ok: false,
				error: {
					code: "ambiguous",
					message: "find matches 2 places",
					details: { matches: 2 },
				},
			}),
		});
		const c = await connect();
		const r = await call(c, "suggest_edit", {
			path: "essay.md",
			find: "cat",
			replace: "dog",
		});
		expect(r.isError).toBe(true);
		expect(r.json).toEqual({
			code: "ambiguous",
			message: "find matches 2 places",
			details: { matches: 2 },
		});
	});

	it("read_note error has the code and a message", async () => {
		hub = await startFakeHub({
			vault,
			machine,
			respond: (method, params) =>
				method === "read_note" && String(params.path).startsWith("..")
					? {
							ok: false,
							error: { code: "invalid_path", message: "Path leaves the vault" },
						}
					: { ok: true, result: {} },
		});
		const c = await connect();
		const r = await call(c, "read_note", { path: "../secrets.md" });
		expect(r.isError).toBe(true);
		expect(r.json).toMatchObject({ code: "invalid_path" });
	});

	it("get_context says hubConnected false when Obsidian is closed", async () => {
		const c = await connect();
		expect((await call(c, "get_context")).json).toMatchObject({
			hubConnected: false,
			activeNote: null,
		});
	});

	it("get_digest works with Obsidian closed", async () => {
		await writeLog(vault, [suggestion(1, "essay.md", "i1bbbb")]);
		await cpMachine();
		const c = await connect();
		// The cursor was created at the end of the log at start.
		expect((await call(c, "get_digest")).text).toBe("No new decisions.");
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			decision(2, "essay.md", "i1bbbb", "accepted", "slow"),
		]);
		await cpMachine();
		const r = await call(c, "get_digest");
		expect(r.isError).toBe(false);
		expect(r.text).toContain("MD-Coeditor: 1 new decision.");
		expect(r.text).not.toContain("Active note:");
		expect((await readCursor(vault, machine, "stdio-1"))?.seq).toBe(2);
	});
});

async function cpMachine(): Promise<void> {
	// testkit writes to the machine "mac"; the bundle uses the real host name.
	const { cp } = await import("node:fs/promises");
	await cp(
		path.join(vault, ".coedit", "local", MACHINE),
		path.join(vault, ".coedit", "local", machine),
		{ recursive: true },
	);
}

describe("coedit mcp without a vault", () => {
	it("starts, and the tools that need the vault say hub_unavailable", async () => {
		const m = await startMcp({
			env: {},
			cwd: vault,
		});
		try {
			const ctx = await m.call("get_context");
			expect(ctx.json).toMatchObject({ hubConnected: false });
			const r = await m.call("read_note", { path: "a.md" });
			expect(r.isError).toBe(true);
			expect(r.json).toMatchObject({ code: "hub_unavailable" });
			expect((r.json as { message: string }).message).toContain("vault");
			const d = await m.call("get_detail", { id: "i1aaaa" });
			expect(d.json).toMatchObject({ code: "hub_unavailable" });
			expect(m.stderr.join("")).toContain("No vault found");
		} finally {
			await m.close();
		}
	});
});
