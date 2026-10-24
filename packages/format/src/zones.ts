import type { Zone } from "./types";

export interface Line {
	start: number;
	/** End of the line content, before the line ending. */
	end: number;
	/** Start of the next line (or the text length for the last line). */
	next: number;
}

/**
 * Split text into lines. A line ends with `\n`; a `\r` directly before `\n`
 * belongs to the line ending. No empty line is added after a final line ending.
 */
export function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	let start = 0;
	while (start < text.length) {
		const nl = text.indexOf("\n", start);
		if (nl === -1) {
			lines.push({ start, end: text.length, next: text.length });
			break;
		}
		const end = nl > start && text[nl - 1] === "\r" ? nl - 1 : nl;
		lines.push({ start, end, next: nl + 1 });
		start = nl + 1;
	}
	return lines;
}

const BLANK = /^[ \t]*$/;
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const FRONTMATTER_EDGE = /^---[ \t]*$/;
const FRONTMATTER_END = /^(---|\.\.\.)[ \t]*$/;

function isIndented(line: string): boolean {
	return line.startsWith("    ") || line.startsWith("\t");
}

function isDelimiterRow(line: string): boolean {
	return line.includes("|") && DELIMITER_ROW.test(line);
}

/** Find frontmatter, fenced code, indented code and tables. Sorted by start. */
export function findBlockZones(text: string): Zone[] {
	const lines = splitLines(text);
	const content = (i: number): string => {
		const l = lines[i];
		return l ? text.slice(l.start, l.end) : "";
	};
	const zones: Zone[] = [];
	const push = (kind: Zone["kind"], first: number, last: number): void => {
		const a = lines[first];
		const b = lines[last];
		if (a && b) zones.push({ kind, start: a.start, end: b.end });
	};

	let i = 0;
	let prevBlank = true;
	let inList = false;

	// A leading byte order mark is not part of the frontmatter zone.
	const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
	if (lines.length > 0 && FRONTMATTER_EDGE.test(content(0).slice(bom))) {
		for (let j = 1; j < lines.length; j++) {
			if (FRONTMATTER_END.test(content(j))) {
				push("frontmatter", 0, j);
				const z = zones[zones.length - 1];
				if (z) z.start += bom;
				i = j + 1;
				prevBlank = false;
				break;
			}
		}
	}

	while (i < lines.length) {
		const line = content(i);

		// Fenced code.
		const fence = FENCE_OPEN.exec(line);
		if (
			fence?.[1] &&
			!(fence[1][0] === "`" && (fence[2] ?? "").includes("`"))
		) {
			const ch = fence[1][0] as string;
			const count = fence[1].length;
			const close = new RegExp(
				`^ {0,3}${ch === "`" ? "`" : "~"}{${count},}[ \\t]*$`,
			);
			let last = lines.length - 1;
			for (let j = i + 1; j < lines.length; j++) {
				if (close.test(content(j))) {
					last = j;
					break;
				}
			}
			push("fenced-code", i, last);
			if (!isIndented(line) && !line.startsWith(" ")) inList = false;
			prevBlank = false;
			i = last + 1;
			continue;
		}

		// Table: a line with a pipe, directly followed by a delimiter row.
		if (
			line.includes("|") &&
			i + 1 < lines.length &&
			isDelimiterRow(content(i + 1))
		) {
			let last = i + 1;
			while (last + 1 < lines.length && !BLANK.test(content(last + 1))) last++;
			push("table", i, last);
			if (!line.startsWith(" ") && !line.startsWith("\t")) inList = false;
			prevBlank = false;
			i = last + 1;
			continue;
		}

		// Indented code.
		if (prevBlank && !inList && isIndented(line) && !BLANK.test(line)) {
			let last = i;
			for (let j = i + 1; j < lines.length; j++) {
				const l = content(j);
				if (BLANK.test(l)) continue;
				if (!isIndented(l)) break;
				last = j;
			}
			push("indented-code", i, last);
			prevBlank = false;
			i = last + 1;
			continue;
		}

		if (BLANK.test(line)) {
			prevBlank = true;
		} else {
			prevBlank = false;
			if (LIST_ITEM.test(line)) inList = true;
			else if (!line.startsWith(" ") && !line.startsWith("\t")) inList = false;
		}
		i++;
	}
	return zones;
}
