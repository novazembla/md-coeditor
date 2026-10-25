import { parse } from "./parse";
import type { Change, DecideErrorCode, Mark, Result } from "./types";

export type Decision = "accept" | "reject";

/**
 * Accept or reject one insertion or deletion, found by id.
 * The full mark (with attributes) is replaced by its content or by nothing.
 */
export interface DecideInput {
	text: string;
	id: string;
	decision: Decision;
}

export type DecideResult = Result<
	{
		text: string;
		mark: Mark;
		decision: Decision;
		changes: Change[];
	},
	DecideErrorCode
>;

export function decide({ text, id, decision }: DecideInput): DecideResult {
	const found = parse(text).marks.filter((m) => m.id === id);
	const mark = found[0];
	if (!mark) {
		return {
			ok: false,
			code: "not_found",
			message: `No mark has the id "${id}".`,
		};
	}
	if (found.length > 1) {
		return {
			ok: false,
			code: "duplicate_id",
			message: `More than one mark has the id "${id}".`,
		};
	}
	if (mark.kind !== "insertion" && mark.kind !== "deletion") {
		return {
			ok: false,
			code: "unsupported_kind",
			message: `The mark "${id}" is a ${mark.kind}. Only insertions and deletions can be decided.`,
		};
	}
	const keep = (mark.kind === "insertion") === (decision === "accept");
	const inserted = keep ? mark.content : "";
	return {
		ok: true,
		text: text.slice(0, mark.start) + inserted + text.slice(mark.end),
		mark,
		decision,
		changes: [{ from: mark.start, to: mark.end, insert: inserted }],
	};
}
