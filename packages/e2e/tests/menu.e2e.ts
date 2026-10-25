import { expect } from "@wdio/globals";
import {
	clickMenuItem,
	docText,
	fileText,
	menuItems,
	openNote,
	rightClickOn,
	waitFor,
} from "../helpers";

const DECISIONS = "decisions.md";
const LINE1 = 'The {id="a1"++big ++}cat.';
const DOC = `${LINE1}\nA {~~cat~>dog~~} sat.\n`;

describe("change-decisions", () => {
	it("Reject from the menu", async () => {
		await openNote(DECISIONS, "live");
		await rightClickOn({ text: "big" });
		expect(await menuItems()).toEqual(
			expect.arrayContaining(["Accept change", "Reject change"]),
		);
		await clickMenuItem("Reject change");
		const after = DOC.replace(LINE1, "The cat.");
		await waitFor(docText, (t) => t === after, "editor text after reject");
		expect(await fileText(DECISIONS)).toBe(after);
	});

	it("Right-click on plain text", async () => {
		await openNote(DECISIONS, "live");
		await rightClickOn({ text: "cat." });
		const items = await menuItems();
		expect(items.length).toBeGreaterThan(0);
		expect(items).not.toContain("Accept change");
		expect(items).not.toContain("Reject change");
	});
});

describe("markup-rendering", () => {
	it("Right-click in Reading view", async () => {
		await openNote("modes.md", "reading");
		await rightClickOn({
			selector: ".markdown-preview-view .coedit-ins",
			synthetic: true,
		});
		// Obsidian opens no menu here; if it opens one, it has no decision item.
		const items = await menuItems({ optional: true });
		expect(items).not.toContain("Accept change");
		expect(items).not.toContain("Reject change");
	});
});
