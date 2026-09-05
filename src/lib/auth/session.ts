// App-wide authenticated-state store, hydrated from the localStorage Entu JWT.
//
// This is the minimal T3 auth state: signed-in vs signed-out, plus the decoded
// `accounts` map (person-id per db) straight off the JWT claims. It deliberately
// does NOT resolve display name / org membership (that needs Entu round-trips and
// db-selection — T4+). T4 reads `personIdByDb` here to drive db-selection.

import { writable } from 'svelte/store';
import { clearAll, getToken } from './storage';
import { decodeJwtPayload, decodeJwtExpMs } from './guard';

type AuthState =
	| { status: 'loading' }
	| { status: 'anonymous' }
	| { status: 'authenticated'; personIdByDb: Record<string, string>; expMs: number };

export const authStore = writable<AuthState>({ status: 'loading' });

/**
 * Read the localStorage token, validate `exp`, and publish auth state. Also
 * returns the resolved state for callers that need it synchronously (e.g. the
 * callback page right after a successful exchange). An expired/garbage token is
 * cleared (provider kept, so re-auth pre-selects it).
 */
export function hydrateAuth(nowMs: number = Date.now()): AuthState {
	const token = getToken();
	if (!token) {
		const state: AuthState = { status: 'anonymous' };
		authStore.set(state);
		return state;
	}

	const payload = decodeJwtPayload(token);
	const expMs = decodeJwtExpMs(token);
	if (!payload || expMs === null || expMs <= nowMs) {
		clearAll({ preserveProvider: true });
		const state: AuthState = { status: 'anonymous' };
		authStore.set(state);
		return state;
	}

	const accounts =
		payload.accounts && typeof payload.accounts === 'object'
			? (payload.accounts as Record<string, string>)
			: {};

	const state: AuthState = { status: 'authenticated', personIdByDb: accounts, expMs };
	authStore.set(state);
	return state;
}

/**
 * Tear a session down COMPLETELY: storage AND the in-memory store, in that
 * order. The two halves must never be done separately — clearing storage alone
 * leaves `authStore` asserting 'authenticated', so the nav still renders the
 * signed-in shell and the layout's auth-keyed effects keep firing Entu reads
 * with an empty Bearer (there is no document reload on a client-side `goto` to
 * re-hydrate them). Flipping the store is also what drives +layout.svelte's
 * `becameAnonymous` edge, which re-runs `hydrateCollectives()` and clears the
 * stale collective selection.
 *
 * The single teardown for BOTH exit paths: explicit sign-out
 * (`performLogout`, preserveProvider: false) and the 401 recovery
 * (`handleAuthExpired401` in $lib/entu/request, preserveProvider: true, so
 * re-auth pre-selects the provider). Keeping them on one function is what stops
 * the two from drifting apart again (#107 review F1).
 */
export function endSession(opts: { preserveProvider: boolean }): void {
	clearAll({ preserveProvider: opts.preserveProvider });
	authStore.set({ status: 'anonymous' });
}

// (*MVOX:Josquin*)
