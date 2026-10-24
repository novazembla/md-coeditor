import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			"packages/*",
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
