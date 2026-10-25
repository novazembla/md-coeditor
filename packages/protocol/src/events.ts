import { z } from "zod";

export const EVENT_VERSION = 1;

const envelopeShape = {
	v: z.literal(EVENT_VERSION),
	seq: z.number().int().nonnegative(),
	ts: z.string(),
	type: z.string(),
	path: z.string(),
	actor: z.enum(["user", "agent"]),
	agent: z.string().optional(),
	session: z.string().optional(),
};

export const eventEnvelopeSchema = z.looseObject(envelopeShape);
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

const suggestionShape = {
	ids: z.array(z.string()),
	find: z.string(),
	replace: z.string(),
	before: z.string().optional(),
	after: z.string().optional(),
};
const decisionShape = {
	id: z.string(),
	decision: z.enum(["accepted", "rejected"]),
	content: z.string(),
	author: z.string().optional(),
};
const renameShape = { from: z.string() };

/** Reader schemas: loose objects, `kind` is any string. */
export const suggestionEventSchema = z.looseObject({
	...envelopeShape,
	type: z.literal("suggestion"),
	...suggestionShape,
});
export const decisionEventSchema = z.looseObject({
	...envelopeShape,
	type: z.literal("decision"),
	kind: z.string(),
	...decisionShape,
});
export const renameEventSchema = z.looseObject({
	...envelopeShape,
	type: z.literal("rename"),
	...renameShape,
});

/** Writer schemas: strict objects, `kind` is closed. */
export const suggestionEventWriteSchema = z.strictObject({
	...envelopeShape,
	type: z.literal("suggestion"),
	...suggestionShape,
});
export const decisionEventWriteSchema = z.strictObject({
	...envelopeShape,
	type: z.literal("decision"),
	kind: z.enum(["insertion", "deletion"]),
	...decisionShape,
});
export const renameEventWriteSchema = z.strictObject({
	...envelopeShape,
	type: z.literal("rename"),
	...renameShape,
});

export type SuggestionEvent = z.infer<typeof suggestionEventSchema>;
export type DecisionEvent = z.infer<typeof decisionEventSchema>;
export type RenameEvent = z.infer<typeof renameEventSchema>;
export type KnownEvent = SuggestionEvent | DecisionEvent | RenameEvent;
/** A valid envelope with a type this reader does not know. */
export type UnknownEvent = EventEnvelope & { unknown: true };
export type ParsedEvent = KnownEvent | UnknownEvent;

const eventSchemas = {
	suggestion: suggestionEventSchema,
	decision: decisionEventSchema,
	rename: renameEventSchema,
} as const;

/**
 * Parse one log line (JSON text) or an object. Returns the known event,
 * the envelope with `unknown: true` for an unknown type, or null if invalid.
 * Never throws.
 */
export function parseEvent(input: unknown): ParsedEvent | null {
	let value = input;
	if (typeof input === "string") {
		try {
			value = JSON.parse(input);
		} catch {
			return null;
		}
	}
	const envelope = eventEnvelopeSchema.safeParse(value);
	if (!envelope.success) return null;
	const type = envelope.data.type;
	if (!Object.hasOwn(eventSchemas, type)) {
		return { ...envelope.data, unknown: true };
	}
	const parsed =
		eventSchemas[type as keyof typeof eventSchemas].safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function isKnownEvent(event: ParsedEvent): event is KnownEvent {
	return !("unknown" in event && event.unknown === true);
}
