import { $, $$, browser } from "@wdio/globals";
import { Key } from "webdriverio";
import { waitFor } from "./wait";

/** A visible element (CSS selector), or the first match of a text in the editor. */
export type Target = { selector: string } | { text: string };

async function editorPoint(text: string): Promise<{ x: number; y: number }> {
	return browser.executeObsidian(({ app, obsidian }, text) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!view) throw new Error("no Markdown view");
		const doc = view.editor.getValue();
		const i = doc.indexOf(text);
		if (i < 0) throw new Error(`not in the note: ${text}`);
		// The CodeMirror view (not in the public types).
		const cm = (
			view.editor as unknown as {
				cm: { coordsAtPos(p: number, side: 1 | -1): DOMRect | null };
			}
		).cm;
		const from = cm.coordsAtPos(i, 1);
		const to = cm.coordsAtPos(i + text.length, -1);
		if (!from || !to) throw new Error(`not visible: ${text}`);
		return {
			x: Math.round((from.left + to.right) / 2),
			y: Math.round((from.top + from.bottom) / 2),
		};
	}, text);
}

/**
 * Right-click on a target. Returns when the page has handled the `contextmenu`
 * event: the window saw the event (capture phase), and two animation frames passed.
 */
export async function rightClickOn(target: Target): Promise<void> {
	await browser.execute(() => {
		const w = window as unknown as { coeditContextMenu?: boolean };
		w.coeditContextMenu = false;
		window.addEventListener(
			"contextmenu",
			() =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						w.coeditContextMenu = true;
					}),
				),
			{ once: true, capture: true },
		);
	});
	if ("selector" in target) {
		const el = $(target.selector);
		await el.waitForDisplayed();
		await el.click({ button: "right" });
	} else {
		const { x, y } = await editorPoint(target.text);
		await browser
			.action("pointer")
			.move({ x, y, origin: "viewport" })
			.down({ button: 2 })
			.up({ button: 2 })
			.perform();
	}
	await waitFor(
		() =>
			browser.execute(
				() =>
					(window as unknown as { coeditContextMenu?: boolean })
						.coeditContextMenu === true,
			),
		(done) => done,
		"contextmenu handled",
	);
}

/**
 * The item titles of the open DOM menu (`nativeMenus: false`). Waits until a menu shows.
 * With `optional`, returns `[]` when the right-click opened no menu (for example in Reading view).
 */
export async function menuItems(
	options: { optional?: boolean } = {},
): Promise<string[]> {
	if (options.optional && !(await $(".menu").isExisting())) return [];
	await $(".menu").waitForDisplayed();
	return $$(".menu .menu-item .menu-item-title").map((el) => el.getText());
}

/** Click the item with this title in the open menu. */
export async function clickMenuItem(title: string): Promise<void> {
	const item = $(
		`//div[contains(@class,"menu-item")][.//div[contains(@class,"menu-item-title") and normalize-space()="${title}"]]`,
	);
	await item.waitForDisplayed();
	await item.click();
	await $(".menu").waitForDisplayed({ reverse: true });
}

/** Close the open menu. */
export async function closeMenu(): Promise<void> {
	await browser.keys([Key.Escape]);
	await waitFor(
		() => $(".menu").isExisting(),
		(open) => !open,
		"menu closed",
	);
}
