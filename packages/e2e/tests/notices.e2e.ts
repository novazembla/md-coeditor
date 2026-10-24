import { browser, expect } from "@wdio/globals";
import {
	at,
	cursor,
	docText,
	fileText,
	openNote,
	setCursor,
	waitForNotice,
} from "../helpers";

const DECISIONS = "decisions.md";
const DOC = 'The {id="a1"++big ++}cat.\nA {~~cat~>dog~~} sat.\n';
const NO_CHANGES = "no-changes.md";
const DOC_NO_CHANGES = "A {~~x~>y~~} cat.\n";

describe("change-decisions", () => {
	it("No mark at the cursor", async () => {
		await openNote(DECISIONS, "live");
		await setCursor(at(DOC, { after: "}c" }));
		await browser.executeObsidianCommand("md-coeditor:accept-change");
		await waitForNotice("No change at the cursor.");
		expect(await docText()).toBe(DOC);
		expect(await fileText(DECISIONS)).toBe(DOC);
	});

	it("Substitution at the cursor", async () => {
		await openNote(DECISIONS, "live");
		await setCursor(at(DOC, { after: "{~~c" }));
		await browser.executeObsidianCommand("md-coeditor:reject-change");
		await waitForNotice("Not supported yet: substitution.");
		expect(await docText()).toBe(DOC);
		expect(await fileText(DECISIONS)).toBe(DOC);
	});
});

describe("markup-rendering", () => {
	it("No changes", async () => {
		await openNote(NO_CHANGES, "live");
		await setCursor(3);
		await browser.executeObsidianCommand("md-coeditor:next-change");
		await waitForNotice("No changes in this note.");
		expect(await cursor()).toBe(3);
		expect(await docText()).toBe(DOC_NO_CHANGES);
		expect(await fileText(NO_CHANGES)).toBe(DOC_NO_CHANGES);
	});
});
