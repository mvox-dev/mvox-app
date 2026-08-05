import { checkCollectiveMarker } from './marker';
import type { Collective } from './types';

export type DiscoverResult = {
	/** mvox collectives, in the token's db order (stable for default-pick). */
	collectives: Collective[];
	/** dbs whose marker check errored — surfaced so we don't misreport them as absent. */
	erroredDbs: string[];
};

/**
 * Resolve the user's mvox collectives from the token's `accounts` map: probe every
 * db in parallel for the marker (marker.ts) and keep only the marked ones. Non-mvox
 * dbs (the user's other Entu apps) fall out as `not-collective`.
 *
 * `personIdByDb` comes straight from `session.hydrateAuth` (the JWT accounts claim).
 */
export async function discoverCollectives(
	personIdByDb: Record<string, string>,
	token: string,
	fetchImpl: typeof fetch = fetch
): Promise<DiscoverResult> {
	const dbs = Object.keys(personIdByDb);
	const results = await Promise.all(
		dbs.map((db) => checkCollectiveMarker(db, personIdByDb[db], token, fetchImpl))
	);

	const collectives: Collective[] = [];
	const erroredDbs: string[] = [];
	for (const r of results) {
		if (r.kind === 'collective') collectives.push({ db: r.db, name: r.name, personId: r.personId });
		else if (r.kind === 'error') erroredDbs.push(r.db);
	}

	return { collectives, erroredDbs };
}

// (*MVOX:Josquin*)
