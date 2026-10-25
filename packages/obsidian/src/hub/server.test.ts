// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { type Handler, type Hub, HubError, startHub } from "./server";

const TOKEN = "a".repeat(64);
let hub: Hub | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
	for (const s of sockets.splice(0)) s.terminate();
	await hub?.close();
	hub = null;
});

async function start(
	handlers: Record<string, Handler> = {},
	helloTimeoutMs = 5000,
) {
	hub = await startHub({ token: TOKEN, handlers, helloTimeoutMs });
	return hub;
}

interface Client {
	ws: WebSocket;
	messages: Record<string, unknown>[];
	next(): Promise<Record<string, unknown>>;
	closed: Promise<void>;
}

function connect(
	port: number,
	options: { headers?: Record<string, string> } = {},
): Promise<Client> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
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

async function login(port: number, session = "s1") {
	const c = await connect(port);
	c.ws.send(hello({ session }));
	expect((await c.next()).type).toBe("welcome");
	return c;
}

const rejected = (url: string, headers: Record<string, string>) =>
	new Promise<number | undefined>((resolve) => {
		const ws = new WebSocket(url, { headers });
		sockets.push(ws);
		ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
		ws.on("error", () => resolve(undefined));
		ws.on("open", () => resolve(0));
	});

describe("hub server", () => {
	it("answers hello with welcome and ignores unknown fields", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(hello({ extra: 1 }));
		const m = await c.next();
		expect(m).toMatchObject({ type: "welcome", protocol: 1, features: [] });
	});

	it("closes the connection for a message over 1 MiB", async () => {
		const { port } = await start();
		const c = await login(port);
		c.ws.send("x".repeat(1024 * 1024 + 1));
		await c.closed;
	});

	it("closes without an answer for a wrong token", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(hello({ token: "b".repeat(10) }));
		await c.closed;
		expect(c.messages).toEqual([]);
	});

	it("closes for a request before hello", async () => {
		const { port } = await start({ get_context: async () => ({}) });
		const c = await connect(port);
		c.ws.send(
			JSON.stringify({ type: "request", id: 1, method: "get_context" }),
		);
		await c.closed;
		expect(c.messages).toEqual([]);
	});

	it.each(["https://example.com", "null", "chrome-extension://abc"])(
		"refuses Origin %s",
		async (origin) => {
			const { port } = await start();
			expect(await rejected(`ws://127.0.0.1:${port}`, { Origin: origin })).toBe(
				401,
			);
		},
	);

	it("refuses a foreign Host and accepts localhost", async () => {
		const { port } = await start();
		expect(
			await rejected(`ws://127.0.0.1:${port}`, {
				Host: `evil.example:${port}`,
			}),
		).toBe(401);
		expect(
			await rejected(`ws://127.0.0.1:${port}`, { Host: `localhost:${port}` }),
		).toBe(0);
	});

	it("closes when hello does not come in time", async () => {
		const { port } = await start({}, 50);
		const c = await connect(port);
		await c.closed;
		expect(c.messages).toEqual([]);
	});

	it("sends protocol_mismatch and closes", async () => {
		const { port } = await start();
		const c = await connect(port);
		c.ws.send(hello({ protocol: 2 }));
		expect(await c.next()).toMatchObject({
			type: "error",
			code: "protocol_mismatch",
		});
		await c.closed;
	});

	it("routes requests, ignores unknown message types", async () => {
		const { port } = await start({
			read_note: async (p, ctx) => ({
				p,
				session: ctx.session,
				agent: ctx.agent,
			}),
			get_context: async () => {
				throw new HubError("note_not_found", "nope", { path: "x" });
			},
			boom: async () => {
				throw new Error("secret");
			},
		});
		const c = await login(port);
		c.ws.send(JSON.stringify({ type: "mystery" }));
		c.ws.send(
			JSON.stringify({
				type: "request",
				id: 1,
				method: "read_note",
				params: { path: "a.md" },
			}),
		);
		expect(await c.next()).toMatchObject({
			type: "response",
			id: 1,
			ok: true,
			result: { p: { path: "a.md" }, session: "s1", agent: "claude" },
		});
		c.ws.send(
			JSON.stringify({
				type: "request",
				id: 2,
				method: "get_context",
				params: {},
			}),
		);
		expect(await c.next()).toMatchObject({
			id: 2,
			ok: false,
			error: { code: "note_not_found", details: { path: "x" } },
		});
		c.ws.send(
			JSON.stringify({ type: "request", id: 3, method: "boom", params: {} }),
		);
		expect(await c.next()).toMatchObject({
			id: 3,
			ok: false,
			error: { code: "internal_error" },
		});
		c.ws.send(
			JSON.stringify({ type: "request", id: 4, method: "nope", params: {} }),
		);
		expect(await c.next()).toMatchObject({
			id: 4,
			error: { code: "unknown_method" },
		});
		c.ws.send(
			JSON.stringify({
				type: "request",
				id: 5,
				method: "read_note",
				params: {},
			}),
		);
		expect(await c.next()).toMatchObject({
			id: 5,
			error: { code: "invalid_params" },
		});
	});

	it("runs a repeated request id once, also while running and on a new connection", async () => {
		let calls = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const { port } = await start({
			suggest_edit: async () => {
				calls++;
				await gate;
				return { path: "a.md", ids: ["x"] };
			},
		});
		const params = { path: "a.md", find: "a", replace: "b" };
		const req = JSON.stringify({
			type: "request",
			id: "r1",
			method: "suggest_edit",
			params,
		});
		const c1 = await login(port);
		c1.ws.send(req);
		c1.ws.send(req);
		const c2 = await login(port);
		c2.ws.send(req);
		release();
		const expected = { ok: true, result: { path: "a.md", ids: ["x"] } };
		expect(await c1.next()).toMatchObject(expected);
		expect(await c1.next()).toMatchObject(expected);
		expect(await c2.next()).toMatchObject(expected);
		expect(calls).toBe(1);
		// Another session with the same id runs again.
		const c3 = await login(port, "other");
		c3.ws.send(req);
		expect(await c3.next()).toMatchObject(expected);
		expect(calls).toBe(2);
	});

	it("forgets ids beyond the last 50", async () => {
		let calls = 0;
		const { port } = await start({
			get_context: async () => ({ n: ++calls }),
		});
		const c = await login(port);
		for (let i = 0; i < 52; i++) {
			c.ws.send(
				JSON.stringify({
					type: "request",
					id: i,
					method: "get_context",
					params: {},
				}),
			);
			await c.next();
		}
		c.ws.send(
			JSON.stringify({
				type: "request",
				id: 51,
				method: "get_context",
				params: {},
			}),
		);
		await c.next();
		expect(calls).toBe(52);
		c.ws.send(
			JSON.stringify({
				type: "request",
				id: 0,
				method: "get_context",
				params: {},
			}),
		);
		await c.next();
		expect(calls).toBe(53);
	});

	it("accepts Node's global WebSocket (task 4.2)", async () => {
		let seen: unknown;
		const { port } = await start();
		// Observe the headers Node sends, with a plain HTTP upgrade probe.
		const { createServer } = await import("node:http");
		const probe = createServer();
		probe.on("upgrade", (req, socket) => {
			seen = { origin: req.headers.origin, host: req.headers.host };
			socket.destroy();
		});
		await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
		const probePort = (probe.address() as { port: number }).port;
		await new Promise<void>((r) => {
			const g = new globalThis.WebSocket(`ws://127.0.0.1:${probePort}`);
			g.onerror = () => r();
			g.onclose = () => r();
		});
		probe.close();
		console.info("global WebSocket headers:", JSON.stringify(seen));
		expect((seen as { origin?: string }).origin).toBeUndefined();

		const welcome = await new Promise<Record<string, unknown>>(
			(resolve, reject) => {
				const g = new globalThis.WebSocket(`ws://127.0.0.1:${port}`);
				g.onopen = () => g.send(hello());
				g.onmessage = (e) => {
					resolve(JSON.parse(String(e.data)));
					g.close();
				};
				g.onerror = () => reject(new Error("global WebSocket failed"));
			},
		);
		expect(welcome).toMatchObject({ type: "welcome", protocol: 1 });
	});
});
