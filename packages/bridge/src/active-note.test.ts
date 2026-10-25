import { describe, expect, it } from "vitest";
import { activeNoteFromHub } from "./active-note";
import type { HubClient } from "./hub-client";

describe("activeNoteFromHub", () => {
	it("gives null after the time limit and does not close the client", async () => {
		let closed = false;
		const client: HubClient = {
			call: () => new Promise(() => {}),
			close: () => {
				closed = true;
			},
		};
		expect(await activeNoteFromHub(client, 20)).toBeNull();
		expect(closed).toBe(false);
	});

	it("gives the active note", async () => {
		const client: HubClient = {
			call: async () => ({ ok: true, result: { activeNote: "a.md" } }),
			close: () => {},
		};
		expect(await activeNoteFromHub(client, 20)).toBe("a.md");
	});
});
