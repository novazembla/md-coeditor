import { writeAttrs } from "./attrs";
import type { Attr, MarkKind, ParsedNote } from "./types";

export const OPERATORS: Record<MarkKind, { open: string; close: string }> = {
	insertion: { open: "++", close: "++" },
	deletion: { open: "--", close: "--" },
	substitution: { open: "~~", close: "~~" },
	highlight: { open: "==", close: "==" },
	comment: { open: ">>", close: "<<" },
};

/** Join the input slices of all segments. Gives back the parsed text. */
export function serialize(parsed: ParsedNote): string {
	return parsed.segments.map((s) => parsed.text.slice(s.start, s.end)).join("");
}

/** Write one mark. For a substitution, `content` is the raw `old~>new`. */
export function writeMark(
	kind: MarkKind,
	content: string,
	attrs: readonly Attr[] = [],
): string {
	const { open, close } = OPERATORS[kind];
	return `{${writeAttrs(attrs)}${open}${content}${close}}`;
}
