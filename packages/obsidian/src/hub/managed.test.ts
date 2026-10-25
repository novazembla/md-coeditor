import { describe, expect, it } from "vitest";
import { manageHub } from "./managed";

describe("manageHub", () => {
	it("stops a hub when stop comes before start ends", async () => {
		let release: () => void = () => {};
		let stops = 0;
		const hub = manageHub(
			() =>
				new Promise((resolve) => {
					release = () =>
						resolve({
							stop: async () => {
								stops++;
							},
						});
				}),
		);
		const started = hub.start();
		await hub.stop();
		expect(stops).toBe(0);
		release();
		await started;
		expect(stops).toBe(1);
	});

	it("stops a running hub once", async () => {
		let stops = 0;
		const hub = manageHub(async () => ({
			stop: async () => {
				stops++;
			},
		}));
		await hub.start();
		await hub.stop();
		await hub.stop();
		expect(stops).toBe(1);
	});
});
