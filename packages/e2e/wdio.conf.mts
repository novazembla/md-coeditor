import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetVault } from "./helpers/reset";

const here = fileURLToPath(new URL(".", import.meta.url));
const pluginDir = join(here, "..", "obsidian");

// The service's "earliest" looks for manifest.json only in the parent
// folders of the working folder, so read minAppVersion here.
const { minAppVersion } = JSON.parse(
	readFileSync(join(pluginDir, "manifest.json"), "utf8"),
) as { minAppVersion: string };

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: ["./tests/**/*.e2e.ts"],
	// One Obsidian window at a time: the windows take the desktop focus.
	maxInstances: 1,

	capabilities: [
		{
			browserName: "obsidian",
			// The plugin's minAppVersion, so the e2e version changes when
			// minAppVersion changes.
			browserVersion: minAppVersion,
			"wdio:obsidianOptions": {
				// The installer brings Electron. A new installer can change
				// behaviour with the same app version, so pin it. 1.14.4 is
				// the newest installer for app 1.14.4 (Electron 43.7.7).
				installerVersion: "1.14.4",
				plugins: [join(pluginDir, "dist")],
				vault: join(here, "vault"),
			},
		},
	],

	services: ["obsidian"],
	reporters: ["obsidian"],

	// Downloaded Obsidian versions (ignored by git).
	cacheDir: join(here, ".obsidian-cache"),
	mochaOpts: {
		ui: "bdd",
		timeout: 60000,
	},
	logLevel: "warn",

	// Shared hook before each test: a clean vault and no open notes.
	beforeTest: async () => {
		await resetVault();
	},
};
