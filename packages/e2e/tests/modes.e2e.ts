import { $$, expect } from "@wdio/globals";
import { openNote, renderedLine } from "../helpers";

// modes.md: line 1 'The {id="d1"--cat--}{id="a1"++dog++} sat.', line 2 empty,
// line 3 'The {id="a1" author="Claude"++big ++}cat.'
const NOTE = "modes.md";
const RAW = 'The {id="a1" author="Claude"++big ++}cat.';

describe("markup-rendering", () => {
	it("Insertion and deletion in Reading view", async () => {
		await openNote(NOTE, "reading");
		const p = await renderedLine(1);
		expect(p.text).toBe("The catdog sat.");
		expect(p.parts.map((x) => [x.text, x.cls, x.color, x.decoration])).toEqual([
			["The ", null, null, "none"],
			["cat", "coedit-del", "red", "line-through"],
			["dog", "coedit-ins", "green", "underline"],
			[" sat.", null, null, "none"],
		]);
	});

	it("Raw mark in Source mode", async () => {
		await openNote(NOTE, "source");
		const line = await renderedLine(3);
		expect(line.text).toBe(RAW);
		expect(line.parts.every((x) => x.cls === null && x.color === null)).toBe(
			true,
		);
		expect(
			await $$(".cm-content .coedit-ins, .cm-content .coedit-del").length,
		).toBe(0);
	});
});
