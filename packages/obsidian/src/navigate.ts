import {
	EditorSelection,
	type EditorState,
	type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { marksField, visibleSpan } from "./marks";

export const NO_CHANGES_NOTICE = "No changes in this note.";

export type NextChangeResult =
	| { ok: true; spec: TransactionSpec }
	| { ok: false; notice: string };

/**
 * Move the cursor to the start of the visible text of the next (`dir` 1) or
 * previous (`dir` -1) insertion or deletion. Wraps around at the end and at
 * the start of the note. Other mark kinds are skipped.
 */
export function nextChange(state: EditorState, dir: 1 | -1): NextChangeResult {
	const { changes } = state.field(marksField);
	if (changes.length === 0) return { ok: false, notice: NO_CHANGES_NOTICE };
	const { lo, hi } = visibleSpan(changes, state.selection.main.head);
	const starts = changes.map((m) => m.contentStart);
	const target =
		dir === 1
			? (starts.find((p) => p > hi) ?? starts[0])
			: ([...starts].reverse().find((p) => p < lo) ??
				starts[starts.length - 1]);
	return {
		ok: true,
		spec: {
			selection: EditorSelection.cursor(target as number),
			scrollIntoView: true,
		},
	};
}

/** Run `nextChange` in `view`. Returns the notice text, or null. */
export function runNextChange(view: EditorView, dir: 1 | -1): string | null {
	const result = nextChange(view.state, dir);
	if (!result.ok) return result.notice;
	view.dispatch(result.spec);
	return null;
}
