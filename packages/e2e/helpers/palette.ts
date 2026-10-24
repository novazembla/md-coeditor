import { $, $$, browser } from "@wdio/globals";
import { Key } from "webdriverio";
import { waitFor } from "./wait";

/** The suggestion titles as "<prefix>: <name>", for example "MD-Coeditor: Accept change". */
function titles(): Promise<string[]> {
	return browser.execute(() =>
		Array.from(document.querySelectorAll(".prompt .suggestion-title"), (el) => {
			const prefix = el.querySelector(".suggestion-prefix");
			const clean = (t: string | null | undefined) =>
				(t ?? "").replace(/\s+/g, " ").trim();
			const all = clean(el.textContent);
			if (!prefix) return all;
			const p = clean(prefix.textContent);
			return `${p}: ${all.slice(p.length).trim()}`;
		}),
	);
}

async function open(query: string): Promise<void> {
	await browser.executeObsidianCommand("command-palette:open");
	const input = $(".prompt-input");
	await input.waitForDisplayed();
	await input.setValue(query);
	// The list is filtered when each item contains each word of the query, or when it is empty.
	const words = query
		.toLowerCase()
		.replace(/:/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	await waitFor(
		titles,
		(items) =>
			items.every((t) => words.every((w) => t.toLowerCase().includes(w))),
		`palette filtered by ${query}`,
	);
}

async function close(): Promise<void> {
	if (await $(".prompt").isExisting()) await browser.keys([Key.Escape]);
	await $(".prompt").waitForDisplayed({ reverse: true });
}

/** Open the command palette, type the query, read the suggestion titles, and close the palette. */
export async function paletteItems(query: string): Promise<string[]> {
	await open(query);
	const items = await titles();
	await close();
	return items;
}

/** Run a command from the command palette by its full title (for example "MD-Coeditor: Accept change"). */
export async function runFromPalette(title: string): Promise<void> {
	await open(title);
	const items = await titles();
	const i = items.indexOf(title);
	if (i < 0)
		throw new Error(`not in the palette: ${title} (${JSON.stringify(items)})`);
	await $$(".prompt .suggestion-item")[i]?.click();
	await $(".prompt").waitForDisplayed({ reverse: true });
}
