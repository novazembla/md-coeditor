import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parse";
import { serialize } from "../src/serialize";

const fragments = [
	"{++x++}",
	"{--old--}",
	"{~~a~>b~~}",
	"{==h==}",
	"{>>c<<}",
	'{id="a1" author="C" date="2026-10-24"++n++}',
	'{id="a1" edited-by="V"--d--}',
	'{id="a1"\tauthor="C"++t++}',
	'{id="a1"\t \tauthor="C"\t++t++}',
	'{id="a{1"++x++}',
	'{id="a1"\t',
	'{id="a1 ++x++}',
	'{id="q"',
	"{++",
	"{--",
	"{~~a~~}",
	"{",
	"}",
	"++}",
	"~>",
	"`",
	"``",
	"```",
	"````",
	"[[",
	"]]",
	"[[a|b]]",
	"![[x.png]]",
	"> [!note]-",
	"\\",
	"\\`",
	"~~~",
	"```js",
	"|",
	"| a | b |",
	"|---|---|",
	"---",
	"...",
	"---\ntitle: x\n---\n",
	"---\r\ntitle: {++x++}\r\n---\r\n",
	"\uFEFF---\na: 1\n---\n",
	"---\na: 1\n...\n",
	"| a | b |\n|:-:|--:|\n| 1 | {++2++} |\n",
	"| a |\r\n|---|\r\n| 1 |\r\n",
	"a | b\n--|--\n1 | 2\n\n",
	"| a | b |\n",
	"\n",
	"\r\n",
	"\r",
	"\n\n",
	" \n",
	"    ",
	"\t",
	"- ",
	"1. ",
	"# ",
	"😀",
	"é",
	"word",
	" ",
];

const noteArb = fc
	.array(fc.constantFrom(...fragments), { maxLength: 40 })
	.map((parts) => parts.join(""));

describe("round trip (property)", () => {
	it("serialize(parse(t)) === t and the structure is consistent", () => {
		fc.assert(
			fc.property(noteArb, (t) => {
				const p = parse(t);
				expect(serialize(p)).toBe(t);

				// Segments are contiguous and cover the text.
				let at = 0;
				for (const s of p.segments) {
					expect(s.start).toBe(at);
					expect(s.end).toBeGreaterThan(s.start);
					at = s.end;
				}
				expect(at).toBe(t.length);

				// Marks and zones are sorted and do not overlap.
				const ranges = [
					...p.marks.map((m) => ({ start: m.start, end: m.end })),
					...p.zones.map((z) => ({ start: z.start, end: z.end })),
				].sort((a, b) => a.start - b.start);
				for (let i = 1; i < ranges.length; i++) {
					expect((ranges[i] as { start: number }).start).toBeGreaterThanOrEqual(
						(ranges[i - 1] as { end: number }).end,
					);
				}
				for (const list of [p.marks, p.zones]) {
					for (let i = 1; i < list.length; i++) {
						expect((list[i] as { start: number }).start).toBeGreaterThanOrEqual(
							(list[i - 1] as { start: number }).start,
						);
					}
				}
			}),
			{ numRuns: 2000 },
		);
	});

	it("round-trips arbitrary strings", () => {
		fc.assert(
			fc.property(
				fc.string({ unit: "binary" }),
				(t) => serialize(parse(t)) === t,
			),
			{ numRuns: 1000 },
		);
	});

	it("finds no mark inside a wikilink", () => {
		fc.assert(
			fc.property(noteArb, (t) => {
				const p = parse(t);
				for (const z of p.zones) {
					if (z.kind !== "wikilink") continue;
					for (const m of p.marks) {
						expect(m.start < z.end && z.start < m.end).toBe(false);
					}
				}
			}),
			{ numRuns: 2000 },
		);
	});
});
