import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	coeditDir,
	coeditGitignorePath,
	configPath,
} from "@md-coeditor/protocol";
import {
	type Env,
	findClaude,
	findClaudePlugin,
	findPluginDir,
	type ListPlugins,
	listInstalledPlugins,
	PLUGIN_NAME,
	type Platform,
	resolveClaude,
	runningFile,
} from "../claude-plugins";
import type { Io, Subcommand } from "../run";
import { findVaultUp } from "../vault";

// Same values as EXIT_* in run.ts; not imported, to avoid an import cycle.
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

export const INIT_USAGE = `Usage: coedit init [--dev]

Prepare the Obsidian vault at or above this folder for the co-editor.

Options:
  --dev        Link the Obsidian plugin to the repo build instead of copying it
  -h, --help   Show this help
`;

const GITIGNORE_LINES = ["local/", "snapshots/", "*.sock", "*.lock"];
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];
const MARKETPLACE = "md-coeditor";

export interface InitDeps {
	cwd: string;
	env: Env;
	platform: Platform;
	execPath: string;
	runningFile: string;
	exists: (file: string) => boolean;
	readFile: (file: string) => string;
	listPlugins: ListPlugins;
}

function defaultDeps(): InitDeps {
	return {
		cwd: process.cwd(),
		env: process.env,
		platform: process.platform,
		execPath: process.execPath,
		runningFile: runningFile(),
		exists: existsSync,
		readFile: (f) => readFileSync(f, "utf8"),
		listPlugins: listInstalledPlugins,
	};
}

export function createInitCommand(
	overrides: Partial<InitDeps> = {},
): Subcommand {
	return {
		name: "init",
		description: "Prepare the vault: plugin, .coedit folder, Claude report",
		handler: (args, io) =>
			runInit(args, io, { ...defaultDeps(), ...overrides }),
	};
}

export const initCommand: Subcommand = createInitCommand();

/**
 * Source of the Obsidian plugin files: `COEDIT_OBSIDIAN_PLUGIN_DIR` (for tests
 * and unusual layouts), else `packages/obsidian/dist` found from the running
 * `coedit.mjs` (`packages/bridge/dist/../../obsidian/dist`).
 */
export function findObsidianPluginDir(
	env: Env,
	running: string,
	exists: (file: string) => boolean,
): string | undefined {
	const candidates: string[] = [];
	const fromEnv = env.COEDIT_OBSIDIAN_PLUGIN_DIR;
	if (fromEnv !== undefined && fromEnv !== "") candidates.push(fromEnv);
	candidates.push(
		path.resolve(path.dirname(running), "..", "..", "obsidian", "dist"),
	);
	return candidates.find(
		(d) =>
			exists(path.join(d, "main.js")) && exists(path.join(d, "manifest.json")),
	);
}

