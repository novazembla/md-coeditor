import { parseArgs } from "node:util";
import { claudeCommand } from "./commands/claude";
import { inboxCommand } from "./commands/inbox";
import { initCommand } from "./commands/init";
import { mcpCommand } from "./commands/mcp";

export interface Io {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	version: string;
}

export interface Subcommand {
	name: string;
	description: string;
	handler: (args: string[], io: Io) => Promise<number> | number;
}

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

/** Order: init, claude, inbox, mcp. Each task adds its own entry. */
export const subcommands: readonly Subcommand[] = [
	initCommand,
	claudeCommand,
	inboxCommand,
	mcpCommand,
];

export function helpText(
	registry: readonly Subcommand[] = subcommands,
): string {
	const lines = ["Usage: coedit <command> [options]", "", "Commands:"];
	if (registry.length === 0) {
		lines.push("  (no commands are available yet)");
	} else {
		const width = Math.max(...registry.map((c) => c.name.length));
		for (const c of registry) {
			lines.push(`  ${c.name.padEnd(width)}  ${c.description}`);
		}
	}
	lines.push(
		"",
		"Options:",
		"  -h, --help     Show this help",
		"  -v, --version  Show the version",
		"",
	);
	return lines.join("\n");
}

function usageError(io: Io, message: string): number {
	io.stderr(`coedit: ${message}\nRun 'coedit --help' for usage.\n`);
	return EXIT_USAGE;
}

export async function run(
	argv: string[],
	io: Io,
	registry: readonly Subcommand[] = subcommands,
): Promise<number> {
	const first = argv[0];
	if (first !== undefined && !first.startsWith("-")) {
		const command = registry.find((c) => c.name === first);
		if (!command) return usageError(io, `unknown command '${first}'`);
		try {
			return await command.handler(argv.slice(1), io);
		} catch (err) {
			io.stderr(
				`coedit: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			return EXIT_ERROR;
		}
	}

	let values: { help?: boolean; version?: boolean };
	try {
		({ values } = parseArgs({
			args: argv,
			strict: true,
			allowPositionals: false,
			options: {
				help: { type: "boolean", short: "h" },
				version: { type: "boolean", short: "v" },
			},
		}));
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
			const unknown = argv.find((a) => a.startsWith("-") && !isKnownOption(a));
			return usageError(io, `unknown option '${unknown ?? argv.join(" ")}'`);
		}
		if (code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") {
			const extra = argv.find((a) => !a.startsWith("-"));
			return usageError(io, `unexpected argument '${extra ?? argv.join(" ")}'`);
		}
		return usageError(io, err instanceof Error ? err.message : String(err));
	}

	if (values.version) {
		io.stdout(`${io.version}\n`);
		return EXIT_OK;
	}
	io.stdout(helpText(registry));
	return EXIT_OK;
}

function isKnownOption(arg: string): boolean {
	return ["--help", "-h", "--version", "-v"].includes(arg);
}
