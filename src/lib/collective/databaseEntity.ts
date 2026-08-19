// src/lib/collective/databaseEntity.ts
//
// #161 GREEN — collective = database (Mihkel ruling 2026-08-16, via Henry). The
// database entity IS the collective identity; the Organization entity type is
// eliminated (#159 already deleted every organization instance). This module is
// the ONE way the app answers "which entity is THIS db's collective" — the
// successor of the retired person -> active member row -> organization `_parent`
// walk. That whole chain is gone: in a single-collective database every member
// belongs to this database's collective, and the database entity is
// discoverable directly via `entity?_type.string=database&limit=1` (exactly one
// per db, guaranteed by entu — the same query `inviteData.resolvePersonParentId`
// already trusts for the person parent).
//
// CONTRACT (databaseEntity.spec.ts):
//   - `resolveDatabaseEntityId(cfg, fetchImpl?)` — NO personId parameter: the
//     resolution is db-scoped, not person-scoped. ONE GET per call
//     (`_type.string=database&props=_id&limit=1` — the resolve only ever reads
//     `_id`, never the full entity body), no module-level cache (cfg.db and the
//     auth token both vary between calls; staleness is worse than a round-trip).
//   - Resolves to the database entity's own `_id`.
//   - NEVER queries `_type.string=member` and NEVER searches for an
//     "organization"-typed entity.
//   - No database entity readable → `null` (an ANSWER — "this reader cannot see
//     the collective entity" — never silently replaced by a guess).
//   - non-2xx → DatabaseEntityLookupError naming the status and the db.
//   - 2xx whose first entity has no `_id` → DatabaseEntityLookupError
//     (apparent-success trap — same guard as inviteData.resolvePersonParentId).

import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export class DatabaseEntityLookupError extends Error {
	/** HTTP status when the lookup itself failed on the wire. */
	readonly status?: number;

	constructor(message: string, opts: { status?: number } = {}) {
		super(message);
		this.name = 'DatabaseEntityLookupError';
		this.status = opts.status;
	}
}

/**
 * Resolve the database entity id — the collective identity of `cfg.db`.
 * See module header for the pinned contract.
 */
export async function resolveDatabaseEntityId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=database&props=_id&limit=1',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) {
		throw new DatabaseEntityLookupError(
			`resolveDatabaseEntityId: database entity lookup failed: HTTP ${res.status} in db '${cfg.db}'`,
			{ status: res.status }
		);
	}
	const body = (await res.json()) as { entities?: Array<{ _id?: string }> };
	const entity = body.entities?.[0];
	if (!entity) return null;
	// A 2xx that read back an entity without an _id is a contract violation
	// (apparent-success trap) — fail loud rather than hand back an unusable id.
	if (!entity._id) {
		throw new DatabaseEntityLookupError(
			`resolveDatabaseEntityId: the database entity in '${cfg.db}' read back without an _id`
		);
	}
	return entity._id;
}

// (*MVOX:Palestrina* — #161 GREEN implementation)
