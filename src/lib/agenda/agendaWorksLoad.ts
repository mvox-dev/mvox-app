import { cfgFor } from '$lib/entu/cfg';
import { nextEventFileIds } from '$lib/agenda/nextEventFileIds';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { refreshEventPageDetail, refreshEventPageWorkRows } from '$lib/events/eventPageData';
import { getAppByteStore } from '$lib/files/appByteStore';
import { prefetchNextEventParts } from '$lib/files/prefetch';
import { ensureRetentionSweep, seedRetentionKeys } from '$lib/files/retention';
import type { ManageRightsState, WorkRow } from '$lib/repertoire/types';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import type { Season } from '$lib/seasons/types';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { mergePendingRows as mergeRows } from '$lib/repertoire/repertoirePending';
import { refetchSeasonRepertoire, refetchWorkRows } from '$lib/repertoire/refetchWorkRows';
import type { AgendaLoadDeps, AgendaLoadState, LoadCounters } from '$lib/agenda/agendaLoad';

export function createAgendaWorksLoad(ag: AgendaLoadState, seq: LoadCounters, deps: AgendaLoadDeps) {
	const {
		refreshPresence,
		listWorks,
		listAllEditions,
		listRepertoireItems,
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
		ag.seasonCreateRights = 'not-editor';
		ag.eventManageRights = {};
		ag.seasonRepertoire = [];
		ag.libraryWorks = [];
		ag.libraryEditions = [];
		ag.libraryWorksPartial = false;
		ag.libraryEditionsPartial = false;
		ag.scopedEditionsByWorkId = {};
		seq.scopedEditionWorkIdsRequested = new Set<string>();
		ag.libraryPickersLoading = true;
		ag.libraryPickersLoadSucceeded = false;
		ag.worksRowsLoading = true;
		ag.managePendingKeys = new Set();
		ag.manageError = false;
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
				console.error('agenda: resolving database entity rights failed', e);
				return 'error';
			})
			.then((state) => {
				if (state === 'error') databaseEntityRightsByDbPerson.delete(key);
				return state;
			});
		databaseEntityRightsByDbPerson.set(key, probe);
		return probe;
	}

	function upgradeRepertoireManagement(
		cfg: EntuCfg,
		eventIds: string[],
		seasonId: string | null,
		thisRequest: number
	) {
		loadManagePickers(cfg, seasonId, thisRequest);
		const thisWorksLoad = ++seq.worksLoadId;
		ag.worksRowsLoading = true;
		refetchWorkRows(cfg, eventIds, seasonId, worksRefetch(thisRequest, thisWorksLoad, true));
	}

	function worksRefetch(thisRequest: number, thisWorksLoad: number, includeInactive: boolean) {
		return {
			includeInactive,
			isCurrent: () => thisRequest === seq.requestId && thisWorksLoad === seq.worksLoadId,
			onRows: (byEvent: Record<string, WorkRow[]>) => {
				ag.worksByEventId = mergePendingRows(byEvent);
				ag.worksRowsLoading = false;
			},
			onFailure: () => {
				ag.worksRowsLoading = false;
			}
		};
	}

	function loadWorksAndManagement(
		cfg: EntuCfg,
		eventIds: string[],
		seasonId: string | null,
		thisRequest: number
	) {
		const canManage =
			ag.seasonManageRights === 'editor' ||
			Object.values(ag.eventManageRights).some((right) => right === 'editor');
		if (canManage) {
			loadManagePickers(cfg, seasonId, thisRequest);
		} else {
			ag.libraryPickersLoading = false;
		}

		const thisWorksLoad = ++seq.worksLoadId;
		ag.worksRowsLoading = true;
		refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {
			includeInactive: ag.seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== seq.requestId || thisWorksLoad !== seq.worksLoadId) return;
				ag.worksByEventId = byEvent;
				ag.worksRowsLoading = false;
				runPressureSweepThenPrefetch(cfg, thisRequest);
			})
			.catch(() => {
				if (thisRequest !== seq.requestId || thisWorksLoad !== seq.worksLoadId) return;
				ag.worksByEventId = {};
				ag.worksRowsLoading = false;
			});
	}

	function runPressureSweepThenPrefetch(cfg: { db: string; token: string }, thisRequest: number) {
		if (seq.pressureSweepRanAtOpen) {
			prefetchNextEventPartsAfterSettle(cfg, thisRequest);
			return;
		}
		seq.pressureSweepRanAtOpen = true;
		const identity = deps.collectiveIdentity();
		if (identity && identity.db === cfg.db) {
			seedRetentionKeys(identity.db, identity.personId, nextEventFileIds(ag.agendaItems, ag.worksByEventId));
		}
		const state = deps.collectivesState();
		ensureRetentionSweep({
			token: cfg.token,
			collectives: state.status === 'ready' ? state.collectives : [],
			fetchImpl: fetch
		}).finally(() => {
			if (thisRequest !== seq.requestId) return;
			prefetchNextEventPartsAfterSettle(cfg, thisRequest);
		});
	}

	function prefetchNextEventPartsAfterSettle(cfg: { db: string; token: string }, thisRequest: number) {
		const nextEventId = ag.agendaItems[0]?.id;
		if (nextEventId) {
			refreshEventPageDetail(cfg, nextEventId, fetch).catch((e) => {
				console.error('agenda: next-event detail prefetch failed', e);
			});
		}

		const fileIds = nextEventFileIds(ag.agendaItems, ag.worksByEventId);
		if (fileIds.length === 0) return;
		const identity = deps.collectiveIdentity();
		prefetchNextEventParts(cfg, identity, fileIds, getAppByteStore(), fetch, () => thisRequest === seq.requestId)
			.then((results) => {
				if (thisRequest !== seq.requestId || !identity) return;
				if (
					results.some((r) => r.outcome === 'network-stored' || r.outcome === 'network-uncached')
				) {
					refreshPresence(identity.db, identity.personId, () => thisRequest === seq.requestId);
				}
			})
			.catch((e) => {
				console.error('agenda: next-event prefetch failed', e);
			});
	}

	function loadScheduleItems(cfg: EntuCfg, eventIds: string[], thisRequest: number) {
		const thisScheduleLoad = ++seq.scheduleLoadId;
		listScheduleItemsByEventId(cfg, eventIds, fetch)
			.then((byEvent) => {
				if (thisRequest !== seq.requestId || thisScheduleLoad !== seq.scheduleLoadId) return;
				ag.scheduleByEventId = byEvent;
			})
			.catch(() => {
				if (thisRequest !== seq.requestId || thisScheduleLoad !== seq.scheduleLoadId) return;
				ag.scheduleByEventId = {};
			});
	}

	function loadManagePickers(cfg: EntuCfg, seasonId: string | null, thisRequest: number) {
		ag.libraryPickersLoading = true;
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			seasonId === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, seasonId)
		])
			.then(([worksRead, editionsRead, repertoire]) => {
				if (thisRequest !== seq.requestId) return;
				ag.libraryWorks = worksRead.items;
				ag.libraryEditions = editionsRead.items;
				ag.libraryWorksPartial = worksRead.truncated;
				ag.libraryEditionsPartial = editionsRead.truncated;
				ag.seasonRepertoire = repertoire;
				ag.libraryPickersLoading = false;
				ag.libraryPickersLoadSucceeded = true;
			})
			.catch(() => {
				if (thisRequest !== seq.requestId) return;
				ag.libraryWorks = [];
				ag.libraryEditions = [];
				ag.libraryWorksPartial = false;
				ag.libraryEditionsPartial = false;
				ag.seasonRepertoire = [];
				ag.libraryPickersLoading = false;
				ag.libraryPickersLoadSucceeded = false;
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

	function refreshWorksAfterWrite() {
		const selected = deps.selected();
		if (!selected) return;
		const cfg = cfgFor(selected.db);
		const eventIds = [...ag.agendaItems, ...ag.recentItems].map((item) => item.id);
		const seasonId = ag.currentSeasonId;
		const thisRequest = seq.requestId;
		const thisWorksLoad = ++seq.worksLoadId;
		const editor = ag.seasonManageRights === 'editor';
		refetchWorkRows(cfg, eventIds, seasonId, worksRefetch(thisRequest, thisWorksLoad, editor));
		if (seasonId !== null && editor) {
			refetchSeasonRepertoire(
				cfg,
				seasonId,
				listRepertoireItems,
				() => thisRequest === seq.requestId,
				(items) => (ag.seasonRepertoire = items)
			);
		}
	}

	return {
		resetManagement,
		deriveSeasonCreateRights,
		loadDatabaseEntityRights,
		upgradeRepertoireManagement,
		loadWorksAndManagement,
		runPressureSweepThenPrefetch,
		prefetchNextEventPartsAfterSettle,
		loadScheduleItems,
		loadManagePickers,
		mergePendingRows,
		refreshWorksAfterWrite
	};
}
