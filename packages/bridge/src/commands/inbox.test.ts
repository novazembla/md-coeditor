import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { hostname } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { endpointPath, machineName } from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FakeHub, startFakeHub } from "../../test/fake-hub";
import { inbox } from "../../test/inbox-harness";
import { readCursor } from "../cursor";
import { decision, MACHINE, suggestion, tempVault, writeLog } from "../testkit";
import { readAll } from "./inbox";

let vault: string;
let cleanup: () => Promise<void>;
let hub: FakeHub | undefined;
let silent: Server | undefined;
const sockets = new Set<Socket>();
beforeEach(async () => {
	({ vault, cleanup } = await tempVault());
});
afterEach(async () => {
	await hub?.stop();
	for (const s of sockets) s.destroy();
	sockets.clear();
	await new Promise<void>((r) => (silent ? silent.close(() => r()) : r()));
	hub = undefined;
	silent = undefined;
	await cleanup();
});

const env = (extra: Record<string, string> = {}) => ({
	COEDIT_VAULT: vault,
	...extra,
});
const base = [suggestion(1, "essay.md", "i1bbbb")];
const withDecision = [
	...base,
	decision(2, "essay.md", "i1bbbb", "accepted", "slow"),
];
const hookJson = (id: string) =>
	JSON.stringify({ session_id: id, hook_event_name: "UserPromptSubmit" });

async function started(session: string, events = base): Promise<void> {
	await writeLog(vault, events);
	await inbox(["--digest", "--mark-read"], {
		env: env(),
		stdin: hookJson(session),
	});
}

