import { get } from 'svelte/store';
import { getToken } from '$lib/auth/storage';
import { selectedCollectiveStore } from '$lib/collectives/store';
import { listSeasons, listRehearsals, type EntuCfg } from '$lib/seasons/entuSeasons';
import { currentSeason, recentEvents } from '$lib/attendance/conductorLogic';
import type { AgendaItem } from './types';
import type { Season } from '$lib/seasons/types';

// ── Combined load: upcoming + recent + conductor data in ONE fetch pass ────

export interface FullAgendaResult {
	upcoming: AgendaItem[];
	/** ALL past events of the CURRENT season, reverse-chronological. */
	recent: AgendaItem[];
	/** The current season's entity id (null if no season is current). */
	seasonId: string | null;
	/** The current season's conductor person refs (for determineConductor). */
	seasonConductors: string[];
	/** #91 — the current season's `_owner`/`_editor` refs as VISIBLE to this
	 *  caller (private bucket: no grant → empty). Repertoire management gates on
	 *  these; carrying them here means the page derives its rights from the season
	 *  read that already happened instead of firing a separate rights probe. */
	seasonOwners: string[];
	seasonEditors: string[];
	/**
	 * #132/T2 — the FULL season list `listSeasons` already fetched, thrown away
	 * after picking the current one. The season-creation entry point derives
	 * "an upcoming season exists" from this (`startDate` strictly after today),
	 * at zero extra fetch cost.
	 */
	seasons: Season[];
}

const NO_SEASON = { seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] };

/**
 * #83 fix (F1+F2) -- combined load that fetches seasons + rehearsals ONCE (the
 * same reads listAgenda already does), then splits the result into upcoming +
 * recent items and carries the season's conductor data along. This eliminates:
 *   - the duplicate listSeasons + listRehearsals calls that loadRecentEvents made
 *   - the N+1 entity/{id}?props=conductor requests that resolveConductorEventIds
 *     fired (conductor refs are now on the already-fetched AgendaItem/Season)
 */
export async function listFullAgenda(
	cfg: EntuCfg,
	personId: string,
	now: Date,
	fetchImpl: typeof fetch = fetch
): Promise<FullAgendaResult> {
	const nowIso = now.toISOString();
	const seasons = await listSeasons(cfg, personId, fetchImpl);

	// Fetch rehearsals for ALL seasons, paired with season id so we can isolate
	// the current season's events for the Recent section without re-fetching.
	const paired = await Promise.all(
		seasons.map(async (s) => ({
			seasonId: s.id,
			items: await listRehearsals(cfg, s.id, fetchImpl)
		}))
	);

	const upcoming = paired
		.flatMap((p) => p.items)
		.filter((r) => r.startDatetime >= nowIso)
		.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));

	const season = currentSeason(seasons, now);
	if (!season) return { upcoming, recent: [], seasons, ...NO_SEASON };

	const seasonData = paired.find((p) => p.seasonId === season.id);
	const recent = recentEvents(seasonData?.items ?? [], now);

	return {
		upcoming,
		recent,
		seasons,
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors
	};
}

/** Convenience for callers: resolve db/personId/token from T4's stores, then delegate to listFullAgenda. */
export async function loadFullAgenda(
	now: Date = new Date(),
	fetchImpl: typeof fetch = fetch
): Promise<FullAgendaResult> {
	const collective = get(selectedCollectiveStore);
	const token = getToken();
	if (!collective || !token) return { upcoming: [], recent: [], seasons: [], ...NO_SEASON };
	return listFullAgenda({ db: collective.db, token }, collective.personId, now, fetchImpl);
}

// (*MVOX:Josquin*)
