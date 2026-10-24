// Links test-vault/.obsidian/plugins/md-coeditor to packages/obsidian/dist.
// macOS/Linux: relative symlink. Windows: directory junction (absolute target, no admin rights).
// Temporary: `coedit init --dev` replaces this script later.
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(repoRoot, "packages", "obsidian", "dist");
const pluginsDir = join(repoRoot, "test-vault", ".obsidian", "plugins");
const link = join(pluginsDir, "md-coeditor");
const isWindows = process.platform === "win32";

function fail(message) {
	console.error(`link:vault: ${message}`);
	process.exit(1);
}

function lstatOrNull(path) {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

mkdirSync(pluginsDir, { recursive: true });

const stat = lstatOrNull(link);
if (stat) {
	if (!stat.isSymbolicLink()) {
		fail(
			`${link} exists and is a real ${stat.isDirectory() ? "folder" : "file"}, not a link. Remove it and run again.`,
		);
	}
	const current = resolve(pluginsDir, readlinkSync(link));
	if (current === target) {
		console.log(
			`link:vault: link already exists, no change: ${link} -> ${target}`,
		);
		process.exit(0);
	}
	console.log(`link:vault: link points to ${current}, replacing it.`);
	unlinkSync(link);
}

if (isWindows) {
	symlinkSync(target, link, "junction");
} else {
	symlinkSync(relative(pluginsDir, target), link, "dir");
}
console.log(`link:vault: linked ${link} -> ${target}`);
if (!existsSync(target)) {
	console.log(
		"link:vault: note: the target does not exist yet. Run `pnpm build`.",
	);
}
