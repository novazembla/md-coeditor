import { parse } from "./parse";
import type { Mark } from "./types";

/** A mark and its range in the agent view. The range is empty for a hidden mark. */
export interface ViewMark {
	mark: Mark;
	start: number;
	end: number;
}

/**
 * The agent view: the note as if all pending marks were accepted.
 */
export interface View {
	/** The view text. */
	text: string;
	/** All marks in note order, with their ranges in the view. */
	marks: ViewMark[];
	/**
	 * Map a view position to a note position.
	 *
	 * Inside a run of text the answer is exact. At a boundary (where plain text
	 * meets a mark, or a hidden mark sits between two characters) there are two
	 * note positions, and `bias` picks one:
	 * - `"start"` (default): the position of the character at `viewPos`. Hidden
	 *   marks and the opening of a visible mark before that character are
	 *   skipped. Use it for the start of a range.
	 * - `"end"`: the position directly after the character before `viewPos`.
	 *   Hidden marks and the closing of a visible mark after that character are
	 *   not included. Use it for the end of a range.
	 *
	 * A position inside a visible mark gives a position inside its content. At
	 * the end of the view, `"start"` gives the length of the note and `"end"`
	 * stops after the last visible character. A position out of range is clamped.
	 */
	toNote(viewPos: number, bias?: "start" | "end"): number;
}

interface Piece {
	viewStart: number;
	viewEnd: number;
	/** Note position of the first character of the piece. */
	noteStart: number;
}

/**
 * Make the agent view of a note: the text as if all pending marks were
 * accepted, with a map from view positions back to note positions.
 */
export function project(text: string): View {
	const parsed = parse(text);
	const pieces: Piece[] = [];
	const marks: ViewMark[] = [];
	let view = "";

	const add = (value: string, noteStart: number): void => {
		if (value === "") return;
		pieces.push({
			viewStart: view.length,
			viewEnd: view.length + value.length,
			noteStart,
		});
		view += value;
	};

	for (const seg of parsed.segments) {
		if (seg.type === "text") {
			add(text.slice(seg.start, seg.end), seg.start);
			continue;
		}
		const m = seg.mark;
		const start = view.length;
		if (m.kind === "insertion" || m.kind === "highlight") {
			add(m.content, m.contentStart);
		} else if (m.kind === "substitution") {
			const newContent = m.newContent ?? "";
			add(newContent, m.contentEnd - newContent.length);
		}
		marks.push({ mark: m, start, end: view.length });
	}

	const toNote = (viewPos: number, bias: "start" | "end" = "start"): number => {
		const pos = Math.max(0, Math.min(viewPos, view.length));
		if (bias === "start") {
			for (const p of pieces) {
				if (p.viewEnd > pos) return p.noteStart + (pos - p.viewStart);
			}
			return text.length;
		}
		for (let i = pieces.length - 1; i >= 0; i--) {
			const p = pieces[i] as Piece;
			if (p.viewStart < pos) return p.noteStart + (pos - p.viewStart);
		}
		return 0;
	};

	return { text: view, marks, toNote };
}
