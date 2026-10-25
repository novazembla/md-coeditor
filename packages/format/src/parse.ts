import { readAttrs } from "./attrs";
import { OPERATORS } from "./serialize";
import type { Attr, Mark, MarkKind, ParsedNote, Segment, Zone } from "./types";
import { findBlockZones, splitLines } from "./zones";

const CALLOUT = /^\[![A-Za-z0-9_-]+\][+-]?/;
const QUOTE_PREFIX = /^[ \t]*(?:>[ \t]*)+$/;

const KINDS = Object.keys(OPERATORS) as MarkKind[];

/** First index in sorted `arr` with a value >= x. */
function lowerBound(arr: readonly number[], x: number): number {
	let lo = 0;
	let hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((arr[mid] as number) < x) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function firstAttr(attrs: readonly Attr[], name: string): string | undefined {
	return attrs.find((a) => a[0] === name)?.[1];
}

function optionalAttr<K extends string>(
	key: K,
	value: string | undefined,
): { [P in K]?: string } {
	return (value === undefined ? {} : { [key]: value }) as { [P in K]?: string };
}

/**
 * Read a note into ordered text and mark segments, marks, and zones
 * where marks are not tracked. Never throws.
 */
export function parse(text: string): ParsedNote {
	const blockZones = findBlockZones(text);

	// Barriers: start of each blank line and of each block zone.
	const barrierSet = new Set<number>();
	for (const line of splitLines(text)) {
		if (/^[ \t]*$/.test(text.slice(line.start, line.end)))
			barrierSet.add(line.start);
	}
	for (const z of blockZones) barrierSet.add(z.start);
	const barriers = [...barrierSet].sort((a, b) => a - b);
	const limitAfter = (pos: number): number => {
		const idx = lowerBound(barriers, pos + 1);
		return idx < barriers.length ? (barriers[idx] as number) : text.length;
	};

	// Backtick runs, by length.
	const runs = new Map<number, number[]>();
	for (let i = 0; i < text.length; ) {
		if (text[i] === "`") {
			let j = i + 1;
			while (text[j] === "`") j++;
			const list = runs.get(j - i);
			if (list) list.push(i);
			else runs.set(j - i, [i]);
			i = j;
		} else i++;
	}

	// Cached "next occurrence" for close sequences. `from` can also move back
	// (a failed attribute prefix moves it forward first), so a cached result
	// is only valid for a `from` that is not before the one it was found with.
	const cache = new Map<string, { from: number; idx: number }>();
	const nextOccurrence = (seq: string, from: number): number => {
		const c = cache.get(seq);
		if (c && from >= c.from && (c.idx === -1 || c.idx >= from)) return c.idx;
		const idx = text.indexOf(seq, from);
		cache.set(seq, { from, idx });
		return idx;
	};

	const marks: Mark[] = [];
	const inlineZones: Zone[] = [];

	const tryMark = (pos: number): Mark | null => {
		let p = pos + 1;
		let attrs: Attr[] = [];
		if (/[A-Za-z]/.test(text[p] ?? "")) {
			const read = readAttrs(text, p);
			if (!read) return null;
			attrs = read.attrs.map((a) => [a.name, a.value] as const);
			p = read.end;
			while (text[p] === " " || text[p] === "\t") p++;
		}
		const kind = KINDS.find((k) => text.startsWith(OPERATORS[k].open, p));
		if (!kind) return null;
		const { open, close } = OPERATORS[kind];
		const contentStart = p + open.length;
		const closeSeq = `${close}}`;
		const closeAt = nextOccurrence(closeSeq, contentStart);
		if (closeAt === -1 || closeAt + closeSeq.length > limitAfter(pos))
			return null;
		const content = text.slice(contentStart, closeAt);
		const base = {
			start: pos,
			end: closeAt + closeSeq.length,
			attrs,
			content,
			contentStart,
			contentEnd: closeAt,
			...optionalAttr("id", firstAttr(attrs, "id")),
			...optionalAttr("author", firstAttr(attrs, "author")),
			...optionalAttr("date", firstAttr(attrs, "date")),
		};
		if (kind === "substitution") {
			const arrow = content.indexOf("~>");
			if (arrow === -1) return null;
			return {
				...base,
				kind,
				oldContent: content.slice(0, arrow),
				newContent: content.slice(arrow + 2),
			};
		}
		return { ...base, kind };
	};

	// Wikilink or embed at `pos`: `[[` or `![[` up to the next `]]` on the line.
	const wikilinkEnd = (at: number): number => {
		const open = text.startsWith("![[", at)
			? 3
			: text.startsWith("[[", at)
				? 2
				: 0;
		if (open === 0) return -1;
		const close = text.indexOf("]]", at + open);
		if (close === -1) return -1;
		const nl = text.indexOf("\n", at + open);
		return nl !== -1 && nl < close ? -1 : close + 2;
	};

	// Callout marker at `pos`: `[!type]` with `+` or `-`, after a quote prefix.
	const calloutEnd = (at: number): number => {
		const m = CALLOUT.exec(text.slice(at, at + 200));
		if (!m) return -1;
		const lineStart = text.lastIndexOf("\n", at - 1) + 1;
		return QUOTE_PREFIX.test(text.slice(lineStart, at)) ? at + m[0].length : -1;
	};

	let zi = 0;
	let pos = 0;
	while (pos < text.length) {
		while (zi < blockZones.length && (blockZones[zi] as Zone).end <= pos) zi++;
		const bz = blockZones[zi];
		if (bz && bz.start <= pos) {
			pos = bz.end;
			continue;
		}
		const ch = text[pos];
		if (ch === "[" || ch === "!") {
			const end = wikilinkEnd(pos);
			const callout = ch === "[" && end === -1 ? calloutEnd(pos) : -1;
			if (end !== -1) {
				inlineZones.push({ kind: "wikilink", start: pos, end });
				pos = end;
			} else if (callout !== -1) {
				inlineZones.push({ kind: "callout-marker", start: pos, end: callout });
				pos = callout;
			} else pos++;
		} else if (ch === "`") {
			// A backtick after an odd number of backslashes does not open a span.
			let back = 0;
			while (text[pos - 1 - back] === "\\") back++;
			if (back % 2 === 1) {
				pos++;
				continue;
			}
			let j = pos + 1;
			while (text[j] === "`") j++;
			const n = j - pos;
			const list = runs.get(n);
			let found = -1;
			if (list) {
				const k = lowerBound(list, j);
				const cand = list[k];
				if (cand !== undefined && cand + n <= limitAfter(pos)) found = cand;
			}
			if (found !== -1) {
				inlineZones.push({ kind: "inline-code", start: pos, end: found + n });
				pos = found + n;
			} else pos = j;
		} else if (ch === "{") {
			const mark = tryMark(pos);
			if (mark) {
				marks.push(mark);
				pos = mark.end;
			} else pos++;
		} else pos++;
	}

	const segments: Segment[] = [];
	let at = 0;
	for (const mark of marks) {
		if (mark.start > at)
			segments.push({ type: "text", start: at, end: mark.start });
		segments.push({ type: "mark", start: mark.start, end: mark.end, mark });
		at = mark.end;
	}
	if (at < text.length)
		segments.push({ type: "text", start: at, end: text.length });

	const zones = [...blockZones, ...inlineZones].sort(
		(a, b) => a.start - b.start,
	);

	const seen = new Set<string>();
	const dupes = new Set<string>();
	for (const m of marks) {
		if (m.id === undefined) continue;
		if (seen.has(m.id)) dupes.add(m.id);
		seen.add(m.id);
	}
	const duplicateIds = [...dupes];
	// Order of first occurrence.
	duplicateIds.sort((a, b) => firstIndex(marks, a) - firstIndex(marks, b));

	return { text, segments, marks, zones, duplicateIds };
}

function firstIndex(marks: readonly Mark[], id: string): number {
	return marks.findIndex((m) => m.id === id);
}
