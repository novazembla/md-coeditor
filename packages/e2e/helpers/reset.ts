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

/** The plugin's folder (endpoint, log, cursors). `obsidianPage.resetVault` would delete it. */
const KEEP = ".coedit";

/**
 * `obsidianPage.resetVault` deletes every file that is not in the fixture
 * vault, also dot folders, so it would delete `.coedit/` (endpoint and log)
 * while the plugin runs. It lists the files with `app.vault.adapter.list`, so
 * hide `.coedit` from that list while it runs.
 */
async function resetNotesKeepCoedit(): Promise<void> {
	await browser.executeObsidian(({ app }, keep) => {
		type List = (p: string) => Promise<{ files: string[]; folders: string[] }>;
		const adapter = app.vault.adapter as unknown as {
			list: List;
			coeditList?: List;
		};
		if (adapter.coeditList) return;
		const list = adapter.list.bind(adapter);
		adapter.coeditList = list;
		const kept = (p: string) => {
			const q = p.replace(/^\/+/, "");
			return q !== keep && !q.startsWith(`${keep}/`);
		};
		adapter.list = async (p) => {
			const r = await list(p);
			return { files: r.files.filter(kept), folders: r.folders.filter(kept) };
		};
	}, KEEP);
	try {
		await obsidianPage.resetVault();
	} finally {
		await browser.executeObsidian(({ app }) => {
			const adapter = app.vault.adapter as unknown as {
				list: unknown;
				coeditList?: unknown;
			};
			if (adapter.coeditList) {
				adapter.list = adapter.coeditList;
				delete adapter.coeditList;
			}
		});
	}
}

/**
 * Put the vault notes back, close all notes (fresh undo history), and remove
 * menus, modals and notices. `.coedit/` (endpoint, log, cursors) stays.
 */
export async function resetVault(): Promise<void> {
	await closePopups();
	await browser.executeObsidian(({ app }) => {
		app.workspace.detachLeavesOfType("markdown");
	});
	await resetNotesKeepCoedit();
	await clearNotices();
}
