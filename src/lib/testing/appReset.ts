// Puts the session and the collective stores back to their pre-hydration state between tests.
import { authStore } from '$lib/auth/session';
import { clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

export function resetAppState(): void {
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
}

// (*MVOX:Josquin*)
