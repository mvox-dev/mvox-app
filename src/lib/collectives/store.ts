import { writable, derived, readable, get, type Readable, type Writable } from 'svelte/store';
import { goto } from '$app/navigation';
import { getToken } from '$lib/auth/storage';
import { authStore } from '$lib/auth/session';
import { isAuthExpiredError } from '$lib/entu/auth-expired';
import { discoverCollectives, type DiscoverResult } from './discover';
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

	let discovered: DiscoverResult;
	try {
		discovered = await discoverCollectives(auth.personIdByDb, token, fetchImpl);
	} catch (err) {
		// #107 (review R2/F2) — the token died mid-discovery. entuFetch has already
		// torn the session down and fired the sign-in redirect, so the truthful
		// terminal state here is 'anonymous', not 'error'.
		//
		// The layout's `becameAnonymous` edge would normally re-hydrate us into
		// exactly that state, but it cannot: `endSession` flips authStore while THIS
		// call is still in flight, so the edge is suppressed by the `hydrating`
		// guard and a stale state would survive the navigation. Settling it here
		// removes that timing dependency entirely.
		if (isAuthExpiredError(err)) {
			const state: CollectiveState = { status: 'anonymous' };
			collectiveState.set(state);
			return state;
		}
		throw err;
	}
	const { collectives, erroredDbs } = discovered;

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

/**
 * WHICH collective is selected, stripped of its display label.
 *
 * #165 review F1 — `selectedCollectiveStore` is derived off `collectiveState`,
 * so ANY change to the collectives array (notably `renameCollectiveInStore`,
 * a label-only edit) re-emits a fresh `Collective` object. Every reader that
 * only cares about IDENTITY — "which db, acting as which person" — would then
 * tear down and re-resolve on a rename: the root layout's completion gate
 * (`resetGate()` → 'loading' + a re-resolve) and its admin determination
 * (`resetAdmin()` → 'loading' + 2 Entu round-trips), the latter making the
 * Admin nav entry the viewer is standing on VANISH and re-appear.
 *
 * This store emits ONLY when db/personId actually change, so those readers are
 * immune to label churn by construction — no per-reader ad-hoc guard needed.
 */
export type CollectiveIdentity = { db: string; personId: string };

function sameIdentity(a: CollectiveIdentity | null, b: CollectiveIdentity | null): boolean {
	if (a === null || b === null) return a === b;
	return a.db === b.db && a.personId === b.personId;
}

export const selectedCollectiveIdentityStore: Readable<CollectiveIdentity | null> =
	readable<CollectiveIdentity | null>(null, (set) => {
		// `last` is per-subscription-cycle, not module scope: a module-level
		// latch would leak between tests (and between app teardowns).
		let last: CollectiveIdentity | null = null;
		let started = false;
		return selectedCollectiveStore.subscribe((c) => {
			const next = c ? { db: c.db, personId: c.personId } : null;
			if (started && sameIdentity(last, next)) return;
			started = true;
			last = next;
			set(next);
		});
	});

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

/**
 * #165 — rename the collective identified by `db` IN THE STORE, so the picker
 * and agenda header (both single-source readers of `collectiveState`) reflect
 * a just-written marker name without a full reload. A no-op when the state
 * isn't 'ready' or `db` isn't a known collective (nothing to rename).
 *
 * #165 review F1(a) — a rename that changes nothing publishes NOTHING. Without
 * this the function re-emitted a fresh state object (and so a fresh
 * `Collective` out of every derived store) for an unknown db or a same-name
 * write, waking every downstream reader for no reason at all.
 */
export function renameCollectiveInStore(db: string, name: string): void {
	const state = get(collectiveState);
	if (state.status !== 'ready') return;
	const target = state.collectives.find((c) => c.db === db);
	if (!target || target.name === name) return; // unknown db, or already named that
	collectiveState.set({
		...state,
		collectives: state.collectives.map((c) => (c.db === db ? { ...c, name } : c))
	});
}

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
