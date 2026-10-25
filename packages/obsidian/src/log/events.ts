import type { DecisionResult } from "../decide";
import type { NewEvent } from "./writer";

/** Event builders: pure, no I/O. */

export function decisionEvent(path: string, result: DecisionResult): NewEvent {
	const { mark, decision, id } = result;
	return {
		type: "decision",
		path,
		actor: "user",
		id,
		kind: mark.kind,
		decision: decision === "accept" ? "accepted" : "rejected",
		content: mark.content,
		...(mark.author === undefined ? {} : { author: mark.author }),
	};
}

export function renameEvent(path: string, from: string): NewEvent {
	return { type: "rename", path, actor: "user", from };
}

/**
 * Rename events for a renamed file or folder. A Markdown note gives one event.
 * A folder gives none: Obsidian fires its own `rename` event for each file
 * below a renamed folder, after the folder event (seen in task 10.3,
 * `packages/e2e/tests/log.e2e.ts` "Folder renamed").
 */
export function renameEvents(
	file: { path: string; kind: "file" | "folder" },
	oldPath: string,
): NewEvent[] {
	if (file.kind === "folder") return [];
	return file.path.toLowerCase().endsWith(".md")
		? [renameEvent(file.path, oldPath)]
		: [];
}
