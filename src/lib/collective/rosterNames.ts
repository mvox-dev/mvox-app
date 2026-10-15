// The collective-wide roster_show_real_names boolean on the database entity (#267, #161).
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import { resolveDatabaseEntityId } from './databaseEntity';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export type RosterNamesSetting = { dbEntityId: string; showRealNames: boolean };

type EntuEntityResponse = {
	entity?: { _id: string; roster_show_real_names?: Array<{ _id: string; boolean: boolean }> };
};

// A shared reader, so it sets no cache flag: `opts` threads into both reads, and a screen
// that must answer offline passes its own (readCache.optin-fence.spec.ts).
export async function readRosterNamesSetting(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<RosterNamesSetting> {
	const dbEntityId = await resolveDatabaseEntityId(cfg, fetchImpl, opts);
	if (!dbEntityId) {
		throw new Error(`readRosterNamesSetting: no visible database entity in db '${cfg.db}'`);
	}
	return readRosterNamesSettingOf(cfg, dbEntityId, fetchImpl, opts);
}

/** The same read, for a caller that already holds the database entity id. */
export async function readRosterNamesSettingOf(
	cfg: EntuCfg,
	dbEntityId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<RosterNamesSetting> {
	const res = await entuFetch(
		cfg.db,
		`entity/${dbEntityId}?props=roster_show_real_names`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) {
		throw new Error(`readRosterNamesSetting: value read failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as EntuEntityResponse;
	// An unset key is absent from the entity JSON: false, the 'profile' default.
	const showRealNames = body.entity?.roster_show_real_names?.[0]?.boolean ?? false;
	return { dbEntityId, showRealNames };
}

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

// (*MVOX:Palestrina*, *MVOX:Josquin*)
