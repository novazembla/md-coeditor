import { defaultKeymap } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { type EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { after, before, makeView } from "./test-util";

const DOC = 'The {id="a1"++big ++}cat.';

function editorView(doc: string, live = true): EditorView {
	return makeView(doc, { live, extensions: keymap.of(defaultKeymap) });
}

function press(view: EditorView, key: string): void {
	runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
}

function select(view: EditorView, from: number, to: number): void {
	view.dispatch({ selection: EditorSelection.range(from, to) });
}

function typeText(view: EditorView, text: string, userEvent = "input.type") {
	view.dispatch(view.state.replaceSelection(text), { userEvent });
}

function head(view: EditorView): number {
	return view.state.selection.main.head;
}

describe("Backspace and Delete at the edges", () => {
	test("Backspace directly before big (cursor after the hidden prefix)", () => {
		const view = editorView(DOC);
		view.dispatch({ selection: { anchor: before(view, "big") } });
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe('The{id="a1"++big ++}cat.');
		expect(head(view)).toBe(before(view, "big"));
	});

	test("Backspace directly before big (cursor before the brace)", () => {
		const view = editorView('The |{id="a1"++big ++}cat.');
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe('The{id="a1"++big ++}cat.');
		expect(head(view)).toBe(3);
	});

	test("Backspace directly after big  (cursor after the hidden suffix)", () => {
		const view = editorView('The {id="a1"++big ++}|cat.');
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe('The {id="a1"++big++}cat.');
	});

	test("Delete directly after big  (cursor before the hidden suffix)", () => {
		const view = editorView('The {id="a1"++big |++}cat.');
		press(view, "Delete");
		expect(view.state.doc.toString()).toBe('The {id="a1"++big ++}at.');
		expect(head(view)).toBe(after(view, "big "));
	});

	test("Delete directly after big  (cursor after the brace)", () => {
		const view = editorView('The {id="a1"++big ++}|cat.');
		press(view, "Delete");
		expect(view.state.doc.toString()).toBe('The {id="a1"++big ++}at.');
	});

	test("Delete directly before big (cursor before the brace)", () => {
		const view = editorView('The |{id="a1"++big ++}cat.');
		press(view, "Delete");
		expect(view.state.doc.toString()).toBe('The {id="a1"++ig ++}cat.');
	});

	test("Backspace between the two marks of a replace deletes the last visible character of the deletion", () => {
		const view = editorView('The {id="d1"--cat--}{id="a1"++|dog++} sat.');
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe(
			'The {id="d1"--ca--}{id="a1"++dog++} sat.',
		);
	});

	test("Backspace inside the content works as usual", () => {
		const view = editorView('The {id="a1"++bi|g ++}cat.');
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe('The {id="a1"++bg ++}cat.');
	});
});

describe("A selection over part of a mark", () => {
	// Visible text `e bi`: from `e` (2) to after `i` (16).
	const from = 2;
	const to = 16;

	test("delete", () => {
		const view = editorView(DOC);
		select(view, from, to);
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe('Th{id="a1"++g ++}cat.');
		expect(view.state.selection.main.empty).toBe(true);
		expect(head(view)).toBe(2);
	});

	test("type", () => {
		const view = editorView(DOC);
		select(view, from, to);
		typeText(view, "x");
		expect(view.state.doc.toString()).toBe('Thx{id="a1"++g ++}cat.');
		expect(head(view)).toBe(3);
	});

	test("paste", () => {
		const view = editorView(DOC);
		select(view, from, to);
		typeText(view, "XY", "input.paste");
		expect(view.state.doc.toString()).toBe('ThXY{id="a1"++g ++}cat.');
		expect(head(view)).toBe(4);
	});

	test("cut over the end of a mark", () => {
		const view = editorView(DOC);
		view.dispatch({
			changes: { from: before(view, "g ++"), to: after(view, "}c") },
			userEvent: "delete.cut",
		});
		expect(view.state.doc.toString()).toBe('The {id="a1"++bi++}at.');
	});
});

describe("Whole marks and other edits", () => {
	test("a selection over the whole mark removes it", () => {
		const view = editorView(DOC);
		select(view, 0, view.state.doc.length);
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe("");
	});

	test("typing inside an insertion", () => {
		const view = editorView('The {id="a1"++big| ++}cat.');
		for (const ch of "gest") typeText(view, ch);
		expect(view.state.doc.toString()).toBe('The {id="a1"++biggest ++}cat.');
	});

	test("a reload (no user event) over a mark is not filtered", () => {
		const view = editorView(DOC);
		view.dispatch({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: 'The {id="a1"++small ++}cat.',
			},
		});
		expect(view.state.doc.toString()).toBe('The {id="a1"++small ++}cat.');
	});

	test("a non-user change over part of a mark is not filtered", () => {
		const view = editorView(DOC);
		view.dispatch({ changes: { from: 2, to: 16 } });
		expect(view.state.doc.toString()).toBe("Thg ++}cat.");
	});

	test("Source mode: user edits are not filtered", () => {
		const view = editorView(DOC, false);
		select(view, 2, 16);
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe("Thg ++}cat.");
	});
});
