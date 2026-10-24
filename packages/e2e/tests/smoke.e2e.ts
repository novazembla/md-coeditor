import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import {
	at,
	closeMenu,
	cursor,
	docText,
	fileText,
	menuItems,
	modKey,
	notices,
	openNote,
	paletteItems,
	readingText,
	rightClickOn,
	setCursor,
	waitFor,
	writeOnDisk,
} from "../helpers";

const NOTE = "smoke.md";
const DOC = 'The {id="a1"++big ++}cat.\n';

describe("e2e smoke", () => {
	it("opens the vault with the plugin loaded", async () => {
		const loaded = await browser.executeObsidian(
			({ app }) =>
				// biome-ignore lint/suspicious/noExplicitAny: app.plugins is not in the public types
				(app as any).plugins.plugins["md-coeditor"] !== undefined,
		);
		expect(loaded).toBe(true);
	});

	it("helpers: editor, keys and files", async () => {
		await openNote(NOTE, "live");
		expect(await docText()).toBe(DOC);
		expect(await fileText(NOTE)).toBe(DOC);
		await setCursor(at(DOC, { after: "The " }));
		expect(await cursor()).toBe(4);
		expect(["", ""]).toContain(modKey());
		await browser.keys([Key.End]);
		expect(await cursor()).toBe(at(DOC, { after: "cat." }));
	});

	it("helpers: menu, palette and notices", async () => {
		await openNote(NOTE, "live");
		await rightClickOn({ text: "cat." });
		expect((await menuItems()).length).toBeGreaterThan(0);
		await closeMenu();
		expect(await paletteItems("MD-Coeditor")).toContain(
			"MD-Coeditor: Go to next change",
		);
		expect(await notices()).toEqual([]);
	});

	it("helpers: modes and changes on disk", async () => {
		await openNote(NOTE, "source");
		await openNote(NOTE, "reading");
		expect(await readingText()).toBe("The big cat.");
		await openNote(NOTE, "live");
		writeOnDisk(NOTE, "Changed.\n");
		await waitFor(docText, (t) => t === "Changed.\n", "reload from disk");
	});
});
