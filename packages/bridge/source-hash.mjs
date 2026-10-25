import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.join(here, "..");

/** The source folders that go into the bundle. */
export const SOURCE_DIRS = [
	path.join(packagesDir, "bridge", "src"),
	path.join(packagesDir, "format", "src"),
	path.join(packagesDir, "protocol", "src"),
];

async function listFiles(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await listFiles(full)));
		else if (entry.isFile()) out.push(full);
	}
	return out;
}

/**
 * SHA-256 over the source of the bundle. Used by build.mjs (writes it) and by
 * the bundle test (compares it), so the two cannot drift.
 *
 * Input: all `.ts` files in the source folders, except `*.test.ts` (tests are
 * not in the bundle). For each file, sorted by its path relative to
 * `packages/` (with `/` as separator): the path, then the content with
 * `\r\n` changed to `\n`. So the hash is the same on every machine,
 * checkout folder and line-ending setting.
 */
export async function computeSourceHash() {
	const files = [];
	for (const dir of SOURCE_DIRS) {
		for (const file of await listFiles(dir)) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
			files.push({
				rel: path.relative(packagesDir, file).split(path.sep).join("/"),
				file,
			});
		}
	}
	files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
	const hash = createHash("sha256");
	for (const { rel, file } of files) {
		const text = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
		hash.update(`${rel}\0${text}\0`);
	}
	return hash.digest("hex");
}
