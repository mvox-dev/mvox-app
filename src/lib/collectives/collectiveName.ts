// src/lib/collectives/collectiveName.ts
//
// #165 GREEN — the data seam behind the admin page's editable collective name.
//
// WHAT is edited: the `mvox_collective` MARKER entity's `name` property — the
// collective display name every member sees (collective picker, agenda
// header). NOT the database entity's `name` (that is the platform-level
// identifier and stays untouched by this module).
//
// See collectiveName.spec.ts for the full pinned contract; summary:
//   - `resolveCollectiveNameMarker` — ONE cheap query, the same one the
//     discovery probe runs (marker.ts):
//     `entity?_type.string=mvox_collective&props=name&limit=1`. First hit →
//     { markerId, name } (name trimmed, '' when absent). No hit → null.
//     Non-2xx → throw (fail loud).
//   - `updateCollectiveName` — replace semantics per the pinned Entu wire
//     contract (POST APPENDS to implicitly multi-valued props): GET the
//     PRE-EXISTING value ids → POST exactly ONE value
//     ([{ type: 'name', string: name }]) → DELETE every id from the GET.
//     POST BEFORE DELETE (house rule — #91 review F5). Non-2xx anywhere →
//     throw (fail loud, no silent success). That choreography is NOT
//     re-implemented here — it lives once in $lib/entu/replaceProperty (#165
//     review F5), shared with eventFieldEdit.ts; see that module's header for
//     the full rationale.
import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { MVOX_COLLECTIVE_MARKER_TYPE } from './marker';

export type CollectiveNameMarker = { markerId: string; name: string };

/** Search response envelope for `GET {db}/entity?...` (count + entities). */
type EntuSearchResponse = {
	count?: number;
	entities?: Array<{ _id: string; name?: Array<{ string: string }> }>;
};

/**
 * Resolve the `mvox_collective` marker's { markerId, name } for `cfg.db`, or
 * `null` when no marker exists in this db. See module header for the full
 * pinned contract.
 */
export async function resolveCollectiveNameMarker(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<CollectiveNameMarker | null> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=${encodeURIComponent(MVOX_COLLECTIVE_MARKER_TYPE)}&props=name&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) {
		throw new Error(`resolveCollectiveNameMarker: marker query failed: HTTP ${res.status}`);
	}
	const data = (await res.json()) as EntuSearchResponse;
	const hit = data.entities?.[0];
	const found = (data.count ?? data.entities?.length ?? 0) >= 1;
	if (!found || !hit) return null;
	return { markerId: hit._id, name: hit.name?.[0]?.string?.trim() ?? '' };
}

/**
 * Rewrite the marker's `name` to `name` — the shared GET-existing →
 * POST-one-value → DELETE-stale replace choreography ($lib/entu/replaceProperty).
 * Non-2xx anywhere throws.
 */
export async function updateCollectiveName(
	cfg: EntuCfg,
	markerId: string,
	name: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(
		cfg,
		markerId,
		{ type: 'name', string: name },
		fetchImpl,
		'updateCollectiveName'
	);
}

// (*MVOX:Palestrina* — #165 GREEN)
