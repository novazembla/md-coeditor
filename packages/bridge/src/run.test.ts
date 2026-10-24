import { describe, expect, it } from "vitest";
import { helpText, type Io, run, type Subcommand } from "./run";

function fakeIo(version = "1.2.3") {
	const out: string[] = [];
	const err: string[] = [];
	const io: Io = {
		stdout: (t) => out.push(t),
		stderr: (t) => err.push(t),
		version,
	};
	return { io, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("run", () => {
	it("--version prints one line with the version and exits 0", async () => {
		const f = fakeIo("0.0.0");
		expect(await run(["--version"], f.io)).toBe(0);
		expect(f.stdout()).toBe("0.0.0\n");
		expect(f.stderr()).toBe("");
	});

	it("--help prints usage and exits 0", async () => {
		const f = fakeIo();
		expect(await run(["--help"], f.io)).toBe(0);
		expect(f.stdout()).toContain("Usage");
		expect(f.stderr()).toBe("");
	});

	it("no arguments prints the same text as --help and exits 0", async () => {
		const a = fakeIo();
		const b = fakeIo();
		expect(await run([], a.io)).toBe(0);
		await run(["--help"], b.io);
		expect(a.stdout()).toBe(b.stdout());
	});

	it("unknown subcommand: error on stderr, nothing on stdout, exit 2", async () => {
		const f = fakeIo();
		expect(await run(["frobnicate"], f.io)).toBe(2);
		expect(f.stderr()).toContain("frobnicate");
		expect(f.stderr()).toContain("coedit --help");
		expect(f.stdout()).toBe("");
	});

	it("unknown option: error on stderr, nothing on stdout, exit 2", async () => {
		const f = fakeIo();
		expect(await run(["--frobnicate"], f.io)).toBe(2);
		expect(f.stderr()).toContain("--frobnicate");
		expect(f.stderr()).toContain("coedit --help");
		expect(f.stdout()).toBe("");
	});

	it("unexpected positional after an option: exit 2", async () => {
		const f = fakeIo();
		expect(await run(["--help", "extra"], f.io)).toBe(2);
		expect(f.stderr()).toContain("extra");
		expect(f.stdout()).toBe("");
	});
});

describe("subcommand registry", () => {
	const registry: Subcommand[] = [
		{
			name: "hello",
			description: "Say hello",
			handler: (args, io) => {
				io.stdout(`hello ${args.join(" ")}\n`);
				return 0;
			},
		},
		{
			name: "boom",
			description: "Fail",
			handler: () => {
				throw new Error("it broke");
			},
		},
	];

	it("help lists each subcommand with its description", () => {
		const text = helpText(registry);
		expect(text).toMatch(/hello\s+Say hello/);
		expect(text).toMatch(/boom\s+Fail/);
	});

	it("empty registry help says no commands are available", () => {
		expect(helpText([])).toContain("no commands are available yet");
	});

	it("dispatches to the handler with the remaining arguments", async () => {
		const f = fakeIo();
		expect(await run(["hello", "a", "b"], f.io, registry)).toBe(0);
		expect(f.stdout()).toBe("hello a b\n");
	});

	it("a handler that throws gives exit 1 and a message on stderr", async () => {
		const f = fakeIo();
		expect(await run(["boom"], f.io, registry)).toBe(1);
		expect(f.stderr()).toContain("it broke");
		expect(f.stdout()).toBe("");
	});
});
