import { $, browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { Key } from "webdriverio";
import { clearNotices } from "./notices";
import { waitFor } from "./wait";

/** Close open menus and modals (palette) with Escape. */
async function closePopups(): Promise<void> {
	const open = () => $(".menu, .modal-container").isExisting();
	for (let i = 0; i < 3 && (await open()); i++)
		await browser.keys([Key.Escape]);
	await waitFor(open, (o) => !o, "menus and modals closed");
}

/** Put the vault notes back, close all notes (fresh undo history), and remove menus, modals and notices. */
export async function resetVault(): Promise<void> {
	await closePopups();
	await browser.executeObsidian(({ app }) => {
		app.workspace.detachLeavesOfType("markdown");
	});
	await obsidianPage.resetVault();
	await clearNotices();
}
