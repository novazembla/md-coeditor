// Runs the end-to-end tests in Linux in Docker, with a virtual display (xvfb),
// so no Obsidian window opens on the desktop. Needs a running Docker engine.
// Extra arguments go to wdio, for example: pnpm test:e2e:docker --spec tests/cursor.e2e.ts
// See openspec/docs/testing.md.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const image = "md-coeditor-e2e";
// Named volume: Obsidian is downloaded once, not on each run.
const cacheVolume = "md-coeditor-e2e-obsidian-cache";
const args = process.argv.slice(2);

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, {
		cwd: repoRoot,
		stdio: "inherit",
	});
	if (result.error) {
		console.error(
			`test:e2e:docker: cannot start ${command}: ${result.error.message}`,
		);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run("docker", [
	"build",
	"--file",
	join(repoRoot, "packages", "e2e", "docker", "Dockerfile"),
	"--tag",
	image,
	repoRoot,
]);

run("docker", [
	"run",
	"--rm",
	"--init",
	// Chromium needs more shared memory than the 64 MB default.
	"--shm-size=1g",
	"--volume",
	`${cacheVolume}:/repo/packages/e2e/.obsidian-cache`,
	image,
	"xvfb-run",
	"-a",
	"--server-args=-screen 0 1280x1024x24",
	"pnpm",
	"test:e2e",
	...args,
]);
