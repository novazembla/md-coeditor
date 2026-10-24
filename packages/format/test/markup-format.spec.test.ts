import { describe, expect, it } from "vitest";
import { assignIds } from "../src/ids";
import { parse } from "../src/parse";
import { project } from "../src/project";
import { serialize } from "../src/serialize";
import { suggest } from "../src/suggest";

const textOf = (t: string, s: { start: number; end: number }) =>
	t.slice(s.start, s.end);

describe("Recognize the five mark kinds", () => {
	it("Insertion and deletion", () => {
		const t = "The {--old--}{++new++} text.";
		const p = parse(t);
		expect(p.segments.map((s) => s.type)).toEqual([
			"text",
			"mark",
			"mark",
			"text",
		]);
		expect(textOf(t, p.segments[0] as never)).toBe("The ");
		expect(p.marks.map((m) => [m.kind, m.content])).toEqual([
			["deletion", "old"],
			["insertion", "new"],
		]);
		expect(textOf(t, p.segments[3] as never)).toBe(" text.");
	});
	it("Substitution", () => {
		const p = parse("{~~cat~>dog~~}");
		expect(p.marks).toHaveLength(1);
		expect(p.marks[0]).toMatchObject({
			kind: "substitution",
			oldContent: "cat",
			newContent: "dog",
		});
	});
	it("Unclosed mark", () => {
		const p = parse("Use {++ with care.");
		expect(p.marks).toEqual([]);
		expect(p.segments.map((s) => s.type)).toEqual(["text"]);
	});
	it("Blank line ends the search", () => {
		expect(parse("{++first paragraph\n\nsecond++}").marks).toEqual([]);
	});
	it("Single line break in a mark", () => {
		const t = "{++line one\nline two++}";
		const p = parse(t);
		expect(p.marks).toHaveLength(1);
		expect(p.marks[0]).toMatchObject({
			kind: "insertion",
			content: "line one\nline two",
			start: 0,
			end: t.length,
		});
		expect(p.segments.map((s) => s.type)).toEqual(["mark"]);
	});
});

describe("Mark attributes", () => {
	it("Attributes are read", () => {
		const m = parse('{id="k3f9qz" author="Claude" date="2026-10-24"++new++}')
			.marks[0];
		expect([m?.kind, m?.id, m?.author, m?.date]).toEqual([
			"insertion",
			"k3f9qz",
			"Claude",
			"2026-10-24",
		]);
	});
	it("Mark without attributes", () => {
		const m = parse("{++new++}").marks[0];
		expect(m?.kind).toBe("insertion");
		expect([m?.id, m?.author, m?.date]).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});
	it("Unknown attribute is kept", () => {
		const t = '{id="a1" edited-by="Vincent"++x++}';
		const p = parse(t);
		expect(p.marks[0]?.attrs).toEqual([
			["id", "a1"],
			["edited-by", "Vincent"],
		]);
		expect(p.marks[0]?.id).toBe("a1");
		expect(serialize(p)).toBe(t);
	});
	it("Invalid prefix", () => {
		expect(parse('{id="a1 ++x++}').marks).toEqual([]);
	});
	it("Tab between attributes", () => {
		const t = '{id="a1"\tauthor="Claude"++x++}';
		const p = parse(t);
		expect(p.marks).toHaveLength(1);
		expect(p.marks[0]).toMatchObject({
			kind: "insertion",
			id: "a1",
			author: "Claude",
		});
		expect(serialize(p)).toBe(t);
	});
	it("Brace in a value", () => {
		expect(parse('{id="a{1}"++x++}').marks).toEqual([]);
	});
});

