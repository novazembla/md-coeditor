import { describe, expect, it } from "vitest";
import { decide } from "../src/decide";
import { suggest } from "../src/suggest";
import type { ErrorCode } from "../src/types";

const counter = () => {
	let i = 0;
	return () => `id${++i}`;
};
const base = { author: "C", date: "2026-10-24" };
const A = 'author="C" date="2026-10-24"';

function run(
	text: string,
	find: string,
	replace: string,
	extra: { before?: string; after?: string } = {},
) {
	return suggest(text, { find, replace, ...extra, ...base, newId: counter() });
}

function code(text: string, find: string, replace: string) {
	const r = run(text, find, replace);
	return r.ok ? "ok" : r.code;
}

describe("suggest places", () => {
	it("counts overlapping matches as ambiguous", () => {
		expect(code("aaa", "aa", "ab")).toBe("ambiguous");
	});
	it("ignores places that fail the context", () => {
		const r = run("aaa", "aa", "ab", { before: "a" });
		// Only the place at 1 has "a" before; the place at 0 has nothing before.
		expect(r.ok && r.text).toBe(`a{id="id1" ${A}--aa--}{id="id2" ${A}++ab++}`);
	});
	it("context at the start of the note", () => {
		expect(code("ab ab", "ab", "cd")).toBe("ambiguous");
		const r = run("ab ab", "ab", "cd", { after: " ab" });
		expect(r.ok && r.text).toBe(
			`{id="id1" ${A}--ab--}{id="id2" ${A}++cd++} ab`,
		);
	});
	it("context at the end of the note", () => {
		const r = run("ab ab", "ab", "cd", { before: "ab " });
		expect(r.ok && r.text).toBe(
			`ab {id="id1" ${A}--ab--}{id="id2" ${A}++cd++}`,
		);
		expect(code("ab", "ab", "cd")).toBe("ok");
		const none = run("ab", "ab", "cd", { before: "xx" });
		expect(none.ok).toBe(false);
	});
	it("before longer than the text before the match does not wrap around", () => {
		const r = run("ab", "ab", "cd", { before: "ab" });
		expect(r.ok).toBe(false);
	});
});

describe("suggest block prefix", () => {
	it("heading marker is refused, heading text is allowed", () => {
		expect(code("# Intro", "# Intro", "## Intro")).toBe("structural_edit");
		const r = run("# Intro", "Intro", "Overview");
		expect(r.ok && r.text).toBe(
			`# {id="id1" ${A}--Intro--}{id="id2" ${A}++Overview++}`,
		);
	});
	it("list marker", () => {
		expect(code("- item", "- item", "* item")).toBe("structural_edit");
		expect(code("1. item", "1. item", "2. item")).toBe("structural_edit");
		expect(code("- item", "item", "other")).toBe("ok");
	});
	it("adding a list marker is refused", () => {
		expect(code("item", "item", "- item")).toBe("structural_edit");
	});
	it("a marker that appears by deleting text is refused", () => {
		expect(code("x - item", "x - item", "- item")).toBe("structural_edit");
	});
	it("task box", () => {
		expect(code("- [ ] todo", "[ ] todo", "[x] todo")).toBe("structural_edit");
		expect(code("- [ ] todo", "todo", "done")).toBe("ok");
	});
	it("quote", () => {
		expect(code("> quote", "> quote", "quote")).toBe("structural_edit");
		expect(code("> > quote", "quote", "text")).toBe("ok");
	});
	it("indentation", () => {
		expect(code("  word", "  word", "word")).toBe("structural_edit");
		expect(code("  word", "word", "other")).toBe("ok");
	});
	it("only checks the line of the match", () => {
		expect(code("# Title\n\nbody text", "body", "main")).toBe("ok");
	});
});

