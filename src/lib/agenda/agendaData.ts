import { get } from 'svelte/store';
import { getToken } from '$lib/auth/storage';
import { selectedDbStore } from '$lib/collectives/store';
import { listSeasons, listRehearsals, type EntuCfg } from '$lib/seasons/entuSeasons';
import { currentSeason, recentEvents } from '$lib/attendance/conductorLogic';
import type { AgendaItem } from './types';

// ── Combined load: upcoming + recent + conductor data in ONE fetch pass ────

export interface FullAgendaResult {
	upcoming: AgendaItem[];
	/** ALL past events of the CURRENT season, reverse-chronological. */
	recent: AgendaItem[];
	/** The current season's entity id (null if no season is current). */
	seasonId: string | null;
	/** The current season's conductor person refs (for determineConductor). */
	seasonConductors: string[];
}

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
	now: Date,
	fetchImpl: typeof fetch = fetch
): Promise<FullAgendaResult> {
	const nowIso = now.toISOString();
	const seasons = await listSeasons(cfg, fetchImpl);

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
	if (!season) return { upcoming, recent: [], seasonId: null, seasonConductors: [] };

	const seasonData = paired.find((p) => p.seasonId === season.id);
	const recent = recentEvents(seasonData?.items ?? [], now);

	return { upcoming, recent, seasonId: season.id, seasonConductors: season.conductors };
}

/** Convenience for callers: resolve db/token from T4's stores, then delegate to listFullAgenda. */
export async function loadFullAgenda(
	now: Date = new Date(),
	fetchImpl: typeof fetch = fetch
): Promise<FullAgendaResult> {
	const db = get(selectedDbStore);
	const token = getToken();
	if (!db || !token) return { upcoming: [], recent: [], seasonId: null, seasonConductors: [] };
	return listFullAgenda({ db, token }, now, fetchImpl);
}

// (*MVOX:Josquin*)