describe("Suggestion date is a calendar date", () => {
	const withDate = (date: string) => {
		let i = 0;
		return suggest("The cat sat.", {
			find: "cat",
			replace: "dog",
			author: "Claude",
			date,
			newId: () => `k${++i}`,
		});
	};
	it("Day that does not exist", () => {
		expect(withDate("2026-02-30")).toMatchObject({
			ok: false,
			code: "invalid_attribute",
		});
	});
	it("Leap day", () => {
		const r = withDate("2028-02-29");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.marks.map((m) => m.date)).toEqual(["2028-02-29", "2028-02-29"]);
		}
	});
	it("Day in a year that is not a leap year", () => {
		expect(withDate("2026-02-29")).toMatchObject({
			ok: false,
			code: "invalid_attribute",
		});
	});
	it("Parse keeps any date value", () => {
		expect(parse('{id="a1" date="2026-02-30"++x++}').marks[0]?.date).toBe(
			"2026-02-30",
		);
	});
});

describe("Lossless round trip", () => {
	it("Round trip", () => {
		const samples = [
			"",
			"plain",
			"{++a++} {--b",
			'{id="x" y="z"~~a~>b~~}',
			"```\n{++x++}\n",
			"| a |\n|---|\n",
			"---\na: 1\n---\n{==h==}{>>c<<}",
			"😀 {++é++} `code`   {",
		];
		for (const t of samples) expect(serialize(parse(t))).toBe(t);
	});
	it("CRLF line endings", () => {
		const t = "# T\r\n\r\n{++a\r\nb++}\r\n```\r\nx\r\n```\r\n";
		const out = serialize(parse(t));
		expect(out).toBe(t);
		expect(out.split("\r\n").length).toBe(t.split("\r\n").length);
		expect(out.replace(/\r\n/g, "")).not.toContain("\n");
	});
});

describe("Positions in UTF-16 code units", () => {
	it("Position after non-ASCII text", () => {
		const m = parse("😀 {++x++}").marks[0];
		expect(m?.start).toBe(3);
		expect(m?.end).toBe(10);
	});
});

describe("Protected zones", () => {
	it("Mark syntax in a fenced code block", () => {
		const p = parse("```\n{++x++}\n```\n");
		expect(p.marks).toEqual([]);
		expect(p.zones.map((z) => z.kind)).toEqual(["fenced-code"]);
	});
	it("Frontmatter", () => {
		const p = parse("---\ntitle: {++x++}\n---\n");
		expect(p.zones.map((z) => z.kind)).toEqual(["frontmatter"]);
		expect(p.marks).toEqual([]);
	});
	it("Frontmatter after a byte order mark", () => {
		const t = "\uFEFF---\ntitle: {++x++}\n---\n";
		const p = parse(t);
		expect(p.zones).toEqual([{ kind: "frontmatter", start: 1, end: 23 }]);
		expect(t.slice(1, 23)).toBe("---\ntitle: {++x++}\n---");
		expect(p.marks).toEqual([]);
	});
	it("Table", () => {
		const t = "| a | b |\n|---|---|\n| 1 | 2 |\n";
		const p = parse(t);
		expect(p.zones).toHaveLength(1);
		expect(p.zones[0]?.kind).toBe("table");
		expect(t.slice(p.zones[0]?.start, p.zones[0]?.end)).toBe(
			"| a | b |\n|---|---|\n| 1 | 2 |",
		);
	});
	it("Inline code before a mark", () => {
		const p = parse("a `{++x++}` b");
		expect(p.zones.map((z) => z.kind)).toEqual(["inline-code"]);
		expect(p.marks).toEqual([]);
	});
	it("Inline code inside a mark", () => {
		const p = parse("{++run `make`++}");
		expect(p.marks).toHaveLength(1);
		expect(p.marks[0]?.content).toBe("run `make`");
	});
});

describe("Unique mark ids", () => {
	it("Duplicate id is reported", () => {
		expect(parse('{id="a1"++x++} {id="a1"--y--}').duplicateIds).toEqual(["a1"]);
	});
	it("Ids are assigned", () => {
		let i = 0;
		const r = assignIds('{++x++} {id="a1"++y++} {id="a1"--z--}', {
			newId: () => `n${++i}`,
		});
		expect(r.text).toBe('{id="n1"++x++} {id="a1"++y++} {id="n2"--z--}');
		const ids = parse(r.text).marks.map((m) => m.id);
		expect(new Set(ids).size).toBe(3);
		expect(ids[1]).toBe("a1");
	});
});

