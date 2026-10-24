// Speed of the full parse on each change (design D10). Not part of `pnpm check`.
// Run in packages/obsidian: pnpm vitest bench --run --reporter=verbose --silent=false
import { EditorState } from "@codemirror/state";
import { parse } from "@md-coeditor/format";
import { test } from "vitest";
import { coeditExtension } from "./extension";
import { renderField } from "./render";

/** About 1 MB of text with 3,000 insertions and deletions. */
function bigNote(): string {
	const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
	const paragraphs: string[] = [];
	for (let i = 0; i < 1500; i++) {
		paragraphs.push(
			`${filler.repeat(5)}{id="i${i}" author="Claude" date="2026-10-24"++new words ${i}++} ` +
				`${filler.repeat(5)}{id="d${i}" author="Claude" date="2026-10-24"--old words ${i}--} ${filler.repeat(1)}`,
		);
	}
	return paragraphs.join("\n\n");
}

const doc = bigNote();
const state = EditorState.create({
	doc,
	extensions: coeditExtension({ isLivePreview: () => true }),
});
const middle = Math.floor(doc.length / 2);
console.log(
	`note: ${(doc.length / 1e6).toFixed(2)} MB, ${state.field(renderField).decorations.size} decorations`,
);

test("1 MB note, 3,000 marks", async ({ bench }) => {
	const parseResult = await bench("parse", () => {
		parse(doc);
	}).run();
	const keyResult = await bench("key press", () => {
		state
			.update({ changes: { from: middle, insert: "x" } })
			.state.field(renderField);
	}).run();
	console.log(
		`parse: ${parseResult.latency.mean.toFixed(2)} ms mean, ` +
			`one key press (field update and decoration build): ${keyResult.latency.mean.toFixed(2)} ms mean, ` +
			`p99 ${keyResult.latency.p99?.toFixed(2)} ms`,
	);
});
