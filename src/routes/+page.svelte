<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/auth/session';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
	// #220 — the AM/PM preference reaches every displayed clock time through
	// this ONE shared formatter (timeFormat.no-hardcoded-render.spec.ts pins
	// that no other file may keep its own 24h-rendering Intl formatter).
	import { isoDateFormatter } from '$lib/preferences/timeFormat';
	import {
		collectiveState,
		selectedCollectiveStore,
		selectedCollectiveIdentityStore,
		pickerModeStore,
		selectCollective,
		hydrateCollectives,
		sameCollectiveIdentity
	} from '$lib/collectives/store';
	import { loadFullAgenda } from '$lib/agenda/agendaData';
	import type { AgendaItem } from '$lib/agenda/types';
	import { nextEventFileIds } from '$lib/agenda/nextEventFileIds';
	import { prefetchNextEventParts } from '$lib/files/prefetch';
	import { refreshEventPageDetail, refreshEventPageWorkRows } from '$lib/events/eventPageData';
	import { ensureRetentionSweep, seedRetentionKeys } from '$lib/files/retention';
	import { getToken } from '$lib/auth/storage';
	import {
		findMyMemberId,
		listMyRsvps,
		rsvpsByEventId,
		type MyRsvp,
		type RsvpByEventId,
		type RsvpStatus
	} from '$lib/rsvp/rsvpData';
	import { createRsvpChangeQueue, type RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
	import { completionGateStore } from '$lib/profile/completionGate';
	import { loadRoster } from '$lib/roster/rosterData';
	import type { RosterRow } from '$lib/roster/rosterData';
	import { loadActiveAndArchivedRosters } from '$lib/roster/memberLifecycle';
	import {
		listAttendance,
		listMyAttendance,
		listAllRsvpsForEvent,
		attendanceByMemberId,
		type AttendanceStatus,
		type EventAttendance,
		type MyAttendance
	} from '$lib/attendance/attendanceData';
	import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
	import { deriveAttendanceRate, deriveAllMemberRates, type MemberAttendanceRate } from '$lib/attendance/attendanceSummary';
	import { collectSources, buildWorkRows } from '$lib/repertoire/workRows';
	import { listScheduleItemsByEventId, type ScheduleItem } from '$lib/schedule/scheduleData';
	import { openFileBytes } from '$lib/files/openFileBytes';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { getAppLabelStore } from '$lib/files/appLabelStore';
	import { recordPartLabel } from '$lib/files/labelStore';
	import { workLabel } from '$lib/repertoire/workLabel';
	import type {
		ManageRightsState,
		PickerOption,
		RepertoireStatus,
		WorkRow,
		WorksManage
	} from '$lib/repertoire/types';
	import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
	import {
		canDeleteSeries,
		canMarkAttendance,
		createProgramItem,
		createRepertoireItem,
		createRepertoireWriteQueue,
		deleteProgramItem,
		deleteRepertoireItem,
		manageRightsFrom,
		pickableWorks,
		pinEdition,
		planProgramMove,
		reorderProgramItems,
		resolveManageRights,
		updateRepertoireStatus
	} from '$lib/repertoire/repertoireActions';
	import {
		listWorks,
		listEditions,
		listAllEditions,
		listAllCopies,
		type Copy,
		type Edition,
		type Work
	} from '$lib/library/libraryData';
	import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
	import RepertoireElement, {
		ADD_PROGRAMME_KEY,
		ADD_WORK_KEY
	} from '$lib/components/agenda/RepertoireElement.svelte';
	import SeriesCreateForm from '$lib/components/agenda/SeriesCreateForm.svelte';
	import EventCreateForm from '$lib/components/agenda/EventCreateForm.svelte';
	import SeasonCreateForm from '$lib/components/agenda/SeasonCreateForm.svelte';
	import { clearSeriesCreateResume, type SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';
	import { isAuthExpiredError } from '$lib/entu/request';
	// `servedFromCache` is the OLDEST readAt among entries served since
	// `resetServedFromCache()` (reset at the top of every load) so an online
	// load never shows a stale line.
	import { resetServedFromCache, servedFromCache } from '$lib/entu/readCache';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import AgendaList from '$lib/components/agenda/AgendaList.svelte';
	import AgendaMonthView from '$lib/components/agenda/AgendaMonthView.svelte';
	import { agendaViewStore, setAgendaView } from '$lib/preferences/agendaView';
	import { rovingNextIndex } from '$lib/a11y/roving';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
	import { listSections, rosterOrder, type SectionNode } from '$lib/sections/sectionData';
	import type { AttendancePanel } from '$lib/attendance/types';
	import type { Season } from '$lib/seasons/types';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import {
		listEventSeriesForSeason,
		updateSeasonField,
		addSeasonConductor,
		removeSeasonConductor as apiRemoveSeasonConductor,
		deleteEventSeries as apiDeleteEventSeries,
		countSeriesOccurrences as apiCountSeriesOccurrences,
		countSeasonScope as apiCountSeasonScope,
		deleteSeason as apiDeleteSeason
	} from '$lib/seasons/seasonManage';
	import type {
		SeasonEditableField,
		SeriesDefaults,
		SeriesListItem
	} from '$lib/seasons/seasonManage';
	// deleteErrors.ts's discriminators live in their own module so the page's
	// specs can `vi.mock` seasonManage wholesale without breaking them; the
	// 'partial-event' case is dead here since the standalone-event delete left.
	import {
		isDeleteForbidden,
		isSeriesCascadePartial,
		isSeasonCascadePartial
	} from '$lib/seasons/deleteErrors';
	import { CANONICAL_EVENT_TYPES, eventTypeLabel } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import { writesAvailable } from '$lib/net/online';

	const auth = $derived($authStore);
	const collectives = $derived($collectiveState);
	const selected = $derived($selectedCollectiveStore);
	const pickerMode = $derived($pickerModeStore);
	const isOffline = $derived(!$writesAvailable);

	// hydrateCollectives publishes no loading state of its own on retry (only
	// the terminal state), so this flag is the only place an in-flight retry
	// shows — without it a slow retry reads as a dead control.
	let collectivesRetrying = $state(false);

	async function retryCollectives(): Promise<void> {
		if (collectivesRetrying) return;
		const knownErroredDbs = $collectiveState.status === 'error' ? $collectiveState.erroredDbs : [];
		collectivesRetrying = true;
		try {
			await hydrateCollectives();
		} catch (err) {
			console.error('collective discovery retry failed', err);
			collectiveState.set({ status: 'error', erroredDbs: knownErroredDbs });
		} finally {
			collectivesRetrying = false;
		}
	}

	let agendaItems = $state<AgendaItem[]>([]);
	let agendaLoading = $state(true);
	let agendaError = $state(false);
	let sessionExpired = $state(false);

	let memberId = $state<string | null>(null);
	let membership = $state<'loading' | 'member' | 'non-member'>('loading');
	let rsvpRights = $state<'loading' | 'editor' | 'not-editor'>('loading');
	let rsvpByEventId = $state<RsvpByEventId>({});
	let rsvpPartial = $state(false);
	let failedEventIds = $state<Set<string>>(new Set());
	let pendingEventIds = $state<Set<string>>(new Set());
	let savedEventIds = $state<Set<string>>(new Set());

	let myAttendance = $state<MyAttendance[]>([]);
	let attendancePartial = $state(false);

	let recentItems = $state<AgendaItem[]>([]);
	let attendanceEventIds = $state<Set<string>>(new Set());

	type AgendaFilterBucket = (typeof CANONICAL_EVENT_TYPES)[number];
	type AgendaTypeFilter = 'all' | AgendaFilterBucket;
	let agendaTypeFilter = $state<AgendaTypeFilter>('all');
	const CANONICAL_EVENT_TYPE_SET = new Set<string>(CANONICAL_EVENT_TYPES);
	function agendaFilterBucketOf(eventType: string | undefined): AgendaFilterBucket {
		const type = eventType ?? '';
		if (type !== 'other' && CANONICAL_EVENT_TYPE_SET.has(type)) return type as AgendaFilterBucket;
		return 'other';
	}
	const agendaFilterChips = $derived.by(() => {
		const present = new Set<AgendaFilterBucket>();
		for (const it of agendaItems) present.add(agendaFilterBucketOf(it.eventType));
		for (const it of recentItems) present.add(agendaFilterBucketOf(it.eventType));
		return CANONICAL_EVENT_TYPES.filter((type) => present.has(type));
	});
	const filteredAgendaItems = $derived(
		agendaTypeFilter === 'all'
			? agendaItems
			: agendaItems.filter((it) => agendaFilterBucketOf(it.eventType) === agendaTypeFilter)
	);
	const filteredRecentItems = $derived(
		agendaTypeFilter === 'all'
			? recentItems
			: recentItems.filter((it) => agendaFilterBucketOf(it.eventType) === agendaTypeFilter)
	);
	const CHIP_PRESSED_CLASS = 'font-semibold ring-1 ring-ink';
	function agendaTypeChipClass(type: AgendaFilterBucket): string {
		return agendaTypeFilter === type
			? `${eventTypeBadgeClass(type)} ${CHIP_PRESSED_CLASS}`
			: 'border-ink-4 text-ink-2';
	}
	function selectAgendaTypeFilter(value: AgendaTypeFilter) {
		agendaTypeFilter = agendaTypeFilter === value ? 'all' : value;
	}

	function handleAgendaViewKeydown(e: KeyboardEvent): void {
		const group = e.currentTarget as HTMLElement;
		const segments = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
		const idx = segments.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, segments.length);
		if (next < 0) return;
		e.preventDefault();
		const view = segments[next].dataset.agendaView as 'list' | 'month' | undefined;
		if (!view) return;
		setAgendaView(view);
		segments[next].focus();
	}

	$effect(() => {
		if (agendaTypeFilter !== 'all' && !agendaFilterChips.includes(agendaTypeFilter)) {
			agendaTypeFilter = 'all';
		}
	});

	const LOCATION_SUGGESTIONS_ID = 'agenda-location-suggestions';
	const locationSuggestions = $derived.by(() => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const it of recentItems) {
			if (it.location && !seen.has(it.location)) {
				seen.add(it.location);
				out.push(it.location);
			}
		}
		for (const it of agendaItems) {
			if (it.location && !seen.has(it.location)) {
				seen.add(it.location);
				out.push(it.location);
			}
		}
		return out;
	});

	let worksByEventId = $state<Record<string, WorkRow[]>>({});
	let scheduleByEventId = $state<Record<string, ScheduleItem[]>>({});
	let pdfError = $state(false);
	let heldFileIds = $state<Set<string> | null>(null);

	let presenceSeq = 0;
	function refreshPresence(db: string, personId: string, isCurrent: () => boolean): void {
		const seq = ++presenceSeq;
		try {
			getAppByteStore()
				.heldFileIds(db, personId)
				.then((ids) => {
					if (seq !== presenceSeq || !isCurrent()) return;
					heldFileIds = new Set(ids);
				})
				.catch((e) => {
					console.error('agenda: file presence read failed', e);
				});
		} catch (e) {
			console.error('agenda: file presence read failed', e);
		}
	}

	let currentSeasonId = $state<string | null>(null);
	let seasonManageRights = $state<ManageRightsState>('not-editor');
	let manageableSeasonId = $state<string | null>(null);
	let manageableSeasonRights = $state<ManageRightsState>('not-editor');
	let manageableSeasonRightsById = $state<Record<string, ManageRightsState>>({});
	let seasonCreateRights = $state<ManageRightsState>('not-editor');
	let eventManageRights = $state<Record<string, ManageRightsState>>({});
	let seasons = $state<Season[]>([]);
	let seasonRepertoire = $state<RepertoireItem[]>([]);
	let libraryWorks = $state<Work[]>([]);
	let libraryEditions = $state<Edition[]>([]);
	let libraryWorksPartial = $state(false);
	let libraryEditionsPartial = $state(false);
	let scopedEditionsByWorkId = $state<Record<string, PickerOption[]>>({});
	let scopedEditionWorkIdsRequested = new Set<string>();
	let libraryPickersLoading = $state(false);
	let libraryPickersLoadSucceeded = $state(false);
	let worksRowsLoading = $state(false);
	let pickableEditionsVisibleByEventId = $state<Record<string, boolean>>({});
	let pickableWorksVisible = $state<boolean | undefined>(undefined);
	let managePendingKeys = $state<Set<string>>(new Set());
	let manageError = $state(false);

	let panelRepertoire = $state<RepertoireItem[]>([]);
	let panelWorks = $state<Work[]>([]);
	let panelEditions = $state<Edition[]>([]);
	let panelWorksPartial = $state(false);
	let panelCopies = $state<Copy[]>([]);
	let panelPendingKeys = $state<Set<string>>(new Set());
	let panelRepertoireError = $state(false);
	let panelManageError = $state(false);
	let panelManageStatus = $state('');
	let panelRepertoireLoading = $state(false);
	let panelRepertoireItemsOk = $state(false);
	let panelWorksSourcesOk = $state(false);
	let panelPickableWorksVisible = $state<boolean | undefined>(undefined);
	let panelRepertoireSeasonId: string | null = null;

	let seasonSummaryExpanded = $state(false);
	let seasonMemberRates = $state<MemberAttendanceRate[]>([]);
	let seasonRatesLoaded = $state(false);
	let seasonRatesLoading = $state(false);
	let seasonRatesError = $state(false);
	let seasonRatesPartial = $state(false);

	let attendanceItem = $state<AgendaItem | null>(null);
	let attendanceLoading = $state(false);
	let attendanceError = $state(false);
	let attendanceRoster = $state<RosterRow[]>([]);
	let attendanceMap = $state<Record<string, { attendanceId: string; status: AttendanceStatus }>>({});
	let attendanceRsvpMap = $state<Record<string, { rsvpId: string; status: string }>>({});
	let attendancePendingMemberIds = $state<Set<string>>(new Set());
	let attendanceFailedMemberIds = $state<Set<string>>(new Set());
	let attendanceSavedMemberIds = $state<Set<string>>(new Set());
	let attendanceFailedByEvent = $state<Map<string, Set<string>>>(new Map());
	let attendanceRequestId = 0;
	const ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;
	let rosterCache = $state<{
		db: string;
		roster: RosterRow[];
		truncated: boolean;
		fetchedAt: number;
	} | null>(null);
	let rosterRows = $state<RosterRow[]>([]);
	let rosterReadsInFlight = $state(0);
	let rosterReadFailed = $state(false);
	let rosterPartial = $state(false);
	let sectionsReadFailed = $state(false);
	const rosterPickerLoading = $derived(rosterReadsInFlight > 0);

	function getRoster(cfg: { db: string; token: string }): Promise<RosterRow[]> {
		const cacheValid =
			rosterCache &&
			rosterCache.db === cfg.db &&
			Date.now() - rosterCache.fetchedAt < ROSTER_CACHE_TTL_MS;
		if (cacheValid) {
			rosterRows = rosterCache!.roster;
			rosterReadFailed = false;
			rosterPartial = rosterCache!.truncated;
			return Promise.resolve(rosterCache!.roster);
		}
		rosterReadsInFlight += 1;
		rosterReadFailed = false;
		return loadRoster(cfg)
			.then((read) => {
				rosterCache = {
					db: cfg.db,
					roster: read.items,
					truncated: read.truncated,
					fetchedAt: Date.now()
				};
				rosterRows = read.items;
				rosterPartial = read.truncated;
				return read.items;
			})
			.catch((e: unknown) => {
				rosterReadFailed = true;
				rosterPartial = false;
				throw e;
			})
			.finally(() => {
				rosterReadsInFlight -= 1;
			});
	}

	let sectionsCache = $state<{ db: string; sections: SectionNode[]; fetchedAt: number } | null>(
		null
	);
	let rosterSections = $state<SectionNode[]>([]);

	function getSections(cfg: { db: string; token: string }): Promise<SectionNode[]> {
		const cacheValid =
			sectionsCache &&
			sectionsCache.db === cfg.db &&
			Date.now() - sectionsCache.fetchedAt < ROSTER_CACHE_TTL_MS;
		if (cacheValid) {
			rosterSections = sectionsCache!.sections;
			sectionsReadFailed = false;
			return Promise.resolve(sectionsCache!.sections);
		}
		rosterReadsInFlight += 1;
		sectionsReadFailed = false;
		return listSections(cfg)
			.then((sections) => {
				sectionsCache = { db: cfg.db, sections, fetchedAt: Date.now() };
				rosterSections = sections;
				return sections;
			})
			.catch((e: unknown) => {
				sectionsReadFailed = true;
				throw e;
			})
			.finally(() => {
				rosterReadsInFlight -= 1;
			});
	}

	function rosterPickerOptions(
		excludeIds: readonly string[]
	): Array<{ id: string; label: string }> {
		return rosterOrder(rosterRows, rosterSections)
			.filter((row) => !excludeIds.includes(row.personId))
			.map((row) => ({ id: row.personId, label: row.name }));
	}

	function pickerPromptText(optionCount: number, addPrompt: string): string {
		if (optionCount > 0) return addPrompt;
		if (rosterReadFailed) return m.picker_roster_unavailable();
		if (rosterPickerLoading) return m.picker_roster_loading();
		if (rosterRows.length === 0) return m.picker_no_members();
		return m.picker_everyone_added();
	}

	let requestId = 0;
	let pressureSweepRanAtOpen = false;
	let worksLoadId = 0;
	let scheduleLoadId = 0;
	function loadForSelected(opts: { keepSeasonManage?: boolean } = {}) {
		const keepSeasonManage = opts.keepSeasonManage === true;
		const heldSeasonId = keepSeasonManage && seasonManageOpen ? manageableSeasonId : null;
		const current = selected;
		if (!current) {
			agendaItems = [];
			agendaLoading = false;
			agendaError = false;
			memberId = null;
			membership = 'loading';
			rsvpRights = 'loading';
			rsvpByEventId = {};
			rsvpPartial = false;
			failedEventIds = new Set();
			savedEventIds = new Set();
			recentItems = [];
			attendanceEventIds = new Set();
			agendaTypeFilter = 'all';
			worksByEventId = {};
			scheduleByEventId = {};
			pdfError = false;
			heldFileIds = null;
			resetManagement();
			libraryPickersLoading = false;
			worksRowsLoading = false;
			closeAttendancePanel();
			rosterCache = null;
			rosterRows = [];
			rosterPartial = false;
			sectionsCache = null;
			rosterSections = [];
			rosterReadFailed = false;
			sectionsReadFailed = false;
			resetSeasonManage();
			attendanceFailedByEvent = new Map();
			myAttendance = [];
			attendancePartial = false;
			seasonSummaryExpanded = false;
			seasonMemberRates = [];
			seasonRatesLoaded = false;
			seasonRatesLoading = false;
			seasonRatesError = false;
			seasonRatesPartial = false;
			seasons = [];
			closeSeasonCreateForm();
			eventCreateOpen = false;
			seriesCreateOpen = false;
			return;
		}
		const thisRequest = ++requestId;
		closeAttendancePanel();
		agendaLoading = true;
		agendaError = false;
		sessionExpired = false;
		resetServedFromCache();
		memberId = null;
		membership = 'loading';
		rsvpRights = 'loading';
		failedEventIds = new Set();
		savedEventIds = new Set();
		worksByEventId = {};
		scheduleByEventId = {};
		pdfError = false;
		heldFileIds = null;
		resetManagement();
		if (!keepSeasonManage) {
			agendaTypeFilter = 'all';
			rosterCache = null;
			rosterRows = [];
			rosterPartial = false;
			sectionsCache = null;
			rosterSections = [];
			rosterReadFailed = false;
			sectionsReadFailed = false;
			resetSeasonManage();
			seriesCreateOpen = false;
		}
		attendanceFailedByEvent = new Map();
		myAttendance = [];
		rsvpPartial = false;
		attendancePartial = false;
		seasonSummaryExpanded = false;
		seasonMemberRates = [];
		seasonRatesLoaded = false;
		seasonRatesLoading = false;
		seasonRatesError = false;
		seasonRatesPartial = false;
		seasons = [];
		closeSeasonCreateForm();
		eventCreateOpen = false;

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
					if (thisRequest !== requestId) return;
					agendaItems = upcoming;
					agendaLoading = false;
					recentItems = recent;
					seasons = fullSeasons;

					const worksCfg = { db: current.db, token: getToken() ?? '' };
					const events = [...upcoming, ...recent];
					const eventIds = events.map((item) => item.id);
					currentSeasonId = seasonId;
					seasonManageRights =
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
					manageableSeasonRightsById = nextManageableRightsById;
					const keptSeasonId =
						heldSeasonId !== null && candidateSeasons.some((s) => s.id === heldSeasonId)
							? heldSeasonId
							: null;
					if (keptSeasonId !== null) {
						manageableSeasonId = keptSeasonId;
						manageableSeasonRights = nextManageableRightsById[keptSeasonId] ?? 'not-editor';
					} else {
						if (heldSeasonId !== null) {
							resetSeasonManage();
							seriesCreateOpen = false;
						}
						manageableSeasonId = mSeasonId;
						manageableSeasonRights =
							mSeasonId === null ? 'not-editor' : manageRightsFrom(mOwners, mEditors, personId);
					}
					restoreSeriesCreateRun();
					seasonCreateRights = deriveSeasonCreateRights(
						seasonId,
						seasonOwners,
						seasonEditors,
						fullSeasons,
						personId
					);
					eventManageRights = Object.fromEntries(
						events.map((item) => [item.id, manageRightsFrom(item.owners, item.editors, personId)])
					);
					loadWorksAndManagement(worksCfg, eventIds, seasonId, thisRequest);
					refreshPresence(worksCfg.db, personId, () => thisRequest === requestId);
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
							if (thisRequest !== requestId) return;
							if (state !== 'editor') return;
							if (invisibleCandidateSeasons.length > 0) {
								manageableSeasonRightsById = {
									...manageableSeasonRightsById,
									...Object.fromEntries(
										invisibleCandidateSeasons.map(
											(s) => [s.id, 'editor'] as [string, ManageRightsState]
										)
									)
								};
							}
							if (
								manageableSeasonId !== null &&
								manageableSeasonRightsById[manageableSeasonId] === 'editor'
							) {
								manageableSeasonRights = 'editor';
							}
							seasonCreateRights = 'editor';
							if (currentRightsInvisible && seasonManageRights !== 'editor') {
								seasonManageRights = 'editor';
								upgradeRepertoireManagement(worksCfg, eventIds, seasonId, thisRequest);
							}
						});
					}
					attendanceEventIds = new Set(
						recent.filter((item) => canMarkAttendance(item, personId)).map((item) => item.id)
					);
				}
			)
			.catch((err) => {
				if (thisRequest !== requestId) return;
				agendaLoading = false;
				if (isAuthExpiredError(err)) {
					sessionExpired = true;
				} else {
					agendaError = true;
				}
				recentItems = [];
				attendanceEventIds = new Set();
				worksByEventId = {};
				scheduleByEventId = {};
				heldFileIds = null;
				resetManagement();
				libraryPickersLoading = false;
				worksRowsLoading = false;
				resetSeasonManage();
				seasons = [];
			});

		{
			const rightsCfg = { db: current.db, token: getToken() ?? '' };
			const rightsIdentity = { db: current.db, personId };
			resolveManageRights(rightsCfg, personId, personId).then((state) => {
				if (!sameCollectiveIdentity(get(selectedCollectiveIdentityStore), rightsIdentity)) return;
				rsvpRights = state === 'editor' ? 'editor' : 'not-editor';
			});
		}

		findMyMemberId({ db: current.db, token: getToken() ?? '' }, personId)
			.then((id) => {
				if (thisRequest !== requestId) return;
				memberId = id;
				membership = id ? 'member' : 'non-member';
				if (id) {
					listMyAttendance({ db: current.db, token: getToken() ?? '' }, id)
						.then((result) => {
							if (thisRequest !== requestId) return;
							myAttendance = result.items;
							attendancePartial = result.truncated;
						})
						.catch(() => {
							if (thisRequest !== requestId) return;
							myAttendance = [];
							attendancePartial = false;
						});
				} else {
					myAttendance = [];
					attendancePartial = false;
				}
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				memberId = null;
				membership = 'loading';
			});

		listMyRsvps({ db: current.db, token: getToken() ?? '' }, personId)
			.then((result) => {
				if (thisRequest !== requestId) return;
				rsvpByEventId = rsvpsByEventId(result.items);
				rsvpPartial = result.truncated;
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				rsvpByEventId = {};
				rsvpPartial = false;
			});
	}

	const rsvpQueue = createRsvpChangeQueue({
		setOptimistic(eventId, entry) {
			const next = { ...rsvpByEventId };
			if (entry) next[eventId] = entry;
			else delete next[eventId];
			rsvpByEventId = next;
		},
		setPending(eventId, isPending) {
			const next = new Set(pendingEventIds);
			if (isPending) next.add(eventId);
			else next.delete(eventId);
			pendingEventIds = next;
			if (isPending && failedEventIds.has(eventId)) {
				const cleared = new Set(failedEventIds);
				cleared.delete(eventId);
				failedEventIds = cleared;
			}
			if (isPending && savedEventIds.has(eventId)) {
				const cleared = new Set(savedEventIds);
				cleared.delete(eventId);
				savedEventIds = cleared;
			}
		},
		reconcile(eventId, entry) {
			const next = { ...rsvpByEventId };
			if (entry) next[eventId] = entry;
			else delete next[eventId];
			rsvpByEventId = next;
			const saved = new Set(savedEventIds);
			saved.add(eventId);
			savedEventIds = saved;
		},
		revert(eventId, before) {
			const next = { ...rsvpByEventId };
			if (before) next[eventId] = before;
			else delete next[eventId];
			rsvpByEventId = next;
			const failed = new Set(failedEventIds);
			failed.add(eventId);
			failedEventIds = failed;
			if (savedEventIds.has(eventId)) {
				const cleared = new Set(savedEventIds);
				cleared.delete(eventId);
				savedEventIds = cleared;
			}
		}
	});

	function handleRsvpChange(item: AgendaItem, newStatus: RsvpStatus | null) {
		if (!selected) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const personId = selected.personId;
		const identity = { db: selected.db, personId };

		const current: RsvpEntry | undefined = rsvpByEventId[item.id];
		const existing: MyRsvp | null = current
			? { rsvpId: current.rsvpId, eventId: item.id, status: current.status }
			: null;

		rsvpQueue.request({
			cfg,
			personId,
			memberId,
			resolveMemberId: async () => {
				const id = await findMyMemberId(cfg, personId);
				if (sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity)) {
					memberId = id;
					if (!id) membership = 'non-member';
				}
				return id;
			},
			eventId: item.id,
			existing,
			newStatus
		});
	}

	function findWorkRowByFileId(fileId: string): WorkRow | undefined {
		for (const rows of Object.values(worksByEventId)) {
			const row = rows.find((r) => r.fileId === fileId);
			if (row) return row;
		}
		return undefined;
	}

	function handlePdfClick(fileId: string) {
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const identity = get(selectedCollectiveIdentityStore);
		if (!identity) return;
		pdfError = false;
		const row = findWorkRowByFileId(fileId);
		const tab = window.open('', '_blank');
		if (tab) tab.opener = null;
		openFileBytes(cfg, identity, fileId, getAppByteStore())
			.then(({ url, release, reason }) => {
				if (!sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity)) {
					release();
					tab?.close();
					return;
				}
				if (tab) tab.location.href = url;
				else window.location.href = url;
				if (row) {
					recordPartLabel(
						getAppLabelStore(),
						identity,
						fileId,
						{ work: row.workName, composer: row.composer, edition: row.editionName, filename: row.fileName },
						reason
					);
				}
				void reason;
				if (reason === 'network-stored' || reason === 'network-uncached') {
					refreshPresence(identity.db, identity.personId, () =>
						sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity)
					);
				}
			})
			.catch(() => {
				tab?.close();
				if (!sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity)) return;
				pdfError = true;
			});
	}



	function resetManagement() {
		currentSeasonId = null;
		seasonManageRights = 'not-editor';
		manageableSeasonId = null;
		manageableSeasonRights = 'not-editor';
		manageableSeasonRightsById = {};
		seasonCreateRights = 'not-editor';
		eventManageRights = {};
		seasonRepertoire = [];
		libraryWorks = [];
		libraryEditions = [];
		libraryWorksPartial = false;
		libraryEditionsPartial = false;
		scopedEditionsByWorkId = {};
		scopedEditionWorkIdsRequested = new Set<string>();
		libraryPickersLoading = true;
		libraryPickersLoadSucceeded = false;
		worksRowsLoading = true;
		managePendingKeys = new Set();
		manageError = false;
	}

	type ManageCfg = { db: string; token: string };

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

	function loadDatabaseEntityRights(cfg: ManageCfg, personId: string): Promise<ManageRightsState> {
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
		cfg: ManageCfg,
		eventIds: string[],
		seasonId: string | null,
		thisRequest: number
	) {
		loadManagePickers(cfg, seasonId, thisRequest);
		const thisWorksLoad = ++worksLoadId;
		worksRowsLoading = true;
		refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, { includeInactive: true })
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = mergePendingRows(byEvent);
				worksRowsLoading = false;
			})
			.catch(() => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksRowsLoading = false;
			});
	}

	function loadWorksAndManagement(
		cfg: ManageCfg,
		eventIds: string[],
		seasonId: string | null,
		thisRequest: number
	) {
		const canManage =
			seasonManageRights === 'editor' ||
			Object.values(eventManageRights).some((right) => right === 'editor');
		if (canManage) {
			loadManagePickers(cfg, seasonId, thisRequest);
		} else {
			libraryPickersLoading = false;
		}

		const thisWorksLoad = ++worksLoadId;
		worksRowsLoading = true;
		refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = byEvent;
				worksRowsLoading = false;
				runPressureSweepThenPrefetch(cfg, thisRequest);
			})
			.catch(() => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = {};
				worksRowsLoading = false;
			});
	}

	function runPressureSweepThenPrefetch(cfg: { db: string; token: string }, thisRequest: number) {
		if (pressureSweepRanAtOpen) {
			prefetchNextEventPartsAfterSettle(cfg, thisRequest);
			return;
		}
		pressureSweepRanAtOpen = true;
		const identity = get(selectedCollectiveIdentityStore);
		if (identity && identity.db === cfg.db) {
			seedRetentionKeys(identity.db, identity.personId, nextEventFileIds(agendaItems, worksByEventId));
		}
		const state = get(collectiveState);
		ensureRetentionSweep({
			token: cfg.token,
			collectives: state.status === 'ready' ? state.collectives : [],
			fetchImpl: fetch
		}).finally(() => {
			if (thisRequest !== requestId) return;
			prefetchNextEventPartsAfterSettle(cfg, thisRequest);
		});
	}

	function prefetchNextEventPartsAfterSettle(cfg: { db: string; token: string }, thisRequest: number) {
		const nextEventId = agendaItems[0]?.id;
		if (nextEventId) {
			refreshEventPageDetail(cfg, nextEventId, fetch).catch((e) => {
				console.error('agenda: next-event detail prefetch failed', e);
			});
		}

		const fileIds = nextEventFileIds(agendaItems, worksByEventId);
		if (fileIds.length === 0) return;
		const identity = get(selectedCollectiveIdentityStore);
		prefetchNextEventParts(cfg, identity, fileIds, getAppByteStore(), fetch, () => thisRequest === requestId)
			.then((results) => {
				if (thisRequest !== requestId || !identity) return;
				if (
					results.some((r) => r.outcome === 'network-stored' || r.outcome === 'network-uncached')
				) {
					refreshPresence(identity.db, identity.personId, () => thisRequest === requestId);
				}
			})
			.catch((e) => {
				console.error('agenda: next-event prefetch failed', e);
			});
	}

	function loadScheduleItems(cfg: ManageCfg, eventIds: string[], thisRequest: number) {
		const thisScheduleLoad = ++scheduleLoadId;
		listScheduleItemsByEventId(cfg, eventIds, fetch)
			.then((byEvent) => {
				if (thisRequest !== requestId || thisScheduleLoad !== scheduleLoadId) return;
				scheduleByEventId = byEvent;
			})
			.catch(() => {
				if (thisRequest !== requestId || thisScheduleLoad !== scheduleLoadId) return;
				scheduleByEventId = {};
			});
	}

	function loadManagePickers(cfg: ManageCfg, seasonId: string | null, thisRequest: number) {
		libraryPickersLoading = true;
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			seasonId === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, seasonId)
		])
			.then(([worksRead, editionsRead, repertoire]) => {
				if (thisRequest !== requestId) return;
				libraryWorks = worksRead.items;
				libraryEditions = editionsRead.items;
				libraryWorksPartial = worksRead.truncated;
				libraryEditionsPartial = editionsRead.truncated;
				seasonRepertoire = repertoire;
				libraryPickersLoading = false;
				libraryPickersLoadSucceeded = true;
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				libraryWorks = [];
				libraryEditions = [];
				libraryWorksPartial = false;
				libraryEditionsPartial = false;
				seasonRepertoire = [];
				libraryPickersLoading = false;
				libraryPickersLoadSucceeded = false;
			});
	}

	const reorderKey = (eventId: string) => `move:${eventId}`;

	function mergePendingRows(byEvent: Record<string, WorkRow[]>): Record<string, WorkRow[]> {
		const merged: Record<string, WorkRow[]> = {};
		for (const [eventId, rows] of Object.entries(byEvent)) {
			const reorderPending = repertoireQueue.isPending(reorderKey(eventId));
			const live = worksByEventId[eventId] ?? [];
			const out: WorkRow[] = [];
			for (const row of rows) {
				const pending =
					repertoireQueue.isPending(row.id) || (reorderPending && row.kind === 'program');
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
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const eventIds = [...agendaItems, ...recentItems].map((item) => item.id);
		const seasonId = currentSeasonId;
		const thisRequest = requestId;
		const thisWorksLoad = ++worksLoadId;
		refreshEventPageWorkRows(cfg, eventIds, seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = mergePendingRows(byEvent);
				worksRowsLoading = false;
			})
			.catch(() => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksRowsLoading = false;
			});
		if (seasonId !== null && seasonManageRights === 'editor') {
			listRepertoireItems(cfg, seasonId)
				.then((items) => {
					if (thisRequest !== requestId) return;
					seasonRepertoire = items;
				})
				.catch(() => {
				});
		}
	}

	const managePendingMarks = new Map<string, string[]>();

	const repertoireQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			const next = new Set(managePendingKeys);
			for (const mark of [key, ...(managePendingMarks.get(key) ?? [])]) {
				if (pending) next.add(mark);
				else next.delete(mark);
			}
			managePendingKeys = next;
			if (pending) manageError = false;
		},
		reconcile(key) {
			managePendingMarks.delete(key);
			syncPanelRepertoireAfterAgendaWrite();
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) refreshWorksAfterWrite();
		},
		revert(key) {
			managePendingMarks.delete(key);
			manageError = true;
			syncPanelRepertoireAfterAgendaWrite();
			refreshWorksAfterWrite();
		}
	});


	function mapRows(update: (rows: WorkRow[], eventId: string) => WorkRow[]) {
		const next: Record<string, WorkRow[]> = {};
		for (const [eventId, rows] of Object.entries(worksByEventId)) {
			next[eventId] = update(rows, eventId);
		}
		worksByEventId = next;
	}

	function patchRow(itemId: string, patch: Partial<WorkRow>) {
		mapRows((rows) => rows.map((row) => (row.id === itemId ? { ...row, ...patch } : row)));
	}

	function findRow(itemId: string): WorkRow | undefined {
		for (const rows of Object.values(worksByEventId)) {
			const hit = rows.find((row) => row.id === itemId);
			if (hit) return hit;
		}
		return undefined;
	}

	function snapshotRow(itemId: string, onlyEventId?: string) {
		const snapshot: Array<{ eventId: string; index: number; row: WorkRow }> = [];
		for (const [eventId, rows] of Object.entries(worksByEventId)) {
			if (onlyEventId !== undefined && eventId !== onlyEventId) continue;
			const index = rows.findIndex((row) => row.id === itemId);
			if (index >= 0) snapshot.push({ eventId, index, row: rows[index] });
		}
		return snapshot;
	}

	function restoreRow(snapshot: Array<{ eventId: string; index: number; row: WorkRow }>) {
		const next = { ...worksByEventId };
		for (const { eventId, index, row } of snapshot) {
			const rows = [...(next[eventId] ?? [])];
			if (rows.some((r) => r.id === row.id)) continue;
			rows.splice(Math.min(index, rows.length), 0, row);
			next[eventId] = rows;
		}
		worksByEventId = next;
	}

	function dropRow(itemId: string, onlyEventId?: string) {
		mapRows((rows, eventId) =>
			onlyEventId !== undefined && eventId !== onlyEventId
				? rows
				: rows.filter((row) => row.id !== itemId)
		);
	}

	function setOrdinals(eventId: string, ordinalById: Map<string, number>) {
		mapRows((rows, id) =>
			id === eventId
				? rows.map((row) =>
						ordinalById.has(row.id) ? { ...row, ordinal: ordinalById.get(row.id)! } : row
					)
				: rows
		);
	}


	function manageCfg(): ManageCfg | null {
		if (!selected) return null;
		return { db: selected.db, token: getToken() ?? '' };
	}

	function handleAddWork(workId: string) {
		if (isOffline) return;
		const cfg = manageCfg();
		const seasonId = currentSeasonId;
		if (!cfg || seasonId === null) return;
		repertoireQueue.request(ADD_WORK_KEY, async () => {
			await createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function handleStatusChange(itemId: string, status: RepertoireStatus) {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = row.status;
		repertoireQueue.request(
			itemId,
			() => updateRepertoireStatus(cfg, itemId, status),
			{
				apply: () => patchRow(itemId, { status }),
				rollback: () => patchRow(itemId, { status: before })
			}
		);
	}

	function handlePinEdition(itemId: string, editionId: string) {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = { editionId: row.editionId, editionName: row.editionName };
		const editionName = libraryEditions.find((e) => e.id === editionId)?.name ?? '';
		repertoireQueue.request(
			itemId,
			() => pinEdition(cfg, itemId, editionId),
			{
				apply: () => patchRow(itemId, { editionId, editionName }),
				rollback: () => patchRow(itemId, before)
			}
		);
	}

	function handleRemoveItem(eventId: string, itemId: string) {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = worksByEventId[eventId]?.find((r) => r.id === itemId);
		if (!cfg || !row) return;
		if (row.kind === 'program') {
			const snapshot = snapshotRow(itemId, eventId);
			repertoireQueue.request(itemId, () => deleteProgramItem(cfg, itemId), {
				apply: () => dropRow(itemId, eventId),
				rollback: () => restoreRow(snapshot)
			});
			return;
		}
		const snapshot = snapshotRow(itemId);
		const repertoireBefore = seasonRepertoire;
		repertoireQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				dropRow(itemId);
				seasonRepertoire = seasonRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				restoreRow(snapshot);
				seasonRepertoire = repertoireBefore;
			}
		});
	}

	const PANEL_ADD_WORK_KEY = '__panel_add_work__';

	function refreshPanelRepertoire(): void {
		const cfg = manageCfg();
		const seasonId = panelRepertoireSeasonId;
		if (!cfg || seasonId === null) return;
		const thisRequest = requestId;
		const thisSwitch = seasonManageSwitchGeneration;
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = items;
				panelRepertoireItemsOk = true;
			})
			.catch(() => {
			});
	}

	function syncPanelRepertoireAfterAgendaWrite(): void {
		if (!seasonManageOpen) return;
		if (manageableSeasonId === null || manageableSeasonId !== currentSeasonId) return;
		refreshPanelRepertoire();
	}

	const panelQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			const next = new Set(panelPendingKeys);
			if (pending) next.add(key);
			else next.delete(key);
			panelPendingKeys = next;
			if (pending) {
				panelManageError = false;
				panelManageStatus = '';
			}
		},
		reconcile() {
			refreshPanelRepertoire();
			refreshWorksAfterWrite();
			panelManageStatus = m.repertoire_manage_saved();
		},
		revert() {
			refreshPanelRepertoire();
			refreshWorksAfterWrite();
			panelManageError = true;
		}
	});

	function handlePanelAddWork(workId: string) {
		if (isOffline) return;
		const cfg = manageCfg();
		const seasonId = manageableSeasonId;
		if (!cfg || seasonId === null) return;
		panelQueue.request(PANEL_ADD_WORK_KEY, async () => {
			await createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function handlePanelStatusChange(itemId: string, status: RepertoireStatus) {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = panelRepertoire.find((item) => item.id === itemId)?.status;
		if (before === undefined) return;
		const thisSwitch = seasonManageSwitchGeneration;
		panelQueue.request(itemId, () => updateRepertoireStatus(cfg, itemId, status), {
			apply: () => {
				panelRepertoire = panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status } : item
				);
			},
			rollback: () => {
				if (thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status: before } : item
				);
			}
		});
	}

	function handlePanelRemoveItem(itemId: string) {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = panelRepertoire;
		const thisSwitch = seasonManageSwitchGeneration;
		panelQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				panelRepertoire = panelRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				if (thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = before;
			}
		});
	}

	function handleMoveItem(eventId: string, itemId: string, direction: 'up' | 'down') {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const rows = worksByEventId[eventId] ?? [];
		const items = rows
			.filter((row) => row.kind === 'program')
			.map((row) => ({ id: row.id, ordinal: row.ordinal ?? 0 }));
		const plan = planProgramMove(items, itemId, direction);
		if (plan.length === 0) return;

		const key = reorderKey(eventId);
		managePendingMarks.set(
			key,
			items.map((item) => item.id)
		);
		const before = new Map(
			plan.map((entry) => [entry.id, items.find((i) => i.id === entry.id)?.ordinal ?? 0])
		);
		const after = new Map(plan.map((entry) => [entry.id, entry.ordinal]));
		repertoireQueue.request(key, () => reorderProgramItems(cfg, plan), {
			apply: () => setOrdinals(eventId, after),
			rollback: () => setOrdinals(eventId, before)
		});
	}

	function handleAddProgramItem(eventId: string, editionId: string, ordinal: number) {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg) return;
		repertoireQueue.request(ADD_PROGRAMME_KEY, async () => {
			await createProgramItem(cfg, { eventId, editionId, ordinal });
		});
	}


	const editionsByWorkId = $derived.by(() => {
		const map = new Map<string, Edition[]>();
		for (const edition of libraryEditions) {
			const workId = edition.workId ?? '';
			if (workId === '') continue;
			const list = map.get(workId);
			if (list) list.push(edition);
			else map.set(workId, [edition]);
		}
		return map;
	});

	function editionLabel(edition: Edition): string {
		return edition.name || edition.publisher || edition.id;
	}

	const editionOptionsByRowId = $derived.by(() => {
		const out: Record<string, PickerOption[]> = {};
		for (const rows of Object.values(worksByEventId)) {
			for (const row of rows) {
				if (row.kind !== 'repertoire' || row.workId === '' || out[row.id]) continue;
				const options =
					scopedEditionsByWorkId[row.workId] ??
					(editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
						id: edition.id,
						label: editionLabel(edition)
					}));
				if (options.length > 0) out[row.id] = options;
			}
		}
		return out;
	});

	const editionsResolvedWorkIds = $derived(new Set(Object.keys(scopedEditionsByWorkId)));

	const unknownEditionWorkIds = $derived(
		unresolvedEditionWorkIds(
			Object.values(worksByEventId).flat(),
			editionOptionsByRowId,
			libraryEditionsPartial,
			editionsResolvedWorkIds
		)
	);

	$effect(() => {
		const workIds = unknownEditionWorkIds;
		if (workIds.length === 0) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const thisRequest = requestId;
		for (const workId of workIds) {
			if (scopedEditionWorkIdsRequested.has(workId)) continue;
			scopedEditionWorkIdsRequested.add(workId);
			listEditions(cfg, workId)
				.then((read) => {
					if (thisRequest !== requestId) return;
					if (read.truncated) return;
					scopedEditionsByWorkId = {
						...scopedEditionsByWorkId,
						[workId]: read.items.map((edition) => ({
							id: edition.id,
							label: editionLabel(edition)
						}))
					};
				})
				.catch(() => {
				});
		}
	});

	const pickableEditionsByEventId = $derived.by(() => {
		const workById = new Map(libraryWorks.map((work) => [work.id, work]));
		const all: PickerOption[] = libraryEditions.map((edition) => {
			const work = workById.get(edition.workId ?? '');
			const prefix = work === undefined ? '' : workLabel(work);
			return {
				id: edition.id,
				label: prefix === '' ? editionLabel(edition) : `${prefix} — ${editionLabel(edition)}`
			};
		});
		const out: Record<string, PickerOption[]> = {};
		for (const [eventId, rows] of Object.entries(worksByEventId)) {
			const programmed = new Set(
				rows.filter((row) => row.kind === 'program').map((row) => row.editionId)
			);
			out[eventId] = all.filter((option) => !programmed.has(option.id));
		}
		return out;
	});

	$effect(() => {
		if (libraryPickersLoading || worksRowsLoading) return;
		const next: Record<string, boolean> = {};
		for (const [eventId, options] of Object.entries(pickableEditionsByEventId)) {
			next[eventId] = options.length > 0;
		}
		pickableEditionsVisibleByEventId = next;
	});

	const pickableWorksList = $derived(pickableWorks(libraryWorks, seasonRepertoire));

	$effect(() => {
		if (libraryPickersLoading || !libraryPickersLoadSucceeded) return;
		pickableWorksVisible = pickableWorksList.length > 0;
	});

	const panelWorkRowSources = $derived(collectSources(panelWorks, panelEditions, panelCopies));
	const panelWorkRows = $derived(
		buildWorkRows({ source: 'repertoire', items: panelRepertoire }, panelWorkRowSources)
	);
	const panelPickableWorksList = $derived(pickableWorks(panelWorks, panelRepertoire));

	$effect(() => {
		if (panelRepertoireLoading || !panelRepertoireItemsOk || !panelWorksSourcesOk) return;
		panelPickableWorksVisible = panelPickableWorksList.length > 0;
	});

	const worksManage = $derived.by<WorksManage | undefined>(() => {
		const anyEventRight = Object.values(eventManageRights).some((right) => right === 'editor');
		if (seasonManageRights !== 'editor' && !anyEventRight) return undefined;
		return {
			seasonRights: seasonManageRights,
			eventRightsByEventId: eventManageRights,
			pickableWorksList,
			pickableWorksVisible,
			pickableWorksPartial: libraryWorksPartial,
			pickableEditionsPartial: libraryEditionsPartial,
			pickableEditionsByEventId,
			pickableEditionsVisibleByEventId,
			editionOptionsByRowId,
			editionsResolvedWorkIds,
			pendingKeys: managePendingKeys,
			onaddwork: handleAddWork,
			onstatuschange: handleStatusChange,
			onpinedition: handlePinEdition,
			onremoveitem: handleRemoveItem,
			onmoveitem: handleMoveItem,
			onaddprogramitem: handleAddProgramItem
		};
	});

	function openAttendancePanel(item: AgendaItem) {
		if (!selected) return;
		if (!attendanceEventIds.has(item.id)) return;
		attendanceItem = item;
		attendanceLoading = true;
		attendanceError = false;
		attendanceRoster = [];
		attendanceMap = {};
		attendanceRsvpMap = {};
		attendancePendingMemberIds = attendanceQueue.pendingMembersForEvent(item.id);
		attendanceFailedMemberIds = new Set(attendanceFailedByEvent.get(item.id) ?? []);
		attendanceSavedMemberIds = new Set();

		const cfg = { db: selected.db, token: getToken() ?? '' };
		const thisRequest = ++attendanceRequestId;

		const rosterPromise = getRoster(cfg);

		const requestIssuedAt = Date.now();
		Promise.all([rosterPromise, listAttendance(cfg, item.id), listAllRsvpsForEvent(cfg, item.id)])
			.then(([roster, records, rsvps]) => {
				if (thisRequest !== attendanceRequestId) return;
				attendanceRoster = roster;
				const pendingMembers = attendanceQueue.pendingMembersForEvent(item.id);
				const serverMap = attendanceByMemberId(records);
				const merged = { ...serverMap };
				for (const mid of pendingMembers) {
					if (mid in attendanceMap) merged[mid] = attendanceMap[mid];
					else delete merged[mid];
				}
				for (const mid of Object.keys(attendanceMap)) {
					if (pendingMembers.has(mid)) continue;
					const liveEntry = attendanceMap[mid];
					const serverEntry = serverMap[mid];
					if (liveEntry && (!serverEntry || serverEntry.attendanceId !== liveEntry.attendanceId)) {
						merged[mid] = liveEntry;
					}
				}
				attendanceMap = merged;
				const rsvpMap: Record<string, { rsvpId: string; status: string }> = {};
				for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
				attendanceRsvpMap = rsvpMap;
				attendanceLoading = false;
			})
			.catch(() => {
				if (thisRequest !== attendanceRequestId) return;
				attendanceLoading = false;
				attendanceError = true;
			});
	}

	function closeAttendancePanel() {
		const closedItemId = untrack(() => attendanceItem?.id);
		attendanceRequestId++;
		attendanceItem = null;
		attendanceLoading = false;
		attendanceError = false;
		if (closedItemId) {
			tick().then(() => {
				document
					.querySelector<HTMLElement>(
						`[data-testid="agenda-recent-row-${closedItemId}"] [data-testid="take-attendance-btn"]`
					)
					?.focus();
			});
		}
	}

	const attendanceQueue = createAttendanceChangeQueue({
		setOptimistic(eventId, memberId, entry) {
			if (eventId !== attendanceItem?.id) return;
			const next = { ...attendanceMap };
			if (entry) next[memberId] = entry;
			else delete next[memberId];
			attendanceMap = next;
		},
		setPending(eventId, memberId, isPending) {
			if (isPending) {
				const eventFailed = attendanceFailedByEvent.get(eventId);
				if (eventFailed?.has(memberId)) {
					const cleared = new Set(eventFailed);
					cleared.delete(memberId);
					const nextMap = new Map(attendanceFailedByEvent);
					if (cleared.size === 0) nextMap.delete(eventId);
					else nextMap.set(eventId, cleared);
					attendanceFailedByEvent = nextMap;
				}
			}
			if (eventId !== attendanceItem?.id) return;
			const next = new Set(attendancePendingMemberIds);
			if (isPending) next.add(memberId);
			else next.delete(memberId);
			attendancePendingMemberIds = next;
			if (isPending && attendanceFailedMemberIds.has(memberId)) {
				const cleared = new Set(attendanceFailedMemberIds);
				cleared.delete(memberId);
				attendanceFailedMemberIds = cleared;
			}
			if (isPending && attendanceSavedMemberIds.has(memberId)) {
				const cleared = new Set(attendanceSavedMemberIds);
				cleared.delete(memberId);
				attendanceSavedMemberIds = cleared;
			}
		},
		reconcile(eventId, targetMemberId, entry) {
			seasonRatesLoaded = false;
			if (targetMemberId === memberId) {
				if (entry) {
					const idx = myAttendance.findIndex((a) => a.eventId === eventId);
					const record = { attendanceId: entry.attendanceId, eventId, status: entry.status };
					if (idx >= 0) {
						const next = [...myAttendance];
						next[idx] = record;
						myAttendance = next;
					} else {
						myAttendance = [...myAttendance, record];
					}
				} else {
					myAttendance = myAttendance.filter((a) => a.eventId !== eventId);
				}
			}

			if (eventId !== attendanceItem?.id) return;
			const next = { ...attendanceMap };
			if (entry) next[targetMemberId] = entry;
			else delete next[targetMemberId];
			attendanceMap = next;
			const saved = new Set(attendanceSavedMemberIds);
			saved.add(targetMemberId);
			attendanceSavedMemberIds = saved;
		},
		revert(eventId, targetMemberId, before) {
			seasonRatesLoaded = false;

			const eventFailed = new Set(attendanceFailedByEvent.get(eventId) ?? []);
			eventFailed.add(targetMemberId);
			const nextMap = new Map(attendanceFailedByEvent);
			nextMap.set(eventId, eventFailed);
			attendanceFailedByEvent = nextMap;

			if (targetMemberId === memberId) {
				if (before) {
					const idx = myAttendance.findIndex((a) => a.eventId === eventId);
					const record = { attendanceId: before.attendanceId, eventId, status: before.status };
					if (idx >= 0) {
						const next = [...myAttendance];
						next[idx] = record;
						myAttendance = next;
					} else {
						myAttendance = [...myAttendance, record];
					}
				} else {
					myAttendance = myAttendance.filter((a) => a.eventId !== eventId);
				}
			}

			if (eventId !== attendanceItem?.id) return;
			const next = { ...attendanceMap };
			if (before) next[targetMemberId] = before;
			else delete next[targetMemberId];
			attendanceMap = next;
			const failed = new Set(attendanceFailedMemberIds);
			failed.add(targetMemberId);
			attendanceFailedMemberIds = failed;
			if (attendanceSavedMemberIds.has(targetMemberId)) {
				const cleared = new Set(attendanceSavedMemberIds);
				cleared.delete(targetMemberId);
				attendanceSavedMemberIds = cleared;
			}
		}
	});

	function handleAttendanceToggle(memberId: string, newStatus: AttendanceStatus | null) {
		if (!selected || !attendanceItem) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const current = attendanceMap[memberId];
		const existing: EventAttendance | null = current
			? { attendanceId: current.attendanceId, memberId, status: current.status }
			: null;
		attendanceQueue.request({ cfg, eventId: attendanceItem.id, memberId, existing, newStatus });
	}

	const attendancePanel = $derived.by<AttendancePanel | undefined>(() => {
		if (!attendanceItem) return undefined;
		return {
			item: attendanceItem,
			members: attendanceRoster,
			attendanceByMemberId: attendanceMap,
			rsvpByMemberId: attendanceRsvpMap,
			loading: attendanceLoading,
			error: attendanceError,
			pendingMemberIds: attendancePendingMemberIds,
			failedMemberIds: attendanceFailedMemberIds,
			savedMemberIds: attendanceSavedMemberIds,
			membersPartial: rosterPartial,
			ontoggle: handleAttendanceToggle,
			onclose: closeAttendancePanel
		};
	});

	const myAttendanceByEventId = $derived.by(() => {
		const map: Record<string, AttendanceStatus> = {};
		for (const a of myAttendance) map[a.eventId] = a.status;
		return map;
	});
	const mySeasonAttendance = $derived((() => {
		const recentIds = new Set(recentItems.map((i) => i.id));
		return myAttendance.filter((a) => recentIds.has(a.eventId));
	})());
	const mySeasonRate = $derived(deriveAttendanceRate(mySeasonAttendance, recentItems.length));

	function handleExpandSeasonSummary() {
		if (!selected) return;
		if (seasonSummaryExpanded) {
			seasonSummaryExpanded = false;
			return;
		}
		seasonSummaryExpanded = true;
		if (seasonRatesLoaded) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const events = recentItems;
		const thisRequestSnapshot = requestId;
		seasonRatesLoading = true;
		seasonRatesError = false;
		Promise.all([
			loadActiveAndArchivedRosters(cfg),
			Promise.all(events.map((event) => listAttendance(cfg, event.id)))
		])
			.then(([rosters, perEventRecords]) => {
				if (thisRequestSnapshot !== requestId) return;
				const rosterRead = rosters.active;
				const inactiveRead = rosters.inactive;
				seasonRatesPartial = rosterRead.truncated || inactiveRead.truncated;
				seasonMemberRates = deriveAllMemberRates(
					perEventRecords.flat(),
					rosterRead.items,
					events.length,
					inactiveRead.items
				);
				seasonRatesLoaded = true;
				seasonRatesLoading = false;
			})
			.catch(() => {
				if (thisRequestSnapshot !== requestId) return;
				seasonRatesLoading = false;
				seasonRatesError = true;
				seasonMemberRates = [];
				seasonRatesPartial = false;
			});
	}

	let seasonCreateOpen = $state(false);
	let seasonCreateSubmitting = $state(false);
	let seasonCreateStatus = $state('');

	const showSeasonCreate = $derived(seasonCreateRights === 'editor');

	function openSeasonCreateForm(): void {
		if (createEntryPointsBlocked) return;
		eventCreateOpen = false;
		seriesCreateOpen = false;
		seasonCreateStatus = '';
		seasonCreateSubmitting = false;
		seasonCreateOpen = true;
	}

	function closeSeasonCreateForm(): void {
		seasonCreateOpen = false;
	}

	function dismissSeasonCreateForm(): void {
		if (seasonCreateSubmitting) return;
		closeSeasonCreateForm();
	}

	const manageableSeasonEntries = $derived(
		seasons.filter((s) => manageableSeasonRightsById[s.id] === 'editor')
	);
	const showSeasonCard = $derived(manageableSeasonEntries.length > 0);

	let seasonManageOpen = $state(false);
	let seasonManageName = $state('');
	let seasonManageStartDate = $state('');
	let seasonManageEndDate = $state('');
	let seasonManageConductorIds = $state<string[]>([]);
	let seasonManageFieldsLoaded = $state(false);
	let seasonManageSeries = $state<SeriesListItem[]>([]);
	let seasonManageSeriesError = $state(false);
	let seasonManagePartial = $state(false);
	let seasonManageDeleteError = $state<{
		list: 'series' | 'season';
		reason: 'write' | 'forbidden' | 'partial' | 'partial-season';
		deleted?: number;
		total?: number;
	} | null>(null);
	let seasonManageDeleteArmed = $state<string | null>(null);
	let seasonManageArmedSeriesCount = $state<number | null>(null);
	const SEASON_DELETE_ROW_ID = '__season__';
	const seasonManageDeleteName = $derived(
		seasonManageFieldsLoaded
			? seasonManageName
			: (seasons.find((s) => s.id === manageableSeasonId)?.name ?? '')
	);
	let seasonManageDeleteScope = $state<{
		series: number;
		events: number;
		repertoireItems: number;
	} | null>(null);
	let seasonManageDeletePendingId = $state<string | null>(null);
	let seasonManageDeleteStatus = $state('');
	let seasonManageDeleteProgress = $state<{ current: number; total: number } | null>(null);
	let seasonManageDeleteGeneration = 0;
	let seasonManageSwitchGeneration = 0;

	function makeSeasonManageDeleteProgress(
		generation: number
	): (current: number, total: number) => void {
		return (current, total) => {
			if (generation !== seasonManageDeleteGeneration) return;
			seasonManageDeleteProgress = { current, total };
		};
	}
	let seasonManageConductorError = $state(false);
	let seasonManageConductorPending = $state(false);
	let seasonManageConductorStatus = $state('');
	let seasonManageRosterLoading = $state(false);
	let seasonManagePanelEl = $state<HTMLDivElement | null>(null);
	let seasonCardEl = $state<HTMLDivElement | null>(null);

	let seasonEditingField = $state<SeasonEditableField | null>(null);
	let seasonEditDraft = $state('');
	let seasonEditErrors = $state<Partial<Record<SeasonEditableField, 'save' | 'range'>>>({});
	let seasonEditHeldOffline = $state(false);
	$effect(() => {
		if (!isOffline) seasonEditHeldOffline = false;
	});
	let seasonEditPending = $state<Partial<Record<SeasonEditableField, boolean>>>({});
	let seasonEditStatus = $state('');

	const seasonManageConductorNameById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const row of rosterRows) map.set(row.personId, row.name);
		return map;
	});

	function seasonConductorLabel(personId: string): string {
		const name = seasonManageConductorNameById.get(personId);
		if (name) return name;
		return seasonManageRosterLoading
			? m.season_manage_conductor_loading()
			: m.season_manage_conductor_unknown();
	}

	const seasonManageConductorOptions = $derived(
		rosterPickerOptions(seasonManageConductorIds)
	);

	const seasonManageConductorEntries = $derived(
		(() => {
			const seen = new Map<string, number>();
			return seasonManageConductorIds.map((personId) => {
				const occurrence = seen.get(personId) ?? 0;
				seen.set(personId, occurrence + 1);
				return { key: `${personId}#${occurrence}`, personId };
			});
		})()
	);

	const seasonDateFmt = isoDateFormatter('UTC');

	function formatSeasonDate(isoDate: string): string {
		if (!isoDate) return '';
		const at = new Date(isoDate);
		if (Number.isNaN(at.getTime())) return '';
		return seasonDateFmt.format(at);
	}

	function resetSeasonManage(): void {
		seasonManageOpen = false;
		seasonManageFieldsLoaded = false;
		seasonManageName = '';
		seasonManageStartDate = '';
		seasonManageEndDate = '';
		seasonManageConductorIds = [];
		seasonManageSeries = [];
		seasonManageSeriesError = false;
		seasonManagePartial = false;
		seasonManageDeleteError = null;
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		seasonManageDeletePendingId = null;
		seasonManageDeleteStatus = '';
		seasonManageDeleteProgress = null;
		seasonManageDeleteGeneration += 1;
		seasonManageSwitchGeneration += 1;
		seasonManageConductorError = false;
		seasonManageConductorPending = false;
		seasonManageConductorStatus = '';
		seasonManageRosterLoading = false;
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditErrors = {};
		seasonEditPending = {};
		seasonEditStatus = '';
		panelRepertoire = [];
		panelRepertoireSeasonId = null;
		panelWorks = [];
		panelWorksPartial = false;
		panelEditions = [];
		panelCopies = [];
		panelPendingKeys = new Set();
		panelRepertoireError = false;
		panelManageError = false;
		panelManageStatus = '';
		panelRepertoireLoading = false;
		panelRepertoireItemsOk = false;
		panelWorksSourcesOk = false;
		panelPickableWorksVisible = undefined;
	}

	function loadPanelRepertoire(cfg: ManageCfg, seasonId: string): void {
		const thisRequest = requestId;
		const thisSwitch = seasonManageSwitchGeneration;
		panelRepertoireSeasonId = seasonId;
		panelRepertoireError = false;
		panelRepertoireLoading = true;
		panelRepertoireItemsOk = false;
		panelWorksSourcesOk = false;
		let itemsSettled = false;
		let sourcesSettled = false;
		const maybeStopLoading = () => {
			if (itemsSettled && sourcesSettled) panelRepertoireLoading = false;
		};
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = items;
				panelRepertoireItemsOk = true;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: loading the season-manage repertoire failed', e);
				panelRepertoire = [];
				panelRepertoireError = true;
			})
			.finally(() => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				itemsSettled = true;
				maybeStopLoading();
			});
		Promise.all([listWorks(cfg), listAllEditions(cfg), listAllCopies(cfg)])
			.then(([worksRead, editionsRead, copiesRead]) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				panelWorks = worksRead.items;
				panelEditions = editionsRead.items;
				panelCopies = copiesRead.items;
				panelWorksPartial = worksRead.truncated;
				panelWorksSourcesOk = true;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: loading the season-manage repertoire sources failed', e);
				panelWorks = [];
				panelEditions = [];
				panelCopies = [];
				panelWorksPartial = false;
				panelRepertoireError = true;
			})
			.finally(() => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				sourcesSettled = true;
				maybeStopLoading();
			});
	}

	function openSeasonManagePanel(): void {
		if (!selected || manageableSeasonId === null) return;
		seasonManageOpen = true;
		seasonEditingField = null;
		if (!seasonManageFieldsLoaded) {
			const season = seasons.find((s) => s.id === manageableSeasonId);
			seasonManageName = season?.name ?? '';
			seasonManageStartDate = season?.startDate ?? '';
			seasonManageEndDate = season?.endDate ?? '';
			seasonManageConductorIds = season?.conductors ?? [];
			seasonManageFieldsLoaded = true;
		}
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisRequest = requestId;
		const thisSwitch = seasonManageSwitchGeneration;
		seasonManageSeriesError = false;
		seasonManageRosterLoading = true;
		getRoster(cfg)
			.catch((e) => {
				console.error('agenda: loading the roster for season management failed', e);
			})
			.finally(() => {
				if (thisRequest !== requestId) return;
				seasonManageRosterLoading = false;
			});
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for season management failed', e);
		});
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				seasonManageSeries = result.items;
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: loading the season\'s event series failed', e);
				seasonManageSeries = [];
				seasonManageSeriesError = true;
				seasonManagePartial = false;
			});
		loadPanelRepertoire(cfg, seasonId);
	}

	function openSeasonManagePanelFor(seasonId: string): void {
		if (seasonId !== manageableSeasonId) {
			if (seriesRunUnfinished) return;
			resetSeasonManage();
			seriesCreateOpen = false;
			manageableSeasonId = seasonId;
			manageableSeasonRights = manageableSeasonRightsById[seasonId] ?? 'not-editor';
		}
		openSeasonManagePanel();
	}

	function closeSeasonManagePanel(): void {
		if (seriesRunUnfinished) return;
		seasonManageOpen = false;
		seasonEditingField = null;
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		seasonManageDeleteError = null;
		const closedSeasonId = manageableSeasonId;
		tick().then(() => {
			seasonCardEl
				?.querySelector<HTMLButtonElement>(
					`[data-testid="season-card-expand"][data-season-manage-id="${closedSeasonId}"]`
				)
				?.focus();
		});
	}

	$effect(() => {
		if (seasonManageOpen && seasonManagePanelEl) seasonManagePanelEl.focus();
	});

	function refocusSeasonManagePanel(): void {
		tick().then(() => seasonManagePanelEl?.focus());
	}

	function onSeasonManagePanelKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') closeSeasonManagePanel();
	}

	function seasonFieldValue(field: SeasonEditableField): string {
		switch (field) {
			case 'name':
				return seasonManageName;
			case 'start_date':
				return seasonManageStartDate;
			case 'end_date':
				return seasonManageEndDate;
		}
	}

	function applySeasonFieldLocally(field: SeasonEditableField, value: string): void {
		switch (field) {
			case 'name':
				seasonManageName = value;
				break;
			case 'start_date':
				seasonManageStartDate = value;
				break;
			case 'end_date':
				seasonManageEndDate = value;
				break;
		}
	}

	function clearSeasonFieldError(field: SeasonEditableField): void {
		const next = { ...seasonEditErrors };
		delete next[field];
		seasonEditErrors = next;
	}

	function beginSeasonFieldEdit(field: SeasonEditableField): void {
		if (seasonEditPending[field] || isOffline) return;
		clearSeasonFieldError(field);
		seasonEditHeldOffline = false;
		seasonEditDraft = seasonFieldValue(field);
		seasonEditingField = field;
	}

	function cancelSeasonFieldEdit(): void {
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditHeldOffline = false;
	}

	function confirmSeasonFieldEdit(field: SeasonEditableField): void {
		if (!selected || manageableSeasonId === null || seasonEditingField !== field) return;
		if (isOffline) {
			clearSeasonFieldError(field);
			seasonEditHeldOffline = true;
			return;
		}
		const before = seasonFieldValue(field);
		const value = seasonEditDraft.trim();
		seasonEditingField = null;
		if (value === '' || value === before) return;

		if (seasonDateRangeInverted(field, value)) {
			seasonEditStatus = '';
			seasonEditErrors = { ...seasonEditErrors, [field]: 'range' };
			return;
		}

		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisSeasonManage = seasonManageSwitchGeneration;
		clearSeasonFieldError(field);
		seasonEditStatus = '';
		seasonEditPending = { ...seasonEditPending, [field]: true };
		applySeasonFieldLocally(field, value);
		updateSeasonField(cfg, seasonId, field, value)
			.then(() => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				seasonEditPending = { ...seasonEditPending, [field]: false };
				seasonEditStatus = m.season_manage_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				console.error('agenda: season field save failed', field, e);
				seasonEditPending = { ...seasonEditPending, [field]: false };
				applySeasonFieldLocally(field, before);
				seasonEditErrors = { ...seasonEditErrors, [field]: 'save' };
			});
	}

	function seasonDateRangeInverted(field: SeasonEditableField, value: string): boolean {
		if (field === 'start_date') return seasonManageEndDate !== '' && value > seasonManageEndDate;
		if (field === 'end_date') return seasonManageStartDate !== '' && value < seasonManageStartDate;
		return false;
	}

	function seasonFieldErrorText(field: SeasonEditableField): string {
		return seasonEditErrors[field] === 'range'
			? m.season_date_range_invalid()
			: m.season_manage_save_error();
	}

	function handleSeasonFieldKeydown(event: KeyboardEvent, field: SeasonEditableField): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelSeasonFieldEdit();
			refocusSeasonManagePanel();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			confirmSeasonFieldEdit(field);
			refocusSeasonManagePanel();
		}
	}

	function focusSeasonInputOnMount(node: HTMLElement): void {
		node.focus();
	}

	function onSeasonManageConductorSelect(selection: { id: string | null; label: string }): void {
		if (seasonManageConductorPending || isOffline) return;
		if (!selection.id || !selected || manageableSeasonId === null) return;
		const personId = selection.id;
		if (seasonManageConductorIds.includes(personId)) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisSeasonManage = seasonManageSwitchGeneration;
		seasonManageConductorError = false;
		seasonManageConductorStatus = '';
		seasonManageConductorPending = true;
		seasonManageConductorIds = [...seasonManageConductorIds, personId];
		addSeasonConductor(cfg, seasonId, personId)
			.then(() => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				seasonManageConductorPending = false;
				seasonManageConductorStatus = m.season_manage_conductor_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				console.error('agenda: add season conductor failed', personId, e);
				seasonManageConductorIds = seasonManageConductorIds.filter((id) => id !== personId);
				seasonManageConductorError = true;
				seasonManageConductorPending = false;
			});
	}

	function onSeasonManageConductorRemove(personId: string, index: number): void {
		if (seasonManageConductorPending || isOffline) return;
		if (!selected || manageableSeasonId === null) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisSeasonManage = seasonManageSwitchGeneration;
		const before = seasonManageConductorIds;
		seasonManageConductorError = false;
		seasonManageConductorStatus = '';
		seasonManageConductorPending = true;
		seasonManageConductorIds = [
			...seasonManageConductorIds.slice(0, index),
			...seasonManageConductorIds.slice(index + 1)
		];
		apiRemoveSeasonConductor(cfg, seasonId, personId)
			.then(() => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				seasonManageConductorPending = false;
				seasonManageConductorStatus = m.season_manage_conductor_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				console.error('agenda: remove season conductor failed', personId, e);
				seasonManageConductorIds = before;
				seasonManageConductorError = true;
				seasonManageConductorPending = false;
			});
	}


	let eventCreateOpen = $state(false);
	let eventCreateSubmitting = $state(false);
	let eventCreateStatus = $state('');

	function openEventCreateForm(): void {
		if (createEntryPointsBlocked) return;
		closeSeasonCreateForm();
		seriesCreateOpen = false;
		eventCreateStatus = '';
		eventCreateOpen = true;
	}

	function restoreEventCreateFocus(): void {
		tick().then(() => {
			seasonManagePanelEl?.focus();
		});
	}

	let pendingSurfaceEventId = $state<string | null>(null);
	let pendingSurfaceGiveUpTimer: ReturnType<typeof setTimeout> | null = null;
	const SURFACE_GIVE_UP_MS = 10000;
	let justCreatedEventId = $state<string | null>(null);
	let justCreatedEventMarkTimer: ReturnType<typeof setTimeout> | null = null;
	const JUST_CREATED_MARK_MS = 3000;

	function surfaceCreatedEvent(eventId: string): void {
		if (pendingSurfaceGiveUpTimer !== null) clearTimeout(pendingSurfaceGiveUpTimer);
		pendingSurfaceEventId = eventId;
		pendingSurfaceGiveUpTimer = setTimeout(() => {
			pendingSurfaceGiveUpTimer = null;
			pendingSurfaceEventId = null;
		}, SURFACE_GIVE_UP_MS);
	}

	$effect(() => {
		const id = pendingSurfaceEventId;
		if (!id) return;
		const monthMode = $agendaViewStore === 'month';
		const present = monthMode
			? filteredAgendaItems.some((it) => it.id === id)
			: filteredAgendaItems.some((it) => it.id === id) ||
				filteredRecentItems.some((it) => it.id === id);
		if (!present) return;
		pendingSurfaceEventId = null;
		if (pendingSurfaceGiveUpTimer !== null) {
			clearTimeout(pendingSurfaceGiveUpTimer);
			pendingSurfaceGiveUpTimer = null;
		}
		closeSeasonManagePanel();
		tick().then(() => {
			document
				.querySelector<HTMLElement>(
					monthMode
						? `[data-testid="agenda-month-row-${id}"]`
						: `[data-testid="agenda-row-${id}"], [data-testid="agenda-recent-row-${id}"]`
				)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		});
		if (justCreatedEventMarkTimer !== null) clearTimeout(justCreatedEventMarkTimer);
		justCreatedEventId = id;
		justCreatedEventMarkTimer = setTimeout(() => {
			justCreatedEventId = null;
			justCreatedEventMarkTimer = null;
		}, JUST_CREATED_MARK_MS);
	});

	function dismissEventCreateForm(): void {
		if (eventCreateSubmitting) return;
		eventCreateOpen = false;
		restoreEventCreateFocus();
	}

	function refreshSeasonManageLists(cfg: ManageCfg, seasonId: string): void {
		const thisRequest = requestId;
		const thisSwitch = seasonManageSwitchGeneration;
		loadPanelRepertoire(cfg, seasonId);
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				seasonManageSeries = result.items;
				seasonManageSeriesError = false;
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: refreshing the season\'s event series after an event create failed', e);
				seasonManageSeriesError = true;
			});
	}


	async function armSeasonManageDelete(rowId: string, confirmTestid: string): Promise<void> {
		seasonManageDeleteError = null;
		seasonManageDeleteArmed = rowId;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="${confirmTestid}"]`)?.focus();
	}

	async function armSeasonManageSeriesDelete(series: SeriesListItem): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? { db: selected.db, token: getToken() ?? '' } : null;
		await armSeasonManageDelete(series.id, `season-manage-series-delete-confirm-${series.id}`);
		if (!cfg) return;
		try {
			const live = await apiCountSeriesOccurrences(cfg, series.id);
			seasonManageSeries = seasonManageSeries.map((row) =>
				row.id === series.id ? { ...row, eventCount: live } : row
			);
			if (seasonManageDeleteArmed === series.id) seasonManageArmedSeriesCount = live;
		} catch (e) {
			console.error('agenda: live occurrence count for the delete confirm failed', series.id, e);
		}
	}

	async function disarmSeasonManageDelete(disarmTestid: string): Promise<void> {
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="${disarmTestid}"]`)?.focus();
	}

	async function armSeasonManageSeasonDelete(): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? { db: selected.db, token: getToken() ?? '' } : null;
		const seasonId = manageableSeasonId;
		const generation = seasonManageDeleteGeneration;
		await armSeasonManageDelete(SEASON_DELETE_ROW_ID, 'season-manage-delete-season-confirm');
		if (!cfg || seasonId === null) return;
		try {
			const scope = await apiCountSeasonScope(cfg, seasonId);
			if (
				generation === seasonManageDeleteGeneration &&
				seasonManageDeleteArmed === SEASON_DELETE_ROW_ID
			) {
				seasonManageDeleteScope = scope;
			}
		} catch (e) {
			console.error('agenda: live season scope for the delete confirm failed', seasonId, e);
		}
	}

	function seasonManageDeleteFailure(
		list: 'series' | 'season',
		reason: unknown
	): NonNullable<typeof seasonManageDeleteError> {
		if (isDeleteForbidden(reason)) return { list, reason: 'forbidden' };
		if (list === 'season' && isSeasonCascadePartial(reason)) {
			const partial = reason as { deletedCount?: number; totalCount?: number };
			return {
				list,
				reason: 'partial-season',
				deleted: partial.deletedCount ?? 0,
				total: partial.totalCount ?? 0
			};
		}
		if (isSeriesCascadePartial(reason)) {
			const partial = reason as { deletedCount?: number; totalCount?: number };
			return {
				list,
				reason: 'partial',
				deleted: partial.deletedCount ?? 0,
				total: partial.totalCount ?? 0
			};
		}
		return { list, reason: 'write' };
	}

	function seasonManageDeleteErrorText(
		failure: NonNullable<typeof seasonManageDeleteError>
	): string {
		switch (failure.reason) {
			case 'forbidden':
				return m.season_manage_delete_forbidden();
			case 'partial':
				return m.season_manage_delete_partial({
					deleted: failure.deleted ?? 0,
					total: failure.total ?? 0
				});
			case 'partial-season':
				return m.season_manage_season_delete_partial({
					deleted: failure.deleted ?? 0,
					total: failure.total ?? 0
				});
			default:
				return m.season_manage_delete_error();
		}
	}

	function refreshAfterSeasonManageDelete(cfg: ManageCfg): void {
		const panelSeasonId = manageableSeasonId;
		loadForSelected({ keepSeasonManage: true });
		if (panelSeasonId !== null) refreshSeasonManageLists(cfg, panelSeasonId);
	}

	function onSeasonManageSeriesDelete(series: SeriesListItem): void {
		if (!selected) return;
		if (seasonManageDeletePendingId !== null) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		seasonManageDeleteError = null;
		seasonManageDeleteProgress = null;
		seasonManageDeletePendingId = series.id;
		const generation = seasonManageDeleteGeneration;
		apiDeleteEventSeries(cfg, series.id, undefined, {
			onProgress: makeSeasonManageDeleteProgress(generation)
		})
			.then((deletedOccurrences) => {
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteArmed = null;
				seasonManageArmedSeriesCount = null;
				seasonManageSeries = seasonManageSeries.filter((row) => row.id !== series.id);
				seasonManageDeleteStatus =
					deletedOccurrences > 0
						? m.season_manage_series_deleted({ name: series.name, count: deletedOccurrences })
						: m.season_manage_deleted({ name: series.name });
				refreshAfterSeasonManageDelete(cfg);
			})
			.catch((e) => {
				console.error('agenda: deleting event series failed', series.id, e);
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteError = seasonManageDeleteFailure('series', e);
			})
			.finally(() => {
				seasonManageDeletePendingId = null;
				if (generation === seasonManageDeleteGeneration) seasonManageDeleteProgress = null;
			});
	}

	function onSeasonManageSeasonDelete(): void {
		if (!selected || manageableSeasonId === null) return;
		if (seasonManageDeletePendingId !== null) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const seasonName = seasonManageDeleteName;
		seasonManageDeleteError = null;
		seasonManageDeleteProgress = null;
		seasonManageDeletePendingId = SEASON_DELETE_ROW_ID;
		const generation = seasonManageDeleteGeneration;
		apiDeleteSeason(cfg, seasonId, undefined, {
			onProgress: makeSeasonManageDeleteProgress(generation)
		})
			.then(() => {
				if (generation !== seasonManageDeleteGeneration) return;
				loadForSelected();
				seasonManageDeleteStatus = m.season_delete_success({ name: seasonName });
			})
			.catch((e) => {
				console.error('agenda: deleting season failed', seasonId, e);
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteError = seasonManageDeleteFailure('season', e);
			})
			.finally(() => {
				seasonManageDeletePendingId = null;
				if (generation === seasonManageDeleteGeneration) seasonManageDeleteProgress = null;
			});
	}


	let seriesCreateOpen = $state(false);
	let seriesCreateSubmitting = $state(false);
	let seriesRunDb = $state<string | null>(null);
	let seriesCreateResumeByDb = $state<Record<string, SeriesResumeEntry>>({});

	const seriesCreateResume = $derived(selected ? (seriesCreateResumeByDb[selected.db] ?? null) : null);

	const anyCreateSubmitting = $derived(
		seasonCreateSubmitting || eventCreateSubmitting || seriesCreateSubmitting
	);

	const seriesRunUnfinished = $derived(seriesCreateSubmitting || seriesCreateResume !== null);
	const createEntryPointsBlocked = $derived(anyCreateSubmitting || seriesRunUnfinished);

	const seasonCardCollapseDisabled = $derived(seasonManageOpen && seriesRunUnfinished);

	function openSeriesCreateForm(): void {
		if (manageableSeasonId === null) return;
		if (createEntryPointsBlocked) return;
		closeSeasonCreateForm();
		eventCreateOpen = false;
		seriesCreateOpen = true;
	}

	// #508 — field-by-field restore now lives in SeriesCreateForm's own
	// construction (it reads resumeByDb fresh on every mount); this only needs
	// to clear a season-mismatched record and flip the flag that mounts it.
	function restoreSeriesCreateRun(): void {
		const current = selected;
		if (!current) return;
		if (seriesCreateOpen || (seriesCreateSubmitting && seriesRunDb === current.db)) return;
		const entry = seriesCreateResumeByDb[current.db];
		if (!entry) return;
		if (manageableSeasonId !== entry.form.seasonId) {
			console.warn(
				'agenda: dropping a series resume record whose season is no longer manageable',
				current.db,
				entry.form.seasonId
			);
			seriesCreateResumeByDb = clearSeriesCreateResume(seriesCreateResumeByDb, current.db);
			return;
		}
		if (!seasonManageOpen) openSeasonManagePanel();
		seriesCreateOpen = true;
	}

	const gatedMembership = $derived(
		membership === 'member' && $completionGateStore !== 'complete' ? 'loading' : membership
	);
	const gatedCanRsvp = $derived(
		rsvpRights === 'not-editor'
			? 'not-editor'
			: $completionGateStore !== 'complete'
				? 'loading'
				: rsvpRights
	);

	$effect(() => {
		selected;
		seasonCreateStatus = '';
		eventCreateStatus = '';
		untrack(() => loadForSelected());
	});

	function retryAgenda() {
		loadForSelected();
	}
