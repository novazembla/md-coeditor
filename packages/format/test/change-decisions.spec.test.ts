import { describe, expect, it } from "vitest";
import { decide } from "../src/decide";

const REPLACE = '{id="d1"--cat--}{id="a1"++dog++}';

function must<T extends { ok: boolean }>(r: T): T & { ok: true } {
	if (!r.ok) throw new Error("decision refused");
	return r as T & { ok: true };
}

function run(text: string, steps: [string, "accept" | "reject"][]): string {
	let t = text;
	for (const [id, d] of steps)
		t = must(decide({ text: t, id: id, decision: d })).text;
	return t;
}

describe("Accept and reject an insertion", () => {
	const note = 'The {id="a1"++big ++}cat.';
	it("Accept insertion", () => {
		expect(
			must(decide({ text: note, id: "a1", decision: "accept" })).text,
		).toBe("The big cat.");
	});
	it("Reject insertion", () => {
		expect(
			must(decide({ text: note, id: "a1", decision: "reject" })).text,
		).toBe("The cat.");
	});
});

describe("Accept and reject a deletion", () => {
	const note = 'A {id="d1"--very --}big cat.';
	it("Accept deletion", () => {
		expect(
			must(decide({ text: note, id: "d1", decision: "accept" })).text,
		).toBe("A big cat.");
	});
	it("Reject deletion", () => {
		expect(
			must(decide({ text: note, id: "d1", decision: "reject" })).text,
		).toBe("A very big cat.");
	});
});

describe("Marks of a replace are decided on their own", () => {
	it("Accept both", () => {
		expect(
			run(REPLACE, [
				["d1", "accept"],
				["a1", "accept"],
			]),
		).toBe("dog");
	});
	it("Reject both", () => {
		expect(
			run(REPLACE, [
				["d1", "reject"],
				["a1", "reject"],
			]),
		).toBe("cat");
	});
	it("Reject the deletion, accept the insertion", () => {
		expect(
			run(REPLACE, [
				["d1", "reject"],
				["a1", "accept"],
			]),
		).toBe("catdog");
	});
	it("One decided, one pending", () => {
		expect(run(REPLACE, [["d1", "accept"]])).toBe('{id="a1"++dog++}');
	});
});

describe("Decisions address a mark by id", () => {
	it("Unknown id", () => {
		const r = decide({ text: "plain text", id: "x9", decision: "accept" });
		expect(r).toMatchObject({ ok: false, code: "not_found" });
		if (!r.ok) expect(r.message).toMatch(/no mark/i);
	});
	it("Duplicate id", () => {
		const r = decide({
			text: '{id="a1"++x++} {id="a1"++y++}',
			id: "a1",
			decision: "accept",
		});
		expect(r).toMatchObject({ ok: false, code: "duplicate_id" });
	});
	it("Unsupported kind", () => {
		const note = '{id="s1"~~a~>b~~}';
		const r = decide({ text: note, id: "s1", decision: "accept" });
		// Only these keys: no new text, no changes, no mark.
		expect(r).toEqual({
			ok: false,
			code: "unsupported_kind",
			message: expect.stringMatching(/substitution/),
		});
	});
});

describe("Decision result", () => {
	it("Result of an accepted insertion", () => {
		const note = 'The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.';
		const r = must(decide({ text: note, id: "a1", decision: "accept" }));
		expect(r.mark).toMatchObject({
			id: "a1",
			kind: "insertion",
			content: "big ",
			author: "Claude",
			date: "2026-10-24",
			start: 4,
			end: 55,
		});
		expect(note.slice(4, 55)).toBe(
			'{id="a1" author="Claude" date="2026-10-24"++big ++}',
		);
		expect(r.decision).toBe("accept");
		expect(r.text).toBe("The big cat.");
		expect(r.changes).toEqual([{ from: 4, to: 55, insert: "big " }]);
	});
	it("Result of a rejected insertion", () => {
		const note = 'The {id="a1"++big ++}cat.';
		const r = must(decide({ text: note, id: "a1", decision: "reject" }));
		expect(r.decision).toBe("reject");
		expect(r.mark).toMatchObject({ id: "a1", kind: "insertion", start: 4 });
		expect(r.text).toBe("The cat.");
		expect(r.changes).toEqual([{ from: 4, to: 21, insert: "" }]);
		expect(note.slice(4, 21)).toBe('{id="a1"++big ++}');
	});
});
