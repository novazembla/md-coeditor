import { EditorState, Prec, type Transaction } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import {
	type ChangeMark,
	hiddenRanges,
	isLivePreview,
	marksField,
	visibleSpan,
} from "./marks";
import { charStep } from "./motion";

function isUserEdit(tr: Transaction): boolean {
	return (
		tr.isUserEvent("input") ||
		tr.isUserEvent("delete") ||
		tr.isUserEvent("move")
	);
}

/**
 * Keeps the mark syntax whole in Live Preview. For each mark that a user edit
 * covers only in part, the hidden ranges of that mark are suppressed, so the
 * edit changes only the visible text. Other transactions (file reload,
 * decisions) pass.
 */
export const protectFilter = EditorState.changeFilter.of((tr) => {
	if (!tr.docChanged || !isUserEdit(tr) || !isLivePreview(tr.startState))
		return true;
	const { changes } = tr.startState.field(marksField);
	const suppressed = new Set<ChangeMark>();
	tr.changes.iterChangedRanges((from, to) => {
		if (from === to) return;
		for (const mark of changes) {
			const overlaps = from < mark.end && to > mark.start;
			const covers = from <= mark.start && to >= mark.end;
			if (overlaps && !covers) suppressed.add(mark);
		}
	});
	if (suppressed.size === 0) return true;
	return [...suppressed].flatMap(hiddenRanges).flat();
});

/**
 * Backspace (`forward` false) or Delete (`forward` true) with an empty
 * selection next to hidden syntax: delete the visible character on the other
 * side of the hidden ranges. Returns false when no hidden range is next to
 * the cursor, so the default key handling runs.
 */
export function deleteAcrossHidden(
	view: EditorView,
	forward: boolean,
): boolean {
	const { state } = view;
	const sel = state.selection.main;
	if (!sel.empty || !isLivePreview(state)) return false;
	const { lo, hi } = visibleSpan(state.field(marksField).changes, sel.head);
	const pos = forward ? hi : lo;
	if (pos === sel.head) return false;
	const next = charStep(state, pos, forward);
	if (next === pos) return true;
	const [from, to] = forward ? [pos, next] : [next, pos];
	view.dispatch({
		changes: { from, to },
		userEvent: forward ? "delete.forward" : "delete.backward",
		scrollIntoView: true,
	});
	return true;
}

export const protectKeymap = Prec.high(
	keymap.of([
		{ key: "Backspace", run: (view) => deleteAcrossHidden(view, false) },
		{ key: "Delete", run: (view) => deleteAcrossHidden(view, true) },
	]),
);
