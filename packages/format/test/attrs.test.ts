import { describe, expect, it } from "vitest";
import { readAttrs, writeAttrs } from "../src/attrs";

describe("readAttrs", () => {
	it("reads a valid prefix with exact ranges", () => {
		const t = '{id="a1" author="Claude"++x++}';
		const r = readAttrs(t, 1);
		expect(r?.end).toBe(24);
		expect(t.slice(r?.end)).toBe("++x++}");
		expect(r?.attrs.map((a) => [a.name, a.value])).toEqual([
			["id", "a1"],
			["author", "Claude"],
		]);
		const id = r?.attrs[0];
		expect(t.slice(id?.valueStart, id?.valueEnd)).toBe("a1");
		expect(t.slice(id?.nameStart, id?.valueStart)).toBe('id="');
	});
	it("keeps unknown attributes in order", () => {
		const r = readAttrs('{b="1" id="a" a-b_c="2"++', 1);
		expect(r?.attrs.map((a) => a.name)).toEqual(["b", "id", "a-b_c"]);
	});
	it("does not include trailing spaces", () => {
		const t = '{id="a"   ++x++}';
		expect(readAttrs(t, 1)?.end).toBe(7);
	});
	it("returns null for an unclosed quote", () => {
		expect(readAttrs('{id="a1 ++x++}', 1)).toBeNull();
	});
	it("returns null for a line break in a value", () => {
		expect(readAttrs('{id="a\nb"++', 1)).toBeNull();
		expect(readAttrs('{id="a\rb"++', 1)).toBeNull();
	});
	it("returns null for a missing equals sign or bad name", () => {
		expect(readAttrs("{id++", 1)).toBeNull();
		expect(readAttrs('{1a="x"++', 1)).toBeNull();
	});
	it("returns null when a second attribute is broken", () => {
		expect(readAttrs('{id="a" b=c++', 1)).toBeNull();
	});
	it("needs a space between attributes", () => {
		const r = readAttrs('{id="a"author="b"++', 1);
		expect(r?.attrs).toHaveLength(1);
		expect(r?.end).toBe(7);
	});
});

describe("readAttrs: separators and braces", () => {
	const rows: [string, string, string[][] | null][] = [
		[
			"tab",
			'{id="a"\tauthor="b"++',
			[
				["id", "a"],
				["author", "b"],
			],
		],
		[
			"tabs",
			'{id="a"\t\tauthor="b"++',
			[
				["id", "a"],
				["author", "b"],
			],
		],
		[
			"tab then space",
			'{id="a"\t author="b"++',
			[
				["id", "a"],
				["author", "b"],
			],
		],
		[
			"space then tab",
			'{id="a" \tauthor="b"++',
			[
				["id", "a"],
				["author", "b"],
			],
		],
		["{ in a value", '{id="a{1"++', null],
		["} in a value", '{id="a}1"++', null],
		["{ in a later value", '{id="a" author="b{"++', null],
	];
	for (const [name, text, expected] of rows) {
		it(name, () => {
			const r = readAttrs(text, 1);
			expect(r ? r.attrs.map((a) => [a.name, a.value]) : null).toEqual(
				expected,
			);
		});
	}
	it("does not include trailing tabs", () => {
		const t = '{id="a"\t\t++x++}';
		expect(readAttrs(t, 1)?.end).toBe(7);
	});
});

describe("writeAttrs", () => {
	it("orders id, author, date, then the rest", () => {
		expect(
			writeAttrs([
				["x", "1"],
				["date", "2026-10-24"],
				["author", "C"],
				["y", "2"],
				["id", "a"],
			]),
		).toBe('id="a" author="C" date="2026-10-24" x="1" y="2"');
	});
	it("gives an empty string for no attributes", () => {
		expect(writeAttrs([])).toBe("");
	});
	it("keeps later duplicates among the others", () => {
		expect(
			writeAttrs([
				["id", "a"],
				["id", "b"],
			]),
		).toBe('id="a" id="b"');
	});
});
