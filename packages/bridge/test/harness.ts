import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpApp } from "../src/commands/mcp";

export interface ToolOutcome {
	isError: boolean;
	text: string;
	json: unknown;
}

export function outcome(raw: unknown): ToolOutcome {
	const r = raw as {
		isError?: boolean;
		content: { type: string; text: string }[];
	};
	const text = r.content.map((c) => c.text).join("\n");
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}
	return { isError: r.isError === true, text, json };
}

export interface Harness {
	client: Client;
	stderr: string[];
	call(name: string, args?: Record<string, unknown>): Promise<ToolOutcome>;
	close(): Promise<void>;
}

/** `coedit mcp` in this process, with an in-memory transport. */
export async function startMcp(o: {
	env: Record<string, string | undefined>;
	cwd?: string;
	hostname?: string;
}): Promise<Harness> {
	const stderr: string[] = [];
	const app = await createMcpApp({
		env: o.env,
		cwd: o.cwd ?? process.cwd(),
		hostname: o.hostname ?? "mac",
		stdin: process.stdin,
		stdout: process.stdout,
		stderr: (t) => stderr.push(t),
		version: "0.0.0-test",
	});
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test", version: "1" });
	await Promise.all([app.server.connect(a), client.connect(b)]);
	return {
		client,
		stderr,
		call: async (name, args = {}) =>
			outcome(await client.callTool({ name, arguments: args })),
		close: async () => {
			await client.close();
			app.close();
		},
	};
}
