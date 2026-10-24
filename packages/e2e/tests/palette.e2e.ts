import { expect } from "@wdio/globals";
import {
	at,
	docText,
	fileText,
	openNote,
	paletteItems,
	runFromPalette,
	setCursor,
	waitFor,
} from "../helpers";

const NOTE = "decisions.md";
const LINE1 = 'The {id="a1"++big ++}cat.';
const DOC = `${LINE1}\nA {~~cat~>dog~~} sat.\n`;
const COMMANDS = [
	"MD-Coeditor: Accept change",
	"MD-Coeditor: Reject change",
	"MD-Coeditor: Go to next change",
	"MD-Coeditor: Go to previous change",
];

describe("change-decisions", () => {
	it("Accept with the cursor inside an insertion", async () => {
		await openNote(NOTE, "live");
		await setCursor(at(DOC, { after: '{id="a1"++b' }));
		expect(await paletteItems("MD-Coeditor")).toEqual(COMMANDS);
		await runFromPalette("MD-Coeditor: Accept change");
		const after = DOC.replace(LINE1, "The big cat.");
		await waitFor(docText, (t) => t === after, "editor text after accept");
		expect(await fileText(NOTE)).toBe(after);
	});

	it("Source mode", async () => {
		await openNote(NOTE, "source");
		expect(await paletteItems("MD-Coeditor")).toEqual([]);
	});
});
