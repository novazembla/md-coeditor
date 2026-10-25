import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	cursorsDir,
	decisionEventWriteSchema,
	endpointPath,
	eventsPath,
	getContextResultSchema,
	isKnownEvent,
	isToolErrorCode,
	localGitignorePath,
	logIdPath,
	machineName,
	PROTOCOL_VERSION,
	parseEvent,
	parseMessage,
	readNoteResultSchema,
	suggestEditParamsSchema,
	suggestEditResultSchema,
	TOOL_ERROR_CODES,
} from "./index";

const env = {
	v: 1,
	seq: 1,
	ts: "2026-10-25T10:00:00Z",
	path: "a.md",
	actor: "agent",
};

describe("messages", () => {
	it("parses hello with unknown fields", () => {
		const m = parseMessage({
			type: "hello",
			protocol: PROTOCOL_VERSION,
			token: "t",
			agent: "claude",
			session: "s",
			extra: 1,
		});
		expect(m).toMatchObject({ type: "hello", extra: 1 });
	});
	it("refuses hello without token", () => {
		expect(
			parseMessage({ type: "hello", protocol: 1, agent: "c", session: "s" }),
		).toBeNull();
	});
	it("parses welcome and error", () => {
		expect(
			parseMessage('{"type":"welcome","protocol":1,"features":["x"]}'),
		).toMatchObject({ features: ["x"] });
		expect(
			parseMessage({ type: "error", code: "protocol_mismatch", message: "m" }),
		).not.toBeNull();
		expect(parseMessage({ type: "welcome", protocol: 1 })).toBeNull();
	});
	it("does not throw on unknown type, bad JSON or non-objects", () => {
		expect(parseMessage({ type: "future" })).toBeNull();
		expect(parseMessage("{nope")).toBeNull();
		expect(parseMessage(null)).toBeNull();
		expect(parseMessage(42)).toBeNull();
		expect(parseMessage({ type: "toString" })).toBeNull();
	});
	it("parses the reserved event message", () => {
		expect(parseMessage({ type: "event", seq: 3 })).toMatchObject({
			type: "event",
		});
	});
	it("parses request and both responses", () => {
		expect(
			parseMessage({
				type: "request",
				id: "1",
				method: "read_note",
				params: {},
			}),
		).not.toBeNull();
		expect(parseMessage({ type: "request", method: "x" })).toBeNull();
		expect(
			parseMessage({ type: "response", id: "1", ok: true, result: {} }),
		).not.toBeNull();
		const fail = parseMessage({
			type: "response",
			id: "1",
			ok: false,
			error: { code: "ambiguous", message: "m", details: { matches: 2 } },
		});
		expect(fail).toMatchObject({ ok: false });
		expect(
			parseMessage({ type: "response", id: "1", ok: false, error: {} }),
		).toBeNull();
	});
	it("checks results and params", () => {
		expect(
			getContextResultSchema.safeParse({
				activeNote: null,
				selection: null,
				openMarks: null,
			}).success,
		).toBe(true);
		expect(
			getContextResultSchema.safeParse({
				activeNote: "a.md",
				selection: {
					text: "x",
					start: { line: 1, ch: 0 },
					end: { line: 1, ch: 1 },
				},
				openMarks: 2,
			}).success,
		).toBe(true);
		expect(
			getContextResultSchema.safeParse({ activeNote: "a.md" }).success,
		).toBe(false);
		expect(
			readNoteResultSchema.safeParse({
				path: "a.md",
				text: "t",
				marks: [{ id: "x", kind: "insertion", content: "c", line: 1, more: 1 }],
			}).success,
		).toBe(true);
		expect(
			readNoteResultSchema.safeParse({
				path: "a.md",
				text: "t",
				marks: [{ id: "x", kind: "highlight", content: "c", line: 1 }],
			}).success,
		).toBe(false);
		expect(
			suggestEditParamsSchema.safeParse({ path: "a", find: "f", replace: "r" })
				.success,
		).toBe(true);
		expect(
			suggestEditParamsSchema.safeParse({ path: "a", find: "f" }).success,
		).toBe(false);
		expect(
			suggestEditResultSchema.safeParse({ path: "a", ids: ["1"] }).success,
		).toBe(true);
	});
});

describe("errors", () => {
	it("knows hub and format codes", () => {
		expect(isToolErrorCode("note_not_found")).toBe(true);
		expect(isToolErrorCode("protected_zone")).toBe(true);
		expect(isToolErrorCode("nope")).toBe(false);
		expect(TOOL_ERROR_CODES).toContain("hub_unavailable");
	});
});

describe("events", () => {
	it("parses a suggestion", () => {
		const e = parseEvent({
			...env,
			type: "suggestion",
			ids: ["a"],
			find: "f",
			replace: "r",
		});
		expect(e && isKnownEvent(e)).toBe(true);
	});
	it("parses a decision from a JSON line and accepts any kind", () => {
		const e = parseEvent(
			JSON.stringify({
				...env,
				actor: "user",
				type: "decision",
				id: "a",
				kind: "highlight",
				decision: "accepted",
				content: "c",
				future: true,
			}),
		);
		expect(e).toMatchObject({
			type: "decision",
			kind: "highlight",
			future: true,
		});
	});
	it("parses a rename", () => {
		expect(parseEvent({ ...env, type: "rename", from: "b.md" })).toMatchObject({
			from: "b.md",
		});
	});
	it("marks an unknown event type", () => {
		const e = parseEvent({ ...env, type: "future_thing", x: 1 });
		expect(e).toMatchObject({ type: "future_thing", unknown: true });
		expect(e && isKnownEvent(e)).toBe(false);
	});
	it("returns null for invalid events", () => {
		expect(parseEvent("{bad")).toBeNull();
		expect(parseEvent({ ...env, v: 2, type: "rename", from: "b" })).toBeNull();
		expect(parseEvent({ ...env, actor: "robot", type: "x" })).toBeNull();
		expect(parseEvent({ ...env, type: "suggestion", ids: "a" })).toBeNull();
		expect(parseEvent(null)).toBeNull();
	});
	it("writer schema is strict", () => {
		const ok = {
			...env,
			type: "decision",
			id: "a",
			kind: "deletion",
			decision: "rejected",
			content: "",
		};
		expect(decisionEventWriteSchema.safeParse(ok).success).toBe(true);
		expect(
			decisionEventWriteSchema.safeParse({ ...ok, kind: "x" }).success,
		).toBe(false);
		expect(
			decisionEventWriteSchema.safeParse({ ...ok, extra: 1 }).success,
		).toBe(false);
	});
});

describe("paths", () => {
	it("makes machine names", () => {
		expect(machineName("Work-Mac.local")).toBe("work-mac");
		expect(machineName("ÜBER_PC")).toBe("-ber-pc");
		expect(machineName("")).toBe("machine");
		expect(machineName(".local")).toBe("machine");
	});
	it("builds paths", () => {
		const v = join("v");
		expect(endpointPath(v, "m")).toBe(
			join("v", ".coedit", "local", "m", "endpoint.json"),
		);
		expect(eventsPath(v, "m")).toBe(
			join("v", ".coedit", "local", "m", "log", "events.jsonl"),
		);
		expect(logIdPath(v, "m")).toBe(
			join("v", ".coedit", "local", "m", "log", "log-id"),
		);
		expect(cursorsDir(v, "m")).toBe(
			join("v", ".coedit", "local", "m", "cursors"),
		);
		expect(localGitignorePath(v)).toBe(
			join("v", ".coedit", "local", ".gitignore"),
		);
	});
});