</script>

{#if auth.status === 'authenticated'}
	{#if collectives.status === 'ready' && selected}
			<div class="mx-auto flex min-h-screen w-full max-w-md flex-col gap-2 bg-paper px-4 py-6">
				<datalist id={LOCATION_SUGGESTIONS_ID}>
					{#each locationSuggestions as loc (loc)}
						<option value={loc}></option>
					{/each}
				</datalist>
				<header class="flex items-center pb-2">
					{#if pickerMode === 'picker'}
						<select
							class="rounded-md border border-ink bg-paper px-2 py-1 font-display text-xl text-ink"
							data-testid="selected-collective"
							aria-label={m.agenda_switch_collective()}
							value={selected.db}
							onchange={(e) => {
								void selectCollective((e.currentTarget as HTMLSelectElement).value);
							}}
						>
							{#each collectives.status === 'ready' ? collectives.collectives : [] as c (c.db)}
								<option value={c.db}>{c.name}</option>
							{/each}
						</select>
					{:else}
						<p class="font-display text-xl text-ink" data-testid="selected-collective">{selected.name}</p>
					{/if}
				</header>
				<div class="rounded-lg bg-paper p-4">
					{#if sessionExpired}
						<SessionExpiredNotice centered />
					{:else if agendaError}
						<div data-testid="agenda-error" class="flex flex-col items-center gap-3 py-10 text-center">
							<p class="text-sm text-ink-2">{m.agenda_load_error()}</p>
							<button
								type="button"
								class="rounded-md border border-ink px-4 py-2 text-sm text-ink hover:bg-ink hover:text-paper"
								data-testid="agenda-retry"
								onclick={retryAgenda}
							>
								{m.agenda_retry()}
							</button>
						</div>
					{:else}
						{#if $servedFromCache}
							<AsOfLine readAt={$servedFromCache} testid="agenda-as-of" class="mb-3" />
							<a
								href="/downloads"
								class="mb-3 block text-sm text-ink underline"
								data-testid="agenda-downloads-link-cached"
							>
								{m.agenda_downloads_link()}
							</a>
						{/if}
						{#if rsvpPartial}
							<p
								data-testid="rsvp-partial-notice"
								role="status"
								class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
							>
								{m.rsvp_partial_notice()}
							</p>
						{/if}
						{#if attendancePartial}
							<p
								data-testid="attendance-partial-notice"
								role="status"
								class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
							>
								{m.attendance_partial_notice()}
							</p>
						{/if}
						{#if !agendaLoading && seasons.length === 0 && seasonCreateRights === 'editor' && !seasonCreateOpen}
							<div
								data-testid="agenda-onboarding"
								class="mb-3 flex flex-col gap-2 rounded-md border border-dashed border-ink-4 p-3"
							>
								<ol class="flex flex-col gap-1 text-sm text-ink-2">
									<li>{m.agenda_onboarding_step_season()}</li>
									<li>{m.agenda_onboarding_step_series()}</li>
									<li>{m.agenda_onboarding_step_events()}</li>
								</ol>
							</div>
						{/if}
						{#if showSeasonCreate && !seasonCreateOpen}
							<button
								type="button"
								data-testid="season-create"
								disabled={createEntryPointsBlocked}
								class="mb-3 flex w-fit min-h-11 items-center rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
								onclick={openSeasonCreateForm}
							>
								{m.season_create()}
							</button>
						{/if}
						{#if showSeasonCard || seasonManageOpen}
							<div
								data-testid="agenda-admin-card"
								bind:this={seasonCardEl}
								class="mb-3 rounded-md border border-ink-4 p-1.5"
							>
								{#each manageableSeasonEntries as ms (ms.id)}
									{#if !seasonManageOpen || ms.id !== manageableSeasonId}
										<h2>
											<button
												type="button"
												data-testid="season-card-expand"
												data-season-manage-id={ms.id}
												aria-expanded="false"
												disabled={seriesRunUnfinished && ms.id !== manageableSeasonId}
												class="group flex w-full min-h-11 items-center gap-2 rounded-sm px-1.5 text-left font-display text-lg text-ink hover:bg-ink-5 disabled:opacity-50 disabled:hover:bg-transparent"
												onclick={() => openSeasonManagePanelFor(ms.id)}
											>
												<span class="sr-only">{m.season_manage_expand_label()}</span>
												<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
													>▸</span
												>
												<span>{ms.id === manageableSeasonId ? seasonManageDeleteName : ms.name}</span>
											</button>
										</h2>
									{/if}
								{/each}
								{#if seasonManageOpen}
									<div class="flex flex-wrap items-center gap-2">
										{#if showSeasonCard}
											<h2 class="flex min-w-0 flex-1">
												<button
													type="button"
													data-testid="season-card-collapse"
													aria-expanded="true"
													aria-controls="season-manage-panel"
													disabled={seasonCardCollapseDisabled}
													class="group flex w-full min-h-11 items-center gap-2 rounded-sm px-1.5 text-left font-display text-lg text-ink hover:bg-ink-5 disabled:opacity-50 disabled:hover:bg-transparent"
													onclick={closeSeasonManagePanel}
													onkeydown={onSeasonManagePanelKeydown}
												>
													<span class="sr-only">{m.season_manage_collapse_label()}</span>
													<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
														>▾</span
													>
													<span id="season-manage-label" data-testid="season-manage-label">
														{seasonManageDeleteName}
													</span>
												</button>
											</h2>
											{#if seasonManageDeleteArmed === SEASON_DELETE_ROW_ID}
												<button
													type="button"
													data-testid="season-manage-delete-season-confirm"
													aria-label={seasonManageDeleteScope !== null
														? m.season_delete_confirm_scope({
																name: seasonManageDeleteName,
																series: seasonManageDeleteScope.series,
																events: seasonManageDeleteScope.events,
																repertoire: seasonManageDeleteScope.repertoireItems
															})
														: m.season_manage_delete_confirm({ name: seasonManageDeleteName })}
													disabled={seasonManageDeletePendingId !== null || isOffline}
													aria-busy={seasonManageDeletePendingId === SEASON_DELETE_ROW_ID}
													class="ml-auto flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
													onclick={onSeasonManageSeasonDelete}
													onkeydown={onSeasonManagePanelKeydown}
												>
													{seasonManageDeleteScope !== null
														? m.season_delete_confirm_scope_short({
																series: seasonManageDeleteScope.series,
																events: seasonManageDeleteScope.events,
																repertoire: seasonManageDeleteScope.repertoireItems
															})
														: m.season_manage_delete_confirm_short()}
												</button>
												<button
													type="button"
													data-testid="season-manage-delete-season-cancel"
													aria-label={m.season_manage_delete_cancel({ name: seasonManageDeleteName })}
													disabled={seasonManageDeletePendingId !== null}
													class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
													onclick={() => void disarmSeasonManageDelete('season-manage-delete-season')}
													onkeydown={onSeasonManagePanelKeydown}
												>
													{m.season_manage_delete_cancel_short()}
												</button>
											{:else}
												<DeleteTrigger
													data-testid="season-manage-delete-season"
													aria-label={m.season_manage_season_delete({ name: seasonManageDeleteName })}
													class="ml-auto"
													disabled={isOffline}
													onclick={() => void armSeasonManageSeasonDelete()}
													onkeydown={onSeasonManagePanelKeydown}
												/>
											{/if}
										{/if}
									</div>
								{/if}
							{#if seasonManageDeleteProgress !== null}
								<p
									data-testid="season-manage-delete-progress"
									role="status"
									class="mt-1 text-xs text-ink-2"
								>
									{m.season_manage_delete_progress({
										current: seasonManageDeleteProgress.current,
										total: seasonManageDeleteProgress.total
									})}
								</p>
							{/if}
							{#if seasonManageDeleteError?.list === 'season'}
								<p
									data-testid="season-manage-delete-error"
									role="alert"
									class="mt-1 text-xs text-red-700"
								>
									{seasonManageDeleteErrorText(seasonManageDeleteError)}
								</p>
							{/if}
							{#if seasonManageOpen}
								<div
									id="season-manage-panel"
									data-testid="season-manage-panel"
									bind:this={seasonManagePanelEl}
									role="dialog"
									aria-labelledby="season-manage-label"
									tabindex="-1"
									class="mt-3 flex flex-col gap-3 p-3"
									onkeydown={onSeasonManagePanelKeydown}
								>

									{#if isOffline}
										<p data-testid="season-manage-write-unavailable" class="text-xs text-ink-2">
											{m.write_unavailable_no_signal()}
										</p>
									{/if}
									{#if seasonEditHeldOffline}
										<p
											data-testid="season-edit-held-offline"
											role="alert"
											class="text-xs text-ink-2"
										>
											{m.write_held_no_signal()}
										</p>
									{/if}

									<div>
									{#if seasonEditingField === 'name'}
										<input
											type="text"
											data-testid="season-edit-input-name"
											aria-label={m.season_manage_name_label()}
											value={seasonEditDraft}
											use:focusSeasonInputOnMount
											oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
											onblur={() => confirmSeasonFieldEdit('name')}
											onkeydown={(e) => handleSeasonFieldKeydown(e, 'name')}
											class="w-full border-b border-ink bg-transparent font-display text-lg text-ink"
										/>
									{:else}
										<div class="font-display text-lg text-ink">
											<button
												type="button"
												data-testid="season-edit-btn-name"
												disabled={seasonEditPending.name === true || isOffline}
												class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-lg text-ink disabled:opacity-40"
												onclick={() => beginSeasonFieldEdit('name')}
											>
												<span class="sr-only">{m.season_manage_edit_name_label()}</span>
												<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
													>✎</span
												>
												<span data-testid="season-manage-name">{seasonManageName}</span>
											</button>
										</div>
									{/if}
									{#if seasonEditErrors.name}
										<p data-testid="season-edit-error-name" role="alert" class="text-xs text-red-700">
											{seasonFieldErrorText('name')}
										</p>
									{/if}
								</div>

								<div class="flex gap-4">
									<div class="min-w-0 flex-1">
										<p class="text-xs tracking-wide text-ink-2 uppercase">
											{m.season_manage_start_date_label()}
										</p>
										{#if seasonEditingField === 'start_date'}
											<input
												type="date"
												data-testid="season-edit-input-start_date"
												aria-label={m.season_manage_start_date_label()}
												value={seasonEditDraft}
												use:focusSeasonInputOnMount
												oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
												onblur={() => confirmSeasonFieldEdit('start_date')}
												onkeydown={(e) => handleSeasonFieldKeydown(e, 'start_date')}
												class="border-b border-ink bg-transparent text-ink"
											/>
										{:else}
											<button
												type="button"
												data-testid="season-edit-btn-start_date"
												disabled={seasonEditPending.start_date === true || isOffline}
												class="group flex min-h-11 w-full appearance-none items-center gap-1 border-0 bg-transparent p-0 text-left disabled:opacity-40"
												onclick={() => beginSeasonFieldEdit('start_date')}
											>
												<span class="sr-only">{m.season_manage_edit_start_date_label()}</span>
												<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
													>✎</span
												>
												<span data-testid="season-manage-start_date" class="text-base text-ink-2">
													{#if seasonManageStartDate}
														{formatSeasonDate(seasonManageStartDate)}
													{:else}
														{m.season_manage_date_unset()}
													{/if}
												</span>
											</button>
										{/if}
										{#if seasonEditErrors.start_date}
											<p
												data-testid="season-edit-error-start_date"
												role="alert"
												class="text-xs text-red-700"
											>
												{seasonFieldErrorText('start_date')}
											</p>
										{/if}
									</div>
									<div class="min-w-0 flex-1">
										<p class="text-xs tracking-wide text-ink-2 uppercase">
											{m.season_manage_end_date_label()}
										</p>
										{#if seasonEditingField === 'end_date'}
											<input
												type="date"
												data-testid="season-edit-input-end_date"
												aria-label={m.season_manage_end_date_label()}
												value={seasonEditDraft}
												use:focusSeasonInputOnMount
												oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
												onblur={() => confirmSeasonFieldEdit('end_date')}
												onkeydown={(e) => handleSeasonFieldKeydown(e, 'end_date')}
												class="border-b border-ink bg-transparent text-ink"
											/>
										{:else}
											<button
												type="button"
												data-testid="season-edit-btn-end_date"
												disabled={seasonEditPending.end_date === true || isOffline}
												class="group flex min-h-11 w-full appearance-none items-center gap-1 border-0 bg-transparent p-0 text-left disabled:opacity-40"
												onclick={() => beginSeasonFieldEdit('end_date')}
											>
												<span class="sr-only">{m.season_manage_edit_end_date_label()}</span>
												<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
													>✎</span
												>
												<span data-testid="season-manage-end_date" class="text-base text-ink-2">
													{#if seasonManageEndDate}
														{formatSeasonDate(seasonManageEndDate)}
													{:else}
														{m.season_manage_date_unset()}
													{/if}
												</span>
											</button>
										{/if}
										{#if seasonEditErrors.end_date}
											<p
												data-testid="season-edit-error-end_date"
												role="alert"
												class="text-xs text-red-700"
											>
												{seasonFieldErrorText('end_date')}
											</p>
										{/if}
									</div>
								</div>

								<div
									data-testid="season-edit-status"
									role="status"
									aria-live="polite"
									class="sr-only"
								>
									{seasonEditStatus}
								</div>

								<div>
									<p class="text-xs tracking-wide text-ink-2 uppercase">
										{m.season_manage_conductors_label()}
									</p>
									{#if seasonManageConductorEntries.length > 0}
										<ul class="mt-1 flex flex-wrap gap-1.5">
											{#each seasonManageConductorEntries as { key, personId }, entryIndex (key)}
												<li
													data-testid="season-manage-conductor-{personId}"
													data-conductor-key={key}
													class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
												>
													<PersonName name={seasonConductorLabel(personId)} />
													<!-- #237: unlink is not destroy — this chip keeps its × and muted
													     tone on purpose; DeleteTrigger is for Table A only. -->
													<button
														type="button"
														data-testid="season-manage-conductor-remove-{personId}"
														aria-label={m.season_conductor_remove({
															name: seasonConductorLabel(personId)
														})}
														disabled={seasonManageConductorPending || isOffline}
														class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50"
														onclick={() => onSeasonManageConductorRemove(personId, entryIndex)}
													>
														&times;
													</button>
												</li>
											{/each}
										</ul>
									{/if}
									<div class="mt-1.5">
										<select
											data-testid="season-manage-conductor-select"
											aria-label={m.season_conductor_label()}
											disabled={seasonManageConductorOptions.length === 0 ||
												seasonManageConductorPending ||
												isOffline}
											value=""
											onchange={(e) => {
												const target = e.currentTarget as HTMLSelectElement;
												const personId = target.value;
												target.value = '';
												if (!personId) return;
												const label =
													seasonManageConductorOptions.find((o) => o.id === personId)
														?.label ?? '';
												onSeasonManageConductorSelect({ id: personId, label });
											}}
											class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
										>
											<option value="" disabled selected hidden>
												{pickerPromptText(
													seasonManageConductorOptions.length,
													m.season_conductor_placeholder()
												)}
											</option>
											{#each seasonManageConductorOptions as option (option.id)}
												<option value={option.id}>{option.label}</option>
											{/each}
										</select>
										{#if rosterPartial}
											<p data-testid="season-manage-conductor-partial-notice" role="status" class="text-xs text-ink-2">
												{m.picker_partial_members_notice()}
											</p>
										{/if}
										{#if sectionsReadFailed}
											<p
												data-testid="season-manage-conductor-order-note"
												class="text-xs text-ink-2"
											>
												{m.picker_order_fallback()}
											</p>
										{/if}
									</div>
									{#if seasonManageConductorError}
										<p
											data-testid="season-manage-conductor-error"
											role="alert"
											class="text-xs text-red-700"
										>
											{m.season_manage_save_error()}
										</p>
									{/if}
									{#if seasonManageConductorPending}
										<p
											data-testid="season-manage-conductor-pending-notice"
											role="status"
											class="text-xs text-ink-2"
										>
											{m.season_manage_conductor_saving()}
										</p>
									{/if}
									<div
										data-testid="season-manage-conductor-status"
										role="status"
										aria-live="polite"
										class="sr-only"
									>
										{seasonManageConductorStatus}
									</div>
								</div>

								<div>
									<div class="flex items-center justify-between">
										<p class="text-xs tracking-wide text-ink-2 uppercase">
											{m.season_manage_series_label()}
										</p>
										{#if !seriesCreateOpen}
											<button
												type="button"
												data-testid="season-manage-add-series"
												disabled={createEntryPointsBlocked}
												class="flex min-h-11 items-center text-xs text-ink underline disabled:opacity-50"
												onclick={openSeriesCreateForm}
											>
												{m.season_manage_add_series()}
											</button>
										{/if}
									</div>
									{#if seriesCreateOpen}
										<SeriesCreateForm
											{selected}
											{manageableSeasonId}
											{seasonManageStartDate}
											{seasonManageEndDate}
											{seasonManagePanelEl}
											locationSuggestionsId={LOCATION_SUGGESTIONS_ID}
											bind:submitting={seriesCreateSubmitting}
											bind:resumeByDb={seriesCreateResumeByDb}
											bind:seriesRunDb
											onclose={() => (seriesCreateOpen = false)}
											{loadForSelected}
											{refreshSeasonManageLists}
										/>
									{/if}
									{#if seasonManagePartial}
										<p
											data-testid="season-manage-partial-notice"
											role="status"
											class="mt-1 rounded-md border border-dashed border-ink-4 p-2 text-xs text-ink-2"
										>
											{m.season_manage_partial_notice()}
										</p>
									{/if}
									{#if seasonManageSeriesError}
										<p
											data-testid="season-manage-series-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{m.season_manage_list_load_error()}
										</p>
									{/if}
									{#each seasonManageSeries as series (series.id)}
										<div
											data-testid="season-manage-series-{series.id}"
											class="mt-1 flex items-center justify-between text-xs text-ink"
										>
											<span>{series.name}</span>
											<div class="flex items-center gap-1">
												<span class="text-ink-2"
													>{m.season_manage_series_event_count({ count: series.eventCount })}</span
												>
												{#if selected && canDeleteSeries(series, selected.personId)}
												{#if seasonManageDeleteArmed === series.id}
													<button
														type="button"
														data-testid="season-manage-series-delete-confirm-{series.id}"
														aria-label={seasonManageArmedSeriesCount !== null &&
														seasonManageArmedSeriesCount > 0
															? m.season_manage_series_delete_confirm({
																	name: series.name,
																	count: seasonManageArmedSeriesCount
																})
															: m.season_manage_delete_confirm({ name: series.name })}
														disabled={seasonManageDeletePendingId !== null || isOffline}
														aria-busy={seasonManageDeletePendingId === series.id}
														class="flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
														onclick={() => onSeasonManageSeriesDelete(series)}
													>
														{seasonManageArmedSeriesCount !== null &&
														seasonManageArmedSeriesCount > 0
															? m.season_manage_series_delete_confirm_short({
																	count: seasonManageArmedSeriesCount
																})
															: m.season_manage_delete_confirm_short()}
													</button>
													<button
														type="button"
														data-testid="season-manage-series-delete-cancel-{series.id}"
														aria-label={m.season_manage_delete_cancel({ name: series.name })}
														disabled={seasonManageDeletePendingId !== null}
														class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
														onclick={() =>
															void disarmSeasonManageDelete(
																`season-manage-series-delete-${series.id}`
															)}
													>
														{m.season_manage_delete_cancel_short()}
													</button>
												{:else}
													<DeleteTrigger
														data-testid="season-manage-series-delete-{series.id}"
														aria-label={m.season_manage_series_delete({ name: series.name })}
														disabled={isOffline}
														onclick={() => void armSeasonManageSeriesDelete(series)}
													/>
												{/if}
												{/if}
											</div>
										</div>
									{/each}
									{#if seasonManageDeleteError?.list === 'series'}
										<p
											data-testid="season-manage-delete-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{seasonManageDeleteErrorText(seasonManageDeleteError)}
										</p>
									{/if}
								</div>

								{#if !eventCreateOpen}
									<button
										type="button"
										data-testid="season-manage-add-event"
										disabled={createEntryPointsBlocked}
										class="flex min-h-11 items-center text-xs text-ink underline disabled:opacity-50"
										onclick={openEventCreateForm}
									>
										{m.season_manage_add_event()}
									</button>
								{/if}

								<div data-testid="season-manage-repertoire">
									<p class="text-xs tracking-wide text-ink-2 uppercase">
										{m.season_manage_repertoire_label()}
									</p>
									{#if panelRepertoireError}
										<p
											data-testid="season-manage-repertoire-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{m.season_manage_list_load_error()}
										</p>
									{/if}
									<RepertoireElement
										rows={panelWorkRows}
										context="repertoire"
										seasonRights={manageableSeasonRights}
										pickableWorksList={panelPickableWorksList}
										pickableWorksVisible={panelPickableWorksVisible}
										pickableWorksPartial={panelWorksPartial}
										pendingKeys={panelPendingKeys}
										addWorkKey={PANEL_ADD_WORK_KEY}
										expanded={true}
										onpdfclick={handlePdfClick}
										{heldFileIds}
										onaddwork={handlePanelAddWork}
										onstatuschange={handlePanelStatusChange}
										onremoveitem={handlePanelRemoveItem}
									/>
									{#if panelManageError}
										<p
											data-testid="repertoire-manage-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{m.repertoire_manage_error()}
										</p>
									{/if}
									<div
										data-testid="repertoire-manage-status"
										role="status"
										aria-live="polite"
										class="sr-only"
									>
										{panelManageStatus}
									</div>
								</div>
							</div>
							{/if}
						</div>
					{/if}
						<div
							data-testid="season-manage-delete-status"
							role="status"
							aria-live="polite"
							class="sr-only"
						>
							{seasonManageDeleteStatus}
						</div>
						<div
							data-testid="season-create-status"
							role="status"
							aria-live="polite"
							class="mb-2 text-xs text-ink-2"
							class:sr-only={!seasonCreateStatus}
						>
							{seasonCreateStatus}
						</div>
						{#if showSeasonCreate && seasonCreateOpen}
							<SeasonCreateForm
								{selected}
								{rosterPartial}
								{sectionsReadFailed}
								bind:submitting={seasonCreateSubmitting}
								bind:status={seasonCreateStatus}
								{getRoster}
								{getSections}
								{rosterPickerOptions}
								{pickerPromptText}
								loadForSelected={() => loadForSelected()}
								dismiss={dismissSeasonCreateForm}
								onclose={closeSeasonCreateForm}
							/>
						{/if}
						<div
							data-testid="event-create-status"
							role="status"
							aria-live="polite"
							class="mb-2 text-xs text-ink-2"
							class:sr-only={!eventCreateStatus}
						>
							{eventCreateStatus}
						</div>
						{#if eventCreateOpen}
							<EventCreateForm
								{selected}
								{manageableSeasonId}
								{seasons}
								{agendaTypeFilter}
								{agendaFilterBucketOf}
								{rosterPartial}
								{sectionsReadFailed}
								locationSuggestionsId={LOCATION_SUGGESTIONS_ID}
								bind:submitting={eventCreateSubmitting}
								bind:status={eventCreateStatus}
								{getRoster}
								{getSections}
								{rosterPickerOptions}
								{pickerPromptText}
								{loadForSelected}
								{refreshSeasonManageLists}
								dismiss={dismissEventCreateForm}
								onclose={() => (eventCreateOpen = false)}
								{restoreEventCreateFocus}
								{surfaceCreatedEvent}
							/>
						{/if}
						{#if agendaFilterChips.length > 0}
							<div class="flex flex-wrap items-center justify-between gap-2 pb-3">
								<div
									role="group"
									aria-label={m.agenda_filter_group_label()}
									class="flex flex-wrap gap-2"
								>
									<button
										type="button"
										data-testid="agenda-filter-all"
										aria-pressed={agendaTypeFilter === 'all' ? 'true' : 'false'}
										class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {agendaTypeFilter ===
										'all'
											? 'border-ink bg-ink text-paper'
											: 'border-ink-4 text-ink-2'}"
										onclick={() => selectAgendaTypeFilter('all')}
									>
										{m.agenda_filter_all()}
									</button>
									{#each agendaFilterChips as type (type)}
										<button
											type="button"
											data-testid="agenda-filter-{type}"
											aria-pressed={agendaTypeFilter === type ? 'true' : 'false'}
											class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {agendaTypeChipClass(
												type
											)}"
											onclick={() => selectAgendaTypeFilter(type)}
										>
											{eventTypeLabel(type)}
										</button>
									{/each}
								</div>
								<div
									data-testid="agenda-view-toggle"
									role="radiogroup"
									tabindex="-1"
									aria-label={m.agenda_view_toggle_label()}
									class="inline-flex overflow-hidden rounded-md border border-ink-4"
									onkeydown={handleAgendaViewKeydown}
								>
									<button
										type="button"
										data-testid="agenda-view-list"
										data-agenda-view="list"
										role="radio"
										aria-checked={$agendaViewStore === 'list' ? 'true' : 'false'}
										tabindex={$agendaViewStore === 'list' ? 0 : -1}
										class="border-r border-ink-4 px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase last:border-r-0 {$agendaViewStore ===
										'list'
											? 'bg-ink text-paper'
											: 'text-ink-2'}"
										onclick={() => setAgendaView('list')}
									>
										{m.agenda_view_list()}
									</button>
									<button
										type="button"
										data-testid="agenda-view-month"
										data-agenda-view="month"
										role="radio"
										aria-checked={$agendaViewStore === 'month' ? 'true' : 'false'}
										tabindex={$agendaViewStore === 'month' ? 0 : -1}
										class="border-r border-ink-4 px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase last:border-r-0 {$agendaViewStore ===
										'month'
											? 'bg-ink text-paper'
											: 'text-ink-2'}"
										onclick={() => setAgendaView('month')}
									>
										{m.agenda_view_month()}
									</button>
								</div>
							</div>
						{/if}
						{#snippet agendaFilterEmptyState()}
							<div data-testid="agenda-filter-empty" class="flex min-h-[30vh] items-center justify-center">
								<p class="font-display text-xl text-ink-2">{m.agenda_filter_empty()}</p>
							</div>
						{/snippet}
						{#snippet agendaRecentFilterEmptyState()}
							<p data-testid="agenda-recent-filter-empty" class="py-2 text-sm text-ink-2">
								{m.agenda_filter_recent_empty()}
							</p>
						{/snippet}
						{#if $agendaViewStore === 'list'}
							{#key selected?.db}
							<AgendaList
								items={filteredAgendaItems}
								loading={agendaLoading}
								{rsvpByEventId}
								membership={gatedMembership}
								canRsvp={gatedCanRsvp}
								{pendingEventIds}
								{failedEventIds}
								{savedEventIds}
								recentItems={filteredRecentItems}
								conductorEventIds={attendanceEventIds}
								{myAttendanceByEventId}
								{worksByEventId}
								{worksManage}
								{heldFileIds}
								scheduleItemsByEventId={scheduleByEventId}
								{attendancePanel}
								{justCreatedEventId}
								emptyState={agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
								recentEmptyState={agendaTypeFilter !== 'all' && recentItems.length > 0
									? agendaRecentFilterEmptyState
									: undefined}
								onpdfclick={handlePdfClick}
								onrsvpchange={handleRsvpChange}
								ontakeattendance={openAttendancePanel}
							>
								{#snippet seasonSummary()}
									<SeasonSummary
										myRate={mySeasonRate}
										canExpand={seasonManageRights === 'editor'}
										expanded={seasonSummaryExpanded}
										memberRates={seasonMemberRates}
										membersPartial={seasonRatesPartial}
										loading={seasonRatesLoading}
										error={seasonRatesError}
										onexpand={handleExpandSeasonSummary}
									/>
								{/snippet}
							</AgendaList>
							{/key}
						{:else}
							<AgendaMonthView
								items={filteredAgendaItems}
								loading={agendaLoading}
								{justCreatedEventId}
								emptyState={agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
							/>
						{/if}
						{#if pdfError}
							<p data-testid="repertoire-pdf-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_pdf_error()}
							</p>
						{/if}
						{#if manageError}
							<p data-testid="repertoire-manage-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_manage_error()}
							</p>
						{/if}
					{/if}
				</div>
			</div>
	{:else}
		<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
			<p class="text-sm text-ink" data-testid="auth-status">{m.agenda_signed_in()}</p>
			{#if collectives.status === 'none'}
				<p class="text-sm text-ink">{m.agenda_collectives_none()}</p>
			{:else if collectives.status === 'error'}
				<p class="text-sm text-ink">
					{m.agenda_collectives_error_dbs({ dbs: collectives.erroredDbs.join(', ') })}
				</p>
				<button
					type="button"
					class="rounded-md border border-ink px-4 py-2 text-sm text-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
					data-testid="collectives-retry"
					disabled={collectivesRetrying}
					aria-busy={collectivesRetrying}
					onclick={() => {
						void retryCollectives();
					}}
				>
					{m.agenda_collectives_error_retry()}
				</button>
				<a href="/downloads" class="text-sm text-ink underline" data-testid="agenda-downloads-link">
					{m.agenda_downloads_link()}
				</a>
			{:else}
				<p class="text-sm text-ink">{m.agenda_collectives_loading()}</p>
			{/if}
		</main>
	{/if}
{/if}
