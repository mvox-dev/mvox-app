import { get } from 'svelte/store';
import { getToken } from '$lib/auth/storage';
import { selectedCollectiveStore } from '$lib/collectives/store';
import { listSeasons, listEvents, type EntuCfg } from '$lib/seasons/entuSeasons';
import { currentSeason, manageableSeason, recentEvents } from '$lib/attendance/conductorLogic';
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
	 * after picking the current one. Feeds SEVERAL page-level gates at zero
	 * extra fetch cost — not an exhaustive list, but as of #261: the
	 * event-create season `<select>`, the zero-season onboarding banner gate
	 * (`seasons.length === 0` — the first-run surface, invisible to anyone
	 * testing with data), the manageable-season field lookups, and
	 * `deriveSeasonCreateRights`'s lapsed / no-current-season fallback. Check
	 * the consumers before trimming this field.
	 */
	seasons: Season[];
	/**
	 * #167 — the ADMIN's season pick (`manageableSeason`): the current season
	 * when one runs and has not lapsed, else the soonest NOT-YET-STARTED season
	 * -- a season is manageable regardless of its dates. `null` only when there
	 * are no seasons at all. These MIRROR seasonId/seasonOwners/seasonEditors
	 * whenever a live season is current; they diverge in the future-only case
	 * and in the lapsed-season case (review F1), which is exactly what lets the
	 * page's event/series creation controls survive creating a season that has
	 * not started yet. The VIEWER fields above
	 * (seasonId/seasonOwners/seasonEditors/recent) keep their existing
	 * semantics untouched.
	 */
	manageableSeasonId: string | null;
	manageableSeasonOwners: string[];
	manageableSeasonEditors: string[];
}

const NO_SEASON = { seasonId: null, seasonConductors: [], seasonOwners: [], seasonEditors: [] };
const NO_MANAGEABLE_SEASON = {
	manageableSeasonId: null,
	manageableSeasonOwners: [],
	manageableSeasonEditors: []
};

/**
 * #83 fix (F1+F2) -- combined load that fetches seasons + rehearsals ONCE (the
 * same reads listAgenda already does), then splits the result into upcoming +
 * recent items and carries the season's conductor data along. This eliminates:
 *   - the duplicate listSeasons + listEvents calls that loadRecentEvents made
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

	// Fetch events (ALL types, #194/#202) for ALL seasons, paired with season id
	// so we can isolate the current season's events for the Recent section
	// without re-fetching.
	const paired = await Promise.all(
		seasons.map(async (s) => ({
			seasonId: s.id,
			items: await listEvents(cfg, s.id, fetchImpl)
		}))
	);

	const upcoming = paired
		.flatMap((p) => p.items)
		.filter((r) => r.startDatetime >= nowIso)
		.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));

	const season = currentSeason(seasons, now);
	const manageable = manageableSeason(seasons, now);
	const manageableFields = manageable
		? {
				manageableSeasonId: manageable.id,
				manageableSeasonOwners: manageable.owners,
				manageableSeasonEditors: manageable.editors
			}
		: NO_MANAGEABLE_SEASON;

	if (!season) return { upcoming, recent: [], seasons, ...NO_SEASON, ...manageableFields };

	const seasonData = paired.find((p) => p.seasonId === season.id);
	const recent = recentEvents(seasonData?.items ?? [], now);

	return {
		upcoming,
		recent,
		seasons,
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		...manageableFields
	};
}

/**
 * Convenience for callers: resolve db + token from T4's stores, then delegate to
 * listFullAgenda.
 *
 * #161 review fix round 2 — the whole resolve is db-scoped, so `personId` is NOT
 * threaded anywhere: `listSeasons` dropped it and `listFullAgenda` never read it.
 */
export async function loadFullAgenda(
	now: Date = new Date(),
	fetchImpl: typeof fetch = fetch
): Promise<FullAgendaResult> {
	const collective = get(selectedCollectiveStore);
	const token = getToken();
	if (!collective || !token)
		return { upcoming: [], recent: [], seasons: [], ...NO_SEASON, ...NO_MANAGEABLE_SEASON };
	return listFullAgenda({ db: collective.db, token }, now, fetchImpl);
}

// (*MVOX:Josquin*)
