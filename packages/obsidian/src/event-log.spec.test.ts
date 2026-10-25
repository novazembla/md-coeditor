import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	eventsPath,
	logDir,
	logIdPath,
	machineName,
} from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { decideAt } from "./decide";
import { decisionEvent, renameEvents } from "./log/events";
import { createLogWriter } from "./log/writer";
import { makeView } from "./test-util";

let vault: string;
beforeEach(async () => {
	vault = await mkdtemp(join(tmpdir(), "coedit-evspec-"));
});
afterEach(async () => {
	await rm(vault, { recursive: true, force: true });
});

const readLines = async (machine: string): Promise<string[]> =>
	(await readFile(eventsPath(vault, machine), "utf8"))
		.split("\n")
		.filter(Boolean);

/** Accept the change at the `|` of `doc`, return the decision event. */
function decisionOf(
	doc: string,
	decision: "accept" | "reject",
	path = "essay.md",
) {
	const view = makeView(doc);
	const r = decideAt(view.state, view.state.selection.main.head, decision, {
		newId: () => "n1x1x1",
	});
	if (!r.ok) throw new Error(r.notice);
	return decisionEvent(path, r.result);
}

const accept = () =>
	decisionOf('{id="i1bbbb" author="Claude"++s|low++}', "accept");

describe("One log file for each machine", () => {
	test("First event creates the file", async () => {
		const machine = machineName("Work-Mac.local");
		await createLogWriter({ vault, machine }).append(accept());
		const lines = await readLines("work-mac");
		expect(eventsPath(vault, machine)).toContain(
			join("local", "work-mac", "log", "events.jsonl"),
		);
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] as string).type).toBe("decision");
	});

	test("Two machines sync one vault", async () => {
		await createLogWriter({ vault, machine: "work-mac" }).append(accept());
		await createLogWriter({ vault, machine: "home-pc" }).append(accept());
		expect(await readLines("work-mac")).toHaveLength(1);
		expect(await readLines("home-pc")).toHaveLength(1);
	});
});

describe("The log has an id", () => {
	test("Log created again", async () => {
		const w = createLogWriter({ vault, machine: "work-mac" });
		await w.append(accept());
		const before = await readFile(logIdPath(vault, "work-mac"), "utf8");
		await rm(logDir(vault, "work-mac"), { recursive: true });
		await w.append(accept());
		const after = await readFile(logIdPath(vault, "work-mac"), "utf8");
		expect(after).not.toBe(before);
		expect(after).not.toBe("");
	});
});

describe("Events have a rising sequence number", () => {
	test("Sequence after a restart", async () => {
		const first = createLogWriter({ vault, machine: "work-mac" });
		for (let i = 0; i < 41; i++) await first.append(accept());
		const out = await createLogWriter({ vault, machine: "work-mac" }).append(
			decisionOf('{id="i1bbbb"++s|low++}', "reject"),
		);
		expect(out.seq).toBe(42);
	});

	test("Torn last line", async () => {
		const first = createLogWriter({ vault, machine: "work-mac" });
		for (let i = 0; i < 41; i++) await first.append(accept());
		const file = eventsPath(vault, "work-mac");
		await writeFile(file, `${await readFile(file, "utf8")}{"v":1,"seq":4`);
		await createLogWriter({ vault, machine: "work-mac" }).append(accept());
		const lines = await readLines("work-mac");
		const last = JSON.parse(lines[lines.length - 1] as string);
		expect(last.seq).toBe(42);
	});
});

describe("Event envelope", () => {
	test.todo(
		"Agent event: hub, in packages/obsidian/src/hub/tools.test.ts (logs a suggestion event with the real path)",
	);

	test("User event", async () => {
		const out = await createLogWriter({ vault, machine: "work-mac" }).append(
			accept(),
		);
		expect(out).toMatchObject({ v: 1, actor: "user", path: "essay.md" });
		expect("session" in out).toBe(false);
		expect("agent" in out).toBe(false);
	});
});

describe("Readers accept newer events", () => {
	test.todo(
		"Event from a newer plugin: bridge, in packages/bridge/test/context-digest.spec.test.ts",
	);
});

describe("Suggestion events", () => {
	test.todo(
		"Replace logged: hub, in packages/obsidian/src/hub/tools.test.ts (logs a suggestion event with the real path)",
	);
	test.todo(
		"Refusal not logged: hub, in packages/obsidian/src/hub/tools.test.ts (writes no event for a refusal)",
	);
});

describe("Decision events", () => {
	test("Accept with no session running", () => {
		expect(accept()).toMatchObject({
			type: "decision",
			actor: "user",
			id: "i1bbbb",
			kind: "insertion",
			decision: "accepted",
			content: "slow",
			author: "Claude",
		});
	});

	test("Mark typed by hand", () => {
		const e = decisionOf("{--ol|d--}", "reject");
		expect(e).toMatchObject({
			id: "n1x1x1",
			kind: "deletion",
			decision: "rejected",
		});
	});

	test("Log cannot be written", async () => {
		await writeFile(join(vault, ".coedit"), "a file, not a folder");
		await expect(
			createLogWriter({ vault, machine: "work-mac" }).append(accept()),
		).rejects.toThrow();
	});
	test.todo(
		"Log cannot be written (note kept, one notice): e2e in packages/e2e/tests/log.e2e.ts",
	);
});

describe("Rename events", () => {
	test("Note moved", () => {
		expect(
			renameEvents({ path: "drafts/essay.md", kind: "file" }, "essay.md"),
		).toEqual([
			{
				type: "rename",
				path: "drafts/essay.md",
				actor: "user",
				from: "essay.md",
			},
		]);
	});
	test.todo(
		"Note moved (later decision has the new path): e2e in packages/e2e/tests/log.e2e.ts",
	);

	test("Folder renamed", () => {
		// Obsidian fires one rename event for the folder, then one for each
		// file below it (task 10.3). Only the file event is logged.
		expect(renameEvents({ path: "old", kind: "folder" }, "drafts")).toEqual([]);
		expect(
			renameEvents({ path: "old/essay.md", kind: "file" }, "drafts/essay.md"),
		).toEqual([
			{
				type: "rename",
				path: "old/essay.md",
				actor: "user",
				from: "drafts/essay.md",
			},
		]);
	});
	test.todo(
		"Folder renamed (one event for each note, no duplicates): e2e in packages/e2e/tests/log.e2e.ts",
	);
});

describe("A mark is a note and an id", () => {
	test.todo(
		"Copied note: bridge, in packages/bridge/test/agent-tools.spec.test.ts",
	);
});

describe("The latest event for a mark wins", () => {
	test.todo(
		"Decided again after undo: bridge, in packages/bridge/test/agent-tools.spec.test.ts",
	);
});

describe("The log stays out of git", () => {
	test.todo(
		"Git ignores the log: hub endpoint, in packages/obsidian/src/hub/endpoint.test.ts",
	);
});
