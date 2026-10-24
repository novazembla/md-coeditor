import { describe, expect, it } from "vitest";
import { project } from "../src/project";

describe("project", () => {
	it("keeps plain text", () => {
		const v = project("Just text.\n");
		expect(v.text).toBe("Just text.\n");
		expect(v.marks).toEqual([]);
		expect(v.toNote(5)).toBe(5);
	});
	it("shows insertions, highlights and the new text of substitutions", () => {
		expect(project("a {++b++} {==c==} {~~d~>e~~} f").text).toBe("a b c e f");
	});
	it("hides deletions and comments, with empty ranges", () => {
		const v = project("a {--b--}{>>c<<}d");
		expect(v.text).toBe("a d");
		expect(v.marks.map((m) => [m.mark.kind, m.start, m.end])).toEqual([
			["deletion", 2, 2],
			["comment", 2, 2],
		]);
	});
	it("gives the range of each visible mark", () => {
		const v = project("ab{++cd++}ef{~~x~>yz~~}");
		expect(v.text).toBe("abcdefyz");
		expect(v.marks.map((m) => [m.mark.kind, m.start, m.end])).toEqual([
			["insertion", 2, 4],
			["substitution", 6, 8],
		]);
	});
	it("treats attributes as part of the mark", () => {
		const v = project('x{id="a1" author="C"++y++}z');
		expect(v.text).toBe("xyz");
		expect(v.toNote(1)).toBe(v.marks[0]?.mark.contentStart);
	});
	it("keeps code and frontmatter text, and CRLF", () => {
		const t = "---\r\na: 1\r\n---\r\n`{++x++}` {--y--}z";
		expect(project(t).text).toBe("---\r\na: 1\r\n---\r\n`{++x++}` z");
	});
	it("handles an empty note and empty marks", () => {
		const v = project("");
		expect(v.text).toBe("");
		expect(v.toNote(0)).toBe(0);
		expect(v.toNote(0, "end")).toBe(0);
		const w = project("a{++++}b");
		expect(w.text).toBe("ab");
		expect(w.marks.map((m) => [m.start, m.end])).toEqual([[1, 1]]);
	});
});

describe("project toNote", () => {
	const note = "The {--old--}{++new++} text{>>c<<}.";
	const v = project(note);
	it("is exact inside text", () => {
		expect(v.text).toBe("The new text.");
		expect(v.toNote(1)).toBe(1);
		expect(v.toNote(1, "end")).toBe(1);
		expect(v.toNote(9)).toBe(note.indexOf("ext"));
		expect(v.toNote(5)).toBe(note.indexOf("ew"));
	});
	it('"start" skips hidden marks and opening delimiters', () => {
		expect(v.toNote(4)).toBe(note.indexOf("new"));
		expect(v.toNote(7)).toBe(note.indexOf(" text"));
		expect(v.toNote(12)).toBe(note.indexOf("."));
	});
	it('"end" stops before hidden marks and closing delimiters', () => {
		expect(v.toNote(4, "end")).toBe(4);
		expect(v.toNote(7, "end")).toBe(note.indexOf("++}"));
		expect(v.toNote(12, "end")).toBe(note.indexOf("{>>"));
	});
	it("handles the ends of the view and out of range positions", () => {
		expect(v.toNote(0)).toBe(0);
		expect(v.toNote(0, "end")).toBe(0);
		expect(v.toNote(13)).toBe(note.length);
		expect(v.toNote(13, "end")).toBe(note.length);
		expect(v.toNote(99)).toBe(note.length);
		expect(v.toNote(-5)).toBe(0);
		const t = project("a{--b--}");
		expect(t.toNote(1)).toBe(8);
		expect(t.toNote(1, "end")).toBe(1);
	});
	it("maps inside the new text of a substitution", () => {
		const s = "x{~~old~>new~~}y";
		const w = project(s);
		expect(w.text).toBe("xnewy");
		expect(w.toNote(1)).toBe(s.indexOf("new"));
		expect(w.toNote(3)).toBe(s.indexOf("w"));
		expect(w.toNote(4, "end")).toBe(s.indexOf("~~}"));
		expect(w.toNote(4)).toBe(s.indexOf("y"));
	});
	it("counts UTF-16 code units", () => {
		const s = "😀{++x++}😀";
		const w = project(s);
		expect(w.text).toBe("😀x😀");
		expect(w.toNote(3)).toBe(s.lastIndexOf("😀"));
		expect(w.toNote(3, "end")).toBe(s.indexOf("++}"));
		expect(w.toNote(2, "end")).toBe(2);
	});
});
