export interface HubRuntime {
	stop(): Promise<void>;
}

/** Hub runtime that handles an unload during start: stop it when start ends. */
export interface ManagedHub {
	start(): Promise<void>;
	stop(): Promise<void>;
}

/** Wrap a start function; `stop()` before the start ends stops it after. */
export function manageHub(begin: () => Promise<HubRuntime>): ManagedHub {
	let runtime: HubRuntime | null = null;
	let stopped = false;
	return {
		async start() {
			const started = await begin();
			if (stopped) {
				await started.stop();
				return;
			}
			runtime = started;
		},
		async stop() {
			stopped = true;
			const current = runtime;
			runtime = null;
			if (current) await current.stop();
			// If start is pending, `start()` stops the hub when it resolves.
		},
	};
}
