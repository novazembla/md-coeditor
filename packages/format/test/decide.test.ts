import { describe, expect, it } from "vitest";
import { decide } from "../src/decide";

describe("decide", () => {
	it("removes all attributes with the mark", () => {
		const t = 'a {id="a1" author="Claude" date="2026-01-01"++x++} b';
		const r = decide({ text: t, id: "a1", decision: "accept" });
		expect(r).toMatchObject({ ok: true, text: "a x b" });
		const r2 = decide({ text: t, id: "a1", decision: "reject" });
		expect(r2).toMatchObject({ ok: true, text: "a  b" });
	});
	it("keeps CRLF inside and around the mark", () => {
		const t = 'one\r\n{id="a1"++x\r\ny++}\r\ntwo';
		expect(decide({ text: t, id: "a1", decision: "accept" })).toMatchObject({
			text: "one\r\nx\r\ny\r\ntwo",
		});
		expect(decide({ text: t, id: "a1", decision: "reject" })).toMatchObject({
			text: "one\r\n\r\ntwo",
		});
	});
	it("handles a mark at the start of the note", () => {
		const r = decide({
			text: '{id="d1"--ab--}rest',
			id: "d1",
			decision: "reject",
		});
		expect(r).toMatchObject({
			ok: true,
			text: "abrest",
			changes: [{ from: 0, to: 15, insert: "ab" }],
		});
		expect(
			decide({ text: '{id="d1"--ab--}rest', id: "d1", decision: "accept" }),
		).toMatchObject({
			text: "rest",
			changes: [{ from: 0, to: 15, insert: "" }],
		});
	});
	it("handles a mark at the end of the note", () => {
		expect(
			decide({ text: 'rest{id="a1"++ab++}', id: "a1", decision: "accept" }),
		).toMatchObject({
			text: "restab",
			changes: [{ from: 4, to: 19, insert: "ab" }],
		});
		expect(
			decide({ text: 'rest{id="a1"++ab++}', id: "a1", decision: "reject" }),
		).toMatchObject({
			text: "rest",
		});
	});
	it("returns the mark as parsed before the decision", () => {
		const r = decide({
			text: 'x{id="a1" author="C"++yy++}',
			id: "a1",
			decision: "accept",
		});
		expect(r).toMatchObject({
			ok: true,
			decision: "accept",
			mark: {
				kind: "insertion",
				id: "a1",
				author: "C",
				content: "yy",
				start: 1,
			},
		});
	});
	it("refuses and changes nothing", () => {
		const dup = '{id="a1"++x++}{id="a1"--y--}';
		expect(decide({ text: dup, id: "a1", decision: "accept" })).toMatchObject({
			ok: false,
			code: "duplicate_id",
		});
		expect(
			decide({ text: "text", id: "zz", decision: "reject" }),
		).toMatchObject({
			ok: false,
			code: "not_found",
		});
		for (const m of ['{id="s1"~~a~>b~~}', '{id="s1"==a==}', '{id="s1">>a<<}']) {
			const r = decide({ text: m, id: "s1", decision: "accept" });
			expect(r).toMatchObject({ ok: false, code: "unsupported_kind" });
			expect(r).not.toHaveProperty("text");
			if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
		}
	});
});
