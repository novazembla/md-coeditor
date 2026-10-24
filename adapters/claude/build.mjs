// Copy the coedit bundle into the plugin, so the plugin is self-contained (design D9).
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(
	here,
	"..",
	"..",
	"packages",
	"bridge",
	"dist",
	"coedit.mjs",
);
const dest = path.join(here, "dist", "coedit.mjs");

await mkdir(path.dirname(dest), { recursive: true });
try {
	await copyFile(source, dest);
} catch (err) {
	if (err.code === "ENOENT") {
		console.error(`${source} not found. Build @md-coeditor/bridge first.`);
		process.exit(1);
	}
	throw err;
}
if (process.platform !== "win32") await chmod(dest, 0o755);
console.log(`Copied ${source} -> ${dest}`);
