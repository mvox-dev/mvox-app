import { writable, derived, get, type Readable, type Writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { getToken } from '$lib/auth/storage';
import { authStore } from '$lib/auth/session';
import { discoverCollectives } from './discover';
import type { Collective, CollectiveState } from './types';

// Repoints the old polyphony org-picker precedence (URL → localStorage → default)
// onto collective-from-token. The persisted key holds the selected collective's
// db name; the URL param carries the same so a shared link is collective-scoped.
const SELECTED_KEY = 'mvox.selected_collective';
export const COLLECTIVE_URL_PARAM = 'collective';

export const collectiveState: Writable<CollectiveState> = writable({ status: 'loading' });

/** Selected db from the current URL (`?collective=<db>`), wired by the root layout. */
export const urlCollectiveDbStore: Writable<string | null> = writable(null);

/** Persisted explicit pick (survives reloads). */
export const selectedCollectiveDbStore: Writable<string | null> = writable(
	typeof localStorage !== 'undefined' ? localStorage.getItem(SELECTED_KEY) : null
);

/**
 * Discover the user's mvox collectives from the authenticated token and publish
 * the 0/1/many state. Call AFTER `hydrateAuth`. Returns the resolved state too.
 */
export async function hydrateCollectives(fetchImpl: typeof fetch = fetch): Promise<CollectiveState> {
	const auth = get(authStore);
	const token = getToken();
	if (auth.status !== 'authenticated' || !token) {
		const state: CollectiveState = { status: 'anonymous' };
		collectiveState.set(state);
		return state;
	}

	const { collectives, erroredDbs } = await discoverCollectives(auth.personIdByDb, token, fetchImpl);

	let state: CollectiveState;
	if (collectives.length > 0) {
		state = { status: 'ready', collectives, erroredDbs };
	} else if (erroredDbs.length > 0) {
		// 0 resolved but checks errored → don't claim "none" (fail-visible, retryable).
		state = { status: 'error', erroredDbs };
	} else {
		state = { status: 'none' };
	}
	collectiveState.set(state);
	return state;
}

/**
 * The resolved selected collective. Precedence: URL param (write-through to
 * localStorage) → persisted explicit pick → first collective (stable default).
 */
export const selectedCollectiveStore: Readable<Collective | null> = derived(
	[collectiveState, urlCollectiveDbStore, selectedCollectiveDbStore],
	([$state, $urlDb, $selectedDb]) => {
		if ($state.status !== 'ready' || $state.collectives.length === 0) return null;
		const list = $state.collectives;

		// 1. URL wins; write-through so a deep-link becomes the persisted pick.
		const fromUrl = $urlDb ? list.find((c) => c.db === $urlDb) : undefined;
		if (fromUrl) {
			if (typeof localStorage !== 'undefined') localStorage.setItem(SELECTED_KEY, fromUrl.db);
			return fromUrl;
		}

		// 2. Explicit persisted pick.
		const fromPick = $selectedDb ? list.find((c) => c.db === $selectedDb) : undefined;
		if (fromPick) return fromPick;

		// 3. Default to the first collective.
		return list[0];
	}
);

/** The runtime db string to thread into Entu calls (T5+), or null if unresolved. */
export const selectedDbStore: Readable<string | null> = derived(
	selectedCollectiveStore,
	($c) => $c?.db ?? null
);

export type CollectivePickerMode = 'none' | 'static' | 'picker';

/** 0 → none (onboarding), 1 → static (auto-selected), many → picker. */
export const pickerModeStore: Readable<CollectivePickerMode> = derived(collectiveState, ($state) => {
	if ($state.status !== 'ready' || $state.collectives.length === 0) return 'none';
	if ($state.collectives.length === 1) return 'static';
	return 'picker';
});

/** Explicitly select a collective by db name (persist + reflect in the URL). */
export async function selectCollective(db: string): Promise<void> {
	const state = get(collectiveState);
	if (state.status !== 'ready') return;
	if (!state.collectives.find((c) => c.db === db)) return; // ignore unknown db

	selectedCollectiveDbStore.set(db);
	if (typeof localStorage !== 'undefined') localStorage.setItem(SELECTED_KEY, db);
	if (typeof window !== 'undefined') {
		const url = new URL(window.location.href);
		url.searchParams.set(COLLECTIVE_URL_PARAM, db);
		await goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
	}
}

// (*MVOX:Josquin*)
