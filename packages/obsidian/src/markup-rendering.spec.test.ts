import { defaultKeymap } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { type EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { NO_CHANGES_NOTICE, runNextChange } from "./navigate";
import { renderChanges } from "./reading";
import {
	after,
	before,
	changeSpans,
	makeView,
	visibleLines,
} from "./test-util";

function editorView(doc: string, live = true): EditorView {
	return makeView(doc, { live, extensions: keymap.of(defaultKeymap) });
}

function press(view: EditorView, key: string): void {
	runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
}

function typeText(view: EditorView, text: string): void {
	view.dispatch(view.state.replaceSelection(text), { userEvent: "input.type" });
}

function head(view: EditorView): number {
	return view.state.selection.main.head;
}

/** A section like Obsidian's Reading view renders it. */
function section(html: string): HTMLElement {
	const el = document.createElement("div");
	el.innerHTML = html;
	renderChanges(el);
	return el;
}

function readingSpans(el: HTMLElement) {
	return [...el.querySelectorAll(".coedit-ins, .coedit-del")].map((s) => ({
		text: s.textContent,
		cls: s.className,
		label: s.getAttribute("aria-label"),
	}));
}

describe("Insertions look like inserted text in Live Preview", () => {
	test("Insertion with attributes", () => {
		const view = makeView(
			'The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.',
		);
		expect(visibleLines(view)).toEqual(["The big cat."]);
		expect(changeSpans(view).map((s) => [s.text, s.cls])).toEqual([
			["big ", "coedit-ins"],
		]);
	});

	test("Insertion without attributes", () => {
		const view = makeView("The {++big ++}cat.");
		expect(visibleLines(view)).toEqual(["The big cat."]);
		expect(changeSpans(view).map((s) => [s.text, s.cls])).toEqual([
			["big ", "coedit-ins"],
		]);
	});
});

describe("Deletions look like deleted text in Live Preview", () => {
	test("Deletion", () => {
		const view = makeView('A {id="d1"--very --}big cat.');
		expect(visibleLines(view)).toEqual(["A very big cat."]);
		expect(changeSpans(view).map((s) => [s.text, s.cls])).toEqual([
			["very ", "coedit-del"],
		]);
	});

	test("Replace", () => {
		const view = makeView('The {id="d1"--cat--}{id="a1"++dog++} sat.');
		expect(visibleLines(view)).toEqual(["The catdog sat."]);
		expect(changeSpans(view).map((s) => [s.text, s.cls])).toEqual([
			["cat", "coedit-del"],
			["dog", "coedit-ins"],
		]);
	});
});

describe("Mark syntax is always hidden in Live Preview", () => {
	test("Cursor inside the mark", () => {
		const view = makeView('The {id="a1" author="Claude"++b|ig ++}cat.');
		expect(visibleLines(view)).toEqual(["The big cat."]);
	});

	test("Mark over two lines", () => {
		const view = makeView('{id="a1"++one\ntwo++} end');
		expect(visibleLines(view)).toEqual(["one", "two end"]);
		expect(changeSpans(view).map((s) => [s.text, s.cls])).toEqual([
			["one", "coedit-ins"],
			["two", "coedit-ins"],
		]);
	});
});

describe("The cursor never stops inside hidden syntax", () => {
	test("Arrow key over the hidden prefix", () => {
		const view = editorView('The |{id="a1"++big ++}cat.');
		press(view, "ArrowRight");
		expect(head(view)).toBe(after(view, "++b"));
	});

	test("Arrow key out of a mark", () => {
		const view = editorView('The {id="a1"++big |++}cat.');
		press(view, "ArrowRight");
		expect(head(view)).toBe(after(view, "}c"));
	});

	test("One key press for each visible character", () => {
		const visible = "The catdog sat.";
		const view = editorView('The {id="d1"--cat--}{id="a1"++dog++} sat.');
		expect(visibleLines(view)).toEqual([visible]);
		let right = 0;
		while (head(view) < view.state.doc.length) {
			press(view, "ArrowRight");
			right++;
		}
		let left = 0;
		while (head(view) > 0) {
			press(view, "ArrowLeft");
			left++;
		}
		expect([right, left]).toEqual([visible.length, visible.length]);
	});

	test("No cursor position in the prefix", () => {
		const doc = 'The {id="a1"++big ++}cat.';
		const view = editorView(doc);
		const seen = [head(view)];
		while (head(view) < doc.length) {
			press(view, "ArrowRight");
			seen.push(head(view));
		}
		while (head(view) > 0) {
			press(view, "ArrowLeft");
			seen.push(head(view));
		}
		const open = before(view, "{");
		const firstB = before(view, "big");
		const lastSpace = after(view, "big ");
		const close = after(view, "}");
		for (const pos of seen) {
			expect(pos > open && pos < firstB).toBe(false);
			expect(pos > lastSpace && pos < close).toBe(false);
		}
	});
});

describe("Edits keep the mark syntax whole", () => {
	const DOC = 'The {id="a1"++big ++}cat.';

	test("Backspace at the start of an insertion", () => {
		const view = editorView(DOC);
		view.dispatch({ selection: { anchor: before(view, "big") } });
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe('The{id="a1"++big ++}cat.');
	});

	test("Delete a selection that covers part of a mark", () => {
		const view = editorView(DOC);
		// The visible text `e bi`.
		view.dispatch({
			selection: EditorSelection.range(before(view, "e {"), after(view, "bi")),
		});
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe('Th{id="a1"++g ++}cat.');
	});

	test("Delete a selection that covers the whole mark", () => {
		const view = editorView(DOC);
		view.dispatch({
			selection: EditorSelection.range(0, view.state.doc.length),
		});
		press(view, "Backspace");
		expect(view.state.doc.toString()).toBe("");
	});

	test("Typing inside an insertion", () => {
		const view = editorView('The {id="a1"++big| ++}cat.');
		for (const ch of "gest") typeText(view, ch);
		expect(view.state.doc.toString()).toBe('The {id="a1"++biggest ++}cat.');
	});

	test("Changes from outside the editor are not filtered", () => {
		const view = editorView(DOC);
		// A reload: no user event.
		view.dispatch({
			changes: {
				from: 0,
				to: view.state.doc.length,
				insert: 'The {id="a1"++small ++}cat.',
			},
		});
		expect(view.state.doc.toString()).toBe('The {id="a1"++small ++}cat.');
	});
	test.todo(
		"Changes from outside the editor are not filtered: e2e in packages/e2e/tests/reload.e2e.ts",
	);
});

describe("Author and date on hover", () => {
	test("Author and date", () => {
		const view = makeView(
			'The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.',
		);
		expect(changeSpans(view)[0]?.label).toBe("Claude, 2026-10-24");
		const el = section(
			'<p>The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.</p>',
		);
		expect(readingSpans(el)[0]?.label).toBe("Claude, 2026-10-24");
	});
	test.todo("Author and date: e2e in packages/e2e/tests/hover.e2e.ts");

	test("No attributes", () => {
		const view = makeView("The {++big ++}cat.");
		expect(changeSpans(view)[0]?.label).toBe("Unknown author");
		const el = section("<p>The {++big ++}cat.</p>");
		expect(readingSpans(el)[0]?.label).toBe("Unknown author");
	});
	test.todo("No attributes: e2e in packages/e2e/tests/hover.e2e.ts");
});

describe("Reading view shows the changes", () => {
	test("Insertion and deletion in Reading view", () => {
		const el = section('<p>The {id="d1"--cat--}{id="a1"++dog++} sat.</p>');
		expect(el.textContent).toBe("The catdog sat.");
		expect(readingSpans(el).map((s) => [s.text, s.cls])).toEqual([
			["cat", "coedit-del"],
			["dog", "coedit-ins"],
		]);
	});

	test("Formatting inside a mark", () => {
		const el = section('<p>A {id="a1"++<strong>bold</strong> idea++}.</p>');
		expect(el.textContent).toBe("A bold idea.");
		expect(el.querySelector("strong")?.textContent).toBe("bold");
		expect(readingSpans(el).map((s) => [s.text, s.cls])).toEqual([
			["bold", "coedit-ins"],
			[" idea", "coedit-ins"],
		]);
	});
});

describe("Reading view has no decisions", () => {
	test("Right-click in Reading view", () => {
		const el = section('<p>The {id="a1"++big ++}cat.</p>');
		// Reading view output has no item and no handler for decisions.
		expect(el.textContent).not.toContain("Accept change");
		expect(el.textContent).not.toContain("Reject change");
		expect(el.querySelector("button, [role=menuitem]")).toBeNull();
	});
	test.todo(
		"Right-click in Reading view: e2e in packages/e2e/tests/menu.e2e.ts",
	);
});

describe("Source mode shows the raw text", () => {
	test("Raw mark in Source mode", () => {
		const doc = 'The {id="a1" author="Claude"++big ++}cat.';
		const view = makeView(doc, { live: false });
		expect(visibleLines(view)).toEqual([doc]);
		expect(changeSpans(view)).toEqual([]);
	});
});

describe("No rendering in protected zones", () => {
	test("Mark syntax in inline code", () => {
		const view = makeView("Use `{++x++}` here.");
		expect(visibleLines(view)).toEqual(["Use `{++x++}` here."]);
		expect(changeSpans(view)).toEqual([]);

		const html = "<p>Use <code>{++x++}</code> here.</p>";
		const el = section(html);
		expect(el.innerHTML).toBe(html);
		expect(readingSpans(el)).toEqual([]);
	});
});

describe("Other mark kinds keep their current look", () => {
	test("Substitution", () => {
		const view = makeView("A {~~cat~>dog~~} sat.");
		expect(visibleLines(view)).toEqual(["A {~~cat~>dog~~} sat."]);
		expect(changeSpans(view)).toEqual([]);

		const html = "<p>A {~~cat~&gt;dog~~} sat.</p>";
		expect(section(html).innerHTML).toBe(html);
	});
});

describe("Go to the next or previous change", () => {
	const DOC =
		'A {id="a1"++big++} cat {id="d1"--sat--} {~~x~>y~~} {id="a2"++here++}.';

	test("Next change", () => {
		const view = makeView(DOC);
		const seen: number[] = [];
		for (let i = 0; i < 3; i++) {
			expect(runNextChange(view, 1)).toBeNull();
			seen.push(head(view));
		}
		expect(seen).toEqual([
			before(view, "big"),
			before(view, "sat"),
			before(view, "here"),
		]);
	});

	test("Next change wraps around", () => {
		const view = makeView(DOC);
		view.dispatch({ selection: { anchor: before(view, "here") } });
		runNextChange(view, 1);
		expect(head(view)).toBe(before(view, "big"));
	});

	test("Previous change", () => {
		const view = makeView(DOC);
		view.dispatch({ selection: { anchor: before(view, "sat") } });
		runNextChange(view, -1);
		expect(head(view)).toBe(before(view, "big"));
	});

	test("No changes", () => {
		const view = makeView("A {~~x~>y~~} cat.");
		view.dispatch({ selection: { anchor: 3 } });
		expect(runNextChange(view, 1)).toBe(NO_CHANGES_NOTICE);
		expect(NO_CHANGES_NOTICE).toBe("No changes in this note.");
		expect(head(view)).toBe(3);
	});
	test.todo("No changes: e2e in packages/e2e/tests/notices.e2e.ts");
});

describe("In the Obsidian app (e2e)", () => {
	test.todo(
		"Insertion with attributes: e2e in packages/e2e/tests/cursor.e2e.ts",
	);
	test.todo(
		"Arrow key over the hidden prefix: e2e in packages/e2e/tests/cursor.e2e.ts",
	);
	test.todo(
		"Backspace at the start of an insertion: e2e in packages/e2e/tests/cursor.e2e.ts",
	);
	test.todo(
		"Insertion and deletion in Reading view: e2e in packages/e2e/tests/modes.e2e.ts",
	);
	test.todo("Raw mark in Source mode: e2e in packages/e2e/tests/modes.e2e.ts");
});
