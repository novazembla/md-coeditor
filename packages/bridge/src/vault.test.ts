import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	discoverVault,
	findVaultsBelow,
	findVaultUp,
	vaultFromEnv,
} from "./vault";

let root: string;
const mk = (...parts: string[]) => {
	const p = path.join(root, ...parts);
	mkdirSync(p, { recursive: true });
	return p;
};
const vault = (...parts: string[]) =>
	mk(...parts, ".obsidian") && path.join(root, ...parts);

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), "coedit-vault-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("findVaultUp", () => {
	it("finds the vault at the folder itself and above", () => {
		const v = vault("v");
		const deep = mk("v", "a", "b");
		expect(findVaultUp(v)).toBe(v);
		expect(findVaultUp(deep)).toBe(v);
	});
	it("returns the nearest vault", () => {
		vault("v");
		const inner = vault("v", "inner");
		expect(findVaultUp(mk("v", "inner", "x"))).toBe(inner);
	});
	it("returns undefined without a vault", () => {
		expect(findVaultUp(mk("none"))).toBeUndefined();
	});
});

describe("findVaultsBelow", () => {
	it("finds vaults up to 3 levels deep, sorted", () => {
		const b = vault("b");
		const a = vault("x", "y", "a");
		vault("p", "q", "r", "too-deep");
		expect(findVaultsBelow(root)).toEqual([b, a].sort());
	});
	it("skips dot folders and node_modules", () => {
		vault(".hidden", "v");
		vault("node_modules", "v");
		expect(findVaultsBelow(root)).toEqual([]);
	});
});

describe("discoverVault", () => {
	it("prefers a vault at or above", () => {
		const v = vault("v");
		vault("v", "sub", "other");
		expect(discoverVault(v)).toEqual({ kind: "found", vault: v });
	});
	it("uses the one vault below", () => {
		const v = vault("docs", "vault");
		expect(discoverVault(root)).toEqual({ kind: "found", vault: v });
	});
	it("reports none", () => {
		expect(discoverVault(root)).toEqual({ kind: "none" });
	});
	it("reports many, sorted", () => {
		const a = vault("a");
		const b = vault("b");
		expect(discoverVault(root)).toEqual({ kind: "many", vaults: [a, b] });
	});
});

describe("vaultFromEnv", () => {
	it("uses COEDIT_VAULT when set", () => {
		expect(vaultFromEnv({ COEDIT_VAULT: "/work/notes" }, root)).toEqual({
			kind: "found",
			vault: path.resolve("/work/notes"),
		});
	});
	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal unexpanded variable
	it.each([[undefined], [""], ["${COEDIT_VAULT}"]])(
		"falls back to discovery for %j",
		(value) => {
			const v = vault("docs", "vault");
			expect(vaultFromEnv({ COEDIT_VAULT: value }, root)).toEqual({
				kind: "found",
				vault: v,
			});
		},
	);
});
