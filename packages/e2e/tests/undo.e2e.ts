import { browser, expect } from "@wdio/globals";
import {
	at,
	docText,
	fileText,
	modKey,
	openNote,
	setCursor,
	waitFor,
} from "../helpers";

const NOTE = "undo.md";
const DOC =
	'The {id="a1"++big ++}cat.\nA {id="d1"--very --}big cat.\nThe {++big ++}cat.\n';

/** Run a command at a place, check the text after it, then undo with one key press. */
async function decideAndUndo(
	command: string,
	place: { after: string },
	after: string,
): Promise<void> {
	await openNote(NOTE, "live");
	await setCursor(at(DOC, place));
	await browser.executeObsidianCommand(command);
	await waitFor(docText, (t) => t === after, "editor text after the decision");
	await browser.keys([modKey(), "z"]);
	await waitFor(docText, (t) => t === DOC, "editor text after undo");
	expect(await fileText(NOTE)).toBe(DOC);
}

describe("change-decisions: undo in the Obsidian app", () => {
	it("undo after accept gives back the text before the accept", async () => {
		await decideAndUndo(
			"md-coeditor:accept-change",
			{ after: '{id="a1"++b' },
			DOC.replace('The {id="a1"++big ++}cat.', "The big cat."),
		);
	});

	it("undo after reject gives back the text before the reject", async () => {
		await decideAndUndo(
			"md-coeditor:reject-change",
			{ after: '{id="d1"--v' },
			DOC.replace('A {id="d1"--very --}big cat.', "A very big cat."),
		);
	});

	it("an id-less mark has no id after undo, in the editor and in the file", async () => {
		await decideAndUndo(
			"md-coeditor:accept-change",
			{ after: "{++b" },
			DOC.replace("The {++big ++}cat.", "The big cat."),
		);
		expect(await docText()).toContain("The {++big ++}cat.");
		expect(await fileText(NOTE)).toContain("The {++big ++}cat.");
	});
});
