import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(path.join(here, "package.json"), "utf8"));
const outfile = path.join(here, "dist", "coedit.mjs");
const watch = process.argv.includes("--watch");

async function makeExecutable() {
	// Windows has no executable bit and ignores the shebang (design D4a).
	if (process.platform !== "win32") await chmod(outfile, 0o755);
}

/** @type {import("esbuild").BuildOptions} */
const options = {
	absWorkingDir: here,
	entryPoints: [path.join(here, "src", "cli.ts")],
	outfile,
	platform: "node",
	target: "node24",
	format: "esm",
	bundle: true,
	logLevel: "info",
	banner: {
		js: [
			"#!/usr/bin/env node",
			'import { createRequire as __coeditCreateRequire } from "node:module";',
			"const require = __coeditCreateRequire(import.meta.url);",
		].join("\n"),
	},
	define: {
		__COEDIT_VERSION__: JSON.stringify(pkg.version),
	},
	plugins: [
		{
			name: "chmod",
			setup(build) {
				build.onEnd(async (result) => {
					if (result.errors.length === 0) await makeExecutable();
				});
			},
		},
	],
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
} else {
	await esbuild.build(options);
}
