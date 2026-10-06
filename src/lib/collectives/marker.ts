// The mvox-collective marker: is this db a collective, and what is it called?
import { entuFetch, isAuthExpiredError, type EntuFetchOptions } from '$lib/entu/request';
import type { MarkerResult } from './types';
import { reportProblem } from '$lib/problems/reportProblem';

// Only an mvox collective holds this `_sharing: domain` entity; its `name` is the picker label.
export const MVOX_COLLECTIVE_MARKER_TYPE = 'mvox_collective';

type EntuSearchResponse = {
	count?: number;
	entities?: Array<{ _id: string; name?: Array<{ string: string }> }>;
};

// 'error' is never 'not-collective': a blip must not drop a real collective. The cache
// flag in `opts` is the caller's (discover.ts), never this reader's.
export async function checkCollectiveMarker(
	db: string,
	personId: string,
	token: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<MarkerResult> {
	try {
		const res = await entuFetch(
			db,
			`entity?_type.string=${encodeURIComponent(MVOX_COLLECTIVE_MARKER_TYPE)}&props=name&limit=1`,
			token,
			{},
			fetchImpl,
			opts
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
		// An expired session is not a per-db failure: re-raise so discovery settles anonymous.
		if (isAuthExpiredError(err)) throw err;
		const action = 'checking a database for the collective marker';
		reportProblem({ area: 'collectives', action, error: err });
		return { db, kind: 'error', reason: err instanceof Error ? err.message : String(err) };
	}
}

// (*MVOX:Josquin*)
