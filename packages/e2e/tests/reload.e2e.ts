import { expect } from "@wdio/globals";
import { docText, fileText, openNote, waitFor, writeOnDisk } from "../helpers";

const NOTE = "reload.md";
const BEFORE = 'The {id="a1"++big ++}cat.\n';
const AFTER = 'The {id="a1"++small ++}cat.\n';

describe("markup-rendering", () => {
	it("Changes from outside the editor are not filtered", async () => {
		await openNote(NOTE, "live");
		expect(await docText()).toBe(BEFORE);
		writeOnDisk(NOTE, AFTER);
		await waitFor(
			docText,
			(t) => t === AFTER,
			"editor reloads the note from disk",
		);
		expect(await fileText(NOTE)).toBe(AFTER);
	});
});
