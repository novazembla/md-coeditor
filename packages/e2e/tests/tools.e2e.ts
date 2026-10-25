import { readFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	at,
	type Bridge,
	docText,
	openNote,
	readEndpoint,
	restartPlugin,
	setCursor,
	startBridge,
	waitFor,
} from "../helpers";

const ESSAY = "agent/essay.md";
const ESSAY_TEXT =
	'# Essay\n\nThe quick fox.\n\nA {id="a1aaaa" author="Claude"++big ++}{id="d1aaaa" author="Claude"--small --}dog.\n';

const onDisk = (path: string) =>
	readFileSync(join(obsidianPage.getVaultPath(), ...path.split("/")), "utf8");

/** Select from `from` to `to` (offsets) in the active editor. */
async function select(from: number, to: number): Promise<void> {
	await browser.executeObsidian(
		({ app, obsidian }, from, to) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			if (!view) throw new Error("no Markdown view");
			view.editor.focus();
			view.editor.setSelection(
				view.editor.offsetToPos(from),
				view.editor.offsetToPos(to),
			);
		},
		from,
		to,
	);
}

let bridge: Bridge;

describe("agent-tools", () => {
	before(async () => {
		bridge = await startBridge();
	});
	after(async () => {
		await bridge.close();
	});

	it("Active note with a selection", async () => {
		await openNote(ESSAY, "live");
		await select(
			at(ESSAY_TEXT, { before: "quick fox" }),
			at(ESSAY_TEXT, { after: "quick fox" }),
		);
		expect(await bridge.json("get_context")).toEqual({
			hubConnected: true,
			activeNote: ESSAY,
			selection: {
				text: "quick fox",
				start: { line: 3, ch: 4 },
				end: { line: 3, ch: 13 },
			},
			openMarks: 2,
		});
	});

	it("No active note", async () => {
		expect(await bridge.json("get_context")).toEqual({
			hubConnected: true,
			activeNote: null,
			selection: null,
			openMarks: null,
		});
	});

	it("Unsaved editor text", async () => {
		await openNote(ESSAY, "live");
		await setCursor(at(ESSAY_TEXT, { after: "fox." }));
		await browser.keys([" ", "H", "e", "l", "l", "o"]);
		await waitFor(
			docText,
			(t) => t.includes("fox. Hello"),
			"typed text in the editor",
		);
		// Obsidian saves about 2 s after the last key: not yet.
		expect(onDisk(ESSAY)).not.toContain("Hello");
		const note = await bridge.json<{ text: string }>("read_note", {
			path: ESSAY,
		});
		expect(note.text).toContain("The quick fox. Hello");
	});

	it("Obsidian restarted during a session", async () => {
		const first = await bridge.json<{ hubConnected: boolean }>("get_context");
		expect(first.hubConnected).toBe(true);
		const old = readEndpoint();
		const now = await restartPlugin();
		expect(now.token).not.toBe(old?.token);
		const again = await bridge.json<{ hubConnected: boolean }>("get_context");
		expect(again.hubConnected).toBe(true);
	});
});
