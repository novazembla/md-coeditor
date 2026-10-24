import {
	EditorSelection,
	type EditorState,
	findClusterBreak,
	Prec,
} from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { isLivePreview, marksField, visibleSpan } from "./marks";

/**
 * The position one character after (`forward`) or before `pos`. A line break
 * counts as one character. Returns `pos` at the end or start of the document.
 */
export function charStep(
	state: EditorState,
	pos: number,
	forward: boolean,
): number {
	const line = state.doc.lineAt(pos);
	if (forward) {
		if (pos === state.doc.length) return pos;
		if (pos === line.to) return pos + 1;
		return line.from + findClusterBreak(line.text, pos - line.from, true);
	}
	if (pos === 0) return pos;
	if (pos === line.from) return pos - 1;
	return line.from + findClusterBreak(line.text, pos - line.from, false);
}

/**
 * Left or right arrow next to hidden syntax: move over the hidden ranges and
 * one visible character in one key press. Returns false when no hidden range
 * is next to the cursor in that direction, so the default key handling runs.
 */
export function moveAcrossHidden(
	view: EditorView,
	forward: boolean,
	extend: boolean,
): boolean {
	const { state } = view;
	if (!isLivePreview(state) || state.selection.ranges.length > 1) return false;
	const sel = state.selection.main;
	if (!extend && !sel.empty) return false;
	const { lo, hi } = visibleSpan(state.field(marksField).changes, sel.head);
	const edge = forward ? hi : lo;
	if (edge === sel.head) return false;
	const head = charStep(state, edge, forward);
	view.dispatch({
		selection: extend
			? EditorSelection.range(sel.anchor, head)
			: EditorSelection.cursor(head),
		userEvent: "select",
		scrollIntoView: true,
	});
	return true;
}

export const motionKeymap = Prec.high(
	keymap.of([
		{
			key: "ArrowLeft",
			run: (view) => moveAcrossHidden(view, false, false),
			shift: (view) => moveAcrossHidden(view, false, true),
		},
		{
			key: "ArrowRight",
			run: (view) => moveAcrossHidden(view, true, false),
			shift: (view) => moveAcrossHidden(view, true, true),
		},
	]),
);
