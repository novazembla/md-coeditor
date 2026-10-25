import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { machineName } from "@md-coeditor/protocol";
import { type FileSystemAdapter, Notice, type Plugin } from "obsidian";
import type { EventLog } from "../log/wire";
import { createObsidianPort } from "../obsidian-port";
import { deleteEndpointSync, writeEndpoint } from "./endpoint";
import { type HubRuntime, type ManagedHub, manageHub } from "./managed";
import { startHub } from "./server";
import { createToolHandlers } from "./tools";

export type { HubRuntime, ManagedHub };

/**
 * Start the hub and publish its endpoint. Returns a handle to stop it:
 * close the server, then delete `endpoint.json` (own token only).
 * A failed start shows one notice and returns a handle that does nothing.
 */
export function createHubRuntime(plugin: Plugin, log: EventLog): ManagedHub {
	return manageHub(() => startHubRuntime(plugin, log));
}

export async function startHubRuntime(
	plugin: Plugin,
	log: EventLog,
): Promise<HubRuntime> {
	const token = randomBytes(32).toString("hex");
	const vault = (plugin.app.vault.adapter as FileSystemAdapter).getBasePath();
	const machine = machineName(hostname());
	try {
		const handlers = createToolHandlers({
			port: createObsidianPort(plugin),
			log,
		});
		const hub = await startHub({
			token,
			handlers,
			log: (m) => console.debug(`MD-Coeditor hub: ${m}`),
		});
		try {
			await writeEndpoint({
				vault,
				machine,
				port: hub.port,
				token,
				pid: process.pid,
			});
		} catch (error) {
			await hub.close();
			throw error;
		}
		return {
			async stop() {
				// First and synchronous: Obsidian does not wait for onunload.
				deleteEndpointSync({ vault, machine, token });
				await hub.close();
			},
		};
	} catch (error) {
		console.error("MD-Coeditor: hub did not start", error);
		new Notice("MD-Coeditor: the agent hub did not start. See the console.");
		return { stop: async () => {} };
	}
}
