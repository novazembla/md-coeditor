import type { Change, View } from "@md-coeditor/format";
import {
	decide,
	parse,
	project,
	serialize,
	suggest,
} from "@md-coeditor/format";
import { describe, expect, it } from "vitest";

describe("public API", () => {
	it("suggests, parses, decides both marks, and serializes", () => {
		let n = 0;
		const ids = ["aaaaaa", "bbbbbb"];
		const s = suggest("The quick fox jumps.\n", {
			find: "quick",
			replace: "slow",
			author: "claude",
			date: "2026-01-01",
			newId: () => ids[n++] ?? `id${n}`,
		});
		expect(s.ok).toBe(true);
		if (!s.ok) return;

		const parsed = parse(s.text);
		expect(serialize(parsed)).toBe(s.text);
		expect(parsed.marks).toHaveLength(2);

		let text = s.text;
		for (const mark of parsed.marks) {
			const d = decide(text, mark.id as string, "accept");
			expect(d.ok).toBe(true);
			if (d.ok) text = d.text;
		}
		expect(serialize(parse(text))).toBe(text);
		expect(text).toBe("The slow fox jumps.\n");
	});

	it("projects the agent view and maps positions back", () => {
		const note = "The {--old--}{++new++} text.";
		const view: View = project(note);
		expect(view.text).toBe("The new text.");
		expect(view.toNote(4, "end")).toBe(4);
		expect(note.slice(view.toNote(4), view.toNote(7, "end"))).toBe("new");
	});

	it("reports changes that give the new text", () => {
		const note = "The quick fox.";
		const s = suggest(note, {
			find: "quick",
			replace: "slow",
			author: "claude",
			date: "2026-01-01",
		});
		expect(s.ok).toBe(true);
		if (!s.ok) return;
		const changes: Change[] = s.changes;
		let out = "";
		let at = 0;
		for (const c of changes) {
			out += note.slice(at, c.from) + c.insert;
			at = c.to;
		}
		expect(out + note.slice(at)).toBe(s.text);
	});
});
