import { createHash, randomBytes } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { cursorsDir } from "@md-coeditor/protocol";
import type { LogRead } from "./log-read";

export type Cursor = { logId: string; seq: number };

/** File name (without folder) of a session's cursor. */
export function cursorFileName(session: string): string {
	const name = /^[A-Za-z0-9_-]+$/.test(session)
		? session
		: createHash("sha256").update(session).digest("hex");
	return `${name}.json`;
}

export function cursorPath(
	vault: string,
	machine: string,
	session: string,
): string {
	return path.join(cursorsDir(vault, machine), cursorFileName(session));
}

export async function readCursor(
	vault: string,
	machine: string,
	session: string,
): Promise<Cursor | null> {
	try {
		const value: unknown = JSON.parse(
			await readFile(cursorPath(vault, machine, session), "utf8"),
		);
		if (typeof value !== "object" || value === null) return null;
		const { logId, seq } = value as Record<string, unknown>;
		if (
			typeof logId !== "string" ||
			typeof seq !== "number" ||
			!Number.isInteger(seq) ||
			seq < 0
		) {
			return null;
		}
		return { logId, seq };
	} catch {
		return null;
	}
}

const queues = new Map<string, Promise<void>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function writeAtomic(
	file: string,
	compute: () => Promise<Cursor>,
): Promise<void> {
	const tmp = path.join(
		path.dirname(file),
		`.${path.basename(file)}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`,
	);
	let cursor = await compute();
	await writeFile(tmp, `${JSON.stringify(cursor)}\n`, "utf8");
	try {
		// Read the file again right before the rename.
		const again = await compute();
		if (again.seq !== cursor.seq || again.logId !== cursor.logId) {
			cursor = again;
			await writeFile(tmp, `${JSON.stringify(cursor)}\n`, "utf8");
		}
		for (let attempt = 0; ; attempt++) {
			try {
				await rename(tmp, file);
				return;
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				if ((code === "EPERM" || code === "EBUSY") && attempt < 5) {
					await sleep(20 * (attempt + 1));
					continue;
				}
				throw err;
			}
		}
	} catch (err) {
		await unlink(tmp).catch(() => {});
		throw err;
	}
}

/**
 * The session's cursor. When missing, create it with flag `wx` at the end of
 * the log (a log that does not exist yet has logId "" and seq 0).
 */
export async function ensureCursor(
	vault: string,
	machine: string,
	session: string,
	log: Pick<LogRead, "logId" | "lastSeq">,
): Promise<Cursor> {
	const existing = await readCursor(vault, machine, session);
	if (existing !== null) return existing;
	const file = cursorPath(vault, machine, session);
	await mkdir(path.dirname(file), { recursive: true });
	const cursor: Cursor =
		log.logId === null
			? { logId: "", seq: 0 }
			: { logId: log.logId, seq: log.lastSeq };
	try {
		await writeFile(file, `${JSON.stringify(cursor)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
		return cursor;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
		const other = await readCursor(vault, machine, session);
		if (other !== null) return other;
		// A corrupt file: replace it.
		await writeAtomic(file, async () => cursor);
		return cursor;
	}
}

export type ResolvedCursor = { afterSeq: number; reset?: string };

/** The two log-reset rules of D11. */
export function resolveCursor(
	cursor: Cursor,
	log: Pick<LogRead, "logId" | "lastSeq">,
): ResolvedCursor {
	if (log.logId === null) return { afterSeq: cursor.seq };
	if (cursor.logId !== log.logId) {
		// "" means the cursor was made before any log existed: nothing to report.
		return cursor.logId === ""
			? { afterSeq: 0 }
			: {
					afterSeq: 0,
					reset:
						"coedit: the log was replaced by a new one; reading it from the start.",
				};
	}
	if (cursor.seq > log.lastSeq) {
		return {
			afterSeq: log.lastSeq,
			reset: `coedit: the log is older than the cursor (seq ${cursor.seq} > ${log.lastSeq}); moving the cursor to the end of the log.`,
		};
	}
	return { afterSeq: cursor.seq };
}

/**
 * Move the cursor on. Reads the file again right before the rename and never
 * moves back when the log id is the same. A different log id wins. With
 * `reset`, the given seq is written as it is (a restored log).
 */
export async function advanceCursor(
	vault: string,
	machine: string,
	session: string,
	next: Cursor,
	options: { reset?: boolean } = {},
): Promise<Cursor> {
	const file = cursorPath(vault, machine, session);
	await mkdir(path.dirname(file), { recursive: true });
	let result = next;
	const advance = () =>
		writeAtomic(file, async () => {
			const current = await readCursor(vault, machine, session);
			result =
				!options.reset && current !== null && current.logId === next.logId
					? { logId: next.logId, seq: Math.max(current.seq, next.seq) }
					: next;
			return result;
		});
	// One write at a time for one file inside this process.
	const run = (queues.get(file) ?? Promise.resolve())
		.catch(() => {})
		.then(advance);
	queues.set(file, run);
	try {
		await run;
	} finally {
		if (queues.get(file) === run) queues.delete(file);
	}
	return result;
}

/** Delete cursor files that were not written for `maxAgeDays` days. */
export async function pruneCursors(
	vault: string,
	machine: string,
	maxAgeDays = 30,
	now: number = Date.now(),
): Promise<string[]> {
	const dir = cursorsDir(vault, machine);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const removed: string[] = [];
	const limit = now - maxAgeDays * 86_400_000;
	for (const name of names) {
		const file = path.join(dir, name);
		try {
			const info = await stat(file);
			if (info.isFile() && info.mtimeMs < limit) {
				await unlink(file);
				removed.push(name);
			}
		} catch {
			// gone or busy: skip
		}
	}
	return removed;
}
