import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
import { listSections, type SectionNode } from '$lib/sections/sectionData';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import { reportProblem } from '$lib/problems/reportProblem';

const ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;

type Cfg = { db: string; token: string };

interface CacheSlot<C extends { db: string; fetchedAt: number }> {
	read(): C | null;
	write(entry: C): void;
	setFailed(failed: boolean): void;
}

export function createAgendaRosterCache(ag: AgendaLoadState) {
	function cached<C extends { db: string; fetchedAt: number }, T>(
		cfg: Cfg,
		action: string,
		slot: CacheSlot<C>,
		load: () => Promise<C>,
		apply: (entry: C) => T
	): Promise<T> {
		const hit = slot.read();
		if (hit && hit.db === cfg.db && Date.now() - hit.fetchedAt < ROSTER_CACHE_TTL_MS) {
			slot.setFailed(false);
			return Promise.resolve(apply(hit));
		}
		ag.rosterReadsInFlight += 1;
		slot.setFailed(false);
		return load()
			.then((entry) => {
				slot.write(entry);
				return apply(entry);
			})
			.catch((e: unknown) => {
				slot.setFailed(true);
				reportProblem({ area: 'agenda', action, error: e });
				throw e;
			})
			.finally(() => {
				ag.rosterReadsInFlight -= 1;
			});
	}

	function getRoster(cfg: Cfg): Promise<RosterRow[]> {
		return cached(
			cfg,
			'loading the roster',
			{
				read: () => ag.rosterCache,
				write: (entry) => (ag.rosterCache = entry),
				setFailed: (failed) => {
					ag.rosterReadFailed = failed;
					if (failed) ag.rosterPartial = false;
				}
			},
			() =>
				loadRoster(cfg).then((read) => ({
					db: cfg.db,
					roster: read.items,
					truncated: read.truncated,
					fetchedAt: Date.now()
				})),
			(entry) => {
				ag.rosterRows = entry.roster;
				ag.rosterPartial = entry.truncated;
				return entry.roster;
			}
		);
	}

	function getSections(cfg: Cfg): Promise<SectionNode[]> {
		return cached(
			cfg,
			'loading the section tree',
			{
				read: () => ag.sectionsCache,
				write: (entry) => (ag.sectionsCache = entry),
				setFailed: (failed) => (ag.sectionsReadFailed = failed)
			},
			() => listSections(cfg).then((sections) => ({ db: cfg.db, sections, fetchedAt: Date.now() })),
			(entry) => {
				ag.rosterSections = entry.sections;
				return entry.sections;
			}
		);
	}

	return { getRoster, getSections };
}
