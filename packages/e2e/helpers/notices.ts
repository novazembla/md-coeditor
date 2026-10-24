import { $$, browser } from "@wdio/globals";
import { waitFor } from "./wait";

/** The texts of the visible notices. */
export function notices(): Promise<string[]> {
	return $$(".notice").map((el) => el.getText());
}

/** Wait until a notice with this text shows. */
export async function waitForNotice(text: string): Promise<void> {
	await waitFor(notices, (n) => n.includes(text), `notice ${text}`);
}

/** Remove all notices, so a test sees only its own. */
export async function clearNotices(): Promise<void> {
	await browser.execute(() => {
		for (const el of document.querySelectorAll(".notice")) el.remove();
	});
}
