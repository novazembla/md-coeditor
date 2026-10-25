import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	activeNote,
	at,
	type Bridge,
	cursor,
	docText,
	fileText,
	modKey,
	notices,
	obsidianDate,
	openNote,
	renderedLine,
	setCursor,
	startBridge,
	waitFor,
	waitForNotice,
} from "../helpers";

const ESSAY = "agent/essay.md";
const ESSAY_TEXT =
	'# Essay\n\nThe quick fox.\n\nA {id="a1aaaa" author="Claude"++big ++}{id="d1aaaa" author="Claude"--small --}dog.\n';
const PLAN = "agent/plan.md";
const PLAN_TEXT = "# Plan\n\nShip in May.\n";

/** A deletion or insertion mark with attributes (id first) around `text`. */
const del = (text: string) => `\\{id="[a-z0-9]+"[^}]*?--${text}--\\}`;
const ins = (text: string) => `\\{id="[a-z0-9]+"[^}]*?\\+\\+${text}\\+\\+\\}`;
/** `The quick fox.` after the suggestion quick → slow. */
const QUICK_TO_SLOW = new RegExp(`^The ${del("quick")}${ins("slow")} fox\\.$`);

const line3 = (doc: string) => doc.split("\n")[2] ?? "";

const onDisk = (path: string) =>
	readFileSync(join(obsidianPage.getVaultPath(), ...path.split("/")), "utf8");

let bridge: Bridge;

async function suggest(path: string, find: string, replace: string) {
	return bridge.json<{ path: string; ids: string[] }>("suggest_edit", {
		path,
		find,
		replace,
	});
}

describe("vault-hub", () => {
	before(async () => {
		bridge = await startBridge();
	});
	after(async () => {
		await bridge.close();
	});

	it("Suggest into the open note", async () => {
		await openNote(ESSAY, "live");
		await setCursor(at(ESSAY_TEXT, { after: "fox" }));
		const { ids } = await suggest(ESSAY, "quick", "slow");
		expect(ids).toHaveLength(2);
		const doc = await waitFor(
			docText,
			(t) => QUICK_TO_SLOW.test(line3(t)),
			"editor shows the suggestion",
		);
		// The editor shows the deletion and the insertion.
		const parts = (await renderedLine(3)).parts;
		expect(parts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ text: "quick", cls: "coedit-del" }),
				expect.objectContaining({ text: "slow", cls: "coedit-ins" }),
			]),
		);
		// The cursor is still after "fox".
		expect(await cursor()).toBe(at(doc, { after: "fox" }));
		// After the save, the file has both marks with ids.
		const file = await fileText(ESSAY);
		expect(line3(file)).toMatch(QUICK_TO_SLOW);
		for (const id of ids) expect(file).toContain(`id="${id}"`);
	});

	it("Undo removes the suggestion", async () => {
		await openNote(ESSAY, "live");
		await setCursor(at(ESSAY_TEXT, { after: "fox" }));
		await suggest(ESSAY, "quick", "slow");
		await waitFor(
			docText,
			(t) => QUICK_TO_SLOW.test(line3(t)),
			"editor shows the suggestion",
		);
		await browser.keys([modKey(), "z"]);
		await waitFor(docText, (t) => t === ESSAY_TEXT, "text after one undo");
	});

	it("Typing right after a suggestion", async () => {
		await openNote(ESSAY, "live");
		await setCursor(at(ESSAY_TEXT, { after: "fox." }));
		await suggest(ESSAY, "quick", "slow");
		// Within half a second after the suggestion.
		await browser.keys(["!"]);
		const typed = await waitFor(
			docText,
			(t) =>
				/^The .* fox\.!$/.test(line3(t)) &&
				QUICK_TO_SLOW.test(line3(t).slice(0, -1)),
			"suggestion and typed !",
		);
		await browser.keys([modKey(), "z"]);
		await waitFor(
			docText,
			(t) => t === typed.replace("fox.!", "fox."),
			"first undo removes !",
		);
		await browser.keys([modKey(), "z"]);
		await waitFor(
			docText,
			(t) => t === ESSAY_TEXT,
			"second undo removes the suggestion",
		);
	});

	it("Suggest into a closed note", async () => {
		expect(await activeNote()).toBeNull();
		await suggest(PLAN, "May", "June");
		const text = onDisk(PLAN);
		const marks = new RegExp(`${del("May")}${ins("June")}`);
		expect(text).toMatch(marks);
		// The rest of the file is unchanged.
		expect(text.replace(marks, "May")).toBe(PLAN_TEXT);
	});

	it("Suggestion in a background note", async () => {
		await openNote(ESSAY, "live");
		await suggest(PLAN, "May", "June");
		const text = `Claude suggested 2 changes in ${PLAN}`;
		await waitForNotice(text);
		await $(
			`//div[contains(@class,"notice") and normalize-space()="${text}"]`,
		).click();
		await waitFor(activeNote, (p) => p === PLAN, "the click opens the note");
	});

	it("Suggestion in the active note", async () => {
		await openNote(ESSAY, "live");
		await suggest(ESSAY, "quick", "slow");
		await waitFor(
			docText,
			(t) => QUICK_TO_SLOW.test(line3(t)),
			"editor shows the suggestion",
		);
		// The hub shows its notice before it answers, so none can come later.
		expect(await notices()).toEqual([]);
	});

	it("Author and date", async () => {
		await suggest(PLAN, "May", "June");
		const today = await obsidianDate();
		const marks = onDisk(PLAN).match(/\{id="[^}]*?(--|\+\+)/g) ?? [];
		expect(marks).toHaveLength(2);
		for (const m of marks) {
			expect(m).toContain('author="Claude"');
			expect(m).toContain(`date="${today}"`);
		}
	});
});
