// The ink store the viewer gets (#1069): the device answers, so a part opens offline, and each
// save and page turn waits on the device until Entu has it. Entu's ink is joined in behind.
import { reportProblem } from '$lib/problems/reportProblem';
import type { DeviceInkStore, SyncedInkStore } from './inkStore';
import type { InkSync } from './inkSync';
import type { InkSyncQueue } from './inkSyncQueue';

export interface SyncedInkDeps {
	device: DeviceInkStore;
	queue: InkSyncQueue;
	sync: InkSync;
}

export function createSyncedInkStore({ device, queue, sync }: SyncedInkDeps): SyncedInkStore {
	const kick = () => {
		sync.flush().catch((error: unknown) => reportProblem({ area: 'part', action: 'syncing the marks', error }));
	};

	return {
		load: (at) => device.load(at),
		merge: (at, log) => device.merge(at, log),
		placeOf: (part) => queue.placeOf(part),

		async save(at, ink) {
			await device.save(at, ink);
			await queue.markInk(at);
			kick();
		},

		async turn(part, page) {
			await queue.setPlace(part, page);
			kick();
		},

		// No answer is offline, not a failure. A page turned here and not yet sent beats Entu's.
		async pull(part) {
			let remote;
			try {
				remote = await sync.pull(part);
			} catch (error) {
				if (error instanceof TypeError) return null;
				throw error;
			}
			if (!remote || remote.page === null) return remote;
			if (await queue.adoptPlace(part, remote.page)) return remote;
			return { ...remote, page: await queue.placeOf(part) };
		}
	};
}

// (*MVOX:Josquin*)