describe("coedit inbox", () => {
	it("writes the hook JSON for hook input", async () => {
		await started("abc-123");
		await writeLog(vault, withDecision);
		const r = await inbox(["--digest", "--mark-read"], {
			env: env(),
			stdin: hookJson("abc-123"),
		});
		expect(r.code).toBe(0);
		expect(r.stdout.endsWith("\n")).toBe(true);
		const out = JSON.parse(r.stdout);
		expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(out.hookSpecificOutput.additionalContext).toContain(
			'- accepted insertion i1bbbb: "slow"',
		);
	});

	it("uses COEDIT_SESSION before session_id", async () => {
		await started("run-1");
		await writeLog(vault, withDecision);
		await inbox(["--digest", "--mark-read"], {
			env: env({ COEDIT_SESSION: "run-1" }),
			stdin: hookJson("abc-123"),
		});
		expect((await readCursor(vault, MACHINE, "run-1"))?.seq).toBe(2);
		expect(await readCursor(vault, MACHINE, "abc-123")).toBeNull();
	});

	it("uses --session before everything", async () => {
		await started("manual");
		await writeLog(vault, withDecision);
		const r = await inbox(["--digest", "--session", "manual"], {
			env: env({ COEDIT_SESSION: "run-1" }),
			stdin: hookJson("abc-123"),
		});
		expect(r.stdout).toContain("i1bbbb");
	});

	it("writes nothing when nothing is new", async () => {
		await started("s1");
		const r = await inbox(["--digest", "--mark-read"], {
			env: env(),
			stdin: hookJson("s1"),
		});
		expect(r).toMatchObject({ code: 0, stdout: "" });
	});

	it("looks without moving; plain text in a terminal", async () => {
		await started("s1");
		await writeLog(vault, withDecision);
		const a = await inbox(["--digest", "--session", "s1"], { env: env() });
		const b = await inbox(["--digest", "--session", "s1"], { env: env() });
		expect(a.stdout).not.toBe("");
		expect(a.stdout).toBe(b.stdout);
		expect(a.stdout.startsWith("MD-Coeditor: 1 new decision.")).toBe(true);
		expect((await readCursor(vault, MACHINE, "s1"))?.seq).toBe(1);
	});

	it("skips a broken log line and exits 0", async () => {
		await started("s1");
		await writeLog(vault, [...withDecision, '{"v":1,"seq":3,"ty']);
		const r = await inbox(["--digest", "--mark-read"], {
			env: env(),
			stdin: hookJson("s1"),
		});
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("i1bbbb");
		expect(r.stderr).toContain("broken");
	});

	it("adds the active note from the hub", async () => {
		await started("s1");
		await writeLog(vault, withDecision);
		hub = await startFakeHub({
			vault,
			machine: MACHINE,
			respond: () => ({
				ok: true,
				result: { activeNote: "essay.md", selection: null, openMarks: 0 },
			}),
		});
		const r = await inbox(["--digest"], { env: env(), stdin: hookJson("s1") });
		const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
		expect(text).toContain("Active note: essay.md");
	});

	it("finishes in under 3 s when the hub port answers nothing", async () => {
		await started("s1");
		await writeLog(vault, withDecision);
		silent = createServer((socket) => {
			sockets.add(socket);
			socket.on("error", () => {});
		});
		await new Promise<void>((r) => silent?.listen(0, "127.0.0.1", () => r()));
		const port = (silent.address() as { port: number }).port;
		const file = endpointPath(vault, MACHINE);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(
			file,
			JSON.stringify({ port, token: "t", pid: 1, host: MACHINE }),
		);
		const r = await inbox(["--digest"], { env: env(), stdin: hookJson("s1") });
		expect(r.code).toBe(0);
		expect(r.ms).toBeLessThan(3000);
		const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
		expect(text).not.toContain("Active note:");
	});

	it("exits 0 with a message when there is no session", async () => {
		await writeLog(vault, withDecision);
		const r = await inbox(["--digest"], { env: env(), stdin: "" });
		expect(r).toMatchObject({ code: 0, stdout: "" });
		expect(r.stderr).toContain("no session");
	});

	it("exits 0 when there is no vault, 2 for an unknown option", async () => {
		const r = await inbox(["--digest"], {
			env: { COEDIT_SESSION: "s1" },
			cwd: vault,
		});
		expect(r.code).toBe(0);
		expect(r.stdout).toBe("");
		expect((await inbox(["--frob"], { env: env() })).code).toBe(2);
	});

	it("a usage error exits 0 in hook mode and 2 in a terminal", async () => {
		const piped = await inbox(["--frob"], { env: env(), stdin: "{}" });
		expect(piped.code).toBe(0);
		expect(piped.stderr).toContain("Usage");
		expect((await inbox(["--mark-read"], { env: env() })).code).toBe(0);
		const noDigest = await inbox([], { env: env(), stdin: "{}" });
		expect(noDigest.code).toBe(0);
		expect(noDigest.stderr).toContain("--digest is needed");
		expect((await inbox([], { env: env() })).code).toBe(2);
	});

	it("readAll stops after the time limit and keeps what it read", async () => {
		const stream = new PassThrough();
		stream.write('{"a":1}');
		const t0 = Date.now();
		expect(await readAll(stream, 50)).toBe('{"a":1}');
		expect(Date.now() - t0).toBeLessThan(1000);
		const ended = new PassThrough();
		ended.end("abc");
		expect(await readAll(ended, 5000)).toBe("abc");
	});

	it("reads garbage on stdin as no input", async () => {
		await started("s1");
		await writeLog(vault, withDecision);
		const r = await inbox(["--digest", "--session", "s1"], {
			env: env(),
			stdin: "not json",
		});
		expect(r.stdout).toContain("MD-Coeditor");
		expect(r.stdout.startsWith("{")).toBe(false);
	});
});

const bundle = path.join(__dirname, "..", "..", "dist", "coedit.mjs");
const built = existsSync(bundle);
if (!built) {
	it("coedit inbox in the bundle (not built)", (ctx) =>
		ctx.skip(`${bundle} not found: run "pnpm build" first`));
}

describe.skipIf(!built)("coedit inbox in the bundle", () => {
	it("reads hook JSON from piped stdin and writes the hook output", async () => {
		await started("pipe-1");
		await writeLog(vault, withDecision);
		// The bundle uses the real host name for the machine folder.
		const local = path.join(vault, ".coedit", "local");
		await cp(
			path.join(local, MACHINE),
			path.join(local, machineName(hostname())),
			{
				recursive: true,
			},
		);
		const r = spawnSync(
			process.execPath,
			[bundle, "inbox", "--digest", "--mark-read"],
			{
				encoding: "utf8",
				input: hookJson("pipe-1"),
				env: { ...process.env, COEDIT_VAULT: vault, COEDIT_SESSION: "" },
				cwd: path.parse(vault).root,
			},
		);
		expect(r.status).toBe(0);
		const out = JSON.parse(r.stdout);
		expect(out.hookSpecificOutput.additionalContext).toContain("i1bbbb");
	});
});