describe("Agent view", () => {
	it("View of a replace", () => {
		expect(project("The {--old--}{++new++} text.").text).toBe("The new text.");
	});
	it("Comments are hidden", () => {
		expect(project("A {==big==}{>>why?<<} cat.").text).toBe("A big cat.");
	});
});

const sugg = (
	text: string,
	find: string,
	replace: string,
	extra: { before?: string; after?: string } = {},
) => {
	let i = 0;
	return suggest(text, {
		find,
		replace,
		...extra,
		author: "Claude",
		date: "2026-10-24",
		newId: () => `id${++i}`,
	});
};
const AT = 'author="Claude" date="2026-10-24"';

describe("Suggestion makes insertion and deletion marks", () => {
	it("Replace a word", () => {
		const r = sugg("The cat sat.", "cat sat", "dog sat");
		expect(r).toMatchObject({
			ok: true,
			text: `The {id="id1" ${AT}--cat--}{id="id2" ${AT}++dog++} sat.`,
		});
	});
	it("Only an insertion", () => {
		const r = sugg("The cat sat.", "cat sat", "black cat sat");
		expect(r.ok && r.marks.map((m) => [m.kind, m.content])).toEqual([
			["insertion", "black "],
		]);
		expect(r.ok && r.text).toBe(`The {id="id1" ${AT}++black ++}cat sat.`);
	});
	it("Only a deletion", () => {
		const r = sugg("A very big cat.", "very big", "big");
		expect(r.ok && r.marks.map((m) => [m.kind, m.content])).toEqual([
			["deletion", "very "],
		]);
		expect(r.ok && r.text).toBe(`A {id="id1" ${AT}--very --}big cat.`);
	});
	it("Whole words", () => {
		const r = sugg("The cat sat.", "cat", "cut");
		expect(r.ok && r.marks.map((m) => [m.kind, m.content])).toEqual([
			["deletion", "cat"],
			["insertion", "cut"],
		]);
	});
	it("Change an emoji", () => {
		const r = sugg("I like 😀 a lot.", "😀", "😁");
		expect(r).toMatchObject({
			ok: true,
			text: `I like {id="id1" ${AT}--😀--}{id="id2" ${AT}++😁++} a lot.`,
		});
		expect(r.ok && r.marks.map((m) => [m.kind, m.content])).toEqual([
			["deletion", "😀"],
			["insertion", "😁"],
		]);
	});
	it("Result reports the new marks", () => {
		const r = sugg("The cat sat.", "cat", "cut");
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.marks).toHaveLength(2);
		expect(r.marks[0]).toMatchObject({
			id: "id1",
			kind: "deletion",
			content: "cat",
			start: 4,
		});
		expect(r.marks[1]).toMatchObject({
			id: "id2",
			kind: "insertion",
			content: "cut",
			start: r.marks[0]?.end,
		});
		expect(r.text.slice(r.marks[1]?.start, r.marks[1]?.end)).toContain(
			"++cut++",
		);
	});
});

describe("Suggestion target must be unique", () => {
	it("Not found", () => {
		const r = sugg("The cat sat.", "dog", "cat");
		// The result has exactly these keys: no text, no changes, no marks.
		expect(r).toEqual({
			ok: false,
			code: "not_found",
			message: expect.stringMatching(/\S/),
		});
	});
	it("Two matches", () => {
		expect(sugg("a cat and a cat", "cat", "dog")).toMatchObject({
			ok: false,
			code: "ambiguous",
		});
	});
	it("Context makes it unique", () => {
		const r = sugg("a cat and the cat", "cat", "dog", { before: "the " });
		expect(r.ok && r.text).toBe(
			`a cat and the {id="id1" ${AT}--cat--}{id="id2" ${AT}++dog++}`,
		);
	});
	it("Match next to a mark counts", () => {
		expect(
			sugg("The {++big ++}cat sat. The big cat ran.", "big cat", "dog"),
		).toMatchObject({ ok: false, code: "ambiguous" });
	});
	it("Matches in a zone do not count", () => {
		const r = sugg("`cat` and cat", "cat", "dog");
		expect(r).toMatchObject({
			ok: true,
			text: `\`cat\` and {id="id1" ${AT}--cat--}{id="id2" ${AT}++dog++}`,
		});
	});
	it("Context across a mark", () => {
		const r = sugg("The {++big ++}cat sat.", "cat", "dog", {
			before: "The big ",
		});
		expect(r).toMatchObject({
			ok: true,
			text: `The {++big ++}{id="id1" ${AT}--cat--}{id="id2" ${AT}++dog++} sat.`,
		});
	});
	it("Emoji is not split", () => {
		const note = "a 😀 cat";
		const r = sugg(note, "\uDE00 cat", "x");
		expect(r).toMatchObject({ ok: false, code: "not_found" });
		expect(r).not.toHaveProperty("text");
		expect(sugg(note, "a \uD83D", "x")).toMatchObject({
			ok: false,
			code: "not_found",
		});
	});
});

