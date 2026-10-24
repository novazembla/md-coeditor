import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "obsidian",
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
	},
});
