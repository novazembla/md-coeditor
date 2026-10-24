import { describe, expect, it } from "vitest";
import { parse } from "../src/parse";
import { serialize, writeMark } from "../src/serialize";

describe("parse", () => {
	it("reads the five kinds", () => {
		const p = parse("{++a++}{--b--}{~~c~>d~~}{==e==}{>>f<<}");
		expect(p.marks.map((m) => [m.kind, m.content])).toEqual([
			["insertion", "a"],
			["deletion", "b"],
			["substitution", "c~>d"],
			["highlight", "e"],
			["comment", "f"],
		]);
		expect(p.marks[2]).toMatchObject({ oldContent: "c", newContent: "d" });
	});
	it("first close wins", () => {
		const p = parse("{++x+++}");
		expect(p.marks[0]?.content).toBe("x+");
		expect(p.marks[0]?.end).toBe(8);
	});
	it("allows empty content", () => {
		expect(parse("{++++}").marks[0]?.content).toBe("");
	});
	it("a substitution without ~> is text", () => {
		expect(parse("{~~abc~~}").marks).toEqual([]);
	});
	it("splits a substitution at the first ~>", () => {
		const m = parse("{~~a~>b~>c~~}").marks[0];
		expect(m).toMatchObject({ oldContent: "a", newContent: "b~>c" });
	});
	it("records content range", () => {
		const t = '{id="a"++xy++}';
		const m = parse(t).marks[0];
		expect(t.slice(m?.contentStart, m?.contentEnd)).toBe("xy");
	});
	it("allows spaces between attributes and operator", () => {
		expect(parse('{id="a"  ++x++}').marks[0]?.id).toBe("a");
	});
	it("uses the first attribute with a known name", () => {
		const m = parse('{id="a" id="b"++x++}').marks[0];
		expect(m?.id).toBe("a");
		expect(m?.attrs).toEqual([
			["id", "a"],
			["id", "b"],
		]);
	});
	it("a mark does not cross a blank line, also with spaces", () => {
		expect(parse("{++a\n \t\nb++}").marks).toEqual([]);
	});
	it("a mark does not cross the start of a block zone", () => {
		expect(parse("{++a\n```\nx\n```\nb++}").marks).toEqual([]);
		expect(parse("{++a\n| a |\n|---|\nb++}").marks).toEqual([]);
	});
	it("a mark may span CRLF", () => {
		expect(parse("{++a\r\nb++}").marks[0]?.content).toBe("a\r\nb");
	});
	it("inline code wins when it starts first", () => {
		const p = parse("`{++x++}`");
		expect(p.marks).toEqual([]);
		expect(p.zones).toEqual([{ kind: "inline-code", start: 0, end: 9 }]);
	});
	it("a mark wins when it starts first", () => {
		const p = parse("{++run `make`++}");
		expect(p.marks).toHaveLength(1);
		expect(p.zones).toEqual([]);
	});
	it("matches backtick runs of the same length", () => {
		const p = parse("``a`b`` and `c`");
		expect(p.zones.map((z) => [z.start, z.end])).toEqual([
			[0, 7],
			[12, 15],
		]);
	});
	it("unmatched backticks are text", () => {
		expect(parse("a ` b {++x++}").zones).toEqual([]);
		expect(parse("a ` b {++x++}").marks).toHaveLength(1);
	});
	it("inline code does not span a blank line", () => {
		expect(parse("`a\n\nb`").zones).toEqual([]);
	});
	it("skips block zones", () => {
		const p = parse("```\n{++x++}\n```\n{++y++}");
		expect(p.marks.map((m) => m.content)).toEqual(["y"]);
	});
	it("reports duplicate ids in order of first occurrence", () => {
		const p = parse(
			'{id="b"++1++}{id="a"++2++}{id="a"++3++}{id="b"++4++}{id="a"++5++}',
		);
		expect(p.duplicateIds).toEqual(["b", "a"]);
	});
	it("sorts zones by start", () => {
		const p = parse("`a`\n\n```\nx\n```\n\n`b`");
		expect(p.zones.map((z) => z.kind)).toEqual([
			"inline-code",
			"fenced-code",
			"inline-code",
		]);
	});
	it("segments cover the text", () => {
		const p = parse("a{++b++}c");
		expect(p.segments.map((s) => [s.type, s.start, s.end])).toEqual([
			["text", 0, 1],
			["mark", 1, 8],
			["text", 8, 9],
		]);
		expect(parse("").segments).toEqual([]);
	});
	it("is fast for many unclosed openers", () => {
		const t = "{++a ".repeat(20000);
		const p = parse(t);
		expect(p.marks).toEqual([]);
		expect(p.zones).toEqual([]);
		expect(serialize(p)).toBe(t);
	});
});

describe("serialize and writeMark", () => {
	it("round-trips", () => {
		const t = '{++a\r\n++}`x`\n{id="q"++b++}{';
		expect(serialize(parse(t))).toBe(t);
	});
	it("writes marks", () => {
		expect(writeMark("insertion", "x")).toBe("{++x++}");
		expect(
			writeMark("substitution", "a~>b", [
				["author", "C"],
				["id", "i"],
			]),
		).toBe('{id="i" author="C"~~a~>b~~}');
		expect(writeMark("comment", "hi")).toBe("{>>hi<<}");
	});
	it("written marks parse back", () => {
		for (const kind of [
			"insertion",
			"deletion",
			"highlight",
			"comment",
		] as const) {
			const m = parse(writeMark(kind, "x y", [["id", "a"]])).marks[0];
			expect([m?.kind, m?.content, m?.id]).toEqual([kind, "x y", "a"]);
		}
	});
});

describe("parse edge cases", () => {
	it("reads an attribute name with a digit", () => {
		const p = parse('{a1="x"++y++}');
		expect(p.marks).toHaveLength(1);
		expect(p.marks[0]).toMatchObject({
			kind: "insertion",
			content: "y",
			attrs: [["a1", "x"]],
			start: 0,
			end: 13,
		});
	});
	it("finds no marks in frontmatter after a byte order mark", () => {
		expect(parse("﻿---\ntitle: {++x++}\n---").marks).toEqual([]);
	});
	it("finds a mark after a failed attribute prefix moved the search forward", () => {
		const p = parse('{a="{++b++}" ++c');
		expect(p.marks.map((m) => [m.kind, m.content, m.start, m.end])).toEqual([
			["insertion", "b", 4, 11],
		]);
	});
});
