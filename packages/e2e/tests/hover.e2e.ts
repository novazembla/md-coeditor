import { expect } from "@wdio/globals";
import { openNote, tooltipOf } from "../helpers";

// hover.md, line 1: 'The {id="a1" author="Claude" date="2026-10-24"++big ++}cat.'
// hover.md, line 2: 'The {++big ++}cat.'
const NOTE = "hover.md";
const span = (line: number) =>
	`.cm-content > .cm-line:nth-child(${line}) .coedit-ins`;

describe("markup-rendering", () => {
	it("Author and date", async () => {
		await openNote(NOTE, "live");
		expect(await tooltipOf(span(1))).toBe("Claude, 2026-10-24");
	});

	it("No attributes", async () => {
		await openNote(NOTE, "live");
		expect(await tooltipOf(span(2))).toBe("Unknown author");
	});
});
