import { join } from "node:path";

/**
 * Machine folder name (D20): part before the first `.`, lower case,
 * chars outside a-z0-9- become `-`, empty becomes `machine`.
 */
export function machineName(hostname: string): string {
	const name = (hostname.split(".")[0] ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-");
	return name === "" ? "machine" : name;
}

export const coeditDir = (vault: string): string => join(vault, ".coedit");
export const configPath = (vault: string): string =>
	join(coeditDir(vault), "config.json");
export const coeditGitignorePath = (vault: string): string =>
	join(coeditDir(vault), ".gitignore");
export const localDir = (vault: string): string =>
	join(coeditDir(vault), "local");
export const localGitignorePath = (vault: string): string =>
	join(localDir(vault), ".gitignore");
export const machineDir = (vault: string, machine: string): string =>
	join(localDir(vault), machine);
export const endpointPath = (vault: string, machine: string): string =>
	join(machineDir(vault, machine), "endpoint.json");
export const logDir = (vault: string, machine: string): string =>
	join(machineDir(vault, machine), "log");
export const eventsPath = (vault: string, machine: string): string =>
	join(logDir(vault, machine), "events.jsonl");
export const logIdPath = (vault: string, machine: string): string =>
	join(logDir(vault, machine), "log-id");
export const cursorsDir = (vault: string, machine: string): string =>
	join(machineDir(vault, machine), "cursors");
