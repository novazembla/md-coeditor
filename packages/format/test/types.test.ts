import { describe, expect, it } from "vitest";
import { parse } from "../src/parse";
import type { Mark, Result } from "../src/types";

describe("Mark union", () => {
	it("oldContent needs a kind check", () => {
		const mark = parse("{~~a~>b~~}").marks[0] as Mark;
		// @ts-expect-error oldContent does not exist on every kind of Mark
		const without: string = mark.oldContent;
		expect(without).toBe("a");
		if (mark.kind === "substitution") {
			const old: string = mark.oldContent;
			expect(old).toBe("a");
		}
	});
});

describe("Result", () => {
	it("refuses the keys ok, code and message", () => {
		// @ts-expect-error `ok` may not be a success field
		type Bad = Result<{ ok: boolean }>;
		const fine: Result<{ text: string }> = { ok: true, text: "x" };
		const unused: Bad | undefined = undefined;
		expect([fine.ok, unused]).toEqual([true, undefined]);
	});
});
