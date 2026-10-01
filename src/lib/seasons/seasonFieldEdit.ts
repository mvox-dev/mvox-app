// Season field and conductor writes: replace a field's value, add or remove a conductor.
import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty, type EntuWireValue } from '$lib/entu/replaceProperty';
import type { EntuCfg } from './entuSeasons';

export type SeasonEditableField = 'name' | 'start_date' | 'end_date';

/** Seasons carry calendar dates, never datetime (unlike events). */
function seasonWireProp(field: SeasonEditableField, value: string): EntuWireValue {
	switch (field) {
		case 'start_date':
		case 'end_date':
			return { type: field, date: value };
		default:
			return { type: field, string: value };
	}
}

export async function updateSeasonField(
	cfg: EntuCfg,
	seasonId: string,
	field: SeasonEditableField,
	value: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(
		cfg,
		seasonId,
		seasonWireProp(field, value),
		fetchImpl,
		'updateSeasonField'
	);
}

export async function addSeasonConductor(
	cfg: EntuCfg,
	seasonId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(
		cfg.db,
		`entity/${seasonId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'conductor', reference: personId }])
		},
		fetchImpl
	);
	if (!res.ok) throw new Error(`addSeasonConductor failed: ${res.status}`);
}

export async function removeSeasonConductor(
	cfg: EntuCfg,
	seasonId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${seasonId}?props=conductor`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`removeSeasonConductor lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as {
		entity?: { conductor?: Array<{ _id: string; reference?: string }> };
	};
	const values = body.entity?.conductor ?? [];
	const match = values.find((v) => v.reference === personId);
	if (!match) return; // idempotent — a double-tap or a stale chip is a no-op, not a 404.

	const delRes = await entuFetch(cfg.db, `property/${match._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!delRes.ok) throw new Error(`removeSeasonConductor delete failed: ${delRes.status}`);
}
