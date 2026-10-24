import {
	lstat,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CMD_MARKER,
	cmdContent,
	defaultBinDir,
	isOnPath,
	linkBin,
	pathHint,
	unlinkBin,
} from "./link-bin.mjs";

let tmp;
beforeEach(async () => {
	tmp = await mkdtemp(path.join(os.tmpdir(), "coedit-link-bin-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true, force: true });
});

function fakeTarget(root = "repo") {
	return path.join(tmp, root, "packages", "bridge", "dist", "coedit.mjs");
}

describe.skipIf(process.platform === "win32")(
	"symlink entry (macOS, Linux)",
	() => {
		const platform = process.platform;

		it("creates the bin folder and a symlink to the target", async () => {
			const binDir = path.join(tmp, "a", "bin");
			const target = fakeTarget();
			const r = await linkBin({ platform, binDir, target });
			expect(r.status).toBe("created");
			expect(await readlink(path.join(binDir, "coedit"))).toBe(target);
		});

		it("is idempotent", async () => {
			const binDir = path.join(tmp, "bin");
			const target = fakeTarget();
			await linkBin({ platform, binDir, target });
			const r = await linkBin({ platform, binDir, target });
			expect(r.status).toBe("unchanged");
		});

		it("replaces its own stale symlink (repo moved)", async () => {
			const binDir = path.join(tmp, "bin");
			await linkBin({ platform, binDir, target: fakeTarget("old") });
			const target = fakeTarget("new");
			const r = await linkBin({ platform, binDir, target });
			expect(r.status).toBe("replaced");
			expect(await readlink(path.join(binDir, "coedit"))).toBe(target);
		});

		it("refuses a foreign file and a foreign symlink", async () => {
			const binDir = path.join(tmp, "bin");
			await linkBin({ platform, binDir, target: fakeTarget() });
			await rm(path.join(binDir, "coedit"));
			await writeFile(path.join(binDir, "coedit"), "#!/bin/sh\n");
			await expect(
				linkBin({ platform, binDir, target: fakeTarget() }),
			).rejects.toThrow(/not made by md-coeditor/);
			await rm(path.join(binDir, "coedit"));
			await symlink("/usr/bin/true", path.join(binDir, "coedit"));
			await expect(
				linkBin({ platform, binDir, target: fakeTarget() }),
			).rejects.toThrow(/not made by md-coeditor/);
			await expect(
				unlinkBin({ platform, binDir, target: fakeTarget() }),
			).rejects.toThrow(/Not removed/);
		});

		it("--remove deletes its own entry, then reports absent", async () => {
			const binDir = path.join(tmp, "bin");
			const target = fakeTarget();
			await linkBin({ platform, binDir, target });
			expect((await unlinkBin({ platform, binDir, target })).status).toBe(
				"removed",
			);
			await expect(lstat(path.join(binDir, "coedit"))).rejects.toThrow();
			expect((await unlinkBin({ platform, binDir, target })).status).toBe(
				"absent",
			);
		});
	},
);

describe("cmd entry (Windows)", () => {
	const platform = "win32";
	const target = "C:\\repo\\packages\\bridge\\dist\\coedit.mjs";

	it("writes coedit.cmd that calls node with the absolute path", async () => {
		const binDir = path.join(tmp, "win", "bin");
		const r = await linkBin({ platform, binDir, target });
		expect(r.status).toBe("created");
		const content = await readFile(path.join(binDir, "coedit.cmd"), "utf8");
		expect(content.startsWith(CMD_MARKER)).toBe(true);
		expect(content).toContain(`@node "${target}" %*`);
		expect(content).toContain("\r\n");
	});

	it("is idempotent and replaces its own stale entry", async () => {
		const binDir = path.join(tmp, "bin");
		await linkBin({ platform, binDir, target });
		expect((await linkBin({ platform, binDir, target })).status).toBe(
			"unchanged",
		);
		const moved = "D:\\new\\packages\\bridge\\dist\\coedit.mjs";
		expect((await linkBin({ platform, binDir, target: moved })).status).toBe(
			"replaced",
		);
		expect(await readFile(path.join(binDir, "coedit.cmd"), "utf8")).toBe(
			cmdContent(moved),
		);
	});

	it("refuses a foreign coedit.cmd", async () => {
		const binDir = path.join(tmp, "bin");
		await linkBin({ platform, binDir, target });
		await writeFile(path.join(binDir, "coedit.cmd"), "@echo other\r\n");
		await expect(linkBin({ platform, binDir, target })).rejects.toThrow(
			/not made by md-coeditor/,
		);
		await expect(unlinkBin({ platform, binDir, target })).rejects.toThrow(
			/Not removed/,
		);
	});

	it("--remove deletes coedit.cmd", async () => {
		const binDir = path.join(tmp, "bin");
		await linkBin({ platform, binDir, target });
		expect((await unlinkBin({ platform, binDir, target })).status).toBe(
			"removed",
		);
		await expect(lstat(path.join(binDir, "coedit.cmd"))).rejects.toThrow();
	});
});

describe("defaultBinDir", () => {
	it("uses ~/.local/bin on macOS and Linux", () => {
		expect(defaultBinDir("darwin", {}, "/Users/me")).toBe(
			"/Users/me/.local/bin",
		);
		expect(defaultBinDir("linux", {}, "/home/me")).toBe("/home/me/.local/bin");
	});

	it("uses %LOCALAPPDATA%\\md-coeditor\\bin on Windows", () => {
		expect(
			defaultBinDir(
				"win32",
				{ LocalAppData: "C:\\Users\\me\\AppData\\Local" },
				"C:\\Users\\me",
			),
		).toBe("C:\\Users\\me\\AppData\\Local\\md-coeditor\\bin");
	});

	it("COEDIT_BIN_DIR overrides the folder", () => {
		expect(
			defaultBinDir("darwin", { COEDIT_BIN_DIR: "/opt/bin" }, "/Users/me"),
		).toBe("/opt/bin");
		expect(
			defaultBinDir("win32", { COEDIT_BIN_DIR: "E:\\bin" }, "C:\\Users\\me"),
		).toBe("E:\\bin");
	});
});

describe("isOnPath and pathHint", () => {
	it("finds the folder on a POSIX PATH (trailing slash ok)", () => {
		const env = { PATH: "/usr/bin:/Users/me/.local/bin/:/bin" };
		expect(isOnPath("/Users/me/.local/bin", "darwin", env)).toBe(true);
		expect(isOnPath("/Users/me/other", "darwin", env)).toBe(false);
	});

	it("compares case-insensitively on Windows and reads Path", () => {
		const env = {
			Path: "C:\\Windows;c:\\users\\me\\appdata\\local\\md-coeditor\\bin\\",
		};
		expect(
			isOnPath("C:\\Users\\me\\AppData\\Local\\md-coeditor\\bin", "win32", env),
		).toBe(true);
		expect(isOnPath("C:\\Other", "win32", env)).toBe(false);
	});

	it("gives an OS-specific instruction", () => {
		expect(pathHint("darwin", "/Users/me/.local/bin")).toContain(
			"export PATH=",
		);
		expect(pathHint("win32", "C:\\bin")).toContain("SetEnvironmentVariable");
	});
});
