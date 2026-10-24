import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide } from "../src/decide";
import { parse } from "../src/parse";
import { project } from "../src/project";
import { suggest } from "../src/suggest";
import type { Change, Mark } from "../src/types";

const RUNS = 3000;
const AUTHOR = "Cl";
const DATE = "2026-10-24";

const words = ["cat", "sat", "a", "the", "big", "x", "naïve", "😀", "-", "#"];
const prefixes = ["", "", "", "  ", "- ", "> ", "# ", "1. ", "- [ ] ", "+ "];
const marks = [
	"{++big ++}",
	"{--old --}",
	'{id="p#" author="V" date="2026-01-01"++new ++}',
	'{id="p#"--cat--}',
	"{~~sat~>sit~~}",
	"{==cat==}{>>why?<<}",
	"{>>note<<}",
];
const codes = ["`cat`", "`x y`", "``a`b``"];

const wordArb = fc.constantFrom(...words);
const piece = fc.oneof(
	{ weight: 6, arbitrary: wordArb },
	{ weight: 2, arbitrary: fc.constantFrom(...marks) },
	{ weight: 1, arbitrary: fc.constantFrom(...codes) },
);
const lineArb = fc
	.tuple(
		fc.constantFrom(...prefixes),
		fc.array(piece, { minLength: 1, maxLength: 6 }),
	)
	.map(([p, ps]) => p + ps.join(" "));

const blockArb = fc.oneof(
	{ weight: 8, arbitrary: lineArb },
	{ weight: 1, arbitrary: fc.constant("```\ncat sat\n```") },
	{ weight: 1, arbitrary: fc.constant("~~~js\nthe cat\n~~~") },
	{ weight: 1, arbitrary: fc.constant("| cat | big |\n|:-:|--:|\n| a | x |") },
	{ weight: 1, arbitrary: fc.constant("    cat code\n    more") },
);

