import { readFile } from "node:fs/promises";
import {
	type DecisionEvent,
	eventsPath,
	isKnownEvent,
	type KnownEvent,
	logIdPath,
	parseEvent,
	type RenameEvent,
	type SuggestionEvent,
} from "@md-coeditor/protocol";

export type LogRead = {
	logId: string | null;
	events: KnownEvent[];
	/** Highest valid seq of any event, also of unknown types. 0 when none. */
	lastSeq: number;
	warnings: string[];
};

async function readText(file: string): Promise<string | null> {
	try {
		return await readFile(file, "utf8");
	} catch {
		return null;
	}
}

/** Read the machine's log. Never throws; a missing log is empty. */
export async function readLog(
	vault: string,
	machine: string,
): Promise<LogRead> {
	const idText = await readText(logIdPath(vault, machine));
	const logId = idText === null || idText.trim() === "" ? null : idText.trim();
	const text = await readText(eventsPath(vault, machine));
	const events: KnownEvent[] = [];
	const warnings: string[] = [];
	let lastSeq = 0;
	let broken = 0;
	for (const raw of (text ?? "").split("\n")) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (line.trim() === "") continue;
		const event = parseEvent(line);
		if (event === null) {
			broken++;
			continue;
		}
		if (event.seq > lastSeq) lastSeq = event.seq;
		if (isKnownEvent(event)) events.push(event);
	}
	if (broken > 0) {
		warnings.push(
			`events.jsonl: skipped ${broken} broken line${broken === 1 ? "" : "s"}`,
		);
	}
	return { logId, events, lastSeq, warnings };
}

/** Key of a mark: current note path and id. */
export function markKey(path: string, id: string): string {
	return JSON.stringify([path, id]);
}

/**
 * Path of a note as it is after the whole log: every later rename event
 * (after `afterIndex` in log order) that moves the path is followed.
 */
export function currentPath(
	events: readonly KnownEvent[],
	path: string,
	afterIndex: number,
): string {
	let current = path;
	for (let i = afterIndex + 1; i < events.length; i++) {
		const e = events[i] as KnownEvent;
		if (e.type === "rename" && e.from === current) current = e.path;
	}
	return current;
}

export type MarkHistory = { path: string; id: string; events: KnownEvent[] };

/**
 * Events of each mark in log order, keyed by `markKey(currentPath, id)`.
 * Suggestion events count for every id in `ids`; decision events for `id`.
 * The events are the logged events, unchanged; only `path` of the entry
 * is the current path.
 */
export function markHistory(
	events: readonly KnownEvent[],
): Map<string, MarkHistory> {
	const out = new Map<string, MarkHistory>();
	// Walk backwards so each rename is known when its earlier events come.
	// renames[from] chain is resolved with a running map: current[path].
	const moved = new Map<string, string>();
	const mapped: { event: KnownEvent; path: string }[] = new Array(
		events.length,
	);
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i] as KnownEvent;
		if (e.type === "rename") {
			// Events before this rename that used `from` now belong to `e.path`
			// (itself moved later, if so).
			moved.set(e.from, moved.get(e.path) ?? e.path);
			mapped[i] = { event: e, path: e.path };
		} else {
			mapped[i] = { event: e, path: moved.get(e.path) ?? e.path };
		}
	}
	for (const { event, path } of mapped) {
		let ids: string[];
		if (event.type === "suggestion") ids = event.ids;
		else if (event.type === "decision") ids = [event.id];
		else continue;
		for (const id of new Set(ids)) {
			const key = markKey(path, id);
			let entry = out.get(key);
			if (entry === undefined) {
				entry = { path, id, events: [] };
				out.set(key, entry);
			}
			entry.events.push(event);
		}
	}
	return out;
}

export type MarkDetail =
	| {
			ok: true;
			path: string;
			id: string;
			events: KnownEvent[];
			current: "accepted" | "rejected" | "pending";
	  }
	| {
			ok: false;
			code: "unknown_id" | "ambiguous_id";
			message: string;
			details?: { paths: string[] };
	  };

/** Data for `get_detail(id, path?)`. `path` is the current path. */
export function markDetail(
	events: readonly KnownEvent[],
	id: string,
	path?: string,
): MarkDetail {
	const found = [...markHistory(events).values()].filter(
		(m) => m.id === id && (path === undefined || m.path === path),
	);
	if (found.length === 0) {
		return {
			ok: false,
			code: "unknown_id",
			message:
				path === undefined
					? `The log has no mark with id ${id}.`
					: `The log has no mark with id ${id} in ${path}.`,
		};
	}
	if (found.length > 1) {
		const paths = found.map((m) => m.path).sort();
		return {
			ok: false,
			code: "ambiguous_id",
			message: `The id ${id} is in more than one note. Give the path.`,
			details: { paths },
		};
	}
	const mark = found[0] as MarkHistory;
	let current: "accepted" | "rejected" | "pending" = "pending";
	for (const e of mark.events) {
		if (e.type === "decision") current = e.decision;
	}
	return { ok: true, path: mark.path, id, events: mark.events, current };
}

export type { DecisionEvent, RenameEvent, SuggestionEvent };
