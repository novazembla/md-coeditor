import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markDetail, markHistory, markKey, readLog } from "./log-read";
import {
	decision,
	MACHINE,
	renameEv,
	suggestion,
	tempVault,
	writeLog,
} from "./testkit";

let vault: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
	({ vault, cleanup } = await tempVault());
});
afterEach(() => cleanup());

describe("readLog", () => {
	it("returns an empty log when there is no folder", async () => {
		const log = await readLog(vault, MACHINE);
		expect(log).toEqual({ logId: null, events: [], lastSeq: 0, warnings: [] });
	});

	it("skips broken lines and unknown types, but counts their seq", async () => {
		await writeLog(vault, [
			suggestion(1, "a.md", "i1aaaa"),
			"{not json",
			{ v: 1, seq: 2, ts: "t", type: "future", path: "a.md", actor: "user" },
			decision(3, "a.md", "i1aaaa", "accepted"),
			{ v: 1, seq: 9, ts: "t", type: "future", path: "a.md", actor: "user" },
			'{"v":1,"seq":10,"ty',
		]);
		const log = await readLog(vault, MACHINE);
		expect(log.events.map((e) => e.seq)).toEqual([1, 3]);
		expect(log.lastSeq).toBe(9);
		expect(log.logId).toBe("log-1");
		expect(log.warnings).toHaveLength(1);
	});
});

describe("markHistory and markDetail", () => {
	const events = [
		suggestion(1, "essay.md", "i1bbbb"),
		decision(2, "essay.md", "i1bbbb", "accepted"),
		renameEv(3, "essay.md", "drafts/essay.md"),
		decision(4, "drafts/essay.md", "i1bbbb", "rejected"),
	];

	it("follows renames: earlier events belong to the new path", () => {
		const h = markHistory(events);
		expect([...h.keys()]).toEqual([markKey("drafts/essay.md", "i1bbbb")]);
		const entry = [...h.values()][0];
		expect(entry?.events.map((e) => e.seq)).toEqual([1, 2, 4]);
		expect(entry?.path).toBe("drafts/essay.md");
		// The events are the logged ones, not rewritten.
		expect(entry?.events.map((e) => e.path)).toEqual([
			"essay.md",
			"essay.md",
			"drafts/essay.md",
		]);
		expect(entry?.events[0]).toBe(events[0]);
	});

	it("follows a chain of renames and a re-created old path", () => {
		const h = markHistory([
			suggestion(1, "a.md", "i1aaaa"),
			renameEv(2, "a.md", "b.md"),
			suggestion(3, "a.md", "i1aaaa"),
			renameEv(4, "b.md", "c.md"),
		]);
		expect(h.get(markKey("c.md", "i1aaaa"))?.events).toHaveLength(1);
		expect(h.get(markKey("a.md", "i1aaaa"))?.events).toHaveLength(1);
	});

	it("gives the detail with current state", () => {
		const d = markDetail(events, "i1bbbb");
		expect(d).toMatchObject({
			ok: true,
			path: "drafts/essay.md",
			current: "rejected",
		});
		expect(d.ok && d.events).toHaveLength(3);
		expect(markDetail(events.slice(0, 1), "i1bbbb")).toMatchObject({
			ok: true,
			current: "pending",
		});
	});

	it("matches the path argument against the current path", () => {
		expect(markDetail(events, "i1bbbb", "drafts/essay.md").ok).toBe(true);
		expect(markDetail(events, "i1bbbb", "essay.md")).toMatchObject({
			ok: false,
			code: "unknown_id",
		});
	});

	it("refuses an unknown id", () => {
		expect(markDetail(events, "zzz")).toMatchObject({
			ok: false,
			code: "unknown_id",
		});
	});

	it("refuses the same id in two notes unless a path is given", () => {
		const two = [
			suggestion(1, "essay.md", "i1bbbb"),
			decision(2, "copy.md", "i1bbbb", "accepted"),
		];
		const d = markDetail(two, "i1bbbb");
		expect(d).toMatchObject({
			ok: false,
			code: "ambiguous_id",
			details: { paths: ["copy.md", "essay.md"] },
		});
		const one = markDetail(two, "i1bbbb", "copy.md");
		expect(one.ok && one.path).toBe("copy.md");
		expect(one.ok && one.events.map((e) => e.path)).toEqual(["copy.md"]);
		expect(one.ok && one.current).toBe("accepted");
	});
});
