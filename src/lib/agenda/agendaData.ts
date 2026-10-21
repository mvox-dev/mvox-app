import { get } from 'svelte/store';
import { getToken } from '$lib/auth/storage';
import { selectedCollectiveStore } from '$lib/collectives/store';
// fetchOptions, not request.ts: keeps this module off request.ts's $env import chain.
import { CACHED_READ, type EntuFetchOptions } from '$lib/entu/fetchOptions';
import { listSeasons, listEvents } from '$lib/seasons/entuSeasons';
import { cfgFor, type EntuCfg } from '$lib/entu/cfg';
import { currentSeason, manageableSeason, recentEvents } from '$lib/attendance/conductorLogic';
import type { AgendaItem } from './types';
import type { Season } from '$lib/seasons/types';

export interface FullAgendaResult {
	upcoming: AgendaItem[];
	recent: AgendaItem[];
	seasonId: string | null;
	seasonConductors: string[];
	seasonOwners: string[];
	seasonEditors: string[];
	// Feeds several page gates (create-event select, zero-season banner); check them before trimming.
	seasons: Season[];
	// The admin's pick: the current season, else the soonest not-yet-started one. Differs from
	// seasonId when the current season has lapsed or only future seasons exist.
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

// retention.ts calls this without CACHED_READ: it runs on every route, and a cached read
// would put an "as of" line over live agenda rows.
export async function listFullAgenda(
	cfg: EntuCfg,
	now: Date,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<FullAgendaResult> {
	const nowIso = now.toISOString();
	const seasons = await listSeasons(cfg, fetchImpl, opts);

	const paired = await Promise.all(
		seasons.map(async (s) => ({
			seasonId: s.id,
			items: await listEvents(cfg, s.id, fetchImpl, opts)
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

// The agenda page's read-cache opt-in; pinned in readCache.optin-fence.spec.ts.
export async function loadFullAgenda(
	now: Date = new Date(),
	fetchImpl: typeof fetch = fetch
): Promise<FullAgendaResult> {
	const collective = get(selectedCollectiveStore);
	const token = getToken();
	if (!collective || !token)
		return { upcoming: [], recent: [], seasons: [], ...NO_SEASON, ...NO_MANAGEABLE_SEASON };
	return listFullAgenda(cfgFor(collective.db), now, fetchImpl, CACHED_READ);
}

// (*MVOX:Josquin*)
