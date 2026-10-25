import type { HubClient } from "./hub-client";

/**
 * The active note from the hub, or null. Waits at most `ms`; any failure,
 * a late answer or an odd answer gives null. Never throws.
 */
export async function activeNoteFromHub(
	client: HubClient,
	ms = 1000,
): Promise<string | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const answer = await Promise.race([
			client.call("get_context", {}),
			new Promise<null>((resolve) => {
				timer = setTimeout(() => resolve(null), ms);
			}),
		]);
		if (answer === null || !answer.ok) return null;
		const note = (answer.result as { activeNote?: unknown } | null)?.activeNote;
		return typeof note === "string" && note !== "" ? note : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
