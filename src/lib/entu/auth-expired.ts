// #107 — the auth-expiry ERROR TAG, deliberately in its own dependency-free
// module.
//
// Recognising "this rejection is an expired session" is needed all over the app,
// including by modules that have no business knowing the Entu API base URL —
// $lib/collectives/store is the case that forced the split (review R2/F2). Had
// the predicate stayed in $lib/entu/request, importing it would have dragged
// `$lib/entu-config` -> `$env/dynamic/public` (a Vite virtual module that needs a
// SvelteKit request context) into every consumer and their specs.
//
// This module imports NOTHING. `$lib/entu/request` re-exports both names, so the
// existing `from '$lib/entu/request'` call sites keep working unchanged.

export class AuthExpiredError extends Error {
	constructor(message = 'Entu session expired (401)') {
		super(message);
		this.name = 'AuthExpiredError';
	}
}

/** Detects by the `name` TAG, not `instanceof` — callers across module/vitest
 *  graph boundaries construct duck-typed errors with the same tag. */
export function isAuthExpiredError(e: unknown): boolean {
	return e instanceof Error && e.name === 'AuthExpiredError';
}

// (*MVOX:Josquin*)
