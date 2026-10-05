// A navigator.locks stand-in: requests on one name run one at a time, in order, as in a browser.
type Callback = (lock: { name: string; mode: 'exclusive' }) => unknown;

export function serialLocks() {
	const tails = new Map<string, Promise<unknown>>();
	return {
		request(name: string, callback: Callback): Promise<unknown> {
			const run = (tails.get(name) ?? Promise.resolve()).then(() =>
				callback({ name, mode: 'exclusive' })
			);
			tails.set(name, run.catch(() => {}));
			return run;
		}
	};
}

export function installLocks(manager: ReturnType<typeof serialLocks> = serialLocks()): void {
	Object.defineProperty(navigator, 'locks', { value: manager, configurable: true });
}

// (*MVOX:Josquin*)
