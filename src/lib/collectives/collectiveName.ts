// The admin's collective name: the mvox_collective marker's `name`, not the database entity's.
import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import type { EntuSearchResponse } from '$lib/entu/wireTypes';
import type { EntuCfg } from '$lib/entu/cfg';
import { MVOX_COLLECTIVE_MARKER_TYPE } from './marker';

export type CollectiveNameMarker = { markerId: string; name: string };

// The discovery probe's one-row query (marker.ts): no marker gives null, a non-2xx throws.
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

// One atomic overwrite through replaceEntityProperty (#264); a non-2xx anywhere throws.
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
