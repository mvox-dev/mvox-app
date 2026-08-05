// Collective = one mvox choral collective the user belongs to, resolved from the
// token's `accounts` map AND confirmed to be a real mvox collective by the db
// marker (see marker.ts). The `db` is the Entu db name (runtime URL path segment).

export type Collective = {
	/** Entu db name — the runtime db threaded into every API call. */
	db: string;
	/** Display label (from the marker entity's `name`; falls back to the db name). */
	name: string;
	/** The user's person-id within this collective's db (from the JWT accounts map). */
	personId: string;
};

/** Result of probing one db in the token for the mvox marker. */
export type MarkerResult =
	| { db: string; kind: 'collective'; name: string; personId: string }
	| { db: string; kind: 'not-collective' }
	| { db: string; kind: 'error'; reason: string };

/**
 * App-wide collective-resolution state. Distinguishes the three product cases the
 * task calls out (0 / 1 / many) plus fail states:
 *   - `none`   → 0 mvox collectives (all token dbs are non-mvox) → onboarding/empty
 *   - `ready`  → 1 (auto-select) or many (picker) collectives
 *   - `error`  → 0 resolved but one or more marker checks errored (don't claim "none")
 */
export type CollectiveState =
	| { status: 'loading' }
	| { status: 'anonymous' }
	| { status: 'none' }
	| { status: 'error'; erroredDbs: string[] }
	| { status: 'ready'; collectives: Collective[]; erroredDbs: string[] };
