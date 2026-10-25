import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import {
	type DecisionEvent,
	decisionEventWriteSchema,
	EVENT_VERSION,
	eventsPath,
	logDir,
	logIdPath,
	parseEvent,
	type RenameEvent,
	renameEventWriteSchema,
	type SuggestionEvent,
	suggestionEventWriteSchema,
} from "@md-coeditor/protocol";
import { ensureLocalGitignore } from "../hub/endpoint";

type WithoutEnvelope<T> = Omit<T, "v" | "seq" | "ts">;
/** An event as the caller gives it: no `v`, `seq` or `ts`. */
export type NewEvent =
	| WithoutEnvelope<SuggestionEvent>
	| WithoutEnvelope<DecisionEvent>
	| WithoutEnvelope<RenameEvent>;
export type WrittenEvent = NewEvent & { v: 1; seq: number; ts: string };

export interface LogWriter {
	append(event: NewEvent): Promise<WrittenEvent>;
}

export interface LogWriterOptions {
	vault: string;
	machine: string;
	now?: () => Date;
	randomId?: () => string;
}

const schemas = {
	suggestion: suggestionEventWriteSchema,
	decision: decisionEventWriteSchema,
	rename: renameEventWriteSchema,
} as const;

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** ISO 8601 local time with a time zone offset, e.g. 2026-10-25T12:00:00.000+02:00. */
export function isoWithOffset(d: Date): string {
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	const abs = Math.abs(off);
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

const exists = (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

/** The highest valid `seq`, from the last valid line. */
function lastSeq(text: string): number {
	const lines = text.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i] as string;
		if (line.trim() === "") continue;
		const event = parseEvent(line);
		if (event) return event.seq;
	}
	return 0;
}

/**
 * The only writer of `events.jsonl` (D6, D20). One serial queue; `seq` rises
 * by 1; a torn last line gets a `\n` first; a deleted log starts again at 1
 * with a new log-id.
 */
export function createLogWriter(options: LogWriterOptions): LogWriter {
	const { vault, machine } = options;
	const now = options.now ?? (() => new Date());
	const randomId = options.randomId ?? (() => randomBytes(16).toString("hex"));
	const file = eventsPath(vault, machine);
	let seq: number | null = null;
	let known: { size: number; mtimeMs: number } | null = null;
	let queue: Promise<unknown> = Promise.resolve();

	async function prepare(): Promise<void> {
		const st = await stat(file).catch(() => null);
		// Trust the cached seq only while the file is as our last append left it.
		if (
			seq !== null &&
			st &&
			known &&
			st.size === known.size &&
			st.mtimeMs === known.mtimeMs
		)
			return;
		await mkdir(logDir(vault, machine), { recursive: true });
		await ensureLocalGitignore(vault);
		if (!st) {
			// New log (first run, or deleted while running).
			seq = 0;
			await writeFile(logIdPath(vault, machine), randomId());
			return;
		}
		const text = await readFile(file, "utf8");
		seq = lastSeq(text);
		if (text !== "" && !text.endsWith("\n")) await appendFile(file, "\n");
		if (!(await exists(logIdPath(vault, machine))))
			await writeFile(logIdPath(vault, machine), randomId());
	}

	async function write(event: NewEvent): Promise<WrittenEvent> {
		await prepare();
		const next = (seq as number) + 1;
		const full = {
			v: EVENT_VERSION,
			seq: next,
			ts: isoWithOffset(now()),
			...event,
		};
		const type = event.type as string;
		if (!Object.hasOwn(schemas, type))
			throw new Error(`unknown event type: ${type}`);
		const schema = schemas[type as keyof typeof schemas];
		schema.parse(full);
		await appendFile(file, `${JSON.stringify(full)}\n`);
		seq = next;
		const after = await stat(file).catch(() => null);
		known = after ? { size: after.size, mtimeMs: after.mtimeMs } : null;
		return full as WrittenEvent;
	}

	return {
		append(event) {
			const result = queue.then(() => write(event));
			queue = result.catch(() => undefined);
			return result;
		},
	};
}
