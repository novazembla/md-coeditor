import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

function onDisk(path: string): string {
	return join(obsidianPage.getVaultPath(), ...path.split("/"));
}

/** The text of a note on disk. Saves the open note first, so pending edits are in the file. */
export async function fileText(path: string): Promise<string> {
	await browser.executeObsidian(async ({ app, obsidian }) => {
		await app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.save();
	});
	return readFileSync(onDisk(path), "utf8");
}

/** Write a note with Node fs in the sandbox vault, so Obsidian sees a change from outside. */
export function writeOnDisk(path: string, text: string): void {
	writeFileSync(onDisk(path), text);
}