describe("suggest trim and words", () => {
	it("one letter change marks the whole word", () => {
		const r = run("The cat sat.", "cat", "cut");
		expect(r.ok && r.text).toBe(
			`The {id="id1" ${A}--cat--}{id="id2" ${A}++cut++} sat.`,
		);
	});
	it("leading whitespace in find and replace", () => {
		const r = run("a b", " b", "  b");
		expect(r.ok && r.text).toBe(`a {id="id1" ${A}++ ++}b`);
	});
	it("trailing whitespace in find and replace", () => {
		const r = run("a b c", "b ", "b  ");
		expect(r.ok && r.text).toBe(`a b {id="id1" ${A}++ ++}c`);
	});
	it("change at the very start and end", () => {
		const r = run("cat", "cat", "dog");
		expect(r.ok && r.text).toBe(`{id="id1" ${A}--cat--}{id="id2" ${A}++dog++}`);
	});
	it("returns the new marks", () => {
		const r = run("A very big cat.", "very big", "big");
		expect(r.ok && r.marks.map((m) => [m.kind, m.content, m.id])).toEqual([
			["deletion", "very ", "id1"],
		]);
	});
	it("does not reuse ids from the note", () => {
		const r = suggest('{id="id1"++x++} cat', {
			find: "cat",
			replace: "dog",
			...base,
			newId: counter(),
		});
		expect(r.ok && r.marks.map((m) => m.id)).toEqual(["id2", "id3"]);
	});
});

describe("suggest input checks", () => {
	it("checks in order", () => {
		expect(code("a", "", "b")).toBe("empty_find");
		expect(code("a", "a", "a")).toBe("no_change");
		expect(code("a\nb", "a\nb", "{++")).toBe("line_break");
		expect(code("a", "a", "b\r")).toBe("line_break");
		expect(code("a", "a", "~>")).toBe("markup_in_text");
	});
	it("invalid attributes", () => {
		const t = "cat";
		const mk = (author: string, date: string) =>
			suggest(t, { find: "cat", replace: "dog", author, date });
		expect(mk("", "2026-10-24")).toMatchObject({ code: "invalid_attribute" });
		expect(mk('a"b', "2026-10-24")).toMatchObject({
			code: "invalid_attribute",
		});
		expect(mk("C", "24-10-2026")).toMatchObject({ code: "invalid_attribute" });
	});
});

describe("suggest safety against existing markup", () => {
	it("a new close sequence does not close an old unclosed mark", () => {
		const r = run("Use {++ with care.", "care", "caution");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.code).toBe("unsafe_result");
	});
	it("a backtick in the replace text does not pair with an old backtick", () => {
		const r = run("Run `make now", "now", "`later");
		expect(r.ok).toBe(false);
		expect(!r.ok && r.code).toBe("unsafe_result");
	});
	it("balanced backticks in the replace text are fine", () => {
		const r = run("Run it now", "now", "`make`");
		expect(r.ok).toBe(true);
	});
});

