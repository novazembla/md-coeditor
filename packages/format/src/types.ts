export type MarkKind =
	| "insertion"
	| "deletion"
	| "substitution"
	| "highlight"
	| "comment";

/** One attribute of a mark: `[name, value]`. */
export type Attr = readonly [name: string, value: string];

export interface Mark {
	kind: MarkKind;
	/** Position of `{`. */
	start: number;
	/** Position after the closing `}`. */
	end: number;
	/** Attributes in their original order. */
	attrs: readonly Attr[];
	/** First attribute with the name `id`, `author` or `date`. */
	id?: string;
	author?: string;
	date?: string;
	/** Raw text between the operators. For a substitution: `old~>new`. */
	content: string;
	/** Substitution only. */
	oldContent?: string;
	newContent?: string;
	/** Range of `content` in the note. */
	contentStart: number;
	contentEnd: number;
}

export type ZoneKind =
	| "frontmatter"
	| "fenced-code"
	| "indented-code"
	| "inline-code"
	| "table";

export interface Zone {
	kind: ZoneKind;
	start: number;
	end: number;
}

export type Segment =
	| { type: "text"; start: number; end: number }
	| { type: "mark"; start: number; end: number; mark: Mark };

export interface ParsedNote {
	text: string;
	/** Contiguous; together they cover the whole text. */
	segments: Segment[];
	marks: Mark[];
	/** Block and inline zones, sorted by start. */
	zones: Zone[];
	/** Ids that occur on more than one mark, in order of first occurrence. */
	duplicateIds: string[];
}

export type ErrorCode =
	| "empty_find"
	| "no_change"
	| "line_break"
	| "markup_in_text"
	| "invalid_attribute"
	| "not_found"
	| "ambiguous"
	| "overlaps_mark"
	| "protected_zone"
	| "structural_edit"
	| "unsafe_result"
	| "duplicate_id"
	| "unsupported_kind";

/**
 * One edit to a text. `from` and `to` are positions in the text before the
 * edit. A list of changes is in order and has no overlap.
 */
export interface Change {
	from: number;
	to: number;
	insert: string;
}

export type Result<T> =
	| ({ ok: true } & T)
	| { ok: false; code: ErrorCode; message: string };
