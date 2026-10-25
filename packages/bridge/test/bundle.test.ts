import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeSourceHash } from "../source-hash.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(here, "..", "dist", "coedit.mjs");
const pkg = JSON.parse(
	readFileSync(path.join(here, "..", "package.json"), "utf8"),
) as { version: string };
const built = existsSync(bundle);

const SKIP_NOTE = `${bundle} not found: run "pnpm build" first`;

if (!built) console.warn(`[bridge] Skipping bundle tests. ${SKIP_NOTE}.`);

function coedit(...args: string[]) {
	// Start Node directly; do not rely on the shebang (design D4b).
	return spawnSync(process.execPath, [bundle, ...args], {
		encoding: "utf8",
		cwd: path.parse(here).root,
	});
}

if (!built) {
	it("dist/coedit.mjs (not built)", (ctx) => ctx.skip(SKIP_NOTE));
}

describe.skipIf(!built)("dist/coedit.mjs", () => {
	it("starts with the shebang line", () => {
		expect(readFileSync(bundle, "utf8").split("\n")[0]).toBe(
			"#!/usr/bin/env node",
		);
	});

	it("--version prints the package version", () => {
		const r = coedit("--version");
		expect(r.status).toBe(0);
		expect(r.stdout).toBe(`${pkg.version}\n`);
		expect(r.stderr).toBe("");
	});

	it("--help prints usage", () => {
		const r = coedit("--help");
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("Usage");
	});

	it("unknown subcommand exits 2 with nothing on stdout", () => {
		const r = coedit("frobnicate");
		expect(r.status).toBe(2);
		expect(r.stdout).toBe("");
		expect(r.stderr).toContain("frobnicate");
		expect(r.stderr).toContain("coedit --help");
	});

	it("no arguments prints usage and exits 0", () => {
		const r = coedit();
		expect(r.status).toBe(0);
		expect(r.stdout).toContain("Usage");
	});

	it("unknown option exits 2", () => {
		expect(coedit("--frobnicate").status).toBe(2);
	});

	it("is not stale against the source", async () => {
		const meta = JSON.parse(
			readFileSync(path.join(here, "..", "dist", "coedit.build.json"), "utf8"),
		) as { sourceHash: string };
		const current = await computeSourceHash();
		expect(meta.sourceHash, "dist/coedit.mjs is stale: run pnpm build").toBe(
			current,
		);
	});
});
