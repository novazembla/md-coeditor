import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { hiddenRanges, marksField, tooltip, visibleSpan } from "./marks";

function field(doc: string) {
	return EditorState.create({ doc, extensions: marksField }).field(marksField);
}

function nth(doc: string, i: number) {
	const mark = field(doc).changes[i];
	if (!mark) throw new Error(`no change ${i} in ${doc}`);
	return mark;
}

describe("marksField", () => {
	test("one mark", () => {
		const doc = 'The {id="a1" author="Claude"++big ++}cat.';
		expect(field(doc).changes).toHaveLength(1);
		const m = nth(doc, 0);
		expect(m).toMatchObject({
			kind: "insertion",
			start: 4,
			contentStart: 30,
			contentEnd: 34,
			end: 37,
			id: "a1",
			author: "Claude",
		});
		expect(hiddenRanges(m)).toEqual([
			[4, 30],
			[34, 37],
		]);
	});

	test("a replace", () => {
		const { changes } = field('The {id="d1"--cat--}{id="a1"++dog++} sat.');
		expect(changes.map((m) => [m.kind, m.content])).toEqual([
			["deletion", "cat"],
			["insertion", "dog"],
		]);
	});

	test("a mark over two lines", () => {
		const { changes } = field('{id="a1"++one\ntwo++} end');
		expect(changes).toHaveLength(1);
		expect(changes[0]?.content).toBe("one\ntwo");
	});

	test("a mark in inline code is not in the field", () => {
		expect(field("Use `{++x++}` here.").changes).toEqual([]);
	});

	test("a substitution is not in the changes", () => {
		const value = field("A {~~cat~>dog~~} sat.");
		expect(value.changes).toEqual([]);
		expect(value.all.map((m) => m.kind)).toEqual(["substitution"]);
	});

	test("duplicate ids", () => {
		const value = field('{id="a1"++x++} and {id="a1"++y++}');
		expect([...value.duplicateIds]).toEqual(["a1"]);
	});

	test("update after a document change", () => {
		let state = EditorState.create({
			doc: "The cat.",
			extensions: marksField,
		});
		expect(state.field(marksField).changes).toEqual([]);
		state = state.update({ changes: { from: 4, insert: "{++big ++}" } }).state;
		expect(state.field(marksField).changes.map((m) => m.content)).toEqual([
			"big ",
		]);
	});

	test("the value stays the same without a document change", () => {
		const state = EditorState.create({
			doc: "{++a++}",
			extensions: marksField,
		});
		const next = state.update({ selection: { anchor: 1 } }).state;
		expect(next.field(marksField)).toBe(state.field(marksField));
	});
});

describe("hiddenRanges and visibleSpan", () => {
	test("an empty mark has one hidden range", () => {
		expect(hiddenRanges(nth("a{++++}b", 0))).toEqual([[1, 7]]);
	});

	test("the span between the two marks of a replace", () => {
		const doc = 'The {id="d1"--cat--}{id="a1"++dog++} sat.';
		const { changes } = field(doc);
		const del = nth(doc, 0);
		const ins = nth(doc, 1);
		expect(visibleSpan(changes, del.contentEnd)).toEqual({
			lo: del.contentEnd,
			hi: ins.contentStart,
		});
		expect(visibleSpan(changes, ins.start)).toEqual({
			lo: del.contentEnd,
			hi: ins.contentStart,
		});
		expect(visibleSpan(changes, 2)).toEqual({ lo: 2, hi: 2 });
	});
});

describe("tooltip", () => {
	test("author and date", () => {
		expect(tooltip(nth('{author="Claude" date="2026-10-24"++x++}', 0))).toBe(
			"Claude, 2026-10-24",
		);
	});

	test("no attributes", () => {
		expect(tooltip(nth("{++x++}", 0))).toBe("Unknown author");
	});

	test("a date without an author", () => {
		expect(tooltip(nth('{date="2026-10-24"++x++}', 0))).toBe(
			"Unknown author, 2026-10-24",
		);
	});
});
