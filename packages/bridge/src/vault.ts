import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const MAX_DEPTH = 3;
// biome-ignore lint/suspicious/noTemplateCurlyInString: the literal text of an unexpanded variable
const UNEXPANDED = "${COEDIT_VAULT}";

export type VaultResult =
	| { kind: "found"; vault: string }
	| { kind: "none" }
	| { kind: "many"; vaults: string[] };

function isVault(dir: string): boolean {
	try {
		return statSync(path.join(dir, ".obsidian")).isDirectory();
	} catch {
		return false;
	}
}

/** The nearest folder with `.obsidian/` at or above `dir`, or undefined. */
export function findVaultUp(dir: string): string | undefined {
	let current = path.resolve(dir);
	for (;;) {
		if (isVault(current)) return current;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * All vaults below `dir`, up to 3 levels deep, sorted. Skips dot folders and
 * `node_modules`. Does not look inside a vault that it found.
 */
export function findVaultsBelow(dir: string): string[] {
	const found: string[] = [];
	const walk = (current: string, depth: number) => {
		if (depth > MAX_DEPTH) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const child = path.join(current, entry.name);
			if (isVault(child)) found.push(child);
			else walk(child, depth + 1);
		}
	};
	walk(path.resolve(dir), 1);
	return found.sort();
}

/** Discovery for the launcher and the bridge: at or above, else below. */
export function discoverVault(cwd: string): VaultResult {
	const up = findVaultUp(cwd);
	if (up !== undefined) return { kind: "found", vault: up };
	const below = findVaultsBelow(cwd);
	if (below.length === 0) return { kind: "none" };
	if (below.length === 1) return { kind: "found", vault: below[0] as string };
	return { kind: "many", vaults: below };
}

/**
 * `COEDIT_VAULT` when it is set. Unset, empty, or the literal `${COEDIT_VAULT}`
 * (an unexpanded variable) falls back to discovery from `cwd`.
 */
export function vaultFromEnv(
	env: Record<string, string | undefined>,
	cwd: string,
): VaultResult {
	const value = env.COEDIT_VAULT;
	if (value !== undefined && value !== "" && value !== UNEXPANDED) {
		return { kind: "found", vault: path.resolve(cwd, value) };
	}
	return discoverVault(cwd);
}
