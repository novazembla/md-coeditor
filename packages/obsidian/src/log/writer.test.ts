// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventsPath, logDir, logIdPath } from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createLogWriter, type NewEvent } from "./writer";

let vault: string;
beforeEach(async () => {
	vault = await mkdtemp(join(tmpdir(), "coedit-log-"));
});
afterEach(async () => {
	await rm(vault, { recursive: true, force: true });
});

const M = "work-mac";
const ev = (id = "a1"): NewEvent => ({
	type: "decision",
	path: "essay.md",
	actor: "user",
	id,
	kind: "insertion",
	decision: "accepted",
	content: "x",
});
const lines = async (): Promise<string[]> =>
	(await readFile(eventsPath(vault, M), "utf8")).split("\n").filter(Boolean);
const writer = () => createLogWriter({ vault, machine: M });

describe("log writer", () => {
	test("writes local/.gitignore when it creates the log folder", async () => {
		await writer().append(ev());
		expect(
			await readFile(join(vault, ".coedit/local/.gitignore"), "utf8"),
		).toBe("*\n");
	});

	test("repairs a log replaced from outside between two appends", async () => {
		const w = writer();
		for (let i = 0; i < 3; i++) await w.append(ev());
		const good = (await lines()).slice(0, 1);
		// Replace with a log that ends at seq 1 plus a torn line.
		await writeFile(eventsPath(vault, M), `${good[0]}\n{"v":1,"seq":2,"ty`);
		const out = await w.append(ev());
		expect(out.seq).toBe(2);
		const all = await lines();
		expect(all).toHaveLength(3);
		expect(JSON.parse(all[2] as string).seq).toBe(2);
	});

	test("first event has seq 1, an offset time and a log-id", async () => {
		const out = await writer().append(ev());
		expect(out.seq).toBe(1);
		expect(out.v).toBe(1);
		expect(out.ts).toMatch(/T.*[+-]\d\d:\d\d$/);
		expect(await readFile(logIdPath(vault, M), "utf8")).toMatch(
			/^[0-9a-f]{32}$/,
		);
		expect(await lines()).toHaveLength(1);
	});

	test("restart after 41 events continues at 42", async () => {
		const w = writer();
		for (let i = 0; i < 41; i++) await w.append(ev());
		expect((await writer().append(ev())).seq).toBe(42);
	});

	test("torn last line is followed by a valid event on its own line", async () => {
		const w = writer();
		for (let i = 0; i < 41; i++) await w.append(ev());
		const file = eventsPath(vault, M);
		await writeFile(file, `${await readFile(file, "utf8")}{"v":1,"seq":4`);
		const out = await writer().append(ev());
		expect(out.seq).toBe(42);
		const all = await lines();
		expect(all).toHaveLength(43);
		expect(JSON.parse(all[42] as string).seq).toBe(42);
	});

	test("20 parallel appends keep their order", async () => {
		const w = writer();
		await Promise.all(
			Array.from({ length: 20 }, (_, i) => w.append(ev(`i${i}`))),
		);
		const all = (await lines()).map((l) => JSON.parse(l));
		expect(all.map((e) => e.seq)).toEqual(
			Array.from({ length: 20 }, (_, i) => i + 1),
		);
		expect(all.map((e) => e.id)).toEqual(
			Array.from({ length: 20 }, (_, i) => `i${i}`),
		);
	});

	test("a new log-id and seq 1 after the folder is deleted", async () => {
		const w = writer();
		await w.append(ev());
		await w.append(ev());
		const first = await readFile(logIdPath(vault, M), "utf8");
		await rm(logDir(vault, M), { recursive: true });
		expect((await w.append(ev())).seq).toBe(1);
		expect(await readFile(logIdPath(vault, M), "utf8")).not.toBe(first);
	});

	test("an invalid event is refused and does not block the queue", async () => {
		const w = writer();
		await expect(
			w.append({ ...ev(), kind: "other" } as unknown as NewEvent),
		).rejects.toThrow();
		expect((await w.append(ev())).seq).toBe(1);
	});

	test("a log that cannot be written rejects", async () => {
		await mkdir(join(vault, ".coedit"));
		await writeFile(join(vault, ".coedit", "local"), "file, not folder");
		await expect(writer().append(ev())).rejects.toThrow();
	});
});
