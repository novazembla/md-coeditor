import { z } from "zod";
import { toolErrorSchema } from "./errors";

export const PROTOCOL_VERSION = 1;

/** Readers use looseObject: unknown fields are kept, not errors (D21). */
export const helloSchema = z.looseObject({
	type: z.literal("hello"),
	protocol: z.number().int(),
	token: z.string(),
	agent: z.string(),
	session: z.string(),
});
export type Hello = z.infer<typeof helloSchema>;

export const welcomeSchema = z.looseObject({
	type: z.literal("welcome"),
	protocol: z.number().int(),
	features: z.array(z.string()),
});
export type Welcome = z.infer<typeof welcomeSchema>;

export const errorMessageSchema = z.looseObject({
	type: z.literal("error"),
	code: z.string(),
	message: z.string(),
});
export type ErrorMessage = z.infer<typeof errorMessageSchema>;

/** Reserved: the hub does not push events yet. */
export const eventMessageSchema = z.looseObject({
	type: z.literal("event"),
});
export type EventMessage = z.infer<typeof eventMessageSchema>;

export const METHODS = ["get_context", "read_note", "suggest_edit"] as const;
export type Method = (typeof METHODS)[number];

/** Lines are 1-based, `ch` is 0-based UTF-16 (D5). */
export const positionSchema = z.looseObject({
	line: z.number().int(),
	ch: z.number().int(),
});
export type Position = z.infer<typeof positionSchema>;

export const getContextParamsSchema = z.looseObject({});
export type GetContextParams = z.infer<typeof getContextParamsSchema>;

export const getContextResultSchema = z.looseObject({
	activeNote: z.string().nullable(),
	selection: z
		.looseObject({
			text: z.string(),
			start: positionSchema,
			end: positionSchema,
		})
		.nullable(),
	openMarks: z.number().int().nullable(),
});
export type GetContextResult = z.infer<typeof getContextResultSchema>;

export const readNoteParamsSchema = z.looseObject({ path: z.string() });
export type ReadNoteParams = z.infer<typeof readNoteParamsSchema>;

export const noteMarkSchema = z.looseObject({
	id: z.string().optional(),
	kind: z.enum(["insertion", "deletion"]),
	author: z.string().optional(),
	content: z.string(),
	line: z.number().int(),
});
export type NoteMark = z.infer<typeof noteMarkSchema>;

export const readNoteResultSchema = z.looseObject({
	path: z.string(),
	text: z.string(),
	marks: z.array(noteMarkSchema),
});
export type ReadNoteResult = z.infer<typeof readNoteResultSchema>;

export const suggestEditParamsSchema = z.looseObject({
	path: z.string(),
	find: z.string(),
	replace: z.string(),
	before: z.string().optional(),
	after: z.string().optional(),
});
export type SuggestEditParams = z.infer<typeof suggestEditParamsSchema>;

export const suggestEditResultSchema = z.looseObject({
	path: z.string(),
	ids: z.array(z.string()),
});
export type SuggestEditResult = z.infer<typeof suggestEditResultSchema>;

export const requestSchema = z.looseObject({
	type: z.literal("request"),
	id: z.union([z.string(), z.number()]),
	method: z.string(),
	params: z.unknown().optional(),
});
export type Request = z.infer<typeof requestSchema>;

export const responseSchema = z.union([
	z.looseObject({
		type: z.literal("response"),
		id: z.union([z.string(), z.number()]),
		ok: z.literal(true),
		result: z.unknown(),
	}),
	z.looseObject({
		type: z.literal("response"),
		id: z.union([z.string(), z.number()]),
		ok: z.literal(false),
		error: toolErrorSchema,
	}),
]);
export type Response = z.infer<typeof responseSchema>;

export const paramsSchemas = {
	get_context: getContextParamsSchema,
	read_note: readNoteParamsSchema,
	suggest_edit: suggestEditParamsSchema,
} as const;

export const resultSchemas = {
	get_context: getContextResultSchema,
	read_note: readNoteResultSchema,
	suggest_edit: suggestEditResultSchema,
} as const;

export function isMethod(method: unknown): method is Method {
	return (METHODS as readonly unknown[]).includes(method);
}

export type Message =
	| Hello
	| Welcome
	| ErrorMessage
	| EventMessage
	| Request
	| Response;

const messageSchemas = {
	hello: helloSchema,
	welcome: welcomeSchema,
	error: errorMessageSchema,
	event: eventMessageSchema,
	request: requestSchema,
	response: responseSchema,
} as const;

/**
 * Parse an incoming message (JSON text or object). Returns null for invalid
 * input and for unknown `type` values. Never throws.
 */
export function parseMessage(input: unknown): Message | null {
	let value = input;
	if (typeof input === "string") {
		try {
			value = JSON.parse(input);
		} catch {
			return null;
		}
	}
	if (typeof value !== "object" || value === null) return null;
	const type = (value as { type?: unknown }).type;
	if (typeof type !== "string" || !Object.hasOwn(messageSchemas, type)) {
		return null;
	}
	const parsed =
		messageSchemas[type as keyof typeof messageSchemas].safeParse(value);
	return parsed.success ? (parsed.data as Message) : null;
}
