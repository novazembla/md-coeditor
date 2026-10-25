import { readdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import {
	decision,
	MACHINE,
	suggestion,
	tempVault,
	writeLog,
} from "../src/testkit";
import { type FakeHub, type Respond, startFakeHub } from "./fake-hub";
import { type Harness, startMcp } from "./harness";

const HUB = "hub, in packages/obsidian/src/hub/tools.test.ts";
const TOOLS_E2E = "e2e in packages/e2e/tests/tools.e2e.ts";

let vault: string;
let cleanup: () => Promise<void>;
let hub: FakeHub | undefined;
let mcp: Harness | undefined;

beforeEach(async () => {
	({ vault, cleanup } = await tempVault());
});
afterEach(async () => {
	await mcp?.close();
	await hub?.stop();
	mcp = undefined;
	hub = undefined;
	await cleanup();
});

async function setup(
	respond?: Respond,
	protocol?: number,
	withHub = true,
): Promise<Harness> {
	if (withHub) {
		hub = await startFakeHub({ vault, machine: MACHINE, respond, protocol });
	}
	mcp = await startMcp({
		env: { COEDIT_VAULT: vault, COEDIT_SESSION: "s1" },
	});
	return mcp;
}

const ok =
	(result: unknown): Respond =>
	() => ({ ok: true, result });

describe("The tool set", () => {
	it("Tool list", async () => {
		const m = await setup();
		const { tools } = await m.client.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual([
			"get_context",
			"get_detail",
			"get_digest",
			"read_note",
			"suggest_edit",
		]);
	});

	it("Server instructions", async () => {
		const m = await setup();
		const text = m.client.getInstructions() ?? "";
		expect(text).toContain("suggest_edit");
		expect(text).toMatch(/do not edit vault notes directly/i);
	});
});

describe("Tool errors have a code", () => {
	it("Error shape", async () => {
		const m = await setup((method) =>
			method === "read_note"
				? {
						ok: false,
						error: { code: "invalid_path", message: "Path leaves the vault" },
					}
				: { ok: true, result: {} },
		);
		const r = await m.call("read_note", { path: "../secrets.md" });
		expect(r.isError).toBe(true);
		expect(r.json).toMatchObject({
			code: "invalid_path",
			message: expect.any(String),
		});
	});
});

describe("Positions are in the agent view", () => {
	test.todo(`Selection after a pending deletion: ${HUB}`);
	test.todo(`Note with Windows line ends: ${HUB}`);
});

describe("Get the user's focus", () => {
	it("Active note with a selection", async () => {
		const context = {
			activeNote: "essay.md",
			selection: {
				text: "quick fox",
				start: { line: 3, ch: 4 },
				end: { line: 3, ch: 13 },
			},
			openMarks: 2,
		};
		const m = await setup(ok(context));
		const r = await m.call("get_context");
		expect(r.isError).toBe(false);
		expect(r.json).toEqual({ hubConnected: true, ...context });
	});

	it("No active note", async () => {
		const m = await setup(
			ok({ activeNote: null, selection: null, openMarks: null }),
		);
		expect((await m.call("get_context")).json).toEqual({
			hubConnected: true,
			activeNote: null,
			selection: null,
			openMarks: null,
		});
	});

	it("Obsidian closed", async () => {
		const m = await setup(undefined, undefined, false);
		const r = await m.call("get_context");
		expect(r.isError).toBe(false);
		expect(r.json).toEqual({
			hubConnected: false,
			activeNote: null,
			selection: null,
			openMarks: null,
		});
	});
});

describe("Read a note in the agent view", () => {
	test.todo(`Note with a pending replace: ${HUB}`);
	test.todo(`Unsaved editor text: ${TOOLS_E2E}`);
});

describe("Note paths are checked", () => {
	test.todo(`Path outside the vault: ${HUB}`);
	test.todo(`Windows path: ${HUB}`);
	test.todo(`Missing note: ${HUB}`);
});

describe("Suggest a change", () => {
	test.todo(`Successful suggestion: ${HUB}`);
});

describe("A repeated call writes once", () => {
	it("Answer lost after the write", async () => {
		let writes = 0;
		let first = true;
		const m = await setup(() => {
			writes++;
			if (first) {
				first = false;
				return "drop"; // written, but the answer is lost
			}
			return {
				ok: true,
				result: { path: "essay.md", ids: ["d1aaaa", "i1bbbb"] },
			};
		});
		const r = await m.call("suggest_edit", {
			path: "essay.md",
			find: "quick",
			replace: "slow",
		});
		expect(r.isError).toBe(false);
		expect(r.json).toEqual({ path: "essay.md", ids: ["d1aaaa", "i1bbbb"] });
		expect(writes).toBe(2);
		// The repeat carries the same request id, so the hub can answer once.
		const ids = hub?.requests.map((q) => q.id);
		expect(ids?.[0]).toBe(ids?.[1]);
		expect(hub?.hellos.length).toBe(2);
	});
});

describe("Refusals reach the agent unchanged", () => {
	it("Ambiguous find text", async () => {
		const m = await setup(() => ({
			ok: false,
			error: {
				code: "ambiguous",
				message: "find matches 2 places",
				details: { matches: 2 },
			},
		}));
		const r = await m.call("suggest_edit", {
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
		// "the note does not change": the hub refuses before it writes (see the hub test).
	});

	it("Find text touches a pending mark", async () => {
		const m = await setup(() => ({
			ok: false,
			error: {
				code: "overlaps_mark",
				message: "find touches a pending mark",
				details: { ids: ["d1aaaa", "i1bbbb"] },
			},
		}));
		const r = await m.call("suggest_edit", {
			path: "essay.md",
			find: "slow fox",
			replace: "fast fox",
		});
		const body = r.json as { code: string; details: { ids: string[] } };
		expect(body.code).toBe("overlaps_mark");
		expect(body.details.ids).toContain("i1bbbb");
	});
});

describe("Tools that need Obsidian say so", () => {
	it("Suggest with Obsidian closed", async () => {
		const m = await setup(undefined, undefined, false);
		const before = await readdir(vault);
		const r = await m.call("suggest_edit", {
			path: "essay.md",
			find: "a",
			replace: "b",
		});
		expect(r.isError).toBe(true);
		expect(r.json).toEqual({
			code: "hub_unavailable",
			message: "Obsidian not connected",
		});
		expect(await readdir(vault)).toEqual(before);
	});

	it("Digest with Obsidian closed", async () => {
		await writeLog(vault, [suggestion(1, "essay.md", "i1bbbb")]);
		const m = await setup(undefined, undefined, false);
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			decision(2, "essay.md", "i1bbbb", "accepted", "slow"),
		]);
		const r = await m.call("get_digest");
		expect(r.isError).toBe(false);
		expect(r.text).toContain("MD-Coeditor: 1 new decision.");
		expect(r.text).toContain('- accepted insertion i1bbbb: "slow"');
	});
});

describe("Versions that do not match say so", () => {
	it("Old bridge, new plugin", async () => {
		const m = await setup(undefined, 2);
		const r = await m.call("read_note", { path: "essay.md" });
		expect(r.isError).toBe(true);
		const body = r.json as { code: string; message: string };
		expect(body.code).toBe("protocol_mismatch");
		expect(body.message).toContain("update");
	});
});

describe("Reconnect after an Obsidian restart", () => {
	it("Obsidian restarted during a session", async () => {
		const ctx = { activeNote: "a.md", selection: null, openMarks: 0 };
		const m = await setup(ok(ctx));
		expect(
			((await m.call("get_context")).json as { hubConnected: boolean })
				.hubConnected,
		).toBe(true);
		await hub?.restart();
		const again = await m.call("get_context");
		expect((again.json as { hubConnected: boolean }).hubConnected).toBe(true);
	});
});

describe("Get the history of a mark", () => {
	it("Suggested and accepted", async () => {
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			decision(2, "essay.md", "i1bbbb", "accepted", "slow"),
		]);
		const m = await setup(undefined, undefined, false);
		const r = await m.call("get_detail", { id: "i1bbbb" });
		expect(r.isError).toBe(false);
		const body = r.json as {
			path: string;
			events: { type: string }[];
			current: string;
		};
		expect(body.path).toBe("essay.md");
		expect(body.events.map((e) => e.type)).toEqual(["suggestion", "decision"]);
		expect(body.current).toBe("accepted");
	});

	it("Same id in two notes", async () => {
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			suggestion(2, "copy.md", "i1bbbb"),
		]);
		const m = await setup(undefined, undefined, false);
		const r = await m.call("get_detail", { id: "i1bbbb" });
		expect(r.isError).toBe(true);
		expect(r.json).toMatchObject({
			code: "ambiguous_id",
			details: { paths: ["copy.md", "essay.md"] },
		});
		const one = await m.call("get_detail", { id: "i1bbbb", path: "copy.md" });
		const body = one.json as { path: string; events: { path: string }[] };
		expect(body.path).toBe("copy.md");
		expect(body.events).toHaveLength(1);
		expect(body.events.every((e) => e.path === "copy.md")).toBe(true);
	});

	it("Unknown id", async () => {
		await writeLog(vault, [suggestion(1, "essay.md", "i1bbbb")]);
		const m = await setup(undefined, undefined, false);
		const r = await m.call("get_detail", { id: "zzzzzz" });
		expect(r.isError).toBe(true);
		expect((r.json as { code: string }).code).toBe("unknown_id");
	});
});