const noteArb = fc
	.tuple(
		fc.boolean(),
		fc.constantFrom("\n", "\r\n"),
		fc.array(fc.tuple(blockArb, fc.constantFrom(1, 1, 2)), {
			minLength: 1,
			maxLength: 7,
		}),
	)
	.map(([front, eol, blocks]) => {
		let out = front ? "---\ntitle: cat\n---\n" : "";
		for (const [b, gap] of blocks) out += b + eol.repeat(gap);
		out = out.replace(/\r?\n/g, eol);
		let n = 0;
		return out.replace(/p#/g, () => `p${++n}`);
	});

type Mode = "replace" | "insert" | "delete";
const requestArb = fc
	.tuple(
		noteArb,
		fc.nat(),
		fc.nat(),
		fc.constantFrom<Mode>("replace", "insert", "insert", "delete"),
		fc.nat(),
		fc.constantFrom("dog", "ab", "😀", "cat sat", "very ", " big", "x y"),
		fc.constantFrom(
			"none",
			"none",
			"right",
			"right",
			"right",
			"right",
			"right",
			"right",
			"right",
			"right",
			"wrong",
		),
		fc.nat({ max: 6 }),
	)
	.map(([note, i, n, mode, k, text, ctx, ctxLen]) => {
		const pv = project(note);
		const view = pv.text;
		const zones = parse(note).zones;
		const low = (p: number) => {
			const c = view.charCodeAt(p);
			return c >= 0xdc00 && c <= 0xdfff;
		};
		const len = 3 + (n % 14);
		// Most of the time look for a place outside the zones; sometimes not.
		let s = i % Math.max(view.length, 1);
		if (k % 12 !== 0) {
			for (let t = 0; t < 12; t++) {
				const c = (i + t * 7) % Math.max(view.length, 1);
				const from = pv.toNote(c);
				const to = pv.toNote(Math.min(view.length, c + len), "end");
				const hitsMark = pv.marks.some((m) =>
					m.start === m.end
						? c < m.start && m.start < c + len
						: c < m.end && m.start < c + len,
				);
				if (!hitsMark && !zones.some((z) => z.start < to && from < z.end)) {
					s = c;
					break;
				}
			}
		}
		let e = Math.min(view.length, s + len);
		if (low(s)) s--;
		if (low(e)) e++;
		let find = view.slice(s, e).split(/[\r\n]/)[0] as string;
		if (find === "") {
			find = "cat";
			s = -1;
		}
		e = s + find.length;
		let replace: string;
		if (mode === "insert") {
			const at = k % (find.length + 1);
			replace = find.slice(0, at) + text + find.slice(at);
		} else if (mode === "delete") {
			const a = k % find.length;
			const b = Math.min(find.length, a + 1 + (n % 5));
			replace = find.slice(0, a) + find.slice(b);
		} else replace = text;
		const extra: { before?: string; after?: string } = {};
		if (ctx === "right" && s >= 0) {
			extra.before = view.slice(Math.max(0, s - ctxLen), s);
			extra.after = view.slice(e, e + ctxLen);
		} else if (ctx === "wrong") {
			extra.before = "zzz";
		}
		return { note, find, replace, ...extra };
	});

function apply(text: string, changes: Change[]): string {
	let out = "";
	let at = 0;
	for (const c of changes) {
		out += text.slice(at, c.from) + c.insert;
		at = c.to;
	}
	return out + text.slice(at);
}

const sig = (m: Mark) => [m.kind, m.id ?? null, m.content];

describe("suggest then decide (property)", () => {
	it("keeps its promises on notes with marks, zones, CRLF and emoji", () => {
		let total = 0;
		let succeeded = 0;
		let insertionOnly = 0;
		let deletionOnly = 0;
		let both = 0;
		fc.assert(
			fc.property(requestArb, ({ note, find, replace, before, after }) => {
				total++;
				let i = 0;
				const input: Parameters<typeof suggest>[1] = {
					find,
					replace,
					author: AUTHOR,
					date: DATE,
					newId: () => `n${++i}`,
				};
				if (before !== undefined) input.before = before;
				if (after !== undefined) input.after = after;
				const r = suggest(note, input);
				if (!r.ok) {
					expect(r.message.trim()).not.toBe("");
					return;
				}
				succeeded++;

				// `changes` give `text`, and they lie in the input.
				expect(apply(note, r.changes)).toBe(r.text);
				let prevEnd = 0;
				for (const c of r.changes) {
					expect(c.from).toBeGreaterThanOrEqual(prevEnd);
					expect(c.to).toBeGreaterThanOrEqual(c.from);
					prevEnd = c.to;
				}
				expect(prevEnd).toBeLessThanOrEqual(note.length);

				// Reported marks: kind, id, author, date and position.
				const kinds = r.marks.map((m) => m.kind);
				if (kinds.length === 1) {
					if (kinds[0] === "insertion") insertionOnly++;
					else deletionOnly++;
				} else {
					expect(kinds).toEqual(["deletion", "insertion"]);
					both++;
				}
				const reparsed = parse(r.text);
				const oldIds = new Set(parse(note).marks.map((m) => m.id));
				expect(r.marks.map((m) => m.id)).toEqual(
					r.marks.map((_, k) => `n${k + 1}`),
				);
				for (const m of r.marks) {
					expect(oldIds.has(m.id)).toBe(false);
					expect(m.author).toBe(AUTHOR);
					expect(m.date).toBe(DATE);
					const found = reparsed.marks.find((x) => x.start === m.start);
					expect(found).toBeDefined();
					expect(found?.end).toBe(m.end);
					expect(found?.id).toBe(m.id);
					expect(found?.kind).toBe(m.kind);
					expect(found?.content).toBe(m.content);
					expect(found?.author).toBe(AUTHOR);
					expect(found?.date).toBe(DATE);
				}
				const first = r.marks[0] as Mark;
				const last = r.marks[r.marks.length - 1] as Mark;
				expect(first.start).toBe(r.changes[0]?.from);
				expect(r.text.slice(first.start, last.end)).toBe(r.changes[0]?.insert);

				// Reject all gives the original. Accept all gives the replaced view.
				const viewBefore = project(note).text;
				let rejected = r.text;
				let accepted = r.text;
				for (const m of r.marks) {
					const a = decide(accepted, m.id as string, "accept");
					const b = decide(rejected, m.id as string, "reject");
					expect(a.ok && b.ok).toBe(true);
					if (a.ok) accepted = a.text;
					if (b.ok) rejected = b.text;
				}
				expect(rejected).toBe(note);
				const candidates: string[] = [];
				for (
					let k = viewBefore.indexOf(find);
					k !== -1;
					k = viewBefore.indexOf(find, k + 1)
				)
					candidates.push(
						viewBefore.slice(0, k) +
							replace +
							viewBefore.slice(k + find.length),
					);
				expect(candidates).toContain(project(accepted).text);
				expect(project(r.text).text).toBe(project(accepted).text);

				// Every decision outcome leaves the other marks and the zones.
				const ids = r.marks.map((m) => m.id as string);
				const before0 = parse(note);
				const zoneKinds = before0.zones.map((z) => z.kind);
				const otherMarks = before0.marks.map(sig);
				// Each new mark is accepted, rejected or left pending (3^k outcomes).
				const total3 = 3 ** ids.length;
				for (let combo = 0; combo < total3; combo++) {
					let t = r.text;
					let c = combo;
					const pending: string[] = [];
					for (const id of ids) {
						const state = c % 3;
						c = Math.floor(c / 3);
						if (state === 2) {
							pending.push(id);
							continue;
						}
						const d = decide(t, id, state === 0 ? "accept" : "reject");
						expect(d.ok).toBe(true);
						if (d.ok) t = d.text;
					}
					const p = parse(t);
					expect(
						p.marks.filter((m) => !pending.includes(m.id as string)).map(sig),
					).toEqual(otherMarks);
					expect(p.zones.map((z) => z.kind)).toEqual(zoneKinds);
				}
				const pm = parse(r.text);
				expect(
					pm.marks.filter((m) => !ids.includes(m.id as string)).map(sig),
				).toEqual(otherMarks);
				expect(pm.zones.map((z) => z.kind)).toEqual(zoneKinds);
			}),
			{ numRuns: RUNS },
		);
		expect(succeeded / total).toBeGreaterThanOrEqual(0.3);
		expect(insertionOnly).toBeGreaterThan(30);
		expect(deletionOnly).toBeGreaterThan(30);
		expect(both).toBeGreaterThan(50);
	});
});
