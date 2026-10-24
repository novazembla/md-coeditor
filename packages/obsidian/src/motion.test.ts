import { defaultKeymap } from "@codemirror/commands";
import { type EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { hiddenRanges, marksField } from "./marks";
import { after, before, makeView } from "./test-util";

function editorView(doc: string, live = true): EditorView {
	return makeView(doc, { live, extensions: keymap.of(defaultKeymap) });
}

function press(view: EditorView, key: string, shiftKey = false): void {
	runScopeHandlers(
		view,
		new KeyboardEvent("keydown", { key, shiftKey }),
		"editor",
	);
}

function head(view: EditorView): number {
	return view.state.selection.main.head;
}

/** The column of `pos` in the visible text: hidden characters do not count. */
function visibleColumn(view: EditorView, pos: number): number {
	let hidden = 0;
	for (const mark of view.state.field(marksField).changes) {
		for (const [from, to] of hiddenRanges(mark)) {
			hidden += Math.max(0, Math.min(to, pos) - from);
		}
	}
	return pos - hidden;
}

describe("Left and Right over hidden syntax", () => {
	test("into an insertion: one press to after b", () => {
		const view = editorView('The |{id="a1"++big ++}cat.');
		press(view, "ArrowRight");
		expect(head(view)).toBe(after(view, "++b"));
	});

	test("out of an insertion: one press to after c", () => {
		const view = editorView('The {id="a1"++big |++}cat.');
		press(view, "ArrowRight");
		expect(head(view)).toBe(after(view, "}c"));
	});

	test("left into an insertion from after it: one press to before the space", () => {
		const view = editorView('The {id="a1"++big ++}|cat.');
		press(view, "ArrowLeft");
		expect(head(view)).toBe(after(view, "++big"));
	});

	test("left out of an insertion: one press to before the space after The", () => {
		const view = editorView('The {id="a1"++|big ++}cat.');
		press(view, "ArrowLeft");
		expect(head(view)).toBe(3);
	});

	test("between the two marks of a replace: one press to after d", () => {
		const view = editorView('The {id="d1"--cat|--}{id="a1"++dog++} sat.');
		press(view, "ArrowRight");
		expect(head(view)).toBe(after(view, "++d"));
	});

	test.each([
		'The {id="a1"++big ++}cat.',
		'The {id="d1"--cat--}{id="a1"++dog++} sat.',
		"{++a++}{--b--}{++++}c",
		'{id="a1"++one\ntwo++} end',
	])("one visible character per key press: %s", (doc) => {
		const view = editorView(doc);
		const end = view.state.doc.length;
		const lastColumn = visibleColumn(view, end);
		let presses = 0;
		while (head(view) < end) {
			const column = visibleColumn(view, head(view));
			press(view, "ArrowRight");
			presses++;
			expect(visibleColumn(view, head(view))).toBe(column + 1);
		}
		expect(presses).toBe(lastColumn);
		while (visibleColumn(view, head(view)) > 0) {
			const column = visibleColumn(view, head(view));
			press(view, "ArrowLeft");
			expect(visibleColumn(view, head(view))).toBe(column - 1);
		}
	});

	test("Shift+Right extends the selection over the hidden prefix", () => {
		const view = editorView('The |{id="a1"++big ++}cat.');
		press(view, "ArrowRight", true);
		const sel = view.state.selection.main;
		expect([sel.anchor, sel.head]).toEqual([4, after(view, "++b")]);
	});

	test("Right with a selection collapses it as usual", () => {
		const view = editorView('The {id="a1"++big ++}cat.');
		view.dispatch({ selection: { anchor: 0, head: before(view, "{") } });
		press(view, "ArrowRight");
		expect(view.state.selection.main.empty).toBe(true);
	});

	test("Source mode: the cursor moves over the raw syntax", () => {
		const view = editorView('The |{id="a1"++big ++}cat.', false);
		press(view, "ArrowRight");
		expect(head(view)).toBe(5);
	});
});
