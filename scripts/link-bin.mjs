// Put `coedit` on the PATH (design D4a).
// macOS/Linux: symlink <binDir>/coedit -> packages/bridge/dist/coedit.mjs
// Windows:     <binDir>\coedit.cmd that calls node with the absolute path
// Usage: node scripts/link-bin.mjs [--remove]   (env COEDIT_BIN_DIR overrides the folder)
import { existsSync } from "node:fs";
import {
	lstat,
	mkdir,
	readFile,
	readlink,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** First line of every .cmd entry that this script writes. Used to recognize our own entry. */
export const CMD_MARKER =
	"@rem md-coeditor: coedit launcher (made by pnpm link:bin)";

/** A symlink is ours if it points at a file with this path suffix. */
const TARGET_SUFFIX = ["packages", "bridge", "dist", "coedit.mjs"];

function pathFor(platform) {
	return platform === "win32" ? path.win32 : path.posix;
}

/** Look up an env var; Windows env names are case-insensitive. */
function getEnv(env, name, platform) {
	if (platform !== "win32") return env[name];
	const key = Object.keys(env).find((k) => k.toUpperCase() === name);
	return key === undefined ? undefined : env[key];
}

export function entryName(platform) {
	return platform === "win32" ? "coedit.cmd" : "coedit";
}

export function defaultBinDir(platform, env, homedir) {
	const override = getEnv(env, "COEDIT_BIN_DIR", platform);
	if (override) return override;
	const p = pathFor(platform);
	if (platform === "win32") {
		const local =
			getEnv(env, "LOCALAPPDATA", platform) ??
			p.join(homedir, "AppData", "Local");
		return p.join(local, "md-coeditor", "bin");
	}
	return p.join(homedir, ".local", "bin");
}

export function cmdContent(target) {
	return `${CMD_MARKER}\r\n@node "${target}" %*\r\n`;
}

function isOurLinkTarget(linkTarget, platform) {
	const parts = linkTarget.split(/[\\/]+/);
	const tail = parts.slice(-TARGET_SUFFIX.length);
	const same = (a, b) =>
		platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
	return (
		tail.length === TARGET_SUFFIX.length &&
		tail.every((part, i) => same(part, TARGET_SUFFIX[i]))
	);
}

/**
 * Look at the existing entry.
 * @returns {Promise<"absent" | "current" | "own" | "foreign">}
 *   current = ours and already correct; own = ours but stale.
 */
export async function inspectEntry({ platform, entryPath, target }) {
	let stat;
	try {
		stat = await lstat(entryPath);
	} catch (err) {
		if (err.code === "ENOENT") return "absent";
		throw err;
	}
	if (platform === "win32") {
		if (!stat.isFile()) return "foreign";
		const content = await readFile(entryPath, "utf8");
		if (!content.startsWith(CMD_MARKER)) return "foreign";
		return content === cmdContent(target) ? "current" : "own";
	}
	if (!stat.isSymbolicLink()) return "foreign";
	const linkTarget = await readlink(entryPath);
	if (path.resolve(path.dirname(entryPath), linkTarget) === target) {
		return "current";
	}
	return isOurLinkTarget(linkTarget, platform) ? "own" : "foreign";
}

/**
 * Make or update the entry.
 * @returns {Promise<{ status: "created" | "replaced" | "unchanged", entryPath: string }>}
 */
// File operations use the host path module: binDir is a real folder on this machine.
// The platform argument only selects the entry type (symlink or .cmd).
export async function linkBin({ platform, binDir, target }) {
	const entryPath = path.join(binDir, entryName(platform));
	const state = await inspectEntry({ platform, entryPath, target });
	if (state === "foreign") {
		throw new Error(
			`${entryPath} exists and was not made by md-coeditor. Remove it or set COEDIT_BIN_DIR to another folder.`,
		);
	}
	if (state === "current") return { status: "unchanged", entryPath };
	await mkdir(binDir, { recursive: true });
	if (state === "own") await unlink(entryPath);
	if (platform === "win32") {
		await writeFile(entryPath, cmdContent(target), "utf8");
	} else {
		await symlink(target, entryPath);
	}
	return { status: state === "own" ? "replaced" : "created", entryPath };
}

/**
 * Delete the entry if it is ours.
 * @returns {Promise<{ status: "removed" | "absent", entryPath: string }>}
 */
export async function unlinkBin({ platform, binDir, target }) {
	const entryPath = path.join(binDir, entryName(platform));
	const state = await inspectEntry({ platform, entryPath, target });
	if (state === "foreign") {
		throw new Error(`${entryPath} was not made by md-coeditor. Not removed.`);
	}
	if (state === "absent") return { status: "absent", entryPath };
	await unlink(entryPath);
	return { status: "removed", entryPath };
}

export function isOnPath(binDir, platform, env) {
	const p = pathFor(platform);
	const value = getEnv(env, "PATH", platform) ?? "";
	const norm = (dir) => {
		const resolved = p.resolve(dir);
		const trimmed =
			resolved.length > 1 ? resolved.replace(/[\\/]+$/, "") : resolved;
		return platform === "win32" ? trimmed.toLowerCase() : trimmed;
	};
	const wanted = norm(binDir);
	return value
		.split(p.delimiter)
		.filter(Boolean)
		.some((dir) => norm(dir) === wanted);
}

export function pathHint(platform, binDir) {
	if (platform === "win32") {
		return [
			`${binDir} is not on your PATH. To add it for your user, run in PowerShell:`,
			`  [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";${binDir}", "User")`,
			"Then open a new terminal.",
		].join("\n");
	}
	const rc = platform === "darwin" ? "~/.zshrc" : "~/.bashrc (or ~/.zshrc)";
	return [
		`${binDir} is not on your PATH. Add this line to ${rc}:`,
		`  export PATH="${binDir}:$PATH"`,
		"Then open a new terminal.",
	].join("\n");
}

async function main() {
	const args = process.argv.slice(2);
	const unknown = args.filter((a) => a !== "--remove");
	if (unknown.length > 0) {
		console.error(
			`link-bin: unknown argument '${unknown[0]}'. Usage: pnpm link:bin [--remove]`,
		);
		return 2;
	}
	const platform = process.platform;
	const repoRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);
	const target = path.join(repoRoot, ...TARGET_SUFFIX);
	const binDir = path.resolve(
		defaultBinDir(platform, process.env, os.homedir()),
	);

	try {
		if (args.includes("--remove")) {
			const r = await unlinkBin({ platform, binDir, target });
			console.log(
				r.status === "removed"
					? `Removed ${r.entryPath}`
					: `Nothing to remove: ${r.entryPath} does not exist`,
			);
			return 0;
		}
		const r = await linkBin({ platform, binDir, target });
		const verb = {
			created: "Created",
			replaced: "Updated",
			unchanged: "Already linked:",
		}[r.status];
		console.log(`${verb} ${r.entryPath} -> ${target}`);
		if (!existsSync(target)) {
			console.warn(`Warning: ${target} does not exist yet. Run "pnpm build".`);
		}
		if (!isOnPath(binDir, platform, process.env)) {
			console.warn(pathHint(platform, binDir));
		}
		return 0;
	} catch (err) {
		console.error(
			`link-bin: ${err instanceof Error ? err.message : String(err)}`,
		);
		return 1;
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exitCode = await main();
}
