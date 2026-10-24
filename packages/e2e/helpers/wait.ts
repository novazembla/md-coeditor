import { browser } from "@wdio/globals";

/** Short timeout for UI conditions. Helpers wait for a condition, never for a fixed time. */
export const TIMEOUT = 5000;

/** Wait until `get` returns a value that `ok` accepts, and return that value. */
export async function waitFor<T>(
	get: () => Promise<T>,
	ok: (value: T) => boolean,
	what: string,
): Promise<T> {
	let last: T | undefined;
	await browser.waitUntil(
		async () => {
			last = await get();
			return ok(last);
		},
		{
			timeout: TIMEOUT,
			timeoutMsg: () =>
				`timeout: ${what} (last value: ${JSON.stringify(last)})`,
		},
	);
	return last as T;
}