describe("suggest outcome check", () => {
	it("a table delimiter row under a line with a pipe", () => {
		expect(code("a | b\nHello", "Hello", "|---|")).toBe("unsafe_result");
	});
	it("frontmatter that appears on line 1", () => {
		expect(code("Hi\n\nmid\n---\nend", "Hi", "---")).toBe("unsafe_result");
		// No later delimiter line: no frontmatter, the suggestion is fine.
		expect(code("Hi\n\nmid", "Hi", "---")).toBe("structural_edit");
	});
	it("a line that becomes a setext underline", () => {
		expect(code("Hello\nWorld", "World", "===")).toBe("structural_edit");
		expect(code("Hello\nWorld", "World", "---")).toBe("structural_edit");
		expect(code("Hello\n\nWorld", "World", "===")).toBe("ok");
		expect(code("Hello\nWorld", "Hello", "===")).toBe("ok");
		expect(code("a q b", "q", "===")).toBe("ok");
	});
	it("a line that becomes a thematic break", () => {
		expect(code("Hello\n\nWorld", "World", "***")).toBe("structural_edit");
		expect(code("x\n\nWorld", "World", "_ _ _")).toBe("structural_edit");
	});
	it("a setext underline or thematic break that stays one is fine", () => {
		expect(code("Hello\n===\n", "Hello", "Hello there")).toBe("ok");
		// Accepting the deletion of the whole text line leaves a bare `===`.
		expect(code("Hello\n===\n", "Hello", "Hi")).toBe("structural_edit");
		// Replacing the underline itself: a mixed outcome removes it.
		expect(code("Hello\n===\n", "===", "====")).toBe("structural_edit");
	});
	it("the next line can become an underline when the changed line stops being blank", () => {
		expect(code("a\n  q\n===", "q", "x")).toBe("structural_edit");
		expect(code("a\n  q y\n===", "q", "x")).toBe("ok");
		expect(code("a\nq\n===", "q", "")).toBe("structural_edit");
	});
	it("a replace text that joins an old attribute prefix to a plain mark end", () => {
		expect(code("x ++z++}", "x ", '{a="1"')).toBe("unsafe_result");
	});
	it("a replace text that opens a table zone fully inside the change is fine", () => {
		expect(code("a\nb", "b", "|c|")).toBe("ok");
	});
	it("a leading space after a mixed decision is not a prefix change", () => {
		expect(code("The cat sat.", "The cat", "A cat")).toBe("ok");
	});
	it("a mixed decision that makes four spaces of indentation is refused", () => {
		expect(
			code("The     cat", "The cat".replace(" ", "     "), "A     cat"),
		).toBe("structural_edit");
	});
	it("keeps marks and zones next to the change in every outcome", () => {
		expect(code("`a`cat{++x++}", "cat", "dog")).toBe("ok");
		expect(code("{++x++}cat`a`", "cat", "dog")).toBe("ok");
		expect(code("`a``b`", "`b`", "`c`")).toBe("protected_zone");
	});
	it("the written marks are reported and positioned", () => {
		const r = run("a cat b", "cat", "dog");
		expect(r.ok && r.changes).toEqual([
			{
				from: 2,
				to: 5,
				insert: `{id="id1" ${A}--cat--}{id="id2" ${A}++dog++}`,
			},
		]);
	});
});

describe("suggest surrogate pairs in the trim", () => {
	it("does not split a pair in the common start or end", () => {
		const r = run("x 😀 y", "😀", "😁");
		expect(r.ok && r.marks.map((m) => m.content)).toEqual(["😀", "😁"]);
		const e = run("𝒜𝒝 y", "𝒜𝒝", "𝒜𝒞");
		expect(e.ok && e.marks.map((m) => m.content)).toEqual(["𝒜𝒝", "𝒜𝒞"]);
		const f = run("a😀", "a😀", "b😀");
		expect(f.ok && f.marks.map((m) => m.content)).toEqual(["a😀", "b😀"]);
	});
});

describe("suggest: matches in a zone do not count", () => {
	const cases: [string, string][] = [
		["`cat` and cat", "inline code"],
		["```\ncat\n```\ncat", "fenced code"],
		["---\nt: cat\n---\ncat", "frontmatter"],
		["| cat |\n|---|\n\ncat", "table"],
		["x\n\n    cat\n\ncat", "indented code"],
	];
	for (const [note, name] of cases) {
		it(`one place outside ${name}`, () => {
			const r = run(note, "cat", "dog");
			expect(r.ok && r.text).toBe(
				`${note.slice(0, -3)}{id="id1" ${A}--cat--}{id="id2" ${A}++dog++}`,
			);
		});
	}
	it("a match in a mark counts toward ambiguity", () => {
		expect(run("a cat {++cat++}", "cat", "dog")).toMatchObject({
			ok: false,
			code: "ambiguous",
		});
	});
	it("one match fully inside a mark overlaps the mark", () => {
		const r = run("a {++big cat++}", "cat", "dog");
		expect(r).toEqual({
			ok: false,
			code: "overlaps_mark",
			message: expect.stringMatching(/\S/),
		});
	});
	it("a place in a zone and a place in a mark: the mark wins", () => {
		const r = run("The {++big ++}cat. `big cat`", "big cat", "dog");
		expect(r).toMatchObject({ ok: false, code: "overlaps_mark" });
	});
	it("a place next to a zone is fine", () => {
		const r = run("`a`cat", "cat", "dog");
		expect(r.ok && r.text).toBe(
			`\`a\`{id="id1" ${A}--cat--}{id="id2" ${A}++dog++}`,
		);
		const l = run("cat`a`", "cat", "dog");
		expect(l.ok && l.text).toBe(
			`{id="id1" ${A}--cat--}{id="id2" ${A}++dog++}\`a\``,
		);
	});
	it("a place that touches the inside of a zone is refused", () => {
		expect(code("`a`cat", "a`c", "x")).toBe("protected_zone");
	});
});