describe("Unsafe suggestions are refused", () => {
	const code = (t: string, f: string, r: string) => {
		const x = sugg(t, f, r);
		return x.ok ? "ok" : x.code;
	};
	it("Overlaps a pending mark", () => {
		expect(code("The {++big ++}cat.", "big cat", "cat")).toBe("overlaps_mark");
	});
	it("Next to a pending mark", () => {
		const r = sugg("The {++big ++}cat.", "cat", "dog");
		expect(r.ok && r.text).toBe(
			`The {++big ++}{id="id1" ${AT}--cat--}{id="id2" ${AT}++dog++}.`,
		);
	});
	it("Inside a protected zone", () => {
		expect(code("```\ncat\n```\n", "cat", "dog")).toBe("protected_zone");
	});
	it("Line break", () => {
		expect(code("a b", "a\nb", "c")).toBe("line_break");
		expect(code("a b", "a", "c\nd")).toBe("line_break");
	});
	it("Markup in the replace text", () => {
		expect(code("a b", "a", "{++")).toBe("markup_in_text");
	});
	it("Markup in the find text", () => {
		expect(code("a --} b", "--}", "x")).toBe("markup_in_text");
	});
	it("Block prefix", () => {
		expect(code("# Intro", "# Intro", "## Intro")).toBe("structural_edit");
	});
	it("Heading text can change", () => {
		const r = sugg("# Intro", "Intro", "Overview");
		expect(r.ok && r.text).toBe(
			`# {id="id1" ${AT}--Intro--}{id="id2" ${AT}++Overview++}`,
		);
	});
	it("No change", () => {
		expect(code("a b", "a", "a")).toBe("no_change");
	});
});

describe("Decision outcomes stay safe", () => {
	const code = (t: string, f: string, r: string) => {
		const x = sugg(t, f, r);
		return x.ok ? "ok" : x.code;
	};
	it("New list marker", () => {
		expect(code("item", "item", "- item")).toBe("structural_edit");
	});
	it("Mixed decision exposes a heading", () => {
		expect(code("Hello # world", "Hello # world", "Hi # world")).toBe(
			"structural_edit",
		);
	});
	it("Unclosed mark before the place", () => {
		const note = "Use {++ with care.";
		const r = sugg(note, "care", "caution");
		expect(r).toMatchObject({ ok: false, code: "unsafe_result" });
		expect(r).not.toHaveProperty("text");
	});
	it("Line becomes a setext underline", () => {
		expect(code("Hello\nWorld", "World", "===")).toBe("structural_edit");
	});
	it("Leading space after a mixed decision is fine", () => {
		const r = sugg("The cat sat.", "The cat", "A cat");
		expect(r).toMatchObject({
			ok: true,
			text: `{id="id1" ${AT}--The--}{id="id2" ${AT}++A++} cat sat.`,
		});
	});
	it("Replace text opens a code block", () => {
		expect(code("Hello\nworld {++x++} end", "Hello", "```")).toBe(
			"unsafe_result",
		);
	});
	it("Backtick joins inline code", () => {
		expect(code("Say ` hi", "hi", "hi`")).toBe("unsafe_result");
	});
});
