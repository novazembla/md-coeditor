import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import {
	at,
	cursor,
	docText,
	openNote,
	renderedLine,
	setCursor,
} from "../helpers";

const NOTE = "cursor.md";
const LINE1 = 'The {id="a1"++big ++}cat.';
const LINE2 = 'The {id="d1"--cat--}{id="a2"++dog++} sat.';
const LINE3 = 'The {id="a3" author="Claude" date="2026-10-24"++big ++}cat.';
const DOC = `${LINE1}\n${LINE2}\n${LINE3}\n`;

/** The hidden syntax of LINE2, as offsets in DOC. */
const LINE2_START = at(DOC, { before: LINE2 });
const HIDDEN2 = ['{id="d1"--', "--}", '{id="a2"++', "++}"].map((s) => {
	const from = DOC.indexOf(s, LINE2_START);
	return [from, from + s.length] as const;
});

/** The number of visible characters of LINE2 before an offset. */
function column2(offset: number): number {
	let col = 0;
	for (let i = LINE2_START; i < offset; i++) {
		if (!HIDDEN2.some(([from, to]) => i >= from && i < to)) col++;
	}
	return col;
}

describe("markup-rendering", () => {
	it("Arrow key over the hidden prefix", async () => {
		await openNote(NOTE, "live");
		await setCursor(at(DOC, { after: "The " }));
		await browser.keys([Key.ArrowRight]);
		expect(await cursor()).toBe(at(DOC, { after: '{id="a1"++b' }));
	});

	it("Backspace at the start of an insertion", async () => {
		await openNote(NOTE, "live");
		await setCursor(at(DOC, { before: "big" }));
		await browser.keys([Key.Backspace]);
		expect(await docText()).toBe(
			DOC.replace(LINE1, 'The{id="a1"++big ++}cat.'),
		);
	});

	it("Insertion with attributes", async () => {
		await openNote(NOTE, "live");
		const line = await renderedLine(3);
		expect(line.text).toBe("The big cat.");
		expect(
			line.parts.map((p) => [p.text, p.cls, p.color, p.decoration]),
		).toEqual([
			["The ", null, null, "none"],
			["big ", "coedit-ins", "green", "underline"],
			["cat.", null, null, "none"],
		]);
	});
});

describe("Regression: one key press at a mark edge moves one visible character", () => {
	const VISIBLE = "The catdog sat.";

	it("right arrow over the whole line, then left arrow back", async () => {
		await openNote(NOTE, "live");
		await setCursor(LINE2_START);
		const right: number[] = [];
		for (let i = 0; i < VISIBLE.length; i++) {
			await browser.keys([Key.ArrowRight]);
			right.push(column2(await cursor()));
		}
		expect(right).toEqual(Array.from(VISIBLE, (_, i) => i + 1));
		const left: number[] = [];
		for (let i = 0; i < VISIBLE.length; i++) {
			await browser.keys([Key.ArrowLeft]);
			left.push(column2(await cursor()));
		}
		expect(left).toEqual(Array.from(VISIBLE, (_, i) => VISIBLE.length - i - 1));
	});
});
