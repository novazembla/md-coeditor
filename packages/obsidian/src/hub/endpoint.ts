import { readFileSync, rmSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	endpointPath,
	localGitignorePath,
	machineDir,
} from "@md-coeditor/protocol";

export interface EndpointInfo {
	vault: string;
	machine: string;
	port: number;
	token: string;
	pid: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renameWithRetry(from: string, to: string): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		try {
			await rename(from, to);
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			const retry =
				process.platform === "win32" &&
				(code === "EPERM" || code === "EBUSY") &&
				attempt < 5;
			if (!retry) throw error;
			await sleep(20 * attempt);
		}
	}
}

/** Write `.coedit/local/.gitignore` (`*`) only when it is missing. */
export async function ensureLocalGitignore(vault: string): Promise<void> {
	try {
		await writeFile(localGitignorePath(vault), "*\n", { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

/**
 * Write `endpoint.json` in the machine folder, atomically (temp file + rename).
 * The temp file is created with mode 0600 outside Windows.
 */
export async function writeEndpoint(info: EndpointInfo): Promise<void> {
	const dir = machineDir(info.vault, info.machine);
	await mkdir(dir, { recursive: true });
	await ensureLocalGitignore(info.vault);
	const target = endpointPath(info.vault, info.machine);
	const temp = join(
		dirname(target),
		`endpoint.json.${process.pid}.${Date.now()}.tmp`,
	);
	const body = `${JSON.stringify({
		port: info.port,
		token: info.token,
		pid: info.pid,
		host: info.machine,
	})}\n`;
	const handle =
		process.platform === "win32"
			? await open(temp, "wx")
			: await open(temp, "wx", 0o600);
	try {
		await handle.writeFile(body);
	} finally {
		await handle.close();
	}
	try {
		await renameWithRetry(temp, target);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}

/** Delete `endpoint.json` only when it still holds this token. */
export async function deleteEndpoint(
	info: Pick<EndpointInfo, "vault" | "machine" | "token">,
): Promise<boolean> {
	const target = endpointPath(info.vault, info.machine);
	try {
		const parsed = JSON.parse(await readFile(target, "utf8")) as {
			token?: unknown;
		};
		if (parsed.token !== info.token) return false;
		await rm(target, { force: true });
		return true;
	} catch {
		return false;
	}
}

/**
 * Synchronous `deleteEndpoint`, for the unload path: Obsidian does not wait
 * for `onunload`, so an async delete may not run before the app quits.
 */
export function deleteEndpointSync(
	info: Pick<EndpointInfo, "vault" | "machine" | "token">,
): boolean {
	const target = endpointPath(info.vault, info.machine);
	try {
		const parsed = JSON.parse(readFileSync(target, "utf8")) as {
			token?: unknown;
		};
		if (parsed.token !== info.token) return false;
		rmSync(target, { force: true });
		return true;
	} catch {
		return false;
	}
}
