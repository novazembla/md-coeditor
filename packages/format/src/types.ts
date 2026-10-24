export type MarkKind =
	| "insertion"
	| "deletion"
	| "substitution"
	| "highlight"
	| "comment";

/** One attribute of a mark: `[name, value]`. */
export type Attr = readonly [name: string, value: string];

interface MarkBase {
	/** Position of `{`. */
	readonly start: number;
	/** Position after the closing `}`. */
	readonly end: number;
	/** Attributes in their original order. */
	readonly attrs: readonly Attr[];
	/** First attribute with the name `id`, `author` or `date`. */
	readonly id?: string;
	readonly author?: string;
	readonly date?: string;
	/** Raw text between the operators. For a substitution: `old~>new`. */
	readonly content: string;
	/** Range of `content` in the note. */
	readonly contentStart: number;
	readonly contentEnd: number;
}

export interface InsertionMark extends MarkBase {
	readonly kind: "insertion";
}

export interface DeletionMark extends MarkBase {
	readonly kind: "deletion";
}

export interface SubstitutionMark extends MarkBase {
	readonly kind: "substitution";
	readonly oldContent: string;
	readonly newContent: string;
}

export interface HighlightMark extends MarkBase {
	readonly kind: "highlight";
}

export interface CommentMark extends MarkBase {
	readonly kind: "comment";
}

export type Mark =
	| InsertionMark
	| DeletionMark
	| SubstitutionMark
	| HighlightMark
	| CommentMark;

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

/** `T` may not have the keys `ok`, `code` or `message`. */
export type Result<
	T extends {
		[K in keyof T]: K extends "ok" | "code" | "message" ? never : unknown;
	},
> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string };
