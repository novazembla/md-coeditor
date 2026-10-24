import { describe, expect, it } from "vitest";
import { findBlockZones, splitLines } from "../src/zones";

const kinds = (t: string) =>
	findBlockZones(t).map((z) => [z.kind, z.start, z.end]);

describe("splitLines", () => {
	it("splits LF", () => {
		expect(splitLines("a\nbb\n")).toEqual([
			{ start: 0, end: 1, next: 2 },
			{ start: 2, end: 4, next: 5 },
		]);
	});
	it("keeps CR in the line ending only before LF", () => {
		expect(splitLines("a\r\nb\rc")).toEqual([
			{ start: 0, end: 1, next: 3 },
			{ start: 3, end: 6, next: 6 },
		]);
	});
	it("handles empty text and empty lines", () => {
		expect(splitLines("")).toEqual([]);
		expect(splitLines("\n\n")).toHaveLength(2);
	});
});

describe("frontmatter", () => {
	it("finds frontmatter", () => {
		expect(kinds("---\ntitle: x\n---\nbody")).toEqual([["frontmatter", 0, 16]]);
	});
	it("accepts ... as end", () => {
		expect(kinds("---\na: 1\n...\nbody")).toEqual([["frontmatter", 0, 12]]);
	});
	it("needs an end line", () => {
		expect(kinds("---\ntitle: x\nbody")).toEqual([]);
	});
	it("must start on line 1", () => {
		expect(kinds("\n---\na: 1\n---\n")).toEqual([]);
	});
});

describe("fenced code", () => {
	it("finds a backtick fence", () => {
		expect(kinds("a\n```js\ncode\n```\nb")).toEqual([["fenced-code", 2, 16]]);
	});
	it("finds a tilde fence and needs the same character", () => {
		expect(kinds("~~~\nx\n```\n~~~\n")).toEqual([["fenced-code", 0, 13]]);
	});
	it("closing fence must be at least as long", () => {
		expect(kinds("````\nx\n```\ny\n````")).toEqual([["fenced-code", 0, 17]]);
	});
	it("continues to the end when unclosed", () => {
		const t = "```\nx\ny\n";
		expect(kinds(t)).toEqual([["fenced-code", 0, 7]]);
	});
	it("does not open on a backtick in the info string", () => {
		expect(kinds("``` a`b\nx")).toEqual([]);
	});
	it("does not open with 4 spaces of indent", () => {
		expect(kinds("text\n\n    ```\n")).toEqual([["indented-code", 6, 13]]);
	});
	it("does not open with fewer than 3 characters", () => {
		expect(kinds("``\nx\n``")).toEqual([]);
	});
	it("works with CRLF and excludes the final line ending", () => {
		const t = "```\r\nx\r\n```\r\nb";
		expect(kinds(t)).toEqual([["fenced-code", 0, 11]]);
	});
});

describe("indented code", () => {
	it("finds code after a blank line", () => {
		expect(kinds("text\n\n    code\n    more\n\nafter")).toEqual([
			["indented-code", 6, 23],
		]);
	});
	it("finds code at the start of the note", () => {
		expect(kinds("    code\n")).toEqual([["indented-code", 0, 8]]);
	});
	it("includes inner blank lines but not trailing ones", () => {
		expect(kinds("\tone\n\n\ttwo\n\nx")).toEqual([["indented-code", 0, 10]]);
	});
	it("needs a blank line before", () => {
		expect(kinds("text\n    not code")).toEqual([]);
	});
	it("is not code in a list item", () => {
		expect(kinds("- item\n\n    continuation\n")).toEqual([]);
	});
	it("is code again after a paragraph ends the list", () => {
		expect(kinds("- item\n\npara\n\n    code")).toHaveLength(1);
	});
	it("works with CRLF", () => {
		expect(kinds("a\r\n\r\n    c\r\n")).toEqual([["indented-code", 5, 10]]);
	});
});

describe("table", () => {
	it("finds a table", () => {
		const t = "| a | b |\n|---|---|\n| 1 | 2 |\n\nafter";
		expect(kinds(t)).toEqual([["table", 0, 29]]);
	});
	it("finds a table without outer pipes", () => {
		expect(kinds("a | b\n--|--\n1 | 2")).toEqual([["table", 0, 17]]);
	});
	it("needs a delimiter row", () => {
		expect(kinds("| a | b |\n| 1 | 2 |\n")).toEqual([]);
	});
	it("a plain --- line is not a delimiter row", () => {
		expect(kinds("a | b\n---\n")).toEqual([]);
	});
	it("needs a pipe in the first line", () => {
		expect(kinds("a\n|---|---|\n")).toEqual([]);
	});
	it("works with CRLF", () => {
		const t = "| a |\r\n|---|\r\n| 1 |\r\nx";
		expect(kinds(t)).toEqual([["table", 0, 22]]);
	});
});

describe("frontmatter edge cases", () => {
	it("starts the zone after a byte order mark", () => {
		expect(kinds("﻿---\ntitle: x\n---\nbody")).toEqual([["frontmatter", 1, 17]]);
	});
	it("changes nothing for a byte order mark without frontmatter", () => {
		expect(kinds("﻿hello\n\nworld")).toEqual([]);
	});
	it("finds CRLF frontmatter", () => {
		expect(kinds("---\r\ntitle: x\r\n---\r\nbody")).toEqual([
			["frontmatter", 0, 18],
		]);
	});
});

describe("zone edges", () => {
	it("a fence may have 3 spaces of indentation", () => {
		expect(kinds("   ```\nx\n   ```\n")).toEqual([["fenced-code", 0, 15]]);
	});
	it("---x is not frontmatter", () => {
		expect(kinds("---x\na: 1\n---\n")).toEqual([]);
	});
	it("a delimiter row with alignment colons", () => {
		expect(kinds("| a | b |\n|:-:|--:|\n| 1 | 2 |")).toEqual([
			["table", 0, 29],
		]);
	});
	it("a whitespace-only line before indented code is a blank line", () => {
		expect(kinds("text\n \t\n    code")).toEqual([["indented-code", 8, 16]]);
	});
	it("a whitespace-only line after a table ends it", () => {
		expect(kinds("| a |\n|---|\n \n    code")).toEqual([
			["table", 0, 11],
			["indented-code", 14, 22],
		]);
	});
	it("a list item, a continuation, a blank line and 4 spaces is not code", () => {
		expect(kinds("- item\n  more\n\n    code")).toEqual([]);
	});
	it("positions after non-ASCII text are in UTF-16 units", () => {
		// "é" is 1 unit, the emoji is 2, then two line endings: the fence starts at 5.
		expect(kinds("é😀\n\n```\nx\n```")).toEqual([["fenced-code", 5, 14]]);
	});
});
