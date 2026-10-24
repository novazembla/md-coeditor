import type { Change } from "./types";

/**
 * Apply a list of changes to the text they were made for. The changes must be
 * in order and must not overlap. Internal helper (used by tests and by checks).
 */
export function applyChanges(text: string, changes: readonly Change[]): string {
	let out = "";
	let at = 0;
	for (const c of changes) {
		if (c.from < at || c.to < c.from || c.to > text.length)
			throw new RangeError(
				"changes are out of order, overlap, or out of range",
			);
		out += text.slice(at, c.from) + c.insert;
		at = c.to;
	}
	return out + text.slice(at);
}
