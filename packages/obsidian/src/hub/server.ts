import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
	isMethod,
	PROTOCOL_VERSION,
	paramsSchemas,
	parseMessage,
	type Request,
	type ToolError,
} from "@md-coeditor/protocol";
import { type RawData, WebSocket, WebSocketServer } from "ws";

/**
 * Handler contract: a handler returns the result, or throws a `HubError` for
 * a tool error (sent as `{ ok: false, error }`). Any other throw is sent as
 * `internal_error`. For methods in the protocol, `params` is already checked
 * with the zod schema; a failed check answers `invalid_params` and the
 * handler does not run. An unknown method answers `unknown_method`.
 */
export class HubError extends Error {
	readonly code: string;
	readonly details?: Record<string, unknown>;
	constructor(
		code: string,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "HubError";
		this.code = code;
		this.details = details;
	}
	toToolError(): ToolError {
		return this.details === undefined
			? { code: this.code, message: this.message }
			: { code: this.code, message: this.message, details: this.details };
	}
}

export interface HandlerContext {
	session: string;
	agent: string;
}

export type Handler = (
	params: unknown,
	ctx: HandlerContext,
) => Promise<unknown>;

export interface HubOptions {
	token: string;
	handlers: Record<string, Handler>;
	log?: (message: string) => void;
	helloTimeoutMs?: number;
}

export interface Hub {
	port: number;
	close(): Promise<void>;
}

const REMEMBERED_IDS = 50;

type Answer = { ok: true; result: unknown } | { ok: false; error: ToolError };

function tokenMatches(given: string, expected: string): boolean {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	if (a.length !== b.length) {
		// Keep the work equal; the result is false.
		timingSafeEqual(b, b);
		return false;
	}
	return timingSafeEqual(a, b);
}

export async function startHub(options: HubOptions): Promise<Hub> {
	const { token, handlers } = options;
	const log = options.log ?? (() => {});
	const helloTimeoutMs = options.helloTimeoutMs ?? 5000;
	const sessions = new Map<string, Map<string, Promise<Answer>>>();
	let port = 0;

	const wss = new WebSocketServer({
		host: "127.0.0.1",
		port: 0,
		maxPayload: 1024 * 1024,
		verifyClient: (info: { req: IncomingMessage }) => {
			const { origin, host } = info.req.headers;
			if (origin !== undefined) {
				log(`refused origin ${origin}`);
				return false;
			}
			if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
				log(`refused host ${host}`);
				return false;
			}
			return true;
		},
	});
	await new Promise<void>((resolve, reject) => {
		wss.once("listening", resolve);
		wss.once("error", reject);
	});
	const address = wss.address();
	if (typeof address === "string" || address === null) {
		throw new Error("hub: no port");
	}
	port = address.port;

	function remember(session: string, id: string, answer: Promise<Answer>) {
		let ids = sessions.get(session);
		if (!ids) {
			ids = new Map();
			sessions.set(session, ids);
		}
		ids.set(id, answer);
		while (ids.size > REMEMBERED_IDS) {
			const oldest = ids.keys().next().value;
			if (oldest === undefined) break;
			ids.delete(oldest);
		}
	}

	async function run(request: Request, ctx: HandlerContext): Promise<Answer> {
		const handler = Object.hasOwn(handlers, request.method)
			? handlers[request.method]
			: undefined;
		if (!handler) {
			return {
				ok: false,
				error: {
					code: "unknown_method",
					message: `Unknown method: ${request.method}`,
				},
			};
		}
		let params: unknown = request.params;
		if (isMethod(request.method)) {
			const parsed = paramsSchemas[request.method].safeParse(
				request.params ?? {},
			);
			if (!parsed.success) {
				return {
					ok: false,
					error: {
						code: "invalid_params",
						message: parsed.error.issues
							.map((i) => `${i.path.join(".") || "params"}: ${i.message}`)
							.join("; "),
					},
				};
			}
			params = parsed.data;
		}
		try {
			return { ok: true, result: await handler(params, ctx) };
		} catch (error) {
			if (error instanceof HubError) {
				return { ok: false, error: error.toToolError() };
			}
			log(`handler ${request.method} failed: ${String(error)}`);
			return {
				ok: false,
				error: { code: "internal_error", message: "Internal error." },
			};
		}
	}

	wss.on("connection", (ws: WebSocket) => {
		let ctx: HandlerContext | null = null;
		const timer = setTimeout(() => {
			if (!ctx) ws.close();
		}, helloTimeoutMs);
		ws.on("close", () => clearTimeout(timer));
		ws.on("error", () => ws.terminate());

		const send = (value: unknown) => {
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
		};

		ws.on("message", (data: RawData) => {
			const message = parseMessage(data.toString());
			if (!ctx) {
				clearTimeout(timer);
				if (message?.type !== "hello" || !tokenMatches(message.token, token)) {
					ws.close();
					return;
				}
				if (message.protocol !== PROTOCOL_VERSION) {
					send({
						type: "error",
						code: "protocol_mismatch",
						message: `Hub speaks protocol ${PROTOCOL_VERSION}, client sent ${message.protocol}.`,
					});
					ws.close();
					return;
				}
				ctx = { session: message.session, agent: message.agent };
				send({ type: "welcome", protocol: PROTOCOL_VERSION, features: [] });
				return;
			}
			if (message?.type !== "request") return;
			const request = message;
			const key = `${typeof request.id}:${request.id}`;
			const { session } = ctx;
			let answer = sessions.get(session)?.get(key);
			if (!answer) {
				answer = run(request, ctx);
				remember(session, key, answer);
			}
			void answer.then((a) => {
				send(
					a.ok
						? { type: "response", id: request.id, ok: true, result: a.result }
						: { type: "response", id: request.id, ok: false, error: a.error },
				);
			});
		});
	});

	return {
		port,
		close: () =>
			new Promise<void>((resolve) => {
				for (const client of wss.clients) client.terminate();
				wss.close(() => resolve());
			}),
	};
}
