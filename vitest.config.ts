import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			"packages/*",
			// End-to-end tests run in the real Obsidian app: pnpm test:e2e.
			"!packages/e2e",
			"adapters/*",
			{
				test: {
					name: "scripts",
					include: ["scripts/**/*.test.mjs"],
					environment: "node",
				},
			},
		],
		passWithNoTests: true,
	},
});
