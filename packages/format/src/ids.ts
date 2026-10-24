import { readAttrs } from "./attrs";
import { parse } from "./parse";
import type { Change, MarkKind } from "./types";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new random id: 6 characters from `[a-z0-9]`. Not secret, not crypto. */
export function newId(): string {
	let id = "";
	for (let i = 0; i < 6; i++) {
		id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return id;
}

const MAX_TRIES = 1000;

/**
 * Get an id from `generate` that is not in `used`. Does not add it to `used`.
 * Throws if no free id comes after 1000 tries: this is a programming error
 * (for example a generator that always gives the same id).
 */
export function freeId(
	generate: () => string,
	used: ReadonlySet<string>,
): string {
	for (let i = 0; i < MAX_TRIES; i++) {
		const id = generate();
		if (!used.has(id)) return id;
	}
	throw new Error(`newId gave no free id in ${MAX_TRIES} tries`);
}

export interface AssignedId {
	id: string;
	/** The id the mark had before (a duplicate), if any. */
	previousId?: string;
	kind: MarkKind;
	/** Range of the mark in the NEW text. */
	start: number;
	end: number;
}

export interface AssignIdsResult {
	text: string;
	/** Edits to the input text. Applying them gives `text`. */
	changes: Change[];
	assigned: AssignedId[];
}

/**
 * Give a new id to each mark without an id, and to each duplicate occurrence
 * after the first. Changes only the attribute prefix of those marks.
 */
export function assignIds(
	text: string,
	options: { newId?: () => string } = {},
): AssignIdsResult {
	const generate = options.newId ?? newId;
	const parsed = parse(text);
	const used = new Set<string>();
	for (const m of parsed.marks) if (m.id !== undefined) used.add(m.id);

	const seen = new Set<string>();
	const assigned: AssignedId[] = [];
	const changes: Change[] = [];
	let out = "";
	let at = 0;
	let delta = 0;
	for (const mark of parsed.marks) {
		const needs = mark.id === undefined || seen.has(mark.id);
		if (!needs) {
			seen.add(mark.id as string);
			continue;
		}
		const id = freeId(generate, used);
		used.add(id);
		seen.add(id);
		let editStart: number;
		let editEnd: number;
		let insert: string;
		if (mark.id !== undefined) {
			const read = readAttrs(text, mark.start + 1);
			const attr = read?.attrs.find((a) => a.name === "id");
			if (!attr) throw new Error("id attribute not found in mark prefix");
			editStart = attr.valueStart;
			editEnd = attr.valueEnd;
			insert = id;
		} else {
			editStart = editEnd = mark.start + 1;
			insert = `id="${id}"${mark.attrs.length > 0 ? " " : ""}`;
		}
		changes.push({ from: editStart, to: editEnd, insert });
		out += text.slice(at, editStart) + insert;
		at = editEnd;
		const grow = insert.length - (editEnd - editStart);
		const entry: AssignedId = {
			id,
			kind: mark.kind,
			start: mark.start + delta,
			end: mark.end + delta + grow,
		};
		if (mark.id !== undefined) entry.previousId = mark.id;
		assigned.push(entry);
		delta += grow;
	}
	out += text.slice(at);
	return { text: out, changes, assigned };
}
