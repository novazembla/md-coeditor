import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	endpointPath,
	PROTOCOL_VERSION,
	parseMessage,
	type ToolError,
} from "@md-coeditor/protocol";

export type HubResult =
	| { ok: true; result: unknown }
	| { ok: false; error: ToolError };

export interface HubClientOptions {
	vault: string;
	/** Machine name (D20). An endpoint with another `host` is ignored. */
	machine: string;
	session: string;
	agent?: string;
	timeoutMs?: number;
	/**
	 * Timeouts for single methods, in ms. A suggestion in a closed note on a
	 * slow synced disk can take longer than a read.
	 */
	timeouts?: Record<string, number>;
	/** Test hook: returns the raw text of endpoint.json, or undefined. */
	readEndpoint?: () => string | undefined;
}

export interface HubClient {
	call(method: string, params?: unknown): Promise<HubResult>;
	close(): void;
}

interface Endpoint {
	port: number;
	token: string;
}

const NOT_CONNECTED = "Obsidian not connected";
const MISMATCH_HINT =
	"The Obsidian plugin and coedit use different protocol versions: update the Obsidian plugin or coedit.";

export const isHubUnavailable = (error: { code: string }): boolean =>
	error.code === "hub_unavailable";

const fail = (code: string, message: string): HubResult => ({
	ok: false,
	error: { code, message },
});

class MismatchError extends Error {}

type Outcome =
	| { kind: "response"; value: HubResult }
	| { kind: "mismatch"; message: string }
	| { kind: "fail" };

export function createHubClient(options: HubClientOptions): HubClient {
	const {
		vault,
		machine,
		session,
		agent = "claude",
		timeoutMs = 10_000,
		timeouts = { suggest_edit: 30_000 },
	} = options;
	const readRaw =
		options.readEndpoint ??
		((): string | undefined => {
			try {
				return readFileSync(endpointPath(vault, machine), "utf8");
			} catch {
				return undefined;
			}
		});

	let socket: WebSocket | undefined;
	let connecting: Promise<WebSocket> | undefined;

	function readEndpointFile(): Endpoint | undefined {
		const raw = readRaw();
		if (raw === undefined) return undefined;
		try {
			const data: unknown = JSON.parse(raw);
			if (typeof data !== "object" || data === null) return undefined;
			const { port, token, host } = data as Record<string, unknown>;
			if (host !== machine) return undefined;
			if (
				typeof port !== "number" ||
				!Number.isInteger(port) ||
				port < 1 ||
				port > 65535 ||
				typeof token !== "string"
			) {
				return undefined;
			}
			return { port, token };
		} catch {
			return undefined;
		}
	}

	function drop(ws: WebSocket | undefined): void {
		if (ws === undefined) return;
		if (socket === ws) socket = undefined;
		try {
			ws.close();
		} catch {
			// already closed
		}
	}

	function open(ep: Endpoint, WS: typeof WebSocket): Promise<WebSocket> {
		return new Promise<WebSocket>((resolve, reject) => {
			let ws: WebSocket;
			try {
				ws = new WS(`ws://127.0.0.1:${ep.port}`);
			} catch (err) {
				reject(err);
				return;
			}
			let settled = false;
			const settle = (err?: Error): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				ws.removeEventListener("message", onMessage);
				ws.removeEventListener("close", onClose);
				ws.removeEventListener("error", onClose);
				if (err) {
					drop(ws);
					reject(err);
				} else {
					ws.addEventListener("close", () => {
						if (socket === ws) socket = undefined;
					});
					resolve(ws);
				}
			};
			const onClose = (): void => settle(new Error("closed"));
			const onMessage = (event: MessageEvent): void => {
				const msg = parseMessage(event.data);
				if (msg === null) return;
				if (msg.type === "welcome") settle();
				else if (msg.type === "error") {
					settle(
						msg.code === "protocol_mismatch"
							? new MismatchError(msg.message)
							: new Error(msg.message),
					);
				}
			};
			const timer = setTimeout(() => settle(new Error("timeout")), timeoutMs);
			ws.addEventListener("message", onMessage);
			ws.addEventListener("close", onClose);
			ws.addEventListener("error", onClose);
			ws.addEventListener("open", () => {
				ws.send(
					JSON.stringify({
						type: "hello",
						protocol: PROTOCOL_VERSION,
						token: ep.token,
						agent,
						session,
					}),
				);
			});
		});
	}

	async function ensureSocket(WS: typeof WebSocket): Promise<WebSocket> {
		if (socket !== undefined && socket.readyState === WS.OPEN) return socket;
		socket = undefined;
		if (connecting === undefined) {
			const ep = readEndpointFile();
			if (ep === undefined) throw new Error("no endpoint");
			const p = open(ep, WS).then((ws) => {
				socket = ws;
				return ws;
			});
			connecting = p;
			const clear = (): void => {
				if (connecting === p) connecting = undefined;
			};
			p.then(clear, clear);
		}
		return connecting;
	}

	function attempt(
		WS: typeof WebSocket,
		id: string,
		method: string,
		params: unknown,
	): Promise<Outcome> {
		return new Promise<Outcome>((resolve) => {
			let ws: WebSocket | undefined;
			let done = false;
			const finish = (outcome: Outcome, closeSocket = false): void => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				if (ws) {
					ws.removeEventListener("message", onMessage);
					ws.removeEventListener("close", onClose);
					if (closeSocket) drop(ws);
				}
				resolve(outcome);
			};
			const onClose = (): void => finish({ kind: "fail" });
			const onMessage = (event: MessageEvent): void => {
				const msg = parseMessage(event.data);
				if (msg === null || msg.type !== "response" || msg.id !== id) return;
				finish({
					kind: "response",
					value: msg.ok
						? { ok: true, result: msg.result }
						: { ok: false, error: msg.error },
				});
			};
			const timer = setTimeout(
				() => finish({ kind: "fail" }, true),
				timeouts[method] ?? timeoutMs,
			);
			ensureSocket(WS).then(
				(socketOpen) => {
					if (done) return;
					ws = socketOpen;
					ws.addEventListener("message", onMessage);
					ws.addEventListener("close", onClose);
					try {
						ws.send(JSON.stringify({ type: "request", id, method, params }));
					} catch {
						finish({ kind: "fail" }, true);
					}
				},
				(err: unknown) => {
					finish(
						err instanceof MismatchError
							? { kind: "mismatch", message: err.message }
							: { kind: "fail" },
					);
				},
			);
		});
	}

	return {
		async call(method, params = {}) {
			const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
			if (typeof WS !== "function") {
				return fail("hub_unavailable", "Node 24 or later is needed");
			}
			const id = randomUUID();
			for (let i = 0; i < 2; i++) {
				const outcome = await attempt(WS, id, method, params);
				if (outcome.kind === "response") return outcome.value;
				if (outcome.kind === "mismatch") {
					return fail(
						"protocol_mismatch",
						`${outcome.message} (${MISMATCH_HINT})`,
					);
				}
			}
			return fail("hub_unavailable", NOT_CONNECTED);
		},
		close() {
			drop(socket);
		},
	};
}
