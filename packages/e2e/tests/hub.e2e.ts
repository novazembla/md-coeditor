import { readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createConnection } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import { coeditDir, machineName } from "@md-coeditor/protocol";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
	type Endpoint,
	machineFolder,
	pluginIsOn,
	pluginOff,
	pluginOn,
	readEndpoint,
	restartPlugin,
	waitFor,
	waitForEndpoint,
} from "../helpers";

const NOTE = "agent/essay.md";

const onDisk = (path: string) =>
	readFileSync(join(obsidianPage.getVaultPath(), ...path.split("/")), "utf8");

/** True when a TCP connection to 127.0.0.1:port succeeds. */
function tcpConnects(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port }, () => {
			socket.destroy();
			resolve(true);
		});
		socket.on("error", () => resolve(false));
	});
}

/** Connect with Node's WebSocket, send `first`, and collect the messages until the hub closes. */
function sendFirst(port: number, first: unknown): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		const messages: string[] = [];
		let opened = false;
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error(`hub did not close (messages: ${messages})`));
		}, 4000);
		ws.addEventListener("open", () => {
			opened = true;
			ws.send(JSON.stringify(first));
		});
		ws.addEventListener("message", (e) => messages.push(String(e.data)));
		ws.addEventListener("close", () => {
			clearTimeout(timer);
			if (opened) resolve(messages);
			else reject(new Error(`no connection to the hub on port ${port}`));
		});
		ws.addEventListener("error", () => {});
	});
}

/** Status of a WebSocket handshake with extra headers: 101 when accepted. */
function handshake(
	port: number,
	headers: Record<string, string>,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request({
			host: "127.0.0.1",
			port,
			headers: {
				Connection: "Upgrade",
				Upgrade: "websocket",
				"Sec-WebSocket-Version": "13",
				"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
				...headers,
			},
		});
		req.on("upgrade", (res, socket) => {
			socket.destroy();
			resolve(res.statusCode ?? 0);
		});
		req.on("response", (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", reject);
		req.end();
	});
}

describe("vault-hub", () => {
	// A test that switched the plugin off and failed leaves it off: switch it on again.
	beforeEach(async () => {
		if (!(await pluginIsOn())) await pluginOn();
	});
	after(async () => {
		if (!(await pluginIsOn())) await pluginOn();
	});

	it("Endpoint after load", async () => {
		// A vault with no .coedit/ folder: remove it, then load the plugin again.
		await pluginOff();
		rmSync(coeditDir(obsidianPage.getVaultPath()), {
			recursive: true,
			force: true,
		});
		const endpoint = await pluginOn();
		expect(
			JSON.parse(readFileSync(join(machineFolder(), "endpoint.json"), "utf8")),
		).toEqual(endpoint);
		expect(endpoint.port).toBeGreaterThanOrEqual(1024);
		expect(endpoint.port).toBeLessThanOrEqual(65535);
		expect(endpoint.token).toMatch(/^[0-9a-f]{32,}$/);
		expect(endpoint.pid).toBe(await browser.execute(() => process.pid));
		expect(endpoint.host).toBe(machineName(hostname()));
		expect(await tcpConnects(endpoint.port)).toBe(true);
	});

	it("New token after a restart", async () => {
		const before = await waitForEndpoint();
		const after = await restartPlugin();
		expect(after.token).not.toBe(before.token);
	});

	it("Plugin is switched off", async () => {
		const before = (await waitForEndpoint()) as Endpoint;
		await pluginOff();
		// Obsidian does not wait for onunload: the file must be gone at once.
		expect(readEndpoint()).toBeNull();
		await waitFor(
			() => tcpConnects(before.port),
			(ok) => !ok,
			"connection to the old port fails",
		);
		await pluginOn();
	});

	it("Wrong token", async () => {
		const { port } = await waitForEndpoint();
		const text = onDisk(NOTE);
		const messages = await sendFirst(port, {
			type: "hello",
			protocol: 1,
			token: "0000",
			agent: "claude",
			session: "e2e-raw",
		});
		expect(messages).toEqual([]);
		expect(onDisk(NOTE)).toBe(text);
	});

	it("Request before hello", async () => {
		const { port } = await waitForEndpoint();
		const text = onDisk(NOTE);
		const messages = await sendFirst(port, {
			type: "request",
			id: 1,
			method: "suggest_edit",
			params: { path: NOTE, find: "quick", replace: "slow" },
		});
		expect(messages).toEqual([]);
		expect(onDisk(NOTE)).toBe(text);
	});

	it("Web page connects", async () => {
		const { port } = await waitForEndpoint();
		expect(await handshake(port, { Origin: "https://example.com" })).not.toBe(
			101,
		);
		// Without the Origin header the same handshake is accepted.
		expect(await handshake(port, {})).toBe(101);
	});
});
