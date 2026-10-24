import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assignIds, freeId, newId } from "../src/ids";
import { parse } from "../src/parse";

const counter = (prefix = "n") => {
	let i = 0;
	return () => `${prefix}${++i}`;
};

describe("newId", () => {
	it("gives 6 characters from a-z0-9", () => {
		for (let i = 0; i < 200; i++) expect(newId()).toMatch(/^[a-z0-9]{6}$/);
	});
});

describe("newId alphabet", () => {
	it("uses all 36 characters", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 2000; i++) for (const ch of newId()) seen.add(ch);
		expect([...seen].sort().join("")).toBe(
			"0123456789abcdefghijklmnopqrstuvwxyz",
		);
	});
});

describe("freeId", () => {
	it("retries until the id is free", () => {
		const gen = counter("x");
		expect(freeId(gen, new Set(["x1", "x2"]))).toBe("x3");
	});
	it("throws after too many tries", () => {
		expect(() => freeId(() => "same", new Set(["same"]))).toThrow(Error);
	});
});

describe("assignIds", () => {
	it("changes nothing when all ids are unique", () => {
		const t = '{id="a" ++x++} {id="b"--y--}';
		expect(assignIds(t)).toEqual({ text: t, changes: [], assigned: [] });
	});
	it("inserts an id into a mark without attributes", () => {
		const r = assignIds("a {++x++} b", { newId: () => "k1" });
		expect(r.text).toBe('a {id="k1"++x++} b');
		expect(r.assigned).toEqual([
			{ id: "k1", kind: "insertion", start: 2, end: 16 },
		]);
	});
	it("inserts an id before other attributes with a space", () => {
		const r = assignIds('{author="C"--x--}', { newId: () => "k1" });
		expect(r.text).toBe('{id="k1" author="C"--x--}');
	});
	it("replaces the value of a duplicate id only", () => {
		const t = '{id="a1" author="C"++x++}{id="a1"--y--}';
		const r = assignIds(t, { newId: () => "b2" });
		expect(r.text).toBe('{id="a1" author="C"++x++}{id="b2"--y--}');
		expect(r.assigned).toEqual([
			{ id: "b2", previousId: "a1", kind: "deletion", start: 25, end: 39 },
		]);
		const p = parse(r.text);
		expect(r.text.slice(25, 39)).toBe(
			r.text.slice(p.marks[1]?.start, p.marks[1]?.end),
		);
	});
	it("does not reuse an id from the note or from this call", () => {
		const gen = counter("a");
		const r = assignIds('{id="a1"++x++}{++y++}{++z++}', { newId: gen });
		expect(parse(r.text).marks.map((m) => m.id)).toEqual(["a1", "a2", "a3"]);
	});
	it("ignores marks in code", () => {
		const t = "`{++x++}`";
		expect(assignIds(t).text).toBe(t);
	});
	it("keeps CRLF and non-ASCII text", () => {
		const r = assignIds("😀\r\n{++x++}\r\n", { newId: () => "k1" });
		expect(r.text).toBe('😀\r\n{id="k1"++x++}\r\n');
	});
});

const fragments = [
	"{++x++}",
	"{--y--}",
	'{id="a"++x++}',
	'{id="b" author="C"--y--}',
	'{id="a" edited-by="V"==h==}',
	'{id="a1"~~c~>d~~}',
	"{>>c<<}",
	'{id="q',
	"{++",
	"`",
	"\n",
	"\n\n",
	"\r\n",
	"\r\n\r\n",
	" ",
	"word",
	"😀",
	"é",
	"```\n{++z++}\n```\n",
	"~~~\n{--z--}\n",
	"\n\n    {++z++}\n",
	"| {++t++} |\n|---|\n| {--u--} |\n",
	"---\na: {++x++}\n---\n",
	"`{++z++}`",
];

function stripPrefixes(text: string): string {
	let out = "";
	let at = 0;
	for (const m of parse(text).marks) {
		const openLen = 2;
		const prefixEnd = m.contentStart - openLen;
		out += text.slice(at, m.start + 1);
		at = prefixEnd;
	}
	return out + text.slice(at);
}

describe("assignIds property", () => {
	it("gives unique ids to all marks and changes only prefixes", () => {
		fc.assert(
			fc.property(
				fc
					.array(fc.constantFrom(...fragments), { maxLength: 14 })
					.map((a) => a.join("")),
				(t) => {
					const r = assignIds(t);
					const p = parse(r.text);
					const ids = p.marks.map((m) => m.id);
					expect(ids.every((i) => i !== undefined)).toBe(true);
					expect(new Set(ids).size).toBe(ids.length);
					expect(p.duplicateIds).toEqual([]);
					expect(parse(t).marks).toHaveLength(p.marks.length);
					expect(parse(t).zones.map((z) => z.kind)).toEqual(
						p.zones.map((z) => z.kind),
					);
					// `changes` applied to the input give the new text.
					let applied = "";
					let at = 0;
					for (const c of r.changes) {
						applied += t.slice(at, c.from) + c.insert;
						at = c.to;
					}
					expect(applied + t.slice(at)).toBe(r.text);
					expect(stripPrefixes(r.text)).toBe(stripPrefixes(t));
					for (const a of r.assigned) {
						const m = p.marks.find((x) => x.start === a.start);
						expect(m?.end).toBe(a.end);
						expect(m?.id).toBe(a.id);
					}
				},
			),
			{ numRuns: 2000 },
		);
	});
});
