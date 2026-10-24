import { type EditorState, Facet, StateField } from "@codemirror/state";
import {
	type DeletionMark,
	type InsertionMark,
	type Mark,
	parse,
} from "@md-coeditor/format";

/** An insertion or a deletion: the kinds this plugin shows and decides. */
export type ChangeMark = InsertionMark | DeletionMark;

export interface MarksValue {
	/** Insertions and deletions outside protected zones, in note order. */
	changes: readonly ChangeMark[];
	/** All marks outside protected zones, in note order (also other kinds). */
	all: readonly Mark[];
	/** Ids that more than one mark has. */
	duplicateIds: ReadonlySet<string>;
}

export function isChange(mark: Mark): mark is ChangeMark {
	return mark.kind === "insertion" || mark.kind === "deletion";
}

function compute(state: EditorState): MarksValue {
	const parsed = parse(state.doc.toString());
	return {
		changes: parsed.marks.filter(isChange),
		all: parsed.marks,
		duplicateIds: new Set(parsed.duplicateIds),
	};
}

/**
 * Tells if the editor is in Live Preview. Obsidian gives this through
 * `editorLivePreviewField`, which tests cannot import, so `coeditExtension`
 * sets it. Without a value, the editor is not in Live Preview.
 */
export const livePreviewCheck = Facet.define<
	(state: EditorState) => boolean,
	(state: EditorState) => boolean
>({
	combine: (values) => values[0] ?? (() => false),
});

export function isLivePreview(state: EditorState): boolean {
	return state.facet(livePreviewCheck)(state);
}

/** The parse result of the document. Recomputed when the document changes. */
export const marksField = StateField.define<MarksValue>({
	create: compute,
	update: (value, tr) => (tr.docChanged ? compute(tr.state) : value),
});

/**
 * The hidden parts of a change: brace, attributes and operator before the
 * content, and operator and brace after it. An empty content gives one range.
 */
export function hiddenRanges(mark: ChangeMark): [number, number][] {
	if (mark.contentStart === mark.contentEnd) return [[mark.start, mark.end]];
	return [
		[mark.start, mark.contentStart],
		[mark.contentEnd, mark.end],
	];
}

/**
 * The span of positions that look the same as `pos` in Live Preview: `pos`
 * extended over the hidden ranges that touch it. `lo` and `hi` are equal when
 * no hidden range touches `pos`.
 */
export function visibleSpan(
	changes: readonly ChangeMark[],
	pos: number,
): { lo: number; hi: number } {
	const ranges = changes.flatMap(hiddenRanges);
	let lo = pos;
	let hi = pos;
	for (let i = ranges.length - 1; i >= 0; i--) {
		const [from, to] = ranges[i] as [number, number];
		if (to === lo) lo = from;
	}
	for (const [from, to] of ranges) {
		if (from === hi) hi = to;
	}
	return { lo, hi };
}

/** Tooltip text: `author, date`, `Unknown author` when there is no author. */
export function tooltip(mark: Mark): string {
	const author = mark.author ?? "Unknown author";
	return mark.date === undefined ? author : `${author}, ${mark.date}`;
}
