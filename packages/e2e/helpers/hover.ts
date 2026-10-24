import { $, browser } from "@wdio/globals";

/**
 * Move the mouse to an element and return the text of the tooltip that shows.
 *
 * Obsidian shows an `aria-label` tooltip only after two or more mouse
 * `pointermove` events (a guard against touch input). One WebDriver move is
 * one event, so the pointer moves in steps, like a real mouse.
 */
export async function tooltipOf(selector: string): Promise<string> {
	const el = $(selector);
	await el.waitForDisplayed();
	const { x, y } = await el.getLocation();
	const { width, height } = await el.getSize();
	const cx = Math.round(x + width / 2);
	const cy = Math.round(y + height / 2);
	let action = browser.action("pointer", {
		parameters: { pointerType: "mouse" },
	});
	for (const dx of [-30, -20, -10, 0]) {
		action = action.move({
			x: cx + dx,
			y: cy + 20,
			origin: "viewport",
			duration: 50,
		});
	}
	await action
		.move({ x: cx, y: cy, origin: "viewport", duration: 50 })
		.perform();
	const tip = $(".tooltip");
	await tip.waitForDisplayed();
	return tip.getText();
}