/** Nearest folder with `.git` (a folder or a file) at or above `from`. */
export function findGitRoot(from: string): string | undefined {
	let current = path.resolve(from);
	for (;;) {
		if (existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/** -1, 0 or 1. Compares the numeric parts of two versions. */
export function compareVersions(a: string, b: string): number {
	const parts = (v: string) =>
		v.split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
	const pa = parts(a);
	const pb = parts(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d < 0 ? -1 : 1;
	}
	return 0;
}

function readVersion(manifest: string): string {
	try {
		const v = (
			JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }
		).version;
		return typeof v === "string" ? v : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function sameFile(a: string, b: string): boolean {
	try {
		return readFileSync(a).equals(readFileSync(b));
	} catch {
		return false;
	}
}

function lstatOrUndefined(p: string) {
	try {
		return lstatSync(p);
	} catch {
		return undefined;
	}
}

function samePathReal(a: string, b: string): boolean {
	try {
		return realpathSync(a) === realpathSync(b);
	} catch {
		return false;
	}
}

interface Report {
	out: (text: string) => void;
	err: (text: string) => void;
	failed: boolean;
}

/**
 * Copy the plugin files, or with `--dev` link the folder to the repo build.
 * A real folder is never replaced by a link: the user may have local changes.
 */
function installObsidianPlugin(
	vault: string,
	source: string,
	dev: boolean,
	platform: Platform,
	r: Report,
): void {
	const target = path.join(vault, ".obsidian", "plugins", PLUGIN_NAME);
	const st = lstatOrUndefined(target);
	const isLink = st?.isSymbolicLink() === true;

	if (dev) {
		if (isLink && samePathReal(target, source)) {
			r.out(`Obsidian plugin: already linked to ${source}\n`);
			return;
		}
		if (st !== undefined && !isLink) {
			r.err(
				`${target} is a real folder. Remove it first to use --dev (it would be replaced by a link to ${source}).\n`,
			);
			r.failed = true;
			return;
		}
		if (isLink) rmSync(target, { force: true });
		mkdirSync(path.dirname(target), { recursive: true });
		// A junction needs an absolute target. A relative symlink keeps working
		// when the repo folder moves.
		if (platform === "win32") symlinkSync(source, target, "junction");
		else
			symlinkSync(path.relative(path.dirname(target), source), target, "dir");
		r.out(`Obsidian plugin: linked ${target} -> ${source}\n`);
		return;
	}

	if (isLink) {
		r.out(
			`Obsidian plugin: ${target} is a link (${readlinkSync(target)}); left as it is.\n`,
		);
		return;
	}
	const sourceVersion = readVersion(path.join(source, "manifest.json"));
	let copy = st === undefined;
	if (!copy) {
		const installed = readVersion(path.join(target, "manifest.json"));
		const cmp = compareVersions(installed, sourceVersion);
		copy =
			cmp < 0 ||
			(cmp === 0 &&
				!sameFile(path.join(source, "main.js"), path.join(target, "main.js")));
		if (cmp > 0) {
			r.out(
				`Obsidian plugin: installed version ${installed} is newer than ${sourceVersion}; left as it is.\n`,
			);
			return;
		}
	}
	if (!copy) {
		r.out(`Obsidian plugin: ${sourceVersion} is up to date.\n`);
		return;
	}
	mkdirSync(target, { recursive: true });
	for (const file of PLUGIN_FILES) {
		const from = path.join(source, file);
		if (existsSync(from)) copyFileSync(from, path.join(target, file));
	}
	r.out(`Obsidian plugin: copied version ${sourceVersion} to ${target}\n`);
}

function enableCommunityPlugin(vault: string, r: Report): void {
	const file = path.join(vault, ".obsidian", "community-plugins.json");
	let list: unknown[] = [];
	if (existsSync(file)) {
		try {
			const data: unknown = JSON.parse(readFileSync(file, "utf8"));
			if (!Array.isArray(data)) throw new Error("not an array");
			list = data;
		} catch {
			r.err(
				`${file} is not a JSON list. Add "${PLUGIN_NAME}" to it by hand.\n`,
			);
			r.failed = true;
			return;
		}
	}
	if (list.includes(PLUGIN_NAME)) return;
	list.push(PLUGIN_NAME);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
	r.out(`Added ${PLUGIN_NAME} to community-plugins.json\n`);
}

function prepareCoeditFolder(vault: string, r: Report): void {
	mkdirSync(coeditDir(vault), { recursive: true });
	const config = configPath(vault);
	if (!existsSync(config)) {
		writeFileSync(config, '{"digestBudget": 8000}\n');
		r.out("Wrote .coedit/config.json\n");
	}
	const ignore = coeditGitignorePath(vault);
	if (!existsSync(ignore)) {
		writeFileSync(ignore, `${GITIGNORE_LINES.join("\n")}\n`);
		r.out("Wrote .coedit/.gitignore\n");
		return;
	}
	const text = readFileSync(ignore, "utf8");
	const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
	const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
	if (missing.length === 0) return;
	const sep = text === "" || text.endsWith("\n") ? "" : "\n";
	writeFileSync(ignore, `${text}${sep}${missing.join("\n")}\n`);
	r.out(`Added to .coedit/.gitignore: ${missing.join(", ")}\n`);
}

async function reportClaudePlugin(deps: InitDeps, r: Report): Promise<void> {
	const location = findClaude({
		env: deps.env,
		platform: deps.platform,
		exists: deps.exists,
	});
	if (location === undefined) {
		r.out(
			"Warning: claude was not found on the PATH. Install Claude Code to use the co-editor.\n",
		);
		return;
	}
	const resolved = resolveClaude(
		location,
		deps.platform,
		deps.execPath,
		deps.readFile,
		deps.exists,
	);
	if (!resolved.ok) {
		r.out(`Warning: ${resolved.message}\n`);
		return;
	}
	const entry = findClaudePlugin(
		await deps.listPlugins(resolved.claude),
		deps.cwd,
		deps.platform,
	);
	if (entry === undefined) {
		const pluginDir = findPluginDir(deps.env, deps.runningFile, deps.exists);
		const repo =
			pluginDir === undefined ? undefined : path.resolve(pluginDir, "..", "..");
		const source =
			repo !== undefined &&
			deps.exists(path.join(repo, ".claude-plugin", "marketplace.json"))
				? repo
				: "<repo or path>";
		r.out(
			[
				"Claude plugin: not installed. coedit claude works without an install.",
				"To install it at user scope:",
				`  claude plugin marketplace add ${source}`,
				`  claude plugin install ${PLUGIN_NAME}@${MARKETPLACE}`,
				"",
			].join("\n"),
		);
		return;
	}
	r.out(
		`Claude plugin: ${entry.id} is installed${entry.scope ? ` (scope ${entry.scope}${entry.enabled ? ", on" : ", off"})` : ""}.\n`,
	);
	if (entry.scope === "user" && entry.enabled === true) {
		r.out(
			[
				`Warning: ${entry.id} is on at user scope, so plain claude sessions load the co-editor.`,
				"To switch it off (coedit claude still turns it on for its own session):",
				`  claude plugin disable ${entry.id}`,
				"",
			].join("\n"),
		);
	}
}

export function denyRuleText(vault: string): string {
	const root = findGitRoot(vault) ?? vault;
	const rel = path.relative(root, vault).split(path.sep).join("/");
	const rule = `Edit(/${rel === "" ? "" : `${rel}/`}**/*.md)`;
	const settings = path.join(root, ".claude", "settings.json");
	return [
		"Deny rule: to make Claude Code refuse direct edits of your notes, add this to",
		`${settings}`,
		"",
		"  {",
		'    "permissions": {',
		`      "deny": ["${rule}"]`,
		"    }",
		"  }",
		"",
		`The rule applies when coedit claude starts in ${root}.`,
		"coedit init does not write this file. The rule does not stop scripts that the",
		"agent runs; for a hard block, use the Claude Code sandbox.",
		"",
	].join("\n");
}

export async function runInit(
	argv: string[],
	io: Io,
	deps: InitDeps,
): Promise<number> {
	let dev = false;
	try {
		const { values } = parseArgs({
			args: argv,
			strict: true,
			allowPositionals: false,
			options: {
				dev: { type: "boolean" },
				help: { type: "boolean", short: "h" },
			},
		});
		if (values.help) {
			io.stdout(INIT_USAGE);
			return EXIT_OK;
		}
		dev = values.dev === true;
	} catch (err) {
		io.stderr(
			`coedit init: ${err instanceof Error ? err.message : String(err)}\n${INIT_USAGE}`,
		);
		return EXIT_USAGE;
	}

	const vault = findVaultUp(deps.cwd);
	if (vault === undefined) {
		io.stderr(
			`coedit init: Not inside an Obsidian vault (no .obsidian folder at or above ${deps.cwd}).\n`,
		);
		return EXIT_ERROR;
	}

	const r: Report = { out: io.stdout, err: io.stderr, failed: false };
	r.out(`Vault: ${vault}\n`);

	prepareCoeditFolder(vault, r);

	const source = findObsidianPluginDir(deps.env, deps.runningFile, deps.exists);
	if (source === undefined) {
		r.err(
			"Obsidian plugin files not found next to this coedit (looked for packages/obsidian/dist with main.js and manifest.json; COEDIT_OBSIDIAN_PLUGIN_DIR overrides). Skipped the plugin step.\n",
		);
		r.failed = true;
	} else {
		installObsidianPlugin(vault, source, dev, deps.platform, r);
		r.out("Reload Obsidian to load the plugin.\n");
	}
	enableCommunityPlugin(vault, r);

	r.out("\n");
	await reportClaudePlugin(deps, r);
	r.out("\n");
	r.out(denyRuleText(vault));

	return r.failed ? EXIT_ERROR : EXIT_OK;
}
