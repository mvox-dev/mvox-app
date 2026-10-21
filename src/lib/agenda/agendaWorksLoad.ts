import { cfgFor, type EntuCfg } from '$lib/entu/cfg';
import { nextEventFileIds } from '$lib/agenda/nextEventFileIds';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { refreshEventPageDetail, refreshEventPageWorkRows } from '$lib/events/eventPageData';
import { getAppByteStore } from '$lib/files/appByteStore';
import { prefetchNextEventParts } from '$lib/files/prefetch';
import { ensureRetentionSweep, seedRetentionKeys } from '$lib/files/retention';
import type { ManageRightsState, WorkRow } from '$lib/repertoire/types';
import type { Season } from '$lib/seasons/types';
import { mergePendingRows as mergeRows } from '$lib/repertoire/repertoirePending';
import { refetchWorkRows } from '$lib/repertoire/refetchWorkRows';
import { reportProblem } from '$lib/problems/reportProblem';
import type { AgendaLoadDeps, AgendaLoadState, LoadCounters } from '$lib/agenda/agendaLoad';

export function createAgendaWorksLoad(ag: AgendaLoadState, seq: LoadCounters, deps: AgendaLoadDeps) {
	const {
		refreshPresence,
		listScheduleItemsByEventId,
		manageRightsFrom,
		resolveManageRights
	} = deps;

	function resetManagement() {
		ag.currentSeasonId = null;
		ag.seasonManageRights = 'not-editor';
		ag.manageableSeasonId = null;
		ag.manageableSeasonRights = 'not-editor';
		ag.manageableSeasonRightsById = {};
		ag.ownedSeasonIds = new Set();
		ag.seasonCreateRights = 'not-editor';
		ag.eventManageRights = {};
	}

	function deriveSeasonCreateRights(
		seasonId: string | null,
		seasonOwners: string[],
		seasonEditors: string[],
		allSeasons: Season[],
		personId: string
	): ManageRightsState {
		if (seasonId !== null) return manageRightsFrom(seasonOwners, seasonEditors, personId);
		const latest = allSeasons.reduce<Season | null>(
			(best, s) => (best === null || s.startDate > best.startDate ? s : best),
			null
		);
		if (!latest) return 'not-editor';
		return manageRightsFrom(latest.owners, latest.editors, personId);
	}

	const databaseEntityRightsByDbPerson = new Map<string, Promise<ManageRightsState>>();

	function loadDatabaseEntityRights(cfg: EntuCfg, personId: string): Promise<ManageRightsState> {
		const key = `${cfg.db}::${personId}`;
		const cached = databaseEntityRightsByDbPerson.get(key);
		if (cached) return cached;
		const probe = resolveDatabaseEntityId(cfg)
			.then((dbEntityId) =>
				dbEntityId === null
					?
						Promise.resolve<ManageRightsState>('not-editor')
					: resolveManageRights(cfg, dbEntityId, personId)
			)
			.catch((e): ManageRightsState => {
				reportProblem({ area: 'agenda', action: 'resolving the database entity rights', error: e });
				return 'error';
			})
			.then((state) => {
				if (state === 'error') databaseEntityRightsByDbPerson.delete(key);
				return state;
			});
		databaseEntityRightsByDbPerson.set(key, probe);
		return probe;
	}

	function worksRefetch(
		isRequestCurrent: () => boolean,
		isWorksCurrent: () => boolean,
		includeInactive: boolean
	) {
		return {
			includeInactive,
			isCurrent: () => isRequestCurrent() && isWorksCurrent(),
			onRows: (byEvent: Record<string, WorkRow[]>) => {
				ag.worksByEventId = mergePendingRows(byEvent);
			}
		};
	}

	function loadWorksAndManagement(
		cfg: EntuCfg,
		eventIds: string[],
		seasonId: string | null,
		isRequestCurrent: () => boolean
	): Promise<void> {
		const isWorksCurrent = seq.worksLoad.next();
		return refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {
			includeInactive: ag.seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (!isRequestCurrent() || !isWorksCurrent()) return;
				ag.worksByEventId = byEvent;
				void runPressureSweepThenPrefetch(cfg, isRequestCurrent);
			})
			.catch((e) => {
				if (!isRequestCurrent() || !isWorksCurrent()) return;
				reportProblem({ area: 'agenda', action: 'loading the work rows', error: e });
				ag.worksByEventId = {};
			});
	}

	function runPressureSweepThenPrefetch(cfg: { db: string; token: string }, isRequestCurrent: () => boolean): Promise<void> {
		if (seq.pressureSweepRanAtOpen) {
			return prefetchNextEventPartsAfterSettle(cfg, isRequestCurrent);
		}
		seq.pressureSweepRanAtOpen = true;
		const identity = deps.collectiveIdentity();
		if (identity && identity.db === cfg.db) {
			seedRetentionKeys(identity, nextEventFileIds(ag.agendaItems, ag.worksByEventId));
		}
		const state = deps.collectivesState();
		return ensureRetentionSweep({
			token: cfg.token,
			collectives: state.status === 'ready' ? state.collectives : [],
			fetchImpl: fetch
		}).finally(() => {
			if (!isRequestCurrent()) return;
			return prefetchNextEventPartsAfterSettle(cfg, isRequestCurrent);
		});
	}

	function prefetchNextEventPartsAfterSettle(cfg: { db: string; token: string }, isRequestCurrent: () => boolean): Promise<void> {
		const nextEventId = ag.agendaItems[0]?.id;
		const detailChain: Promise<unknown> = nextEventId
			? refreshEventPageDetail(cfg, nextEventId, fetch).catch((e) => {
					if (!isRequestCurrent()) return;
					reportProblem({ area: 'agenda', action: 'prefetching the next event', error: e });
				})
			: Promise.resolve();

		const fileIds = nextEventFileIds(ag.agendaItems, ag.worksByEventId);
		if (fileIds.length === 0) return detailChain.then(() => {});
		const identity = deps.collectiveIdentity();
		const partsChain = prefetchNextEventParts(cfg, identity, fileIds, getAppByteStore(), fetch, isRequestCurrent)
			.then((results) => {
				if (!isRequestCurrent() || !identity) return;
				if (
					results.some((r) => r.outcome === 'network-stored' || r.outcome === 'network-uncached')
				) {
					refreshPresence(identity, isRequestCurrent);
				}
			})
			.catch((e) => {
				if (!isRequestCurrent()) return;
				reportProblem({ area: 'agenda', action: 'prefetching the next event parts', error: e });
			});
		return Promise.all([detailChain, partsChain]).then(() => {});
	}

	function loadScheduleItems(cfg: EntuCfg, eventIds: string[], isRequestCurrent: () => boolean): Promise<void> {
		const isScheduleCurrent = seq.scheduleLoad.next();
		return listScheduleItemsByEventId(cfg, eventIds, fetch)
			.then((byEvent) => {
				if (!isRequestCurrent() || !isScheduleCurrent()) return;
				ag.scheduleByEventId = byEvent;
			})
			.catch((e) => {
				if (!isRequestCurrent() || !isScheduleCurrent()) return;
				reportProblem({ area: 'agenda', action: 'loading the schedule items', error: e });
				ag.scheduleByEventId = {};
			});
	}

	function mergePendingRows(byEvent: Record<string, WorkRow[]>): Record<string, WorkRow[]> {
		const merged: Record<string, WorkRow[]> = {};
		for (const [eventId, rows] of Object.entries(byEvent)) {
			const live = ag.worksByEventId[eventId] ?? [];
			merged[eventId] = mergeRows(rows, live, deps.isRepertoirePending, eventId);
		}
		return merged;
	}

	function refreshWorksAfterWrite(): Promise<void> {
		const selected = deps.selected();
		if (!selected) return Promise.resolve();
		const cfg = cfgFor(selected.db);
		const eventIds = [...ag.agendaItems, ...ag.recentItems].map((item) => item.id);
		const seasonId = ag.currentSeasonId;
		const isRequestCurrent = seq.request.whileCurrent();
		const isWorksCurrent = seq.worksLoad.next();
		const editor = ag.seasonManageRights === 'editor';
		return refetchWorkRows(cfg, eventIds, seasonId, worksRefetch(isRequestCurrent, isWorksCurrent, editor));
	}

	return {
		resetManagement,
		deriveSeasonCreateRights,
		loadDatabaseEntityRights,
		loadWorksAndManagement,
		runPressureSweepThenPrefetch,
		prefetchNextEventPartsAfterSettle,
		loadScheduleItems,
		mergePendingRows,
		refreshWorksAfterWrite
	};
}
