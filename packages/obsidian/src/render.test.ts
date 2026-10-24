import { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { changeSpans, makeView, visibleLines } from "./test-util";

function atomicRanges(view: EditorView): [number, number][] {
	const out: [number, number][] = [];
	for (const get of view.state.facet(EditorView.atomicRanges)) {
		get(view).between(0, view.state.doc.length, (from, to) => {
			out.push([from, to]);
		});
	}
	return out;
}

describe("Live Preview", () => {
	test("insertion with attributes", () => {
		const view = makeView(
			'The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.',
		);
		expect(visibleLines(view)).toEqual(["The big cat."]);
		expect(changeSpans(view)).toEqual([
			{ text: "big ", cls: "coedit-ins", label: "Claude, 2026-10-24" },
		]);
	});

	test("deletion and a replace", () => {
		const view = makeView(
			'A {id="d1"--very --}big {id="d2"--cat--}{id="a1"++dog++}.',
		);
		expect(visibleLines(view)).toEqual(["A very big catdog."]);
		expect(changeSpans(view).map((s) => [s.text, s.cls])).toEqual([
			["very ", "coedit-del"],
			["cat", "coedit-del"],
			["dog", "coedit-ins"],
		]);
	});

	test("no attributes: Unknown author", () => {
		const view = makeView("The {++big ++}cat.");
		expect(changeSpans(view)[0]?.label).toBe("Unknown author");
	});

	test("a mark over two lines", () => {
		const view = makeView('{id="a1"++one\ntwo++} end');
		expect(visibleLines(view)).toEqual(["one", "two end"]);
		expect(changeSpans(view).map((s) => s.text)).toEqual(["one", "two"]);
	});

	test("syntax stays hidden with the cursor inside the mark", () => {
		const view = makeView('The {id="a1" author="Claude"++b|ig ++}cat.');
		expect(visibleLines(view)).toEqual(["The big cat."]);
	});

	test("atomic ranges are the hidden ranges", () => {
		const view = makeView('The {id="a1"++big ++}cat.');
		expect(atomicRanges(view)).toEqual([
			[4, 14],
			[18, 21],
		]);
	});

	test("mark syntax in inline code is not rendered", () => {
		const view = makeView("Use `{++x++}` here.");
		expect(visibleLines(view)).toEqual(["Use `{++x++}` here."]);
		expect(changeSpans(view)).toEqual([]);
	});

	test("a substitution is not rendered", () => {
		const view = makeView("A {~~cat~>dog~~} sat.");
		expect(visibleLines(view)).toEqual(["A {~~cat~>dog~~} sat."]);
		expect(changeSpans(view)).toEqual([]);
	});

	test("an update after a document change", () => {
		const view = makeView("The cat.");
		view.dispatch({ changes: { from: 4, insert: "{++big ++}" } });
		expect(visibleLines(view)).toEqual(["The big cat."]);
	});
});

describe("Source mode", () => {
	test("raw text, no change style, no atomic ranges", () => {
		const doc = 'The {id="a1" author="Claude"++big ++}cat.';
		const view = makeView(doc, { live: false });
		expect(visibleLines(view)).toEqual([doc]);
		expect(changeSpans(view)).toEqual([]);
		expect(atomicRanges(view)).toEqual([]);
	});
});
