import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { endpointPath } from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { createHubClient } from "./hub-client";

const MACHINE = "work-mac";

interface FakeHub {
	port: number;
	received: Record<string, unknown>[];
	close(): Promise<void>;
}

type Handler = (
	msg: Record<string, unknown>,
	ws: WebSocket,
	hub: FakeHub,
) => void;

async function startHub(handler?: Handler): Promise<FakeHub> {
	const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await new Promise<void>((r) => wss.once("listening", () => r()));
	const hub: FakeHub = {
		port: (wss.address() as AddressInfo).port,
		received: [],
		close: () =>
			new Promise<void>((r) => {
				for (const c of wss.clients) c.terminate();
				wss.close(() => r());
			}),
	};
	wss.on("connection", (ws) => {
		ws.on("message", (data) => {
			const msg = JSON.parse(data.toString()) as Record<string, unknown>;
			hub.received.push(msg);
			if (handler) return handler(msg, ws, hub);
			if (msg.type === "hello") {
				ws.send(JSON.stringify({ type: "welcome", protocol: 1, features: [] }));
			} else if (msg.type === "request") {
				ws.send(
					JSON.stringify({
						type: "response",
						id: msg.id,
						ok: true,
						result: { echo: msg.method },
					}),
				);
			}
		});
	});
	return hub;
}

