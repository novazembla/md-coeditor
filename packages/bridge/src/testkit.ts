import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	eventsPath,
	type KnownEvent,
	logDir,
	logIdPath,
} from "@md-coeditor/protocol";

export const MACHINE = "mac";

export async function tempVault(): Promise<{
	vault: string;
	cleanup: () => Promise<void>;
}> {
	const vault = await mkdtemp(path.join(tmpdir(), "coedit-log-"));
	return { vault, cleanup: () => rm(vault, { recursive: true, force: true }) };
}

const base = { v: 1, ts: "2026-10-25T10:00:00Z", actor: "agent" } as const;

export const suggestion = (seq: number, p: string, id: string): KnownEvent =>
	({
		...base,
		seq,
		type: "suggestion",
		path: p,
		ids: [id],
		find: "a",
		replace: "b",
	}) as KnownEvent;

export const decision = (
	seq: number,
	p: string,
	id: string,
	dec: "accepted" | "rejected",
	content = "x",
	kind = "insertion",
): KnownEvent =>
	({
		...base,
		actor: "user",
		seq,
		type: "decision",
		path: p,
		id,
		kind,
		decision: dec,
		content,
	}) as KnownEvent;

export const renameEv = (seq: number, from: string, to: string): KnownEvent =>
	({
		...base,
		actor: "user",
		seq,
		type: "rename",
		path: to,
		from,
	}) as KnownEvent;

export async function writeLog(
	vault: string,
	lines: (KnownEvent | Record<string, unknown> | string)[],
	logId: string | null = "log-1",
): Promise<void> {
	await mkdir(logDir(vault, MACHINE), { recursive: true });
	await writeFile(
		eventsPath(vault, MACHINE),
		lines
			.map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
			.join("\n") + "\n",
	);
	if (logId !== null) await writeFile(logIdPath(vault, MACHINE), `${logId}\n`);
}
