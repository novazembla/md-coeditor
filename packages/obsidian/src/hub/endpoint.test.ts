// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endpointPath, localGitignorePath } from "@md-coeditor/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteEndpoint, deleteEndpointSync, writeEndpoint } from "./endpoint";

let vault = "";
beforeEach(async () => {
	vault = await mkdtemp(join(tmpdir(), "coedit-ep-"));
});
afterEach(async () => {
	await rm(vault, { recursive: true, force: true });
});

const info = (token = "t1") => ({
	vault,
	machine: "mac",
	port: 1234,
	token,
	pid: 99,
});

describe("endpoint", () => {
	it("writes endpoint.json with host", async () => {
		await writeEndpoint(info());
		const json = JSON.parse(await readFile(endpointPath(vault, "mac"), "utf8"));
		expect(json).toEqual({
			port: 1234,
			token: "t1",
			pid: 99,
			host: "mac",
		});
	});

	it.skipIf(process.platform === "win32")("uses mode 0600", async () => {
		await writeEndpoint(info());
		const s = await stat(endpointPath(vault, "mac"));
		expect(s.mode & 0o777).toBe(0o600);
	});

	it("writes local/.gitignore only when missing", async () => {
		await writeEndpoint(info());
		expect(await readFile(localGitignorePath(vault), "utf8")).toBe("*\n");
		await writeFile(localGitignorePath(vault), "custom\n");
		await writeEndpoint(info("t2"));
		expect(await readFile(localGitignorePath(vault), "utf8")).toBe("custom\n");
	});

	it("deletes only with its own token", async () => {
		await writeEndpoint(info("t1"));
		await writeEndpoint(info("t2"));
		expect(await deleteEndpoint({ vault, machine: "mac", token: "t1" })).toBe(
			false,
		);
		await stat(endpointPath(vault, "mac"));
		expect(await deleteEndpoint({ vault, machine: "mac", token: "t2" })).toBe(
			true,
		);
		await expect(stat(endpointPath(vault, "mac"))).rejects.toThrow();
	});

	it("deletes synchronously, only with its own token", async () => {
		await writeEndpoint(info("t2"));
		expect(deleteEndpointSync({ vault, machine: "mac", token: "t1" })).toBe(
			false,
		);
		await stat(endpointPath(vault, "mac"));
		expect(deleteEndpointSync({ vault, machine: "mac", token: "t2" })).toBe(
			true,
		);
		await expect(stat(endpointPath(vault, "mac"))).rejects.toThrow();
	});
});
