// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endpointPath } from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { deleteEndpoint, writeEndpoint } from "./hub/endpoint";
import { type Hub, startHub } from "./hub/server";

const TOKEN = "a1".repeat(32);
let vault = "";
let hub: Hub | null = null;
const sockets: WebSocket[] = [];
let calls = 0;

beforeEach(async () => {
	vault = await mkdtemp(join(tmpdir(), "coedit-vh-"));
	calls = 0;
});
afterEach(async () => {
	for (const s of sockets.splice(0)) s.terminate();
	await hub?.close();
	hub = null;
	await rm(vault, { recursive: true, force: true });
});

async function start(helloTimeoutMs = 5000): Promise<Hub> {
	hub = await startHub({
		token: TOKEN,
		helloTimeoutMs,
		handlers: {
			get_context: async () => {
				calls++;
				return { activeNote: null, selection: null, openMarks: null };
			},
			suggest_edit: async () => {
				calls++;
				return { path: "essay.md", ids: [] };
			},
		},
	});
	return hub;
}

interface Client {
	ws: WebSocket;
	messages: Record<string, unknown>[];
	next(): Promise<Record<string, unknown>>;
	closed: Promise<void>;
}

function connect(port: number): Promise<Client> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		sockets.push(ws);
		const messages: Record<string, unknown>[] = [];
		const waiting: ((m: Record<string, unknown>) => void)[] = [];
		ws.on("message", (d) => {
			const m = JSON.parse(d.toString());
			const w = waiting.shift();
			if (w) w(m);
			else messages.push(m);
		});
		const closed = new Promise<void>((r) => ws.on("close", () => r()));
		ws.once("error", reject);
		ws.once("open", () =>
			resolve({
				ws,
				messages,
				closed,
				next: () =>
					new Promise((r) => {
						const m = messages.shift();
						if (m) r(m);
						else waiting.push(r);
					}),
			}),
		);
	});
}

const hello = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		type: "hello",
		protocol: 1,
		token: TOKEN,
		agent: "claude",
		session: "s1",
		...extra,
	});

/** Status of the answer to a connection request: 0 = accepted, else refused. */
const handshake = (port: number, headers: Record<string, string>) =>
	new Promise<number | undefined>((resolve) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
		sockets.push(ws);
		ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
		ws.on("error", () => resolve(undefined));
		ws.on("open", () => resolve(0));
	});

const endpoint = (token: string, port: number) => ({
	vault,
	machine: "work-mac",
	port,
	token,
	pid: process.pid,
});

describe("The hub publishes its endpoint", () => {
	test.todo("Endpoint after load: e2e in packages/e2e/tests/hub.e2e.ts");
	test.todo("New token after a restart: e2e in packages/e2e/tests/hub.e2e.ts");
});

describe("The endpoint file is safe", () => {
	test.skipIf(process.platform === "win32")("File mode", async () => {
		await writeEndpoint(endpoint(TOKEN, 4000));
		const s = await stat(endpointPath(vault, "work-mac"));
		expect(s.mode & 0o777).toBe(0o600);
	});
});

describe("The hub removes its endpoint on unload", () => {
	test.todo("Plugin is switched off: e2e in packages/e2e/tests/hub.e2e.ts");

	test("File of another hub", async () => {
		await writeEndpoint(endpoint("other-token", 4001));
		const before = await readFile(endpointPath(vault, "work-mac"), "utf8");
		await deleteEndpoint({ vault, machine: "work-mac", token: TOKEN });
		expect(await readFile(endpointPath(vault, "work-mac"), "utf8")).toBe(
			before,
		);
	});
});

describe("Only clients with the token are served", () => {
	test("Wrong token", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(hello({ token: "0000" }));
		await c.closed;
		expect(c.messages).toEqual([]);
		expect(calls).toBe(0);
	});

	test("Request before hello", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(
			JSON.stringify({
				type: "request",
				id: 1,
				method: "suggest_edit",
				params: { path: "essay.md", find: "a", replace: "b" },
			}),
		);
		await c.closed;
		expect(c.messages).toEqual([]);
		expect(calls).toBe(0);
	});

	test("No hello", async () => {
		const { port } = await start(100);
		const c = await connect(port);
		await c.closed;
		expect(c.messages).toEqual([]);
	});

	test("Correct token", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(hello());
		expect((await c.next()).type).toBe("welcome");
		c.ws.send(
			JSON.stringify({ type: "request", id: 1, method: "get_context" }),
		);
		expect(await c.next()).toMatchObject({
			type: "response",
			id: 1,
			ok: true,
		});
	});
});

describe("The hub checks the protocol version", () => {
	test("Matching version", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(hello());
		expect(await c.next()).toMatchObject({
			type: "welcome",
			protocol: 1,
			features: expect.any(Array),
		});
	});

	test("Other version", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(hello({ protocol: 2 }));
		expect(await c.next()).toMatchObject({
			type: "error",
			code: "protocol_mismatch",
		});
		await c.closed;
	});
});

describe("Browser and foreign requests are refused", () => {
	test("Web page connects", async () => {
		const { port } = await start();
		const status = await handshake(port, { Origin: "https://example.com" });
		expect(status).not.toBe(0);
	});

	test("DNS rebinding", async () => {
		const { port } = await start();
		const status = await handshake(port, { Host: `evil.example:${port}` });
		expect(status).not.toBe(0);
	});

	test("Local client without a browser origin", async () => {
		const { port } = await start();
		expect(await handshake(port, {})).toBe(0);
	});
});

describe("The hub listens on the loopback interface only", () => {
	test("TCP connection to 127.0.0.1 succeeds", async () => {
		const { port } = await start();
		await new Promise<void>((resolve, reject) => {
			const socket = createConnection({ host: "127.0.0.1", port }, () => {
				socket.end();
				resolve();
			});
			socket.once("error", reject);
		});
	});
});

describe("Suggestions in an open note go through its editor", () => {
	test.todo(
		"Suggest into the open note: e2e in packages/e2e/tests/suggest.e2e.ts",
	);
	test.todo(
		"Undo removes the suggestion: e2e in packages/e2e/tests/suggest.e2e.ts",
	);
	test.todo(
		"Typing right after a suggestion: e2e in packages/e2e/tests/suggest.e2e.ts",
	);
});

describe("Suggestions in a closed note change the file in one step", () => {
	test.todo(
		"Suggest into a closed note: e2e in packages/e2e/tests/suggest.e2e.ts",
	);
});

describe("Notice for suggestions in another note", () => {
	test.todo(
		"Suggestion in a background note: e2e in packages/e2e/tests/suggest.e2e.ts",
	);
	test.todo(
		"Suggestion in the active note: e2e in packages/e2e/tests/suggest.e2e.ts",
	);
});

describe("Agent marks name the agent and the day", () => {
	test.todo("Author and date: e2e in packages/e2e/tests/suggest.e2e.ts");
});
