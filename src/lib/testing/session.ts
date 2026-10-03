// Seeds a signed-in session with ready collectives, as hydrateAuth + hydrateCollectives would.
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import type { Collective } from '$lib/collectives/types';

export const SAMPLEDB: Collective = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };

export interface SignInOpts {
	token?: string;
	collectives?: Collective[];
	selected?: string | null;
	ttlMs?: number;
}

export function signIn(opts: SignInOpts = {}): void {
	const { token = 'jwt-abc', collectives = [SAMPLEDB], ttlMs = 100_000 } = opts;
	const selected = opts.selected === undefined ? (collectives[0]?.db ?? null) : opts.selected;
	setToken(token);
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(collectives.map((c) => [c.db, c.personId])),
		expMs: Date.now() + ttlMs
	});
	collectiveState.set({ status: 'ready', collectives, erroredDbs: [] });
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(selected);
}

// (*MVOX:Josquin*)
