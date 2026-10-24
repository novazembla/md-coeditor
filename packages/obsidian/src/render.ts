import {
	type EditorState,
	type Range,
	RangeSet,
	type RangeValue,
	StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
	type ChangeMark,
	hiddenRanges,
	isLivePreview,
	marksField,
	tooltip,
} from "./marks";

export const INSERTION_CLASS = "coedit-ins";
export const DELETION_CLASS = "coedit-del";

interface Rendered {
	live: boolean;
	decorations: DecorationSet;
	/** The hidden ranges, for `EditorView.atomicRanges`. */
	atomic: RangeSet<RangeValue>;
}

const hide = Decoration.replace({});

function contentDecoration(mark: ChangeMark): Decoration {
	return Decoration.mark({
		class: mark.kind === "insertion" ? INSERTION_CLASS : DELETION_CLASS,
		attributes: { "aria-label": tooltip(mark) },
	});
}

function build(state: EditorState): Rendered {
	const live = isLivePreview(state);
	if (!live) {
		return { live, decorations: Decoration.none, atomic: RangeSet.empty };
	}
	const decorations: Range<Decoration>[] = [];
	const hidden: Range<Decoration>[] = [];
	for (const mark of state.field(marksField).changes) {
		for (const [from, to] of hiddenRanges(mark)) {
			decorations.push(hide.range(from, to));
			hidden.push(hide.range(from, to));
		}
		if (mark.contentStart < mark.contentEnd) {
			decorations.push(
				contentDecoration(mark).range(mark.contentStart, mark.contentEnd),
			);
		}
	}
	return {
		live,
		decorations: Decoration.set(decorations, true),
		atomic: RangeSet.of(hidden, true),
	};
}

/**
 * Decorations for Live Preview: hidden syntax, the change classes with a
 * tooltip, and atomic ranges over the hidden syntax. Nothing in Source mode.
 */
export const renderField = StateField.define<Rendered>({
	create: build,
	update(value, tr) {
		const changed =
			tr.state.field(marksField) !== tr.startState.field(marksField);
		if (!changed && isLivePreview(tr.state) === value.live) return value;
		return build(tr.state);
	},
	provide: (field) => [
		EditorView.decorations.from(field, (value) => value.decorations),
		EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
	],
});
