import type { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { NO_CHANGES_NOTICE, nextChange, runNextChange } from "./navigate";
import { before, makeView } from "./test-util";

const DOC =
	'A {id="a1"++big++} cat {id="d1"--sat--} {~~x~>y~~} {id="a2"++here++}.';

function cursor(v: EditorView): number {
	return v.state.selection.main.head;
}

describe("nextChange", () => {
	test("next: big, sat, here, then wrap to big", () => {
		const v = makeView(DOC);
		const seen: number[] = [];
		for (let i = 0; i < 4; i++) {
			expect(runNextChange(v, 1)).toBeNull();
			seen.push(cursor(v));
		}
		expect(seen).toEqual([
			before(v, "big"),
			before(v, "sat"),
			before(v, "here"),
			before(v, "big"),
		]);
	});

	test("previous: from sat to big, then wrap to here", () => {
		const v = makeView(DOC);
		v.dispatch({ selection: { anchor: before(v, "sat") } });
		runNextChange(v, -1);
		expect(cursor(v)).toBe(before(v, "big"));
		runNextChange(v, -1);
		expect(cursor(v)).toBe(before(v, "here"));
	});

	test("the cursor before a hidden prefix counts as at the change", () => {
		const v = makeView(DOC);
		v.dispatch({ selection: { anchor: before(v, '{id="a1"') } });
		runNextChange(v, 1);
		expect(cursor(v)).toBe(before(v, "sat"));
	});

	test("the result scrolls the cursor into view", () => {
		const result = nextChange(makeView(DOC).state, 1);
		expect(result.ok && result.spec.scrollIntoView).toBe(true);
	});

	test("no changes: notice, the cursor does not move", () => {
		const v = makeView("A {~~x~>y~~} and `{++x++}`.");
		v.dispatch({ selection: { anchor: 3 } });
		expect(runNextChange(v, 1)).toBe(NO_CHANGES_NOTICE);
		expect(cursor(v)).toBe(3);
	});
});
