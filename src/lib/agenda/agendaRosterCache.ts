import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
import { listSections, type SectionNode } from '$lib/sections/sectionData';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';

const ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;

export function createAgendaRosterCache(ag: AgendaLoadState) {
	function getRoster(cfg: { db: string; token: string }): Promise<RosterRow[]> {
		const cacheValid =
			ag.rosterCache &&
			ag.rosterCache.db === cfg.db &&
			Date.now() - ag.rosterCache.fetchedAt < ROSTER_CACHE_TTL_MS;
		if (cacheValid) {
			ag.rosterRows = ag.rosterCache!.roster;
			ag.rosterReadFailed = false;
			ag.rosterPartial = ag.rosterCache!.truncated;
			return Promise.resolve(ag.rosterCache!.roster);
		}
		ag.rosterReadsInFlight += 1;
		ag.rosterReadFailed = false;
		return loadRoster(cfg)
			.then((read) => {
				ag.rosterCache = {
					db: cfg.db,
					roster: read.items,
					truncated: read.truncated,
					fetchedAt: Date.now()
				};
				ag.rosterRows = read.items;
				ag.rosterPartial = read.truncated;
				return read.items;
			})
			.catch((e: unknown) => {
				ag.rosterReadFailed = true;
				ag.rosterPartial = false;
				throw e;
			})
			.finally(() => {
				ag.rosterReadsInFlight -= 1;
			});
	}

	function getSections(cfg: { db: string; token: string }): Promise<SectionNode[]> {
		const cacheValid =
			ag.sectionsCache &&
			ag.sectionsCache.db === cfg.db &&
			Date.now() - ag.sectionsCache.fetchedAt < ROSTER_CACHE_TTL_MS;
		if (cacheValid) {
			ag.rosterSections = ag.sectionsCache!.sections;
			ag.sectionsReadFailed = false;
			return Promise.resolve(ag.sectionsCache!.sections);
		}
		ag.rosterReadsInFlight += 1;
		ag.sectionsReadFailed = false;
		return listSections(cfg)
			.then((sections) => {
				ag.sectionsCache = { db: cfg.db, sections, fetchedAt: Date.now() };
				ag.rosterSections = sections;
				return sections;
			})
			.catch((e: unknown) => {
				ag.sectionsReadFailed = true;
				throw e;
			})
			.finally(() => {
				ag.rosterReadsInFlight -= 1;
			});
	}

	return { getRoster, getSections };
}
