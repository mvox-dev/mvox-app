// The app's one ink store and its sync (#1069); none with no IndexedDB: ink lasts the session.
import { createInkStore, type InkStore } from './inkStore';
import { createInkSync, type InkSync } from './inkSync';
import { createInkSyncQueue } from './inkSyncQueue';
import { createSyncedInkStore } from './syncedInkStore';

let app: { store: InkStore; sync: InkSync } | null = null;

function appInk(): typeof app {
	if (typeof indexedDB === 'undefined') return null;
	if (!app) {
		const device = createInkStore();
		const queue = createInkSyncQueue();
		const sync = createInkSync({ queue, device });
		app = { store: createSyncedInkStore({ device, queue, sync }), sync };
	}
	return app;
}

export function getInkStore(): InkStore | null {
	return appInk()?.store ?? null;
}

/** Sends waiting ink on the online edge and after sign-in; the app shell starts it once. */
export function startSyncingInk(): () => void {
	return appInk()?.sync.start() ?? (() => {});
}

// (*MVOX:Josquin*)