describe("A mark is a note and an id", () => {
	it("Copied note", async () => {
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			suggestion(2, "copy.md", "i1bbbb"),
			decision(3, "essay.md", "i1bbbb", "accepted"),
			decision(4, "copy.md", "i1bbbb", "rejected"),
		]);
		const m = await setup(undefined, undefined, false);
		const r = await m.call("get_detail", { id: "i1bbbb", path: "essay.md" });
		expect((r.json as { current: string }).current).toBe("accepted");
	});
});

describe("The latest event for a mark wins", () => {
	it("Decided again after undo", async () => {
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			decision(5, "essay.md", "i1bbbb", "accepted"),
			decision(9, "essay.md", "i1bbbb", "rejected"),
		]);
		const m = await setup(undefined, undefined, false);
		const r = await m.call("get_detail", { id: "i1bbbb" });
		expect((r.json as { current: string }).current).toBe("rejected");
	});
});

describe("Get the digest during a task", () => {
	it("Pull in the middle of a task", async () => {
		await writeLog(vault, [suggestion(1, "essay.md", "i1bbbb")]);
		const m = await setup(undefined, undefined, false);
		await writeLog(vault, [
			suggestion(1, "essay.md", "i1bbbb"),
			decision(2, "essay.md", "i1bbbb", "accepted", "slow"),
		]);
		const first = await m.call("get_digest");
		expect(first.text).toContain("i1bbbb");
		// The next prompt (the hook) would not list it again: same cursor.
		const again = await m.call("get_digest");
		expect(again.text).toBe("No new decisions.");
	});

	it("Nothing new", async () => {
		await writeLog(vault, [suggestion(1, "essay.md", "i1bbbb")]);
		const m = await setup(undefined, undefined, false);
		expect((await m.call("get_digest")).text).toBe("No new decisions.");
	});
});
