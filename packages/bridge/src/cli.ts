import { run } from "./run";

declare const __COEDIT_VERSION__: string | undefined;

const version =
	typeof __COEDIT_VERSION__ === "string" ? __COEDIT_VERSION__ : "0.0.0-dev";

process.exitCode = await run(process.argv.slice(2), {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	version,
});
