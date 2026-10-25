import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import {
	at,
	clickMenuItem,
	docText,
	eventsAfter,
	lastSeq,
	machineFolder,
	openNote,
	rightClickOn,
	runFromPalette,
	setCursor,
	waitFor,
	waitForEvents,
	waitForNotice,
} from "../helpers";

const REVIEW = "agent/review.md";
const REVIEW_TEXT =
	'The {id="i1bbbb" author="Claude"++slow++} fox.\nAn {--old--} word.\nPlain text here.\n';
const LOG_FAILED_NOTICE =
	"MD-Coeditor: could not write the event log. See the console.";

/** Rename or move a file or folder as the user does (File explorer, "Move file to"). */
async function renamePath(from: string, to: string): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, from, to) => {
			const file = app.vault.getAbstractFileByPath(from);
			if (!file) throw new Error(`not in the vault: ${from}`);
			const folder = to.split("/").slice(0, -1).join("/");
			if (folder !== "" && !app.vault.getAbstractFileByPath(folder))
				await app.vault.createFolder(folder);
			await app.fileManager.renameFile(file, to);
		},
		from,
		to,
	);
}

describe("change-decisions", () => {
	it("Accept from the menu", async () => {
		const seq = lastSeq();
		await openNote(REVIEW, "live");
		await rightClickOn({ text: "slow" });
		await clickMenuItem("Accept change");
		await waitFor(
			docText,
			(t) =>
				t ===
				REVIEW_TEXT.replace('{id="i1bbbb" author="Claude"++slow++}', "slow"),
			"note after accept",
		);
		const events = await waitForEvents(seq, 1);
		expect(events.at(-1)).toMatchObject({
			type: "decision",
			path: REVIEW,
			id: "i1bbbb",
			decision: "accepted",
		});
	});

	it("No change at the cursor", async () => {
		const seq = lastSeq();
		await openNote(REVIEW, "live");
		await setCursor(at(REVIEW_TEXT, { after: "Plain" }));
		await runFromPalette("MD-Coeditor: Reject change");
		await waitForNotice("No change at the cursor.");
		expect(await docText()).toBe(REVIEW_TEXT);
		expect(eventsAfter(seq)).toEqual([]);
	});
});

describe("event-log", () => {
	it("Accept with no session running", async () => {
		// No bridge runs in this file.
		const seq = lastSeq();
		await openNote(REVIEW, "live");
		await setCursor(at(REVIEW_TEXT, { after: "sl" }));
		await runFromPalette("MD-Coeditor: Accept change");
		const [event] = await waitForEvents(seq, 1);
		expect(event).toMatchObject({
			v: 1,
			type: "decision",
			path: REVIEW,
			actor: "user",
			id: "i1bbbb",
			kind: "insertion",
			decision: "accepted",
			content: "slow",
			author: "Claude",
		});
		expect(event).not.toHaveProperty("session");
	});

	it("Mark typed by hand", async () => {
		const seq = lastSeq();
		await openNote(REVIEW, "live");
		await rightClickOn({ text: "old" });
		await clickMenuItem("Reject change");
		await waitFor(
			docText,
			(t) => t === REVIEW_TEXT.replace("{--old--}", "old"),
			"note after reject",
		);
		const [event] = await waitForEvents(seq, 1);
		expect(event).toMatchObject({
			type: "decision",
			kind: "deletion",
			decision: "rejected",
			content: "old",
		});
		expect(event?.id).toMatch(/^[a-z0-9]{4,}$/);
	});

	it("Note moved", async () => {
		const seq = lastSeq();
		const moved = "agent/moved/review.md";
		await renamePath(REVIEW, moved);
		await openNote(moved, "live");
		await setCursor(at(REVIEW_TEXT, { after: "sl" }));
		await runFromPalette("MD-Coeditor: Accept change");
		const events = await waitForEvents(seq, 2);
		expect(events).toEqual([
			expect.objectContaining({ type: "rename", from: REVIEW, path: moved }),
			expect.objectContaining({ type: "decision", path: moved, id: "i1bbbb" }),
		]);
	});

	it("Folder renamed", async () => {
		const seq = lastSeq();
		await renamePath("agent/drafts", "agent/old");
		// Then one decision: the log has one write queue, so when the decision
		// is in the log, every rename event of the folder rename is too.
		await openNote(REVIEW, "live");
		await setCursor(at(REVIEW_TEXT, { after: "sl" }));
		await runFromPalette("MD-Coeditor: Accept change");
		const events = await waitFor(
			async () => eventsAfter(seq),
			(e) => e.some((x) => x.type === "decision"),
			"the decision after the folder rename",
		);
		// Exactly one rename event for the one note in the folder: no duplicates.
		expect(events.filter((e) => e.type === "rename")).toEqual([
			expect.objectContaining({
				from: "agent/drafts/draft.md",
				path: "agent/old/draft.md",
			}),
		]);
	});

	// Last in the file: the plugin shows this notice once for each session of Obsidian.
	it("Log cannot be written", async () => {
		const log = join(machineFolder(), "log");
		rmSync(log, { recursive: true, force: true });
		writeFileSync(log, "a file, not a folder");
		try {
			await openNote(REVIEW, "live");
			await setCursor(at(REVIEW_TEXT, { after: "sl" }));
			await runFromPalette("MD-Coeditor: Accept change");
			await waitFor(
				docText,
				(t) => t.startsWith("The slow fox."),
				"note has the accepted text",
			);
			await waitForNotice(LOG_FAILED_NOTICE);
		} finally {
			rmSync(log, { force: true });
		}
	});
});
