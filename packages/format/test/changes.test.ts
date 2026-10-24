import { describe, expect, it } from "vitest";
import { applyChanges } from "../src/changes";
import { decide } from "../src/decide";
import { assignIds } from "../src/ids";
import { suggest } from "../src/suggest";

describe("applyChanges", () => {
	it("applies changes in order", () => {
		expect(
			applyChanges("abcdef", [
				{ from: 1, to: 2, insert: "XX" },
				{ from: 2, to: 2, insert: "-" },
				{ from: 4, to: 6, insert: "" },
			]),
		).toBe("aXX-cd");
	});
	it("gives the input for no changes", () => {
		expect(applyChanges("abc", [])).toBe("abc");
	});
	it("refuses overlapping or out of order changes", () => {
		expect(() =>
			applyChanges("abcdef", [
				{ from: 2, to: 4, insert: "" },
				{ from: 3, to: 5, insert: "" },
			]),
		).toThrow(RangeError);
		expect(() => applyChanges("abc", [{ from: 2, to: 9, insert: "" }])).toThrow(
			RangeError,
		);
	});
});

describe("changes of suggest, decide and assignIds", () => {
	it("suggest: applying changes gives text", () => {
		for (const [note, find, replace] of [
			["The cat sat.", "cat", "dog"],
			["A very big cat.", "very big", "big"],
			["The cat sat.", "cat sat", "black cat sat"],
			["😀\r\nI like 😀 a lot.", "😀 a", "😁 a"],
		] as const) {
			const r = suggest(note, {
				find,
				replace,
				author: "C",
				date: "2026-10-24",
			});
			expect(r.ok).toBe(true);
			if (!r.ok) continue;
			expect(r.changes).toHaveLength(1);
			expect(applyChanges(note, r.changes)).toBe(r.text);
		}
	});
	it("decide: applying changes gives text", () => {
		const note = 'a {id="d1"--cat--}{id="i1"++dog++} b';
		for (const [id, d] of [
			["d1", "accept"],
			["d1", "reject"],
			["i1", "accept"],
			["i1", "reject"],
		] as const) {
			const r = decide({ text: note, id: id, decision: d });
			expect(r.ok).toBe(true);
			if (r.ok) expect(applyChanges(note, r.changes)).toBe(r.text);
		}
	});
	it("assignIds: applying changes gives text", () => {
		let i = 0;
		const note =
			'😀 {++x++}\r\n{id="a1"++y++} {id="a1"--z--} {author="C"==w==}';
		const r = assignIds(note, { newId: () => `n${++i}` });
		expect(r.changes).toHaveLength(3);
		expect(applyChanges(note, r.changes)).toBe(r.text);
		expect(assignIds('{id="a"++x++}').changes).toEqual([]);
	});
});