describe("suggest: CriticMarkup sequences in find and replace", () => {
	const sequences = [
		"{++",
		"++}",
		"{--",
		"--}",
		"{~~",
		"~~}",
		"~>",
		"{==",
		"==}",
		"{>>",
		"<<}",
	];
	for (const seq of sequences) {
		it(`${seq} in the replace text`, () => {
			expect(code("a b", "a", `x${seq}y`)).toBe("markup_in_text");
		});
		it(`${seq} in the find text`, () => {
			expect(code(`a b`, `a${seq}`, "x")).toBe("markup_in_text");
		});
	}
});

describe("suggest: block prefix markers", () => {
	it("plus list marker", () => {
		expect(code("+ item", "+ item", "- item")).toBe("structural_edit");
		expect(code("+ item", "item", "thing")).toBe("ok");
	});
	it("parenthesis list marker", () => {
		expect(code("1) item", "1) item", "2) item")).toBe("structural_edit");
		expect(code("1) item", "item", "thing")).toBe("ok");
	});
	it("a tab is indentation", () => {
		expect(code("para\n\tword", "\tword", "word")).toBe("structural_edit");
		expect(code("para\n\tword", "word", "other")).toBe("ok");
	});
	it("a checked task box", () => {
		expect(code("- [x] done", "[x]", "[ ]")).toBe("structural_edit");
		expect(code("- [x] done", "done", "finished")).toBe("ok");
	});
	it("seven # are text, so the edit is allowed", () => {
		expect(code("####### x", "x", "y")).toBe("ok");
		const r = run("####### x", "#######", "!!!!!!!");
		expect(r.ok && r.text).toBe(
			`{id="id1" ${A}--#######--}{id="id2" ${A}++!!!!!!!++} x`,
		);
	});
	// The text after the marker changes, so a decision outcome keeps the same
	// prefix shape. Only the check of the changed part against the prefix
	// (design D6 step 5) refuses these.
	const touching: [string, string, string][] = [
		["+ item", "+ item", "+x item"],
		["- item", "- item", "-x item"],
		["* item", "* item", "*x item"],
		["1. item", "1. item", "1.x item"],
		["1) item", "1) item", "1)x item"],
		["# item", "# item", "#x item"],
		["###### item", "###### item", "######x item"],
		["> item", "> item", ">x item"],
		["- [x] done", "[x] done", "[xx] done"],
		["- [ ] done", "[ ] done", "[ x] done"],
	];
	for (const [note, find, replace] of touching) {
		it(`an edit inside the marker of "${note}" is refused`, () => {
			expect(code(note, find, replace)).toBe("structural_edit");
		});
	}
	it("six # are a heading marker", () => {
		expect(code("###### x", "######", "!!!!!!")).toBe("structural_edit");
	});
});

