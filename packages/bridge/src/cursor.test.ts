import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { cursorsDir } from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	advanceCursor,
	cursorFileName,
	ensureCursor,
	pruneCursors,
	readCursor,
	resolveCursor,
} from "./cursor";
import { MACHINE, tempVault } from "./testkit";

let vault: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
	({ vault, cleanup } = await tempVault());
});
afterEach(() => cleanup());

const log = { logId: "log-1", lastSeq: 41 };

describe("ensureCursor", () => {
	it("creates a cursor at the end of the log, and keeps an existing one", async () => {
		expect(await ensureCursor(vault, MACHINE, "s1", log)).toEqual({
			logId: "log-1",
			seq: 41,
		});
		await advanceCursor(vault, MACHINE, "s1", { logId: "log-1", seq: 45 });
		expect(await ensureCursor(vault, MACHINE, "s1", log)).toEqual({
			logId: "log-1",
			seq: 45,
		});
	});

	it("gives each session its own file", async () => {
		await ensureCursor(vault, MACHINE, "a", log);
		await ensureCursor(vault, MACHINE, "b", log);
		await advanceCursor(vault, MACHINE, "a", { logId: "log-1", seq: 50 });
		expect((await readCursor(vault, MACHINE, "b"))?.seq).toBe(41);
	});

	it("replaces a corrupt file", async () => {
		const dir = cursorsDir(vault, MACHINE);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "s1.json"), "garbage");
		expect(await ensureCursor(vault, MACHINE, "s1", log)).toEqual({
			logId: "log-1",
			seq: 41,
		});
		expect((await readCursor(vault, MACHINE, "s1"))?.seq).toBe(41);
	});

	it("starts at logId '' and seq 0 when no log exists", async () => {
		expect(
			await ensureCursor(vault, MACHINE, "s1", { logId: null, lastSeq: 0 }),
		).toEqual({ logId: "", seq: 0 });
	});
});

describe("advanceCursor", () => {
	it("never moves back under two writers", async () => {
		await ensureCursor(vault, MACHINE, "s1", log);
		await Promise.all([
			advanceCursor(vault, MACHINE, "s1", { logId: "log-1", seq: 60 }),
			advanceCursor(vault, MACHINE, "s1", { logId: "log-1", seq: 50 }),
			advanceCursor(vault, MACHINE, "s1", { logId: "log-1", seq: 55 }),
		]);
		expect((await readCursor(vault, MACHINE, "s1"))?.seq).toBe(60);
		await advanceCursor(vault, MACHINE, "s1", { logId: "log-1", seq: 10 });
		expect((await readCursor(vault, MACHINE, "s1"))?.seq).toBe(60);
	});

	it("lets a new log id win, and leaves no temp files", async () => {
		await ensureCursor(vault, MACHINE, "s1", log);
		await advanceCursor(vault, MACHINE, "s1", { logId: "log-2", seq: 3 });
		expect(await readCursor(vault, MACHINE, "s1")).toEqual({
			logId: "log-2",
			seq: 3,
		});
		expect(await readdir(cursorsDir(vault, MACHINE))).toEqual(["s1.json"]);
	});

	it("moves back with reset (restored log)", async () => {
		await ensureCursor(vault, MACHINE, "s1", log);
		await advanceCursor(
			vault,
			MACHINE,
			"s1",
			{ logId: "log-1", seq: 30 },
			{ reset: true },
		);
		expect((await readCursor(vault, MACHINE, "s1"))?.seq).toBe(30);
	});
});

describe("resolveCursor", () => {
	it("keeps a normal cursor", () => {
		expect(resolveCursor({ logId: "log-1", seq: 10 }, log)).toEqual({
			afterSeq: 10,
		});
	});
	it("reads a new log from the start (log deleted)", () => {
		const r = resolveCursor({ logId: "old", seq: 41 }, log);
		expect(r.afterSeq).toBe(0);
		expect(r.reset).toBeTruthy();
	});
	it("moves to the end of a restored log with a smaller last seq", () => {
		const r = resolveCursor(
			{ logId: "log-1", seq: 41 },
			{ logId: "log-1", lastSeq: 30 },
		);
		expect(r.afterSeq).toBe(30);
		expect(r.reset).toBeTruthy();
	});
	it("is quiet for a cursor made before any log existed", () => {
		expect(resolveCursor({ logId: "", seq: 0 }, log)).toEqual({ afterSeq: 0 });
	});
});

describe("session ids as file names", () => {
	it("uses safe ids as they are and hashes the others", async () => {
		expect(cursorFileName("run-1_A")).toBe("run-1_A.json");
		for (const id of ["a/b", "..", "sessión-é", "a b", ""]) {
			const hash = createHash("sha256").update(id).digest("hex");
			expect(cursorFileName(id)).toBe(`${hash}.json`);
			await ensureCursor(vault, MACHINE, id, log);
		}
		const names = await readdir(cursorsDir(vault, MACHINE));
		expect(names).toHaveLength(5);
		expect(names.every((n) => /^[0-9a-f]{64}\.json$/.test(n))).toBe(true);
		expect(
			JSON.parse(
				await readFile(
					path.join(cursorsDir(vault, MACHINE), names[0] ?? ""),
					"utf8",
				),
			),
		).toEqual({ logId: "log-1", seq: 41 });
	});
});

describe("pruneCursors", () => {
	it("deletes cursors older than 30 days", async () => {
		await ensureCursor(vault, MACHINE, "old-1", log);
		await ensureCursor(vault, MACHINE, "new-1", log);
		const old = new Date(Date.now() - 31 * 86_400_000);
		await utimes(path.join(cursorsDir(vault, MACHINE), "old-1.json"), old, old);
		expect(await pruneCursors(vault, MACHINE)).toEqual(["old-1.json"]);
		expect(await readdir(cursorsDir(vault, MACHINE))).toEqual(["new-1.json"]);
	});
	it("does nothing without a folder", async () => {
		expect(await pruneCursors(vault, MACHINE)).toEqual([]);
	});
});
