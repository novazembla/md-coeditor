import { history, redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import {
	type DecideAtResult,
	decideAt,
	markAt,
	menuPos,
	NO_CHANGE_NOTICE,
	runDecision,
} from "./decide";
import { before, makeView } from "./test-util";

function view(doc: string): EditorView {
	return makeView(doc, { extensions: history() });
}

function text(v: EditorView): string {
	return v.state.doc.toString();
}

function cursor(v: EditorView): number {
	return v.state.selection.main.head;
}

function ok(result: DecideAtResult) {
	if (!result.ok) throw new Error(`expected a decision: ${result.notice}`);
	return result;
}

describe("markAt", () => {
	const doc = 'The {id="d1"--cat--}{id="a1"++dog++} sat.';

	test("inside the visible text", () => {
		const v = view(doc);
		expect(markAt(v.state, before(v, "at--"))?.id).toBe("d1");
	});

	test("between the two marks of a replace: the mark that starts there", () => {
		const v = view(doc);
		const del = markAt(v.state, before(v, "cat"));
		expect(del?.id).toBe("d1");
		// All positions that look like "directly after cat".
		for (const pos of [
			before(v, "--}{"),
			before(v, '{id="a1"'),
			before(v, "dog"),
		])
			expect(markAt(v.state, pos)?.id).toBe("a1");
	});

	test("directly after the last mark", () => {
		const v = view(doc);
		expect(markAt(v.state, before(v, " sat"))?.id).toBe("a1");
	});

	test("no mark", () => {
		const v = view(doc);
		expect(markAt(v.state, 1)).toBeNull();
	});
});

describe("decideAt result for the log", () => {
	test("accept an insertion with author", () => {
		const v = view('The {id="i1" author="Claude"++b|ig ++}cat.');
		const r = ok(decideAt(v.state, cursor(v), "accept")).result;
		expect(r.id).toBe("i1");
		expect(r.decision).toBe("accept");
		expect(r.mark.kind).toBe("insertion");
		expect(r.mark.content).toBe("big ");
		expect(r.mark.author).toBe("Claude");
	});

	test("reject a deletion without author", () => {
		const v = view('A {id="d1"--v|ery --}big cat.');
		const r = ok(decideAt(v.state, cursor(v), "reject")).result;
		expect(r).toMatchObject({ id: "d1", decision: "reject" });
		expect(r.mark.kind).toBe("deletion");
		expect(r.mark.content).toBe("very ");
		expect(r.mark.author).toBeUndefined();
	});

	test("a mark without id: the result has the new id", () => {
		const v = view("A {--v|ery --}big cat.");
		const r = ok(
			decideAt(v.state, cursor(v), "reject", { newId: () => "n1" }),
		).result;
		expect(r.id).toBe("n1");
	});
});

describe("decideAt", () => {
	test("accept an insertion", () => {
		const v = view('The {id="a1"++b|ig ++}cat.');
		expect(runDecision(v, cursor(v), "accept")).toBeNull();
		expect(text(v)).toBe("The big cat.");
		expect(cursor(v)).toBe(4);
	});

	test("reject an insertion", () => {
		const v = view('The {id="a1"++b|ig ++}cat.');
		runDecision(v, cursor(v), "reject");
		expect(text(v)).toBe("The cat.");
	});

	test("accept a deletion", () => {
		const v = view('A {id="d1"--v|ery --}big cat.');
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe("A big cat.");
	});

	test("reject a deletion", () => {
		const v = view('A {id="d1"--v|ery --}big cat.');
		runDecision(v, cursor(v), "reject");
		expect(text(v)).toBe("A very big cat.");
	});

	test("the two marks of a replace one after the other", () => {
		const v = view('The {id="d1"--c|at--}{id="a1"++dog++} sat.');
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe('The {id="a1"++dog++} sat.');
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe("The dog sat.");
	});

	test("no id: a new id in the same transaction", () => {
		const v = view("The {++b|ig ++}cat.");
		const result = ok(decideAt(v.state, cursor(v), "accept"));
		expect(result.result.id).toMatch(/^[a-z0-9]{6}$/);
		v.dispatch(result.spec);
		expect(text(v)).toBe("The big cat.");
	});

	test("no id: other marks without an id stay as they are", () => {
		const v = view("{++|a++} and {++b++}");
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe("a and {++b++}");
	});

	test("duplicate id: the second mark", () => {
		const v = view('{id="a1"++x++} and {id="a1"++|y++}');
		const result = ok(decideAt(v.state, cursor(v), "reject"));
		expect(result.result.id).not.toBe("a1");
		v.dispatch(result.spec);
		expect(text(v)).toBe('{id="a1"++x++} and ');
	});

	test("no mark at the cursor", () => {
		const v = view('The {id="a1"++big ++}c|at.');
		expect(runDecision(v, cursor(v), "accept")).toBe(NO_CHANGE_NOTICE);
		expect(text(v)).toBe('The {id="a1"++big ++}cat.');
	});

	test.each([
		["substitution", "A {~~c|at~>dog~~} sat."],
		["highlight", "A {==c|at==} sat."],
		["comment", "A {>>n|ote<<} sat."],
	])("unsupported kind: %s", (kind, doc) => {
		const v = view(doc);
		const before = text(v);
		expect(runDecision(v, cursor(v), "reject")).toBe(
			`Not supported yet: ${kind}.`,
		);
		expect(text(v)).toBe(before);
	});

	test("the result names the mark and the decision", () => {
		const v = view('The {id="a1"++b|ig ++}cat.');
		const { result } = ok(decideAt(v.state, cursor(v), "reject"));
		expect(result).toMatchObject({
			decision: "reject",
			id: "a1",
			mark: { kind: "insertion", id: "a1" },
		});
	});
});

describe("undo and redo", () => {
	test.each([
		["accept", "The big cat."],
		["reject", "The cat."],
	] as const)("%s, then undo and redo", (decision, decided) => {
		const doc = 'The {id="a1"++big ++}cat.';
		const v = view('The {id="a1"++b|ig ++}cat.');
		runDecision(v, cursor(v), decision);
		expect(text(v)).toBe(decided);
		undo(v);
		expect(text(v)).toBe(doc);
		redo(v);
		expect(text(v)).toBe(decided);
	});

	test("deletion: accept, then undo", () => {
		const v = view('A {id="d1"--v|ery --}big cat.');
		runDecision(v, cursor(v), "accept");
		undo(v);
		expect(text(v)).toBe('A {id="d1"--very --}big cat.');
	});

	test("no id: one undo step gives back the mark without an id", () => {
		const v = view("The {++b|ig ++}cat.");
		runDecision(v, cursor(v), "accept");
		expect(text(v)).toBe("The big cat.");
		undo(v);
		expect(text(v)).toBe("The {++big ++}cat.");
		redo(v);
		expect(text(v)).toBe("The big cat.");
	});
});

describe("menuPos", () => {
	function rightClick(el: Element): void {
		el.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
		);
	}

	test("right-click on a change finds it", () => {
		const v = view('The {id="a1"++big ++}cat.');
		const span = v.contentDOM.querySelector(".coedit-ins");
		if (!span) throw new Error("no span");
		rightClick(span);
		const pos = menuPos(v.state);
		expect(pos).not.toBeNull();
		runDecision(v, pos as number, "reject");
		expect(text(v)).toBe("The cat.");
	});

	test("right-click on the deletion of a replace finds the deletion", () => {
		const v = view('The {id="d1"--cat--}{id="a1"++dog++} sat.');
		const span = v.contentDOM.querySelector(".coedit-del");
		if (!span) throw new Error("no span");
		rightClick(span);
		expect(markAt(v.state, menuPos(v.state) as number)?.id).toBe("d1");
	});

	test("right-click on plain text gives no position", () => {
		const v = view('The {id="a1"++b|ig ++}cat.');
		rightClick(v.contentDOM.querySelector(".cm-line") as Element);
		expect(menuPos(v.state)).toBeNull();
	});

	test("without a right-click: the cursor, if a change is there", () => {
		expect(menuPos(view('The {id="a1"++b|ig ++}cat.').state)).toBe(15);
		expect(menuPos(view('The {id="a1"++big ++}c|at.').state)).toBeNull();
	});
});