describe("hub client", () => {
	let vault: string;
	const hubs: FakeHub[] = [];
	const track = async (h?: Handler): Promise<FakeHub> => {
		const hub = await startHub(h);
		hubs.push(hub);
		return hub;
	};
	const writeEndpoint = (port: number, token = "t1", host = MACHINE): void => {
		const file = endpointPath(vault, MACHINE);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify({ port, token, pid: 1, host }));
	};
	const client = (timeoutMs = 2000, timeouts?: Record<string, number>) =>
		createHubClient({
			vault,
			machine: MACHINE,
			session: "s1",
			timeoutMs,
			timeouts,
		});

	beforeEach(() => {
		vault = mkdtempSync(join(tmpdir(), "coedit-hub-"));
	});
	afterEach(async () => {
		for (const h of hubs.splice(0)) await h.close();
		rmSync(vault, { recursive: true, force: true });
	});

	it("sends hello, waits for welcome and gets the answer", async () => {
		const hub = await track();
		writeEndpoint(hub.port);
		const c = client();
		const res = await c.call("get_context", {});
		expect(res).toEqual({ ok: true, result: { echo: "get_context" } });
		await c.call("get_context", {});
		c.close();
		expect(hub.received[0]).toEqual({
			type: "hello",
			protocol: 1,
			token: "t1",
			agent: "claude",
			session: "s1",
		});
		expect(hub.received.filter((m) => m.type === "hello")).toHaveLength(1);
		expect(hub.received[1]).toMatchObject({
			type: "request",
			method: "get_context",
			params: {},
		});
	});

	it("suggest_edit waits longer than other methods", async () => {
		const hub = await track((msg, ws) => {
			if (msg.type === "hello") {
				ws.send(JSON.stringify({ type: "welcome", protocol: 1, features: [] }));
			} else {
				const delay = msg.method === "suggest_edit" ? 300 : 5000;
				setTimeout(() => {
					try {
						ws.send(
							JSON.stringify({
								type: "response",
								id: msg.id,
								ok: true,
								result: msg.method,
							}),
						);
					} catch {
						// closed
					}
				}, delay);
			}
		});
		writeEndpoint(hub.port);
		const c = client(100, { suggest_edit: 2000 });
		expect(await c.call("suggest_edit", {})).toEqual({
			ok: true,
			result: "suggest_edit",
		});
		expect(await c.call("get_context", {})).toMatchObject({
			ok: false,
			error: { code: "hub_unavailable" },
		});
		c.close();
	});

	it("passes a hub error through unchanged", async () => {
		const hub = await track((msg, ws) => {
			if (msg.type === "hello") {
				ws.send(JSON.stringify({ type: "welcome", protocol: 1, features: [] }));
			} else {
				ws.send(
					JSON.stringify({
						type: "response",
						id: msg.id,
						ok: false,
						error: { code: "ambiguous", message: "m", details: { matches: 2 } },
					}),
				);
			}
		});
		writeEndpoint(hub.port);
		const c = client();
		expect(await c.call("suggest_edit", {})).toEqual({
			ok: false,
			error: { code: "ambiguous", message: "m", details: { matches: 2 } },
		});
		c.close();
	});

	it("re-reads endpoint.json after a port change and repeats with the same id", async () => {
		const first = await track();
		writeEndpoint(first.port);
		const c = client();
		await c.call("get_context", {});
		await first.close();
		const second = await track();
		writeEndpoint(second.port, "t2");
		const res = await c.call("read_note", { path: "a.md" });
		c.close();
		expect(res.ok).toBe(true);
		expect(second.received[0]).toMatchObject({ type: "hello", token: "t2" });
		expect(second.received[1]).toMatchObject({ method: "read_note" });
	});

	it("repeats with the same request id when the first hub drops the request", async () => {
		const ids: unknown[] = [];
		const hub = await track((msg, ws) => {
			if (msg.type === "hello") {
				ws.send(JSON.stringify({ type: "welcome", protocol: 1, features: [] }));
			} else {
				ids.push(msg.id);
				if (ids.length === 1) ws.terminate();
				else
					ws.send(
						JSON.stringify({
							type: "response",
							id: msg.id,
							ok: true,
							result: 1,
						}),
					);
			}
		});
		writeEndpoint(hub.port);
		const c = client();
		expect(await c.call("get_context", {})).toEqual({ ok: true, result: 1 });
		c.close();
		expect(ids).toHaveLength(2);
		expect(ids[0]).toBe(ids[1]);
	});

	it("returns hub_unavailable after a second failure", async () => {
		const hub = await track();
		writeEndpoint(hub.port);
		await hub.close();
		const c = client();
		expect(await c.call("get_context", {})).toEqual({
			ok: false,
			error: { code: "hub_unavailable", message: "Obsidian not connected" },
		});
	});

	it("returns hub_unavailable on a timeout", async () => {
		const hub = await track((msg, ws) => {
			if (msg.type === "hello") {
				ws.send(JSON.stringify({ type: "welcome", protocol: 1, features: [] }));
			}
		});
		writeEndpoint(hub.port);
		const c = client(150);
		expect(await c.call("get_context", {})).toEqual({
			ok: false,
			error: { code: "hub_unavailable", message: "Obsidian not connected" },
		});
		expect(hub.received.filter((m) => m.type === "request")).toHaveLength(2);
		c.close();
	});

	it("returns protocol_mismatch with an update hint and does not retry", async () => {
		const hub = await track((msg, ws) => {
			if (msg.type === "hello") {
				ws.send(
					JSON.stringify({
						type: "error",
						code: "protocol_mismatch",
						message: "protocol 1 not supported",
					}),
				);
			}
		});
		writeEndpoint(hub.port);
		const c = client();
		const res = await c.call("get_context", {});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error.code).toBe("protocol_mismatch");
			expect(res.error.message).toContain(
				"update the Obsidian plugin or coedit",
			);
		}
		expect(hub.received.filter((m) => m.type === "hello")).toHaveLength(1);
	});

	it("treats an endpoint of another machine as missing", async () => {
		const hub = await track();
		writeEndpoint(hub.port, "t1", "other-mac");
		const c = client();
		const res = await c.call("get_context", {});
		expect(res).toMatchObject({
			ok: false,
			error: { code: "hub_unavailable" },
		});
		expect(hub.received).toHaveLength(0);
	});

	it("treats a missing or broken endpoint.json as no endpoint", async () => {
		expect(await client().call("get_context", {})).toMatchObject({
			error: { code: "hub_unavailable" },
		});
		const file = endpointPath(vault, MACHINE);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "{nope");
		expect(await client().call("get_context", {})).toMatchObject({
			error: { code: "hub_unavailable" },
		});
	});

	it("ignores unknown message types and unknown fields", async () => {
		const hub = await track((msg, ws) => {
			if (msg.type === "hello") {
				ws.send(JSON.stringify({ type: "event", seq: 1 }));
				ws.send(JSON.stringify({ type: "future-thing" }));
				ws.send(
					JSON.stringify({ type: "welcome", protocol: 1, features: [], x: 1 }),
				);
			} else {
				ws.send(JSON.stringify({ type: "event", seq: 2 }));
				ws.send(
					JSON.stringify({
						type: "response",
						id: msg.id,
						ok: true,
						result: "r",
						extra: true,
					}),
				);
			}
		});
		writeEndpoint(hub.port);
		const c = client();
		expect(await c.call("get_context", {})).toEqual({ ok: true, result: "r" });
		c.close();
	});

	it("says Node 24 is needed without a global WebSocket", async () => {
		const saved = globalThis.WebSocket;
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		(globalThis as any).WebSocket = undefined;
		try {
			expect(await client().call("get_context", {})).toEqual({
				ok: false,
				error: {
					code: "hub_unavailable",
					message: "Node 24 or later is needed",
				},
			});
		} finally {
			globalThis.WebSocket = saved;
		}
	});
});
