// Agenda data load: the page owns the state object and every write; reads from modules that
// also write reach this file through `deps`, so the write-gate fence still sees them in the page.
import { untrack } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import { cfgFor } from '$lib/entu/cfg';
import { loadFullAgenda } from '$lib/agenda/agendaData';
import { nextEventFileIds } from '$lib/agenda/nextEventFileIds';
import { deriveAllMemberRates } from '$lib/attendance/attendanceSummary';
import type { MemberAttendanceRate } from '$lib/attendance/attendanceSummary';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import { sameCollectiveIdentity, type CollectiveIdentity } from '$lib/collectives/store';
import { isAuthExpiredError } from '$lib/entu/request';
import { resetServedFromCache } from '$lib/entu/readCache';
import { refreshEventPageDetail, refreshEventPageWorkRows } from '$lib/events/eventPageData';
import { getAppByteStore } from '$lib/files/appByteStore';
import { prefetchNextEventParts } from '$lib/files/prefetch';
import { ensureRetentionSweep, seedRetentionKeys } from '$lib/files/retention';
import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
import { listSections, type SectionNode } from '$lib/sections/sectionData';
import type { AgendaItem } from '$lib/agenda/types';
import type { AttendanceStatus, MyAttendance } from '$lib/attendance/attendanceData';
import type { ManageRightsState, PickerOption, WorkRow } from '$lib/repertoire/types';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import type { RsvpByEventId } from '$lib/rsvp/rsvpData';
import type { ScheduleItem } from '$lib/schedule/scheduleData';
import type { Season } from '$lib/seasons/types';
import type { Copy, Edition, Work } from '$lib/library/libraryData';
import type { CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
import type * as AttendanceData from '$lib/attendance/attendanceData';
import type * as LibraryData from '$lib/library/libraryData';
import type * as MemberLifecycle from '$lib/roster/memberLifecycle';
import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
import type * as RepertoireData from '$lib/repertoire/repertoireData';
import type * as RsvpData from '$lib/rsvp/rsvpData';
import type * as ScheduleData from '$lib/schedule/scheduleData';
import type { CollectiveState } from '$lib/collectives/types';
import { focusAfterRender } from '$lib/a11y/focusable';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { dropRows, patchRows, reorderKey, restoreRow, setOrdinals } from '$lib/repertoire/workRowOps';
import type { RepertoireRowStore } from '$lib/repertoire/repertoireRowHandlers';

type AgendaTypeFilter = 'all' | (typeof CANONICAL_EVENT_TYPES)[number];

export function createAgendaLoadState() {
	return {
		agendaItems: [] as AgendaItem[],
		agendaLoading: true,
		agendaError: false,
		sessionExpired: false,
		memberId: null as string | null,
		membership: 'loading' as 'loading' | 'member' | 'non-member',
		rsvpRights: 'loading' as 'loading' | 'editor' | 'not-editor',
		rsvpByEventId: {} as RsvpByEventId,
		rsvpPartial: false,
		failedEventIds: new Set() as Set<string>,
		savedEventIds: new Set() as Set<string>,
		myAttendance: [] as MyAttendance[],
		attendancePartial: false,
		recentItems: [] as AgendaItem[],
		attendanceEventIds: new Set() as Set<string>,
		agendaTypeFilter: 'all' as AgendaTypeFilter,
		worksByEventId: {} as Record<string, WorkRow[]>,
		scheduleByEventId: {} as Record<string, ScheduleItem[]>,
		pdfError: false,
		heldFileIds: null as Set<string> | null,
		currentSeasonId: null as string | null,
		seasonManageRights: 'not-editor' as ManageRightsState,
		manageableSeasonId: null as string | null,
		manageableSeasonRights: 'not-editor' as ManageRightsState,
		manageableSeasonRightsById: {} as Record<string, ManageRightsState>,
		seasonCreateRights: 'not-editor' as ManageRightsState,
		eventManageRights: {} as Record<string, ManageRightsState>,
		seasons: [] as Season[],
		seasonRepertoire: [] as RepertoireItem[],
		libraryWorks: [] as Work[],
		libraryEditions: [] as Edition[],
		libraryWorksPartial: false,
		libraryEditionsPartial: false,
		scopedEditionsByWorkId: {} as Record<string, PickerOption[]>,
		libraryPickersLoading: false,
		libraryPickersLoadSucceeded: false,
		worksRowsLoading: false,
		managePendingKeys: new Set() as Set<string>,
		manageError: false,
		panelRepertoire: [] as RepertoireItem[],
		panelWorks: [] as Work[],
		panelEditions: [] as Edition[],
		panelWorksPartial: false,
		panelCopies: [] as Copy[],
		panelRepertoireError: false,
		panelRepertoireLoading: false,
		panelRepertoireItemsOk: false,
		panelWorksSourcesOk: false,
		seasonSummaryExpanded: false,
		seasonMemberRates: [] as MemberAttendanceRate[],
		seasonRatesLoaded: false,
		seasonRatesLoading: false,
		seasonRatesError: false,
		seasonRatesPartial: false,
		attendanceItem: null as AgendaItem | null,
		attendanceLoading: false,
		attendanceError: false,
		attendanceRoster: [] as RosterRow[],
		attendanceMap: {} as Record<string, { attendanceId: string; status: AttendanceStatus }>,
		attendanceRsvpMap: {} as Record<string, { rsvpId: string; status: string }>,
		attendancePendingMemberIds: new Set() as Set<string>,
		attendanceFailedMemberIds: new Set() as Set<string>,
		attendanceSavedMemberIds: new Set() as Set<string>,
		attendanceFailedByEvent: new Map() as Map<string, Set<string>>,
		rosterCache: null as { db: string; roster: RosterRow[]; truncated: boolean; fetchedAt: number; } | null,
		rosterRows: [] as RosterRow[],
		rosterReadsInFlight: 0,
		rosterReadFailed: false,
		rosterPartial: false,
		sectionsReadFailed: false,
		sectionsCache: null as { db: string; sections: SectionNode[]; fetchedAt: number } | null,
		rosterSections: [] as SectionNode[],
	};
}

export type AgendaLoadState = ReturnType<typeof createAgendaLoadState>;

export function createLoadCounters() {
	return {
		scopedEditionWorkIdsRequested: new Set<string>(),
		panelRepertoireSeasonId: null as string | null,
		attendanceRequestId: 0,
		requestId: 0,
		pressureSweepRanAtOpen: false,
		worksLoadId: 0,
		scheduleLoadId: 0,
	};
}

export type LoadCounters = ReturnType<typeof createLoadCounters>;

export interface AgendaLoadDeps {
	selected: () => { db: string; personId: string } | null;
	seasonManageOpen: () => boolean;
	seasonManageSwitchGeneration: () => number;
	collectiveIdentity: () => CollectiveIdentity | null;
	collectivesState: () => CollectiveState;
	isRepertoirePending: (key: string) => boolean;
	pendingMembersForEvent: (eventId: string) => Set<string>;
	resetSeasonManage: () => void;
	closeSeasonCreateForm: () => void;
	closeEventCreateForm: () => void;
	closeSeriesCreateForm: () => void;
	restoreSeriesCreateRun: () => void;
	refreshPresence: (db: string, personId: string, isCurrent: () => boolean) => void;
	findMyMemberId: typeof RsvpData.findMyMemberId;
	listMyRsvps: typeof RsvpData.listMyRsvps;
	rsvpsByEventId: typeof RsvpData.rsvpsByEventId;
	listMyAttendance: typeof AttendanceData.listMyAttendance;
	listAttendance: typeof AttendanceData.listAttendance;
	listAllRsvpsForEvent: typeof AttendanceData.listAllRsvpsForEvent;
	attendanceByMemberId: typeof AttendanceData.attendanceByMemberId;
	listWorks: typeof LibraryData.listWorks;
	listAllEditions: typeof LibraryData.listAllEditions;
	listAllCopies: typeof LibraryData.listAllCopies;
	listRepertoireItems: typeof RepertoireData.listRepertoireItems;
	listScheduleItemsByEventId: typeof ScheduleData.listScheduleItemsByEventId;
	loadActiveAndArchivedRosters: typeof MemberLifecycle.loadActiveAndArchivedRosters;
	canMarkAttendance: typeof RepertoireActions.canMarkAttendance;
	manageRightsFrom: typeof RepertoireActions.manageRightsFrom;
	resolveManageRights: typeof RepertoireActions.resolveManageRights;
}

export function createAgendaLoader(ag: AgendaLoadState, seq: LoadCounters, deps: AgendaLoadDeps) {
	const {
		resetSeasonManage,
		closeSeasonCreateForm,
		restoreSeriesCreateRun,
		refreshPresence,
		findMyMemberId,
		listMyRsvps,
		rsvpsByEventId,
		listMyAttendance,
		listAttendance,
		listAllRsvpsForEvent,
		attendanceByMemberId,
		listWorks,
		listAllEditions,
		listAllCopies,
		listRepertoireItems,
		listScheduleItemsByEventId,
		loadActiveAndArchivedRosters,
		canMarkAttendance,
		manageRightsFrom,
		resolveManageRights,
	} = deps;
	const ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;

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

		function loadForSelected(opts: { keepSeasonManage?: boolean } = {}) {
			const keepSeasonManage = opts.keepSeasonManage === true;
			const heldSeasonId = keepSeasonManage && deps.seasonManageOpen() ? ag.manageableSeasonId : null;
			const current = deps.selected();
			if (!current) {
				ag.agendaItems = [];
				ag.agendaLoading = false;
				ag.agendaError = false;
				ag.memberId = null;
				ag.membership = 'loading';
				ag.rsvpRights = 'loading';
				ag.rsvpByEventId = {};
				ag.rsvpPartial = false;
				ag.failedEventIds = new Set();
				ag.savedEventIds = new Set();
				ag.recentItems = [];
				ag.attendanceEventIds = new Set();
				ag.agendaTypeFilter = 'all';
				ag.worksByEventId = {};
				ag.scheduleByEventId = {};
				ag.pdfError = false;
				ag.heldFileIds = null;
				resetManagement();
				ag.libraryPickersLoading = false;
				ag.worksRowsLoading = false;
				closeAttendancePanel();
				ag.rosterCache = null;
				ag.rosterRows = [];
				ag.rosterPartial = false;
				ag.sectionsCache = null;
				ag.rosterSections = [];
				ag.rosterReadFailed = false;
				ag.sectionsReadFailed = false;
				resetSeasonManage();
				ag.attendanceFailedByEvent = new Map();
				ag.myAttendance = [];
				ag.attendancePartial = false;
				ag.seasonSummaryExpanded = false;
				ag.seasonMemberRates = [];
				ag.seasonRatesLoaded = false;
				ag.seasonRatesLoading = false;
				ag.seasonRatesError = false;
				ag.seasonRatesPartial = false;
				ag.seasons = [];
				closeSeasonCreateForm();
				deps.closeEventCreateForm();
				deps.closeSeriesCreateForm();
				return;
			}
			const thisRequest = ++seq.requestId;
			closeAttendancePanel();
			ag.agendaLoading = true;
			ag.agendaError = false;
			ag.sessionExpired = false;
			resetServedFromCache();
			ag.memberId = null;
			ag.membership = 'loading';
			ag.rsvpRights = 'loading';
			ag.failedEventIds = new Set();
			ag.savedEventIds = new Set();
			ag.worksByEventId = {};
			ag.scheduleByEventId = {};
			ag.pdfError = false;
			ag.heldFileIds = null;
			resetManagement();
			if (!keepSeasonManage) {
				ag.agendaTypeFilter = 'all';
				ag.rosterCache = null;
				ag.rosterRows = [];
				ag.rosterPartial = false;
				ag.sectionsCache = null;
				ag.rosterSections = [];
				ag.rosterReadFailed = false;
				ag.sectionsReadFailed = false;
				resetSeasonManage();
				deps.closeSeriesCreateForm();
			}
			ag.attendanceFailedByEvent = new Map();
			ag.myAttendance = [];
			ag.rsvpPartial = false;
			ag.attendancePartial = false;
			ag.seasonSummaryExpanded = false;
			ag.seasonMemberRates = [];
			ag.seasonRatesLoaded = false;
			ag.seasonRatesLoading = false;
			ag.seasonRatesError = false;
			ag.seasonRatesPartial = false;
			ag.seasons = [];
			closeSeasonCreateForm();
			deps.closeEventCreateForm();

			const personId = current.personId;

			loadFullAgenda()
				.then(
					({
						upcoming,
						recent,
						seasonId,
						seasonConductors,
						seasonOwners,
						seasonEditors,
						seasons: fullSeasons,
						manageableSeasonId: mSeasonId,
						manageableSeasonOwners: mOwners,
						manageableSeasonEditors: mEditors
					}) => {
						if (thisRequest !== seq.requestId) return;
						ag.agendaItems = upcoming;
						ag.agendaLoading = false;
						ag.recentItems = recent;
						ag.seasons = fullSeasons;

						const worksCfg = cfgFor(current.db);
						const events = [...upcoming, ...recent];
						const eventIds = events.map((item) => item.id);
						ag.currentSeasonId = seasonId;
						ag.seasonManageRights =
							seasonId === null
								? 'not-editor'
								: manageRightsFrom(seasonOwners, seasonEditors, personId);
						const nowDateOnly = new Date().toISOString().slice(0, 10);
						const candidateSeasons = fullSeasons.filter(
							(s) => s.id === mSeasonId || s.endDate === '' || s.endDate >= nowDateOnly
						);
						const nextManageableRightsById: Record<string, ManageRightsState> = {};
						for (const s of candidateSeasons) {
							nextManageableRightsById[s.id] = manageRightsFrom(s.owners, s.editors, personId);
						}
						ag.manageableSeasonRightsById = nextManageableRightsById;
						const keptSeasonId =
							heldSeasonId !== null && candidateSeasons.some((s) => s.id === heldSeasonId)
								? heldSeasonId
								: null;
						if (keptSeasonId !== null) {
							ag.manageableSeasonId = keptSeasonId;
							ag.manageableSeasonRights = nextManageableRightsById[keptSeasonId] ?? 'not-editor';
						} else {
							if (heldSeasonId !== null) {
								resetSeasonManage();
								deps.closeSeriesCreateForm();
							}
							ag.manageableSeasonId = mSeasonId;
							ag.manageableSeasonRights =
								mSeasonId === null ? 'not-editor' : manageRightsFrom(mOwners, mEditors, personId);
						}
						restoreSeriesCreateRun();
						ag.seasonCreateRights = deriveSeasonCreateRights(
							seasonId,
							seasonOwners,
							seasonEditors,
							fullSeasons,
							personId
						);
						ag.eventManageRights = Object.fromEntries(
							events.map((item) => [item.id, manageRightsFrom(item.owners, item.editors, personId)])
						);
						loadWorksAndManagement(worksCfg, eventIds, seasonId, thisRequest);
						refreshPresence(worksCfg.db, personId, () => thisRequest === seq.requestId);
						loadScheduleItems(worksCfg, eventIds, thisRequest);
						const currentRightsInvisible =
							seasonId !== null && seasonOwners.length === 0 && seasonEditors.length === 0;
						const noSeasonToBorrowFrom = seasonId === null && fullSeasons.length === 0;
						const invisibleCandidateSeasons = candidateSeasons.filter(
							(s) => s.owners.length === 0 && s.editors.length === 0
						);
						if (
							invisibleCandidateSeasons.length > 0 ||
							currentRightsInvisible ||
							noSeasonToBorrowFrom
						) {
							loadDatabaseEntityRights(worksCfg, personId).then((state) => {
								if (thisRequest !== seq.requestId) return;
								if (state !== 'editor') return;
								if (invisibleCandidateSeasons.length > 0) {
									ag.manageableSeasonRightsById = {
										...ag.manageableSeasonRightsById,
										...Object.fromEntries(
											invisibleCandidateSeasons.map(
												(s) => [s.id, 'editor'] as [string, ManageRightsState]
											)
										)
									};
								}
								if (
									ag.manageableSeasonId !== null &&
									ag.manageableSeasonRightsById[ag.manageableSeasonId] === 'editor'
								) {
									ag.manageableSeasonRights = 'editor';
								}
								ag.seasonCreateRights = 'editor';
								if (currentRightsInvisible && ag.seasonManageRights !== 'editor') {
									ag.seasonManageRights = 'editor';
									upgradeRepertoireManagement(worksCfg, eventIds, seasonId, thisRequest);
								}
							});
						}
						ag.attendanceEventIds = new Set(
							recent.filter((item) => canMarkAttendance(item, personId)).map((item) => item.id)
						);
					}
				)
				.catch((err) => {
					if (thisRequest !== seq.requestId) return;
					ag.agendaLoading = false;
					if (isAuthExpiredError(err)) {
						ag.sessionExpired = true;
					} else {
						ag.agendaError = true;
					}
					ag.recentItems = [];
					ag.attendanceEventIds = new Set();
					ag.worksByEventId = {};
					ag.scheduleByEventId = {};
					ag.heldFileIds = null;
					resetManagement();
					ag.libraryPickersLoading = false;
					ag.worksRowsLoading = false;
					resetSeasonManage();
					ag.seasons = [];
				});

			{
				const rightsCfg = cfgFor(current.db);
				const rightsIdentity = { db: current.db, personId };
				resolveManageRights(rightsCfg, personId, personId).then((state) => {
					if (!sameCollectiveIdentity(deps.collectiveIdentity(), rightsIdentity)) return;
					ag.rsvpRights = state === 'editor' ? 'editor' : 'not-editor';
				});
			}

			findMyMemberId(cfgFor(current.db), personId)
				.then((id) => {
					if (thisRequest !== seq.requestId) return;
					ag.memberId = id;
					ag.membership = id ? 'member' : 'non-member';
					if (id) {
						listMyAttendance(cfgFor(current.db), id)
							.then((result) => {
								if (thisRequest !== seq.requestId) return;
								ag.myAttendance = result.items;
								ag.attendancePartial = result.truncated;
							})
							.catch(() => {
								if (thisRequest !== seq.requestId) return;
								ag.myAttendance = [];
								ag.attendancePartial = false;
							});
					} else {
						ag.myAttendance = [];
						ag.attendancePartial = false;
					}
				})
				.catch(() => {
					if (thisRequest !== seq.requestId) return;
					ag.memberId = null;
					ag.membership = 'loading';
				});

			listMyRsvps(cfgFor(current.db), personId)
				.then((result) => {
					if (thisRequest !== seq.requestId) return;
					ag.rsvpByEventId = rsvpsByEventId(result.items);
					ag.rsvpPartial = result.truncated;
				})
				.catch(() => {
					if (thisRequest !== seq.requestId) return;
					ag.rsvpByEventId = {};
					ag.rsvpPartial = false;
				});
		}

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
			refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, { includeInactive: true })
				.then((byEvent) => {
					if (thisRequest !== seq.requestId || thisWorksLoad !== seq.worksLoadId) return;
					ag.worksByEventId = mergePendingRows(byEvent);
					ag.worksRowsLoading = false;
				})
				.catch(() => {
					if (thisRequest !== seq.requestId || thisWorksLoad !== seq.worksLoadId) return;
					ag.worksRowsLoading = false;
				});
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
				const reorderPending = deps.isRepertoirePending(reorderKey(eventId));
				const live = ag.worksByEventId[eventId] ?? [];
				const out: WorkRow[] = [];
				for (const row of rows) {
					const pending =
						deps.isRepertoirePending(row.id) || (reorderPending && row.kind === 'program');
					if (!pending) {
						out.push(row);
						continue;
					}
					const liveRow = live.find((r) => r.id === row.id);
					if (liveRow) out.push(liveRow);
				}
				merged[eventId] = out;
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
			refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {
				includeInactive: ag.seasonManageRights === 'editor'
			})
				.then((byEvent) => {
					if (thisRequest !== seq.requestId || thisWorksLoad !== seq.worksLoadId) return;
					ag.worksByEventId = mergePendingRows(byEvent);
					ag.worksRowsLoading = false;
				})
				.catch(() => {
					if (thisRequest !== seq.requestId || thisWorksLoad !== seq.worksLoadId) return;
					ag.worksRowsLoading = false;
				});
			if (seasonId !== null && ag.seasonManageRights === 'editor') {
				listRepertoireItems(cfg, seasonId)
					.then((items) => {
						if (thisRequest !== seq.requestId) return;
						ag.seasonRepertoire = items;
					})
					.catch(() => {
					});
			}
		}

		function mapRows(update: (rows: WorkRow[], eventId: string) => WorkRow[]) {
			const next: Record<string, WorkRow[]> = {};
			for (const [eventId, rows] of Object.entries(ag.worksByEventId)) {
				next[eventId] = update(rows, eventId);
			}
			ag.worksByEventId = next;
		}

		function findRow(itemId: string): WorkRow | undefined {
			for (const rows of Object.values(ag.worksByEventId)) {
				const hit = rows.find((row) => row.id === itemId);
				if (hit) return hit;
			}
			return undefined;
		}

		function snapshotRow(itemId: string, onlyEventId?: string): () => void {
			const snapshot: Array<{ eventId: string; index: number; row: WorkRow }> = [];
			for (const [eventId, rows] of Object.entries(ag.worksByEventId)) {
				if (onlyEventId !== undefined && eventId !== onlyEventId) continue;
				const index = rows.findIndex((row) => row.id === itemId);
				if (index >= 0) snapshot.push({ eventId, index, row: rows[index] });
			}
			return () => {
				const next = { ...ag.worksByEventId };
				for (const { eventId, index, row } of snapshot) {
					next[eventId] = restoreRow(next[eventId] ?? [], index, row);
				}
				ag.worksByEventId = next;
			};
		}

		const rowStore: RepertoireRowStore = {
			list: (eventId) => ag.worksByEventId[eventId] ?? [],
			find: findRow,
			patch: (itemId, patch) => mapRows((rows) => patchRows(rows, itemId, patch)),
			drop: (itemId, onlyEventId) =>
				mapRows((rows, eventId) =>
					onlyEventId !== undefined && eventId !== onlyEventId ? rows : dropRows(rows, itemId)
				),
			snapshot: snapshotRow,
			setOrdinals: (eventId, ordinalById) =>
				mapRows((rows, id) => (id === eventId ? setOrdinals(rows, ordinalById) : rows))
		};

		function openAttendancePanel(item: AgendaItem) {
			const selected = deps.selected();
			if (!selected) return;
			if (!ag.attendanceEventIds.has(item.id)) return;
			ag.attendanceItem = item;
			ag.attendanceLoading = true;
			ag.attendanceError = false;
			ag.attendanceRoster = [];
			ag.attendanceMap = {};
			ag.attendanceRsvpMap = {};
			ag.attendancePendingMemberIds = deps.pendingMembersForEvent(item.id);
			ag.attendanceFailedMemberIds = new Set(ag.attendanceFailedByEvent.get(item.id) ?? []);
			ag.attendanceSavedMemberIds = new Set();

			const cfg = cfgFor(selected.db);
			const thisRequest = ++seq.attendanceRequestId;

			const rosterPromise = getRoster(cfg);

			const requestIssuedAt = Date.now();
			Promise.all([rosterPromise, listAttendance(cfg, item.id), listAllRsvpsForEvent(cfg, item.id)])
				.then(([roster, records, rsvps]) => {
					if (thisRequest !== seq.attendanceRequestId) return;
					ag.attendanceRoster = roster;
					const pendingMembers = deps.pendingMembersForEvent(item.id);
					const serverMap = attendanceByMemberId(records);
					const merged = { ...serverMap };
					for (const mid of pendingMembers) {
						if (mid in ag.attendanceMap) merged[mid] = ag.attendanceMap[mid];
						else delete merged[mid];
					}
					for (const mid of Object.keys(ag.attendanceMap)) {
						if (pendingMembers.has(mid)) continue;
						const liveEntry = ag.attendanceMap[mid];
						const serverEntry = serverMap[mid];
						if (liveEntry && (!serverEntry || serverEntry.attendanceId !== liveEntry.attendanceId)) {
							merged[mid] = liveEntry;
						}
					}
					ag.attendanceMap = merged;
					const rsvpMap: Record<string, { rsvpId: string; status: string }> = {};
					for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
					ag.attendanceRsvpMap = rsvpMap;
					ag.attendanceLoading = false;
				})
				.catch(() => {
					if (thisRequest !== seq.attendanceRequestId) return;
					ag.attendanceLoading = false;
					ag.attendanceError = true;
				});
		}

		function closeAttendancePanel() {
			const closedItemId = untrack(() => ag.attendanceItem?.id);
			seq.attendanceRequestId++;
			ag.attendanceItem = null;
			ag.attendanceLoading = false;
			ag.attendanceError = false;
			if (closedItemId) {
				void focusAfterRender(() =>
					document.querySelector<HTMLElement>(
						`[data-testid="agenda-recent-row-${closedItemId}"] [data-testid="take-attendance-btn"]`
					)
				);
			}
		}

		function handleExpandSeasonSummary() {
			const selected = deps.selected();
			if (!selected) return;
			if (ag.seasonSummaryExpanded) {
				ag.seasonSummaryExpanded = false;
				return;
			}
			ag.seasonSummaryExpanded = true;
			if (ag.seasonRatesLoaded) return;
			const cfg = cfgFor(selected.db);
			const events = ag.recentItems;
			const thisRequestSnapshot = seq.requestId;
			ag.seasonRatesLoading = true;
			ag.seasonRatesError = false;
			Promise.all([
				loadActiveAndArchivedRosters(cfg),
				Promise.all(events.map((event) => listAttendance(cfg, event.id)))
			])
				.then(([rosters, perEventRecords]) => {
					if (thisRequestSnapshot !== seq.requestId) return;
					const rosterRead = rosters.active;
					const inactiveRead = rosters.inactive;
					ag.seasonRatesPartial = rosterRead.truncated || inactiveRead.truncated;
					ag.seasonMemberRates = deriveAllMemberRates(
						perEventRecords.flat(),
						rosterRead.items,
						events.length,
						inactiveRead.items
					);
					ag.seasonRatesLoaded = true;
					ag.seasonRatesLoading = false;
				})
				.catch(() => {
					if (thisRequestSnapshot !== seq.requestId) return;
					ag.seasonRatesLoading = false;
					ag.seasonRatesError = true;
					ag.seasonMemberRates = [];
					ag.seasonRatesPartial = false;
				});
		}

		function loadPanelRepertoire(cfg: EntuCfg, seasonId: string): void {
			const thisRequest = seq.requestId;
			const thisSwitch = deps.seasonManageSwitchGeneration();
			seq.panelRepertoireSeasonId = seasonId;
			ag.panelRepertoireError = false;
			ag.panelRepertoireLoading = true;
			ag.panelRepertoireItemsOk = false;
			ag.panelWorksSourcesOk = false;
			let itemsSettled = false;
			let sourcesSettled = false;
			const maybeStopLoading = () => {
				if (itemsSettled && sourcesSettled) ag.panelRepertoireLoading = false;
			};
			listRepertoireItems(cfg, seasonId)
				.then((items) => {
					if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
					ag.panelRepertoire = items;
					ag.panelRepertoireItemsOk = true;
				})
				.catch((e) => {
					if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
					console.error('agenda: loading the season-manage repertoire failed', e);
					ag.panelRepertoire = [];
					ag.panelRepertoireError = true;
				})
				.finally(() => {
					if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
					itemsSettled = true;
					maybeStopLoading();
				});
			Promise.all([listWorks(cfg), listAllEditions(cfg), listAllCopies(cfg)])
				.then(([worksRead, editionsRead, copiesRead]) => {
					if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
					ag.panelWorks = worksRead.items;
					ag.panelEditions = editionsRead.items;
					ag.panelCopies = copiesRead.items;
					ag.panelWorksPartial = worksRead.truncated;
					ag.panelWorksSourcesOk = true;
				})
				.catch((e) => {
					if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
					console.error('agenda: loading the season-manage repertoire sources failed', e);
					ag.panelWorks = [];
					ag.panelEditions = [];
					ag.panelCopies = [];
					ag.panelWorksPartial = false;
					ag.panelRepertoireError = true;
				})
				.finally(() => {
					if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
					sourcesSettled = true;
					maybeStopLoading();
				});
		}

	return {
		getRoster,
		getSections,
		loadForSelected,
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
		refreshWorksAfterWrite,
		rowStore,
		openAttendancePanel,
		closeAttendancePanel,
		handleExpandSeasonSummary,
		loadPanelRepertoire,
	};
}