describe("suggest: attribute checks", () => {
	const mk = (author: string, date: string) =>
		suggest("cat", { find: "cat", replace: "dog", author, date });
	it("author with a line break", () => {
		expect(mk("A\nB", "2026-10-24")).toMatchObject({
			ok: false,
			code: "invalid_attribute",
		});
		expect(mk("A\rB", "2026-10-24")).toMatchObject({
			ok: false,
			code: "invalid_attribute",
		});
	});
	it("date with extra text", () => {
		expect(mk("C", "2026-10-24T")).toMatchObject({
			ok: false,
			code: "invalid_attribute",
		});
		expect(mk("C", "x2026-10-24")).toMatchObject({
			ok: false,
			code: "invalid_attribute",
		});
	});
});

describe("suggest: author braces", () => {
	for (const author of ["A{B", "A}B", "{", "}"]) {
		it(`author ${author} is refused`, () => {
			expect(
				suggest("cat", {
					find: "cat",
					replace: "dog",
					author,
					date: "2026-10-24",
				}),
			).toMatchObject({ ok: false, code: "invalid_attribute" });
		});
	}
});

describe("suggest: date is a calendar date", () => {
	const rows: [string, boolean][] = [
		["2026-02-30", false],
		["2026-02-29", false],
		["2028-02-29", true],
		["2026-13-01", false],
		["2026-04-31", false],
		["2026-10-24", true],
		["2026-00-10", false],
		["2026-01-00", false],
		["1900-02-29", false],
		["2000-02-29", true],
	];
	for (const [date, valid] of rows) {
		it(`${date} is ${valid ? "accepted" : "refused"}`, () => {
			const r = suggest("cat", {
				find: "cat",
				replace: "dog",
				author: "C",
				date,
			});
			if (valid) expect(r).toMatchObject({ ok: true });
			else expect(r).toMatchObject({ ok: false, code: "invalid_attribute" });
		});
	}
});

describe("suggest: ids", () => {
	it("skips an id that the call already used", () => {
		const seq = ["x", "x", "y"];
		let i = 0;
		const r = suggest("cat", {
			find: "cat",
			replace: "dog",
			...base,
			newId: () => seq[i++] ?? "z",
		});
		expect(r.ok && r.marks.map((m) => [m.kind, m.id])).toEqual([
			["deletion", "x"],
			["insertion", "y"],
		]);
		expect(r.ok && r.text).toBe(`{id="x" ${A}--cat--}{id="y" ${A}++dog++}`);
	});
});

describe("suggest: every error code", () => {
	const dup = '{id="a1"++x++}{id="a1"--y--}';
	const triggers: Record<
		ErrorCode,
		() => { ok: boolean; code?: string; message?: string }
	> = {
		empty_find: () => run("a", "", "b"),
		no_change: () => run("a", "a", "a"),
		line_break: () => run("a b", "a\nb", "c"),
		markup_in_text: () => run("a", "a", "{++"),
		invalid_attribute: () =>
			suggest("a", { find: "a", replace: "b", author: "", date: "2026-10-24" }),
		not_found: () => run("a", "z", "b"),
		ambiguous: () => run("a a", "a", "b"),
		overlaps_mark: () => run("The {++big ++}cat.", "big cat", "cat"),
		protected_zone: () => run("```\ncat\n```\n", "cat", "dog"),
		structural_edit: () => run("# Intro", "# Intro", "## Intro"),
		unsafe_result: () => run("Use {++ with care.", "care", "caution"),
		duplicate_id: () => decide({ text: dup, id: "a1", decision: "accept" }),
		unsupported_kind: () =>
			decide({ text: '{id="s1"==a==}', id: "s1", decision: "accept" }),
	};
	for (const [name, trigger] of Object.entries(triggers)) {
		it(`${name} has a code and a message`, () => {
			const r = trigger();
			expect(r.ok).toBe(false);
			expect(r.code).toBe(name);
			expect(typeof r.message).toBe("string");
			expect((r.message ?? "").trim()).not.toBe("");
		});
	}
});
