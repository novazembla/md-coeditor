import { freeId, newId as randomId } from "./ids";
import { parse } from "./parse";
import { project } from "./project";
import { writeMark } from "./serialize";
import type { Change, ErrorCode, Mark, ParsedNote, Result } from "./types";
import { splitLines } from "./zones";

export interface SuggestInput {
	find: string;
	replace: string;
	/** Text that must stand directly before the match. */
	before?: string;
	/** Text that must stand directly after the match. */
	after?: string;
	author: string;
	/** `YYYY-MM-DD`. */
	date: string;
	/** Id generator. Default: `newId`. */
	newId?: () => string;
}

export type SuggestResult = Result<{
	text: string;
	/** Edits to the input text. Applying them gives `text`. */
	changes: Change[];
	marks: Mark[];
}>;

const MARKUP = [
	"{++",
	"++}",
	"{--",
	"--}",
	"{~~",
	"~~}",
	"~>",
	"{==",
	"==}",
	"{>>",
	"<<}",
];

const BLOCK_PREFIX =
	/^[ \t]*(?:>[ \t]*)*(?:#{1,6}(?:[ \t]+|$)|(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)(?:\[[ xX]\](?:[ \t]+|$))?)?/;

const isSpace = (ch: string | undefined): boolean =>
	ch === undefined || /\s/.test(ch);

function fail(code: ErrorCode, message: string): SuggestResult {
	return { ok: false, code, message };
}

function blockPrefix(line: string): string {
	return BLOCK_PREFIX.exec(line)?.[0] ?? "";
}

/**
 * Turn "replace `find` with `replace`" into a deletion mark and an insertion
 * mark. Only the changed part is marked, extended to whole words.
 * The note is not changed when the result is an error.
 */
export function suggest(text: string, input: SuggestInput): SuggestResult {
	const { find, replace, before, after, author, date } = input;

	if (find === "") return fail("empty_find", "The find text is empty.");
	if (find === replace)
		return fail("no_change", "The replace text is the same as the find text.");
	if (/[\r\n]/.test(find) || /[\r\n]/.test(replace))
		return fail(
			"line_break",
			"The find text and the replace text must not contain a line break. Make one suggestion for each line.",
		);
	if (MARKUP.some((m) => find.includes(m) || replace.includes(m)))
		return fail(
			"markup_in_text",
			"The find text and the replace text must not contain CriticMarkup sequences.",
		);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
		return fail("invalid_attribute", "The date must have the form YYYY-MM-DD.");
	if (author === "" || /["\r\n]/.test(author))
		return fail(
			"invalid_attribute",
			"The author must not be empty and must not contain a quote or a line break.",
		);

	const parsed = parse(text);
	const view = project(text);
	const vt = view.text;

	// Places in the agent view (overlapping ones too).
	const places: {
		from: number;
		to: number;
		viewStart: number;
		viewEnd: number;
	}[] = [];
	let hitZone = false;
	for (
		let idx = vt.indexOf(find);
		idx !== -1;
		idx = vt.indexOf(find, idx + 1)
	) {
		const end = idx + find.length;
		if (before !== undefined) {
			if (idx < before.length || vt.slice(idx - before.length, idx) !== before)
				continue;
		}
		if (after !== undefined && vt.slice(end, end + after.length) !== after)
			continue;
		if (splitsPair(vt, idx) || splitsPair(vt, end)) continue;
		const from = view.toNote(idx, "start");
		const to = view.toNote(end, "end");
		if (parsed.zones.some((z) => z.start < to && from < z.end)) {
			hitZone = true;
			continue;
		}
		places.push({ from, to, viewStart: idx, viewEnd: end });
	}
	const place = places[0];
	if (!place) {
		if (hitZone)
			return fail(
				"protected_zone",
				"The text is in code, a table or frontmatter. These are not tracked.",
			);
		return fail("not_found", "The find text does not occur in the note.");
	}
	if (places.length > 1)
		return fail(
			"ambiguous",
			"The find text occurs more than once. Add text before or after it.",
		);
	if (
		view.marks.some((m) =>
			m.start === m.end
				? place.viewStart < m.start && m.start < place.viewEnd
				: place.viewStart < m.end && m.start < place.viewEnd,
		)
	)
		return fail("overlaps_mark", "The text overlaps a pending mark.");
	const placeStart = place.from;

	// Trim and extend to whole words.
	let p = 0;
	const maxP = Math.min(find.length, replace.length);
	while (p < maxP && find[p] === replace[p]) p++;
	let s = 0;
	while (
		s < maxP - p &&
		find[find.length - 1 - s] === replace[replace.length - 1 - s]
	)
		s++;
	while (p > 0 && (splitsPair(find, p) || splitsPair(replace, p))) p--;
	while (
		s > 0 &&
		(splitsPair(find, find.length - s) ||
			splitsPair(replace, replace.length - s))
	)
		s--;
	let a = p;
	let bF = find.length - s;
	let bR = replace.length - s;

	const changedF = find.slice(a, bF);
	const changedR = replace.slice(a, bR);
	const firstChanged = (changedF[0] ?? "") + (changedR[0] ?? "");
	const lastChanged =
		(changedF[changedF.length - 1] ?? "") +
		(changedR[changedR.length - 1] ?? "");
	const extendStart = a > 0 && !isSpace(find[a - 1]) && /\S/.test(firstChanged);
	const extendEnd =
		bF < find.length && !isSpace(find[bF]) && /\S/.test(lastChanged);
	if (extendStart) {
		while (a > 0 && !isSpace(find[a - 1])) a--;
	}
	if (extendEnd) {
		let k = 0;
		while (bF + k < find.length && !isSpace(find[bF + k])) k++;
		bF += k;
		bR += k;
	}
	const deleted = find.slice(a, bF);
	const inserted = replace.slice(a, bR);

	// Block prefix: the changed part must not touch the prefix of its line.
	const changeStart = placeStart + a;
	const changeEnd = placeStart + bF;
	const line = splitLines(text).find(
		(l) => l.start <= placeStart && placeStart < l.next,
	);
	const linePrefix = line ? blockPrefix(text.slice(line.start, line.end)) : "";
	if (line && changeStart - line.start < linePrefix.length)
		return fail(
			"structural_edit",
			"The change touches the start of a line (heading, list, task or quote marker, or indentation).",
		);

	// Write.
	const used = new Set<string>();
	for (const m of parsed.marks) if (m.id !== undefined) used.add(m.id);
	const generate = input.newId ?? randomId;
	const written: {
		kind: "deletion" | "insertion";
		id: string;
		content: string;
		str: string;
	}[] = [];
	for (const [kind, content] of [
		["deletion", deleted],
		["insertion", inserted],
	] as const) {
		if (content === "") continue;
		const id = freeId(generate, used);
		used.add(id);
		written.push({
			kind,
			id,
			content,
			str: writeMark(kind, content, [
				["id", id],
				["author", author],
				["date", date],
			]),
		});
	}
	const insertedText = written.map((w) => w.str).join("");
	const newText =
		text.slice(0, changeStart) + insertedText + text.slice(changeEnd);

	// Outcome check: the marked text and every decision outcome.
	const head = text.slice(0, changeStart);
	const tail = text.slice(changeEnd);
	const outcomes = [head + inserted + tail, head + deleted + tail];
	if (deleted !== "" && inserted !== "")
		outcomes.push(head + tail, head + deleted + inserted + tail);
	else if (deleted !== "") outcomes.push(head + tail);
	const region = changeEnd - changeStart;

	const reparsed = parse(newText);
	let at = changeStart;
	const writtenMarks = written.map((w) => {
		const start = at;
		at += w.str.length;
		return { kind: w.kind, id: w.id, content: w.content, start, end: at };
	});
	if (!sameStructure(parsed, reparsed, changeStart, changeEnd, writtenMarks))
		return unsafe();

	const originalKey = line ? structureKey(text, parsed, line.start) : "";
	let structural = false;
	let unsafeOutcome = false;
	for (const out of outcomes) {
		const outParsed = parse(out);
		if (line && structureKey(out, outParsed, line.start) !== originalKey)
			structural = true;
		const len = out.length - (text.length - region);
		if (!sameStructure(parsed, outParsed, changeStart, changeEnd, [], len))
			unsafeOutcome = true;
	}
	if (structural)
		return fail(
			"structural_edit",
			"Accepting or rejecting the change would change the start of a line (heading, list, task or quote marker, or indentation).",
		);
	if (unsafeOutcome) return unsafe();

	const marks = reparsed.marks.filter(
		(m) => m.start >= changeStart && m.end <= changeStart + insertedText.length,
	);
	return {
		ok: true,
		text: newText,
		changes: [{ from: changeStart, to: changeEnd, insert: insertedText }],
		marks,
	};
}

/**
 * Key to compare block prefixes of one line before and after a decision.
 * Spaces and tabs only count when they make an indented code block (4 columns
 * or more at the start). Otherwise a mixed decision such as "accept the
 * deletion of The" would give the line " cat" and always be refused.
 */
function samePrefixKey(prefix: string): string {
	const indent = /^[ \t]*/.exec(prefix)?.[0] ?? "";
	const columns = [...indent].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);
	const rest = prefix.slice(indent.length).replace(/[ \t]+/g, " ");
	return (columns >= 4 ? "<code>" : "") + rest;
}

const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const THEMATIC = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BLANK_LINE = /^[ \t]*$/;

interface TextLine {
	start: number;
	end: number;
	next: number;
}

function lineAt(t: string, start: number): TextLine | undefined {
	if (start >= t.length) return undefined;
	const nl = t.indexOf("\n", start);
	let end = nl === -1 ? t.length : nl;
	if (nl !== -1 && end > start && t[end - 1] === "\r") end--;
	return { start, end, next: nl === -1 ? t.length : nl + 1 };
}

function lineBefore(t: string, start: number): TextLine | undefined {
	if (start === 0) return undefined;
	const prevNl = t.lastIndexOf("\n", start - 2);
	return lineAt(t, prevNl + 1);
}

/**
 * Block structure of the line that starts at `lineStart` and of the line after
 * it: block prefix (see `samePrefixKey`) and whether each line is a setext
 * underline or a thematic break. Used to compare the original with outcomes.
 */
function structureKey(
	t: string,
	parsed: ParsedNote,
	lineStart: number,
): string {
	const inZone = (l: TextLine): boolean =>
		parsed.zones.some(
			(z) => z.kind !== "inline-code" && z.start < l.end && l.start < z.end,
		);
	const kind = (l: TextLine, prev: TextLine | undefined): string => {
		const c = t.slice(l.start, l.end);
		if (inZone(l)) return "";
		if (
			SETEXT.test(c) &&
			prev &&
			!BLANK_LINE.test(t.slice(prev.start, prev.end)) &&
			!inZone(prev)
		)
			return "setext";
		return THEMATIC.test(c) ? "thematic" : "";
	};
	const first = lineAt(t, lineStart);
	if (!first) return "||";
	const second = lineAt(t, first.next);
	return [
		samePrefixKey(blockPrefix(t.slice(first.start, first.end))),
		kind(first, lineBefore(t, lineStart)),
		second ? kind(second, first) : "",
	].join("|");
}

function unsafe(): SuggestResult {
	return fail(
		"unsafe_result",
		"The new marks, or a decision on them, would combine with markup or code that is already in the note.",
	);
}

interface Expected {
	kind: string;
	id?: string;
	content: string;
	start: number;
	end: number;
}

/**
 * Compare a new text with the original parse. The change replaced the range
 * `[changeStart, changeEnd)`; the new region is `regionLength` long (default:
 * the length of the written marks). Marks and zones outside the region must be
 * as before, shifted. `written` are the marks expected inside the region.
 * Zones that lie fully inside the region are the change itself and are skipped.
 */
function sameStructure(
	original: ParsedNote,
	next: ParsedNote,
	changeStart: number,
	changeEnd: number,
	written: Expected[],
	regionLength?: number,
): boolean {
	const length =
		regionLength ?? written.reduce((n, w) => n + (w.end - w.start), 0);
	const regionEnd = changeStart + length;
	const delta = length - (changeEnd - changeStart);

	const expectedMarks: Expected[] = [];
	for (const m of original.marks) {
		if (m.end <= changeStart) expectedMarks.push(describe(m, 0));
	}
	expectedMarks.push(...written);
	for (const m of original.marks) {
		if (m.start >= changeEnd) expectedMarks.push(describe(m, delta));
	}
	const gotMarks = next.marks.map((m) => describe(m, 0));

	const expectedZones: string[] = [];
	for (const z of original.zones) {
		if (z.end <= changeStart)
			expectedZones.push(`${z.kind}:${z.start}:${z.end}`);
		else if (z.start >= changeEnd)
			expectedZones.push(`${z.kind}:${z.start + delta}:${z.end + delta}`);
	}
	const gotZones = next.zones
		.filter((z) => !(z.start >= changeStart && z.end <= regionEnd))
		.map((z) => `${z.kind}:${z.start}:${z.end}`);

	return (
		JSON.stringify(gotMarks.map(key)) ===
			JSON.stringify(expectedMarks.map(key)) &&
		JSON.stringify(gotZones) === JSON.stringify(expectedZones)
	);
}

const key = (e: Expected): unknown[] => [
	e.kind,
	e.id ?? null,
	e.content,
	e.start,
	e.end,
];

function describe(m: Mark, delta: number): Expected {
	const e: Expected = {
		kind: m.kind,
		content: m.content,
		start: m.start + delta,
		end: m.end + delta,
	};
	if (m.id !== undefined) e.id = m.id;
	return e;
}

/** True when `pos` lies between the two halves of a surrogate pair. */
function splitsPair(str: string, pos: number): boolean {
	const lo = str.charCodeAt(pos);
	const hi = str.charCodeAt(pos - 1);
	return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff;
}
