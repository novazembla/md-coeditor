import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, "dist");
const production = process.argv[2] === "production";

function copyStatic() {
	mkdirSync(outDir, { recursive: true });
	copyFileSync(join(root, "manifest.json"), join(outDir, "manifest.json"));
	copyFileSync(join(root, "styles.css"), join(outDir, "styles.css"));
	writeFileSync(join(outDir, ".hotreload"), "");
}

const copyStaticPlugin = {
	name: "copy-static",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length === 0) copyStatic();
		});
	},
};

const context = await esbuild.context({
	absWorkingDir: root,
	entryPoints: [join(root, "src", "main.ts")],
	outfile: join(outDir, "main.js"),
	bundle: true,
	format: "cjs",
	target: "es2022",
	platform: "node",
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	minify: production,
	plugins: [copyStaticPlugin],
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
