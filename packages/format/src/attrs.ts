import type { Attr } from "./types";

export interface ReadAttr {
	name: string;
	value: string;
	/** Position of the first character of the name. */
	nameStart: number;
	/** Position of the first character of the value (after the opening quote). */
	valueStart: number;
	/** Position after the last character of the value (at the closing quote). */
	valueEnd: number;
}

export interface ReadAttrs {
	attrs: ReadAttr[];
	/** Where reading started. */
	start: number;
	/** Position after the closing quote of the last attribute. */
	end: number;
}

const NAME_START = /[A-Za-z]/;
const NAME_REST = /[A-Za-z0-9_-]/;

function readOne(text: string, pos: number): ReadAttr | null {
	if (!NAME_START.test(text[pos] ?? "")) return null;
	let p = pos + 1;
	while (p < text.length && NAME_REST.test(text[p] as string)) p++;
	if (text[p] !== "=" || text[p + 1] !== '"') return null;
	const valueStart = p + 2;
	let q = valueStart;
	while (q < text.length) {
		const ch = text[q] as string;
		if (ch === '"') {
			return {
				name: text.slice(pos, p),
				value: text.slice(valueStart, q),
				nameStart: pos,
				valueStart,
				valueEnd: q,
			};
		}
		if (ch === "\n" || ch === "\r") return null;
		q++;
	}
	return null;
}

/**
 * Read an attribute prefix at `start` (the position after `{`).
 * Attributes are separated by one or more spaces. Spaces after the last
 * attribute are not part of the result. Returns null if there is no valid
 * prefix.
 */
export function readAttrs(text: string, start: number): ReadAttrs | null {
	const attrs: ReadAttr[] = [];
	let pos = start;
	for (;;) {
		const attr = readOne(text, pos);
		if (!attr) return null;
		attrs.push(attr);
		const end = attr.valueEnd + 1;
		let p = end;
		while (text[p] === " ") p++;
		if (p > end && NAME_START.test(text[p] ?? "")) {
			pos = p;
			continue;
		}
		return { attrs, start, end };
	}
}

/** Write attributes: `id`, `author`, `date` first, then the rest in order. One space between. */
export function writeAttrs(attrs: readonly Attr[]): string {
	const used = new Set<number>();
	const ordered: Attr[] = [];
	for (const name of ["id", "author", "date"]) {
		const idx = attrs.findIndex((a) => a[0] === name);
		if (idx !== -1) {
			used.add(idx);
			ordered.push(attrs[idx] as Attr);
		}
	}
	attrs.forEach((a, i) => {
		if (!used.has(i)) ordered.push(a);
	});
	return ordered.map(([n, v]) => `${n}="${v}"`).join(" ");
}
