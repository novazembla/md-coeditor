import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { endpointPath } from "@md-coeditor/protocol";
import { type WebSocket, WebSocketServer } from "ws";

export type Reply =
	| { ok: true; result: unknown }
	| {
			ok: false;
			error: {
				code: string;
				message: string;
				details?: Record<string, unknown>;
			};
	  }
	| "drop";

export type Respond = (
	method: string,
	params: Record<string, unknown>,
	ws: WebSocket,
) => Reply;

export interface FakeHub {
	port: number;
	/** Every request message: `{ type, id, method, params }`. */
	requests: Record<string, unknown>[];
	hellos: Record<string, unknown>[];
	respond: Respond;
	/** Close the server and start a new one with a new port and token. */
	restart(): Promise<void>;
	stop(): Promise<void>;
}

export interface FakeHubOptions {
	vault: string;
	machine: string;
	/** The protocol version the hub speaks. Default 1. */
	protocol?: number;
	respond?: Respond;
}

const defaultRespond: Respond = (method) => ({
	ok: true,
	result: { echo: method },
});

/** A hub that speaks the protocol, with its endpoint.json in the vault. */
export async function startFakeHub(o: FakeHubOptions): Promise<FakeHub> {
	const protocol = o.protocol ?? 1;
	let wss: WebSocketServer;
	let generation = 0;
	const hub: FakeHub = {
		port: 0,
		requests: [],
		hellos: [],
		respond: o.respond ?? defaultRespond,
		restart: async () => {
			await close();
			await listen();
		},
		stop: () => close(),
	};

	async function listen(): Promise<void> {
		generation++;
		const token = `token-${generation}`;
		wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		await new Promise<void>((r) => wss.once("listening", () => r()));
		hub.port = (wss.address() as AddressInfo).port;
		wss.on("connection", (ws) => {
			ws.on("message", (data) => {
				const msg = JSON.parse(data.toString()) as Record<string, unknown>;
				if (msg.type === "hello") {
					hub.hellos.push(msg);
					if (msg.protocol !== protocol) {
						ws.send(
							JSON.stringify({
								type: "error",
								code: "protocol_mismatch",
								message: `hub speaks protocol ${protocol}`,
							}),
						);
						ws.close();
					} else if (msg.token !== token) {
						ws.close();
					} else {
						ws.send(
							JSON.stringify({ type: "welcome", protocol, features: [] }),
						);
					}
				} else if (msg.type === "request") {
					hub.requests.push(msg);
					const reply = hub.respond(
						String(msg.method),
						(msg.params ?? {}) as Record<string, unknown>,
						ws,
					);
					if (reply === "drop") {
						ws.terminate();
						return;
					}
					ws.send(JSON.stringify({ type: "response", id: msg.id, ...reply }));
				}
			});
		});
		const file = endpointPath(o.vault, o.machine);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({ port: hub.port, token, pid: 1, host: o.machine }),
		);
	}

	function close(): Promise<void> {
		return new Promise<void>((r) => {
			for (const c of wss.clients) c.terminate();
			wss.close(() => r());
		});
	}

	await listen();
	return hub;
}
