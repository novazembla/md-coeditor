import { type InboxDeps, runInbox } from "../src/commands/inbox";

export interface InboxRun {
	code: number;
	stdout: string;
	stderr: string;
	ms: number;
}

/** `coedit inbox` in this process, with a fake stdin. */
export async function inbox(
	argv: string[],
	o: {
		env: Record<string, string | undefined>;
		stdin?: string;
		cwd?: string;
		hostname?: string;
		createClient?: InboxDeps["createClient"];
	},
): Promise<InboxRun> {
	let stdout = "";
	let stderr = "";
	const start = Date.now();
	const code = await runInbox(
		argv,
		{
			stdout: (t) => {
				stdout += t;
			},
			stderr: (t) => {
				stderr += t;
			},
			version: "0.0.0-test",
		},
		{
			env: o.env,
			cwd: o.cwd ?? process.cwd(),
			hostname: o.hostname ?? "mac",
			stdinIsTTY: o.stdin === undefined,
			readStdin: async () => o.stdin ?? "",
			createClient: o.createClient,
		},
	);
	return { code, stdout, stderr, ms: Date.now() - start };
}
