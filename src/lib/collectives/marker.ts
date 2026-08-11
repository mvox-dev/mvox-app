import { entuFetch, isAuthExpiredError } from '$lib/entu/request';
import type { MarkerResult } from './types';

// ─── The mvox-collective MARKER ──────────────────────────────────────────────
//
// A token's `accounts` map spans EVERY Entu db where the user has a person —
// choral collectives AND unrelated Entu apps (Mihkel's live token: esmuuseum,
// piletilevi, polyphony, template, ww — only `polyphony` is choral). So "has a
// person" is too broad. A real mvox collective is identified by a self-describing
// MARKER IN THE DB: a single well-known entity of a dedicated type that other Entu
// dbs do not have. Existence of the marker == this db is an mvox collective.
//
// SHAPE (PO-signed-off 2026-08-05; Pérotin seeds the matching entity into polyphony):
//   - Entity TYPE: `mvox_collective` (dedicated; self-identifying; absent from
//     non-mvox dbs). One singleton instance per collective.
//   - The instance carries `name` (the collective's display label) — reused as the
//     picker label, so the marker check doubles as the name fetch (no N+1).
//   - `_sharing: domain` so every in-collective member can read it (the domain
//     read-gate already requires a real person in that db — aligns the marker with
//     the visibility model; anonymous/non-members can't see it, which is fine
//     because we only probe dbs from the user's own token).
//
// The type name is centralised here so any future rename is a one-line change with
// no impact on selection logic.
export const MVOX_COLLECTIVE_MARKER_TYPE = 'mvox_collective';

/** Search response envelope for `GET {db}/entity?...` (count + entities). */
type EntuSearchResponse = {
	count?: number;
	entities?: Array<{ _id: string; name?: Array<{ string: string }> }>;
};

/**
 * Probe one db for the mvox marker under the user's rights. Returns:
 *   - `collective`     → marker present (with its display name)
 *   - `not-collective` → query succeeded, no marker → not an mvox db
 *   - `error`          → the check itself failed (auth/network) → caller must NOT
 *                        silently treat as not-collective (that would drop a real
 *                        collective on a transient blip).
 *
 * ONE cheap query per db: `_type.string=<marker>&limit=1`.
 */
export async function checkCollectiveMarker(
	db: string,
	personId: string,
	token: string,
	fetchImpl: typeof fetch = fetch
): Promise<MarkerResult> {
	try {
		const res = await entuFetch(
			db,
			`entity?_type.string=${encodeURIComponent(MVOX_COLLECTIVE_MARKER_TYPE)}&props=name&limit=1`,
			token,
			{},
			fetchImpl
		);

		if (!res.ok) {
			return { db, kind: 'error', reason: `marker query ${res.status}` };
		}

		const data = (await res.json()) as EntuSearchResponse;
		const hit = data.entities?.[0];
		const found = (data.count ?? data.entities?.length ?? 0) >= 1;

		if (!found) {
			return { db, kind: 'not-collective' };
		}

		const name = hit?.name?.[0]?.string?.trim() || db;
		return { db, kind: 'collective', name, personId };
	} catch (err) {
		// #107 (review R2/F2) — an expired session is NOT a per-db marker failure.
		// Collective discovery is the FIRST authenticated Entu call on app load, so
		// it is the likeliest place a revoked / IP-mismatched token first shows
		// itself; mapping it to `kind: 'error'` made every db look broken and drove
		// the "Some collectives could not be checked… Please retry." copy — exactly
		// the misleading data-error class #107 exists to remove. Re-raise so
		// discoverCollectives -> hydrateCollectives can settle at 'anonymous'.
		if (isAuthExpiredError(err)) throw err;
		return { db, kind: 'error', reason: err instanceof Error ? err.message : String(err) };
	}
}

// (*MVOX:Josquin*)
