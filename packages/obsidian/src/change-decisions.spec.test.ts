import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import {
	decideAt,
	markAt,
	menuPos,
	NO_CHANGE_NOTICE,
	runDecision,
} from "./decide";
import { isLivePreview } from "./marks";
import { after, before, makeView } from "./test-util";

function view(doc: string, live = true): EditorView {
	return makeView(doc, { live, extensions: history() });
}

function text(v: EditorView): string {
	return v.state.doc.toString();
}

function cursor(v: EditorView): number {
	return v.state.selection.main.head;
}

function rightClick(el: Element): void {
	el.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
}

describe("Accept and reject the change at the cursor", () => {
	test("Accept with the cursor inside an insertion", () => {
		const v = view('The {id="a1"++b|ig ++}cat.');
		expect(runDecision(v, cursor(v), "accept")).toBeNull();
		expect(text(v)).toBe("The big cat.");
	});

	test("Reject with the cursor inside a deletion", () => {
		const v = view('A {id="d1"--v|ery --}big cat.');
		expect(runDecision(v, cursor(v), "reject")).toBeNull();
		expect(text(v)).toBe("A very big cat.");
	});

	test("Cursor between the two marks of a replace", () => {
		const v = view('The {id="d1"--cat--}{id="a1"++dog++} sat.');
		// Directly after `cat`, directly before `dog`.
		v.dispatch({ selection: { anchor: before(v, "dog") } });
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe('The {id="d1"--cat--}dog sat.');
	});

	test("Decide both marks of a replace one after the other", () => {
		const v = view('The {id="d1"--c|at--}{id="a1"++dog++} sat.');
		runDecision(v, cursor(v), "accept");
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe("The dog sat.");
	});
	test.todo(
		"Accept with the cursor inside an insertion: e2e in packages/e2e/tests/palette.e2e.ts",
	);
});

describe("Decisions from the right-click menu", () => {
	test("Reject from the menu", () => {
		const v = view('The {id="a1"++big ++}cat.');
		const span = v.contentDOM.querySelector(".coedit-ins");
		if (!span) throw new Error("no span");
		rightClick(span);
		const pos = menuPos(v.state);
		expect(pos).not.toBeNull();
		runDecision(v, pos as number, "reject");
		expect(text(v)).toBe("The cat.");
	});
	test.todo("Reject from the menu: e2e in packages/e2e/tests/menu.e2e.ts");

	test("Right-click on plain text", () => {
		const v = view('The {id="a1"++big ++}cat.');
		rightClick(v.contentDOM.querySelector(".cm-line") as Element);
		expect(menuPos(v.state)).toBeNull();
	});
	test.todo("Right-click on plain text: e2e in packages/e2e/tests/menu.e2e.ts");
});

describe("A mark without an id gets one when it is decided", () => {
	test("Accept an insertion without an id", () => {
		const v = view("The {++b|ig ++}cat.");
		const result = decideAt(v.state, cursor(v), "accept");
		if (!result.ok) throw new Error(result.notice);
		v.dispatch(result.spec);
		expect(text(v)).toBe("The big cat.");
		expect(result.result.id).toMatch(/^[a-z0-9]{6}$/);
	});

	test("Other marks without an id stay as they are", () => {
		const v = view("{++|a++} and {++b++}");
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe("a and {++b++}");
	});

	test("Duplicate id", () => {
		const v = view('{id="a1"++x++} and {id="a1"++|y++}');
		runDecision(v, cursor(v), "reject");
		expect(text(v)).toBe('{id="a1"++x++} and ');
	});

	test("Opening a note does not change it", () => {
		const doc = "The {++big ++}cat.";
		let changed = false;
		const v = makeView(doc, {
			extensions: EditorView.updateListener.of((u) => {
				if (u.docChanged) changed = true;
			}),
		});
		expect(changed).toBe(false);
		expect(text(v)).toBe(doc);
	});
});

describe("One decision is one undo step", () => {
	test("Undo an accept", () => {
		const v = view('The {id="a1"++b|ig ++}cat.');
		runDecision(v, cursor(v), "accept");
		undo(v);
		expect(text(v)).toBe('The {id="a1"++big ++}cat.');
	});

	test("Undo an accept of a mark without an id", () => {
		const v = view("The {++b|ig ++}cat.");
		runDecision(v, cursor(v), "accept");
		undo(v);
		expect(text(v)).toBe("The {++big ++}cat.");
	});
});

describe("Decisions that cannot be made show a notice", () => {
	test("No mark at the cursor", () => {
		const doc = 'The {id="a1"++big ++}cat.';
		const v = view('The {id="a1"++big ++}c|at.');
		expect(runDecision(v, cursor(v), "accept")).toBe(NO_CHANGE_NOTICE);
		expect(NO_CHANGE_NOTICE).toBe("No change at the cursor.");
		expect(text(v)).toBe(doc);
	});
	test.todo("No mark at the cursor: e2e in packages/e2e/tests/notices.e2e.ts");

	test("Substitution at the cursor", () => {
		const doc = "A {~~c|at~>dog~~} sat.";
		const v = view(doc);
		const before0 = text(v);
		expect(runDecision(v, cursor(v), "reject")).toBe(
			"Not supported yet: substitution.",
		);
		expect(text(v)).toBe(before0);
	});
	test.todo(
		"Substitution at the cursor: e2e in packages/e2e/tests/notices.e2e.ts",
	);
});

describe("Decisions only in Live Preview", () => {
	test("Source mode", () => {
		// main.ts: editorCheckCallback returns false when this is false.
		expect(isLivePreview(view("The {++big ++}cat.", false).state)).toBe(false);
		expect(isLivePreview(view("The {++big ++}cat.").state)).toBe(true);
	});
	test.todo("Source mode: e2e in packages/e2e/tests/palette.e2e.ts");
});

describe("markAt helper", () => {
	test("positions around a visible mark", () => {
		const v = view('The {id="a1"++big ++}cat.');
		expect(markAt(v.state, after(v, "b"))?.id).toBe("a1");
	});
});

describe("Decisions in Obsidian are logged", () => {
	test.todo("Accept from the menu: e2e in packages/e2e/tests/log.e2e.ts");
	test.todo("No change at the cursor: e2e in packages/e2e/tests/log.e2e.ts");
});
