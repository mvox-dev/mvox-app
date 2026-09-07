// src/lib/collective/rosterNames.ts
//
// #267 GREEN — the data seam behind the profile page's admin-only roster-names
// toggle: the collective-wide `roster_show_real_names` boolean on the DATABASE
// ENTITY (collective = database, #161; prop-def provisioned live on both dbs
// by #265 — boolean, `_sharing: domain`, so every member's client can READ it
// while only the db entity's `_owner`/`_editor` — exactly the set the admin
// gate checks — can WRITE it; no new rights mechanism).
//
// See rosterNames.spec.ts for the full pinned contract; summary:
//   - `readRosterNamesSetting` — resolveDatabaseEntityId (the ONE way the app
//     answers "which entity is this db's collective", databaseEntity.ts) then
//     ONE GET `entity/{dbEntityId}?props=roster_show_real_names`. The key is
//     entirely ABSENT from the entity JSON when unset (platform-doc-verified)
//     → false → the UI's 'profile' default. The resolved dbEntityId rides
//     along in the answer because the WRITE needs it. Fail loud: no visible
//     database entity or a non-2xx anywhere → throw.
//   - `updateRosterShowRealNames` — a thin wrapper (the updateCollectiveName
//     precedent, collectiveName.ts) around the shared replaceEntityProperty
//     choreography ($lib/entu/replaceProperty, atomic since #264). Non-2xx
//     anywhere → throw (fail loud, no silent success); turning that into the
//     truthful inline error is the profile page's job.
import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import { resolveDatabaseEntityId } from './databaseEntity';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type RosterNamesSetting = { dbEntityId: string; showRealNames: boolean };

/** Read response envelope for `GET {db}/entity/{id}?props=roster_show_real_names`. */
type EntuEntityResponse = {
	entity?: { _id: string; roster_show_real_names?: Array<{ _id: string; boolean: boolean }> };
};

/**
 * Resolve the collective-wide `roster_show_real_names` setting for `cfg.db`.
 * See module header for the pinned contract.
 */
export async function readRosterNamesSetting(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<RosterNamesSetting> {
	const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl);
	if (!dbEntityId) {
		throw new Error(`readRosterNamesSetting: no visible database entity in db '${cfg.db}'`);
	}

	const res = await entuFetch(
		cfg.db,
		`entity/${dbEntityId}?props=roster_show_real_names`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) {
		throw new Error(`readRosterNamesSetting: value read failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as EntuEntityResponse;
	const showRealNames = body.entity?.roster_show_real_names?.[0]?.boolean ?? false;
	return { dbEntityId, showRealNames };
}

/**
 * Rewrite the database entity's `roster_show_real_names` to `value` — the
 * shared GET existing id(s) → ONE POST pairing the first old `_id` with the
 * new value choreography ($lib/entu/replaceProperty); corrupted extras only
 * are swept after the POST, and the normal ≤1-value path issues zero deletes.
 * Non-2xx anywhere throws.
 */
export async function updateRosterShowRealNames(
	cfg: EntuCfg,
	dbEntityId: string,
	value: boolean,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(
		cfg,
		dbEntityId,
		{ type: 'roster_show_real_names', boolean: value },
		fetchImpl,
		'updateRosterShowRealNames'
	);
}

// (*MVOX:Palestrina* — #267 GREEN)
