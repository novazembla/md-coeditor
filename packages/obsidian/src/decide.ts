import {
	ChangeSet,
	type EditorState,
	StateEffect,
	StateField,
	type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
	type Decision,
	decide,
	ensureId,
	type Mark,
} from "@md-coeditor/format";
import { type ChangeMark, isChange, marksField, visibleSpan } from "./marks";
import { DELETION_CLASS, INSERTION_CLASS } from "./render";

export const NO_CHANGE_NOTICE = "No change at the cursor.";

/**
 * The mark at `pos`: `pos` is in its visible text or directly before or
 * after it. When two marks touch `pos`, the mark whose visible text starts at
 * `pos` wins. Also finds other kinds, so the caller can tell the user that
 * they are not supported.
 */
export function markAt(state: EditorState, pos: number): Mark | null {
	const { changes, all } = state.field(marksField);
	const { lo, hi } = visibleSpan(changes, pos);
	const touching = all.filter((m) => m.start <= hi && m.end >= lo);
	if (touching.length === 0) return null;
	return (
		touching.find((m) => m.contentStart === hi || m.start === hi) ??
		(touching[0] as Mark)
	);
}

export interface DecisionResult {
	mark: ChangeMark;
	decision: Decision;
	/** The id the decision used. New if the mark had none or a duplicate. */
	id: string;
}

export type DecideAtResult =
	| { ok: true; spec: TransactionSpec; result: DecisionResult }
	| { ok: false; notice: string };

/**
 * Accept or reject the insertion or deletion at `pos`, as one transaction.
 * A mark without an id or with a duplicate id gets a new id in the same
 * transaction, so undo gives back the text as it was before.
 */
export function decideAt(
	state: EditorState,
	pos: number,
	decision: Decision,
	options: { newId?: () => string } = {},
): DecideAtResult {
	const mark = markAt(state, pos);
	if (!mark) return { ok: false, notice: NO_CHANGE_NOTICE };
	if (!isChange(mark))
		return { ok: false, notice: `Not supported yet: ${mark.kind}.` };

	const text0 = state.doc.toString();
	const { duplicateIds } = state.field(marksField);
	const needsId = mark.id === undefined || duplicateIds.has(mark.id);
	const withId = needsId
		? ensureId(text0, mark.start, options)
		: { text: text0, changes: [], id: mark.id as string };
	const decided = decide({ text: withId.text, id: withId.id, decision });
	if (!decided.ok) throw new Error(`decide failed: ${decided.message}`);

	const changes = ChangeSet.of(withId.changes, text0.length).compose(
		ChangeSet.of(decided.changes, withId.text.length),
	);
	return {
		ok: true,
		spec: {
			changes,
			selection: { anchor: mark.start },
			filter: false,
			userEvent: "coedit.decide",
			scrollIntoView: true,
		},
		result: { mark, decision, id: withId.id },
	};
}

/**
 * Decide the mark at `pos` in `view`. Returns the decision result, or the
 * notice text when nothing was decided.
 */
export function applyDecision(
	view: EditorView,
	pos: number,
	decision: Decision,
): { result: DecisionResult } | { notice: string } {
	const decided = decideAt(view.state, pos, decision);
	if (!decided.ok) return { notice: decided.notice };
	view.dispatch(decided.spec);
	return { result: decided.result };
}

/**
 * Decide the mark at `pos` in `view`. Returns the notice text when nothing
 * was decided, or null.
 */
export function runDecision(
	view: EditorView,
	pos: number,
	decision: Decision,
): string | null {
	const outcome = applyDecision(view, pos, decision);
	return "notice" in outcome ? outcome.notice : null;
}

const setMenuPos = StateEffect.define<number | null>();

/**
 * Where the last right-click was: a position in the visible text of a change,
 * null for a right-click elsewhere, undefined before any right-click.
 */
export const menuPosField = StateField.define<number | null | undefined>({
	create: () => undefined,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setMenuPos)) return e.value;
		if (typeof value === "number" && tr.docChanged)
			return tr.changes.mapPos(value);
		return value;
	},
});

/**
 * Stores the right-clicked position before Obsidian opens the editor menu.
 * The position is the start of the change span under the pointer, so a
 * right-click on plain text next to a change does not find it.
 */
export const menuPosHandler = EditorView.domEventHandlers({
	contextmenu(event, view) {
		const target = event.target as Element | null;
		const span = target?.closest?.(`.${INSERTION_CLASS}, .${DELETION_CLASS}`);
		const pos = span ? view.posAtDOM(span, 0) : null;
		view.dispatch({ effects: setMenuPos.of(pos) });
		return false;
	},
});

/**
 * The position the editor menu acts on: the last right-click, or the cursor
 * if no right-click was seen. Null when the menu must not show the items.
 */
export function menuPos(state: EditorState): number | null {
	const stored = state.field(menuPosField, false);
	const pos = stored === undefined ? state.selection.main.head : stored;
	if (pos === null) return null;
	const mark = markAt(state, pos);
	return mark && isChange(mark) ? pos : null;
}
