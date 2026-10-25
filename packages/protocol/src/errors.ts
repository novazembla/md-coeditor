import { z } from "zod";

/** Refusal codes of the format package (suggest.ts). Kept as strings: no import from format. */
export const FORMAT_ERROR_CODES = [
	"empty_find",
	"no_change",
	"line_break",
	"markup_in_text",
	"invalid_attribute",
	"not_found",
	"ambiguous",
	"overlaps_mark",
	"protected_zone",
	"structural_edit",
	"unsafe_result",
	"duplicate_id",
	"unsupported_kind",
] as const;

/** Codes made by the hub or the bridge. */
export const HUB_ERROR_CODES = [
	"hub_unavailable",
	"protocol_mismatch",
	"invalid_path",
	"note_not_found",
	"unknown_id",
	"ambiguous_id",
	"invalid_params",
	"unknown_method",
	"internal_error",
] as const;

export const TOOL_ERROR_CODES = [
	...HUB_ERROR_CODES,
	...FORMAT_ERROR_CODES,
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export function isToolErrorCode(code: unknown): code is ToolErrorCode {
	return (TOOL_ERROR_CODES as readonly unknown[]).includes(code);
}

/**
 * Error shape of a tool call. `code` is a plain string in the reader:
 * a newer hub can send a code that this bridge does not know.
 * `details`: `protected_zone` has `zone`, `ambiguous` has `matches`,
 * `overlaps_mark` has `ids`.
 */
export const toolErrorSchema = z.looseObject({
	code: z.string(),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});
export type ToolError = z.infer<typeof toolErrorSchema>;
