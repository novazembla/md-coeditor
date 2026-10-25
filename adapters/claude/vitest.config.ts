import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "claude-plugin",
		environment: "node",
	},
});
