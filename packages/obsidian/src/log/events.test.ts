import { describe, expect, test } from "vitest";
import type { DecisionResult } from "../decide";
import { decisionEvent, renameEvents } from "./events";

const mark = (author?: string) =>
	({
		kind: "insertion",
		content: "slow",
		...(author ? { author } : {}),
	}) as unknown as DecisionResult["mark"];

describe("event builders", () => {
	test("decision event", () => {
		expect(
			decisionEvent("essay.md", {
				mark: mark("Claude"),
				decision: "accept",
				id: "i1",
			}),
		).toEqual({
			type: "decision",
			path: "essay.md",
			actor: "user",
			id: "i1",
			kind: "insertion",
			decision: "accepted",
			content: "slow",
			author: "Claude",
		});
	});

	test("reject without author has no author field", () => {
		const e = decisionEvent("a.md", {
			mark: mark(),
			decision: "reject",
			id: "i1",
		});
		expect(e).toMatchObject({ decision: "rejected" });
		expect("author" in e).toBe(false);
	});

	test("file rename: only Markdown", () => {
		expect(renameEvents({ path: "d/e.md", kind: "file" }, "e.md")).toEqual([
			{ type: "rename", path: "d/e.md", actor: "user", from: "e.md" },
		]);
		expect(renameEvents({ path: "d/e.png", kind: "file" }, "e.png")).toEqual(
			[],
		);
	});

	test("folder rename: no event (Obsidian fires one for each file)", () => {
		expect(renameEvents({ path: "old", kind: "folder" }, "drafts")).toEqual([]);
	});
});
