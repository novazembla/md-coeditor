import { describe, expect, it } from "vitest";
import { bridgeSession, hookSession } from "./session";

describe("bridgeSession", () => {
	it("prefers COEDIT_SESSION", () => {
		expect(
			bridgeSession({ COEDIT_SESSION: "run-1", CLAUDE_CODE_SESSION_ID: "xyz" }),
		).toBe("run-1");
	});
	it("falls back to CLAUDE_CODE_SESSION_ID, then default", () => {
		expect(bridgeSession({ CLAUDE_CODE_SESSION_ID: "xyz" })).toBe("xyz");
		expect(bridgeSession({})).toBe("default");
	});
	it("treats empty and unexpanded values as unset", () => {
		expect(
			bridgeSession({
				// biome-ignore lint/suspicious/noTemplateCurlyInString: literal unexpanded variable
				COEDIT_SESSION: "${COEDIT_SESSION}",
				CLAUDE_CODE_SESSION_ID: "",
			}),
		).toBe("default");
	});
});

describe("hookSession", () => {
	const input = { session_id: "abc-123" };
	it("orders option, env, input", () => {
		expect(hookSession("o", { COEDIT_SESSION: "run-1" }, input)).toBe("o");
		expect(hookSession(undefined, { COEDIT_SESSION: "run-1" }, input)).toBe(
			"run-1",
		);
		expect(hookSession(undefined, {}, input)).toBe("abc-123");
	});
	it("treats empty and unexpanded values as unset", () => {
		expect(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal unexpanded variable
			hookSession("", { COEDIT_SESSION: "${COEDIT_SESSION}" }, input),
		).toBe("abc-123");
	});
	it("returns undefined when nothing is set", () => {
		expect(hookSession(undefined, {}, undefined)).toBeUndefined();
		expect(hookSession(undefined, {}, { session_id: 5 })).toBeUndefined();
	});
});
