<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/auth/session';
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
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
	import { ADD_PROGRAMME_KEY, ADD_WORK_KEY } from '$lib/components/agenda/RepertoireElement.svelte';
	import EventCreateForm from '$lib/components/agenda/EventCreateForm.svelte';
	import SeasonCreateForm from '$lib/components/agenda/SeasonCreateForm.svelte';
	import SeasonManagePanel from '$lib/components/agenda/SeasonManagePanel.svelte';
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
	import { createAgendaLoadState, createLoadCounters, createAgendaLoader } from '$lib/agenda/agendaLoad';
	import { attendanceQueueHandlers } from '$lib/agenda/attendancePanel';
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
	import { CANONICAL_EVENT_TYPES, eventTypeLabel } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import { writesAvailable } from '$lib/net/online';
	import { withItem, without } from '$lib/collections/immutable';

	const auth = $derived($authStore);
	const collectives = $derived($collectiveState);
	const selected = $derived($selectedCollectiveStore);
	const pickerMode = $derived($pickerModeStore);
	const isOffline = $derived(!$writesAvailable);

	const ag = $state(createAgendaLoadState());
	const seq = createLoadCounters();
	const {
		getRoster,
		getSections,
		loadForSelected,
		resetManagement,
		reorderKey,
		mergePendingRows,
		refreshWorksAfterWrite,
		mapRows,
		patchRow,
		findRow,
		snapshotRow,
		restoreRow,
		dropRow,
		setOrdinals,
		openAttendancePanel,
		closeAttendancePanel,
		handleExpandSeasonSummary,
		loadPanelRepertoire
	} = createAgendaLoader(ag, seq, {
		selected: () => selected,
		seasonManageOpen: () => seasonManageOpen,
		seasonManageSwitchGeneration: () => seasonManageSwitchGeneration,
		collectiveIdentity: () => get(selectedCollectiveIdentityStore),
		collectivesState: () => get(collectiveState),
		isRepertoirePending: (key) => repertoireQueue.isPending(key),
		pendingMembersForEvent: (eventId) => attendanceQueue.pendingMembersForEvent(eventId),
		resetSeasonManage,
		closeSeasonCreateForm,
		closeEventCreateForm: () => (eventCreateOpen = false),
		closeSeriesCreateForm: () => (seriesCreateOpen = false),
		restoreSeriesCreateRun,
		refreshPresence,
		findMyMemberId: (...a) => findMyMemberId(...a),
		listMyRsvps: (...a) => listMyRsvps(...a),
		rsvpsByEventId: (...a) => rsvpsByEventId(...a),
		listMyAttendance: (...a) => listMyAttendance(...a),
		listAttendance: (...a) => listAttendance(...a),
		listAllRsvpsForEvent: (...a) => listAllRsvpsForEvent(...a),
		attendanceByMemberId: (...a) => attendanceByMemberId(...a),
		listWorks: (...a) => listWorks(...a),
		listAllEditions: (...a) => listAllEditions(...a),
		listAllCopies: (...a) => listAllCopies(...a),
		listRepertoireItems: (...a) => listRepertoireItems(...a),
		listScheduleItemsByEventId: (...a) => listScheduleItemsByEventId(...a),
		loadActiveAndArchivedRosters: (...a) => loadActiveAndArchivedRosters(...a),
		canMarkAttendance: (...a) => canMarkAttendance(...a),
		manageRightsFrom: (...a) => manageRightsFrom(...a),
		resolveManageRights: (...a) => resolveManageRights(...a),
	});

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

	let pendingEventIds = $state<Set<string>>(new Set());

	type AgendaFilterBucket = (typeof CANONICAL_EVENT_TYPES)[number];
	type AgendaTypeFilter = 'all' | AgendaFilterBucket;
	const CANONICAL_EVENT_TYPE_SET = new Set<string>(CANONICAL_EVENT_TYPES);
	function agendaFilterBucketOf(eventType: string | undefined): AgendaFilterBucket {
		const type = eventType ?? '';
		if (type !== 'other' && CANONICAL_EVENT_TYPE_SET.has(type)) return type as AgendaFilterBucket;
		return 'other';
	}
	const agendaFilterChips = $derived.by(() => {
		const present = new Set<AgendaFilterBucket>();
		for (const it of ag.agendaItems) present.add(agendaFilterBucketOf(it.eventType));
		for (const it of ag.recentItems) present.add(agendaFilterBucketOf(it.eventType));
		return CANONICAL_EVENT_TYPES.filter((type) => present.has(type));
	});
	const filteredAgendaItems = $derived(
		ag.agendaTypeFilter === 'all'
			? ag.agendaItems
			: ag.agendaItems.filter((it) => agendaFilterBucketOf(it.eventType) === ag.agendaTypeFilter)
	);
	const filteredRecentItems = $derived(
		ag.agendaTypeFilter === 'all'
			? ag.recentItems
			: ag.recentItems.filter((it) => agendaFilterBucketOf(it.eventType) === ag.agendaTypeFilter)
	);
	const CHIP_PRESSED_CLASS = 'font-semibold ring-1 ring-ink';
	function agendaTypeChipClass(type: AgendaFilterBucket): string {
		return ag.agendaTypeFilter === type
			? `${eventTypeBadgeClass(type)} ${CHIP_PRESSED_CLASS}`
			: 'border-ink-4 text-ink-2';
	}
	function selectAgendaTypeFilter(value: AgendaTypeFilter) {
		ag.agendaTypeFilter = ag.agendaTypeFilter === value ? 'all' : value;
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
		if (ag.agendaTypeFilter !== 'all' && !agendaFilterChips.includes(ag.agendaTypeFilter)) {
			ag.agendaTypeFilter = 'all';
		}
	});

	const LOCATION_SUGGESTIONS_ID = 'agenda-location-suggestions';
	const locationSuggestions = $derived.by(() => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const it of ag.recentItems) {
			if (it.location && !seen.has(it.location)) {
				seen.add(it.location);
				out.push(it.location);
			}
		}
		for (const it of ag.agendaItems) {
			if (it.location && !seen.has(it.location)) {
				seen.add(it.location);
				out.push(it.location);
			}
		}
		return out;
	});

	let presenceSeq = 0;
	function refreshPresence(db: string, personId: string, isCurrent: () => boolean): void {
		const seq = ++presenceSeq;
		try {
			getAppByteStore()
				.heldFileIds(db, personId)
				.then((ids) => {
					if (seq !== presenceSeq || !isCurrent()) return;
					ag.heldFileIds = new Set(ids);
				})
				.catch((e) => {
					console.error('agenda: file presence read failed', e);
				});
		} catch (e) {
			console.error('agenda: file presence read failed', e);
		}
	}

	let pickableEditionsVisibleByEventId = $state<Record<string, boolean>>({});
	let pickableWorksVisible = $state<boolean | undefined>(undefined);

	let panelPendingKeys = $state<Set<string>>(new Set());
	let panelManageError = $state(false);
	let panelManageStatus = $state('');
	let panelPickableWorksVisible = $state<boolean | undefined>(undefined);

	const rosterPickerLoading = $derived(ag.rosterReadsInFlight > 0);

	function rosterPickerOptions(
		excludeIds: readonly string[]
	): Array<{ id: string; label: string }> {
		return rosterOrder(ag.rosterRows, ag.rosterSections)
			.filter((row) => !excludeIds.includes(row.personId))
			.map((row) => ({ id: row.personId, label: row.name }));
	}

	function pickerPromptText(optionCount: number, addPrompt: string): string {
		if (optionCount > 0) return addPrompt;
		if (ag.rosterReadFailed) return m.picker_roster_unavailable();
		if (rosterPickerLoading) return m.picker_roster_loading();
		if (ag.rosterRows.length === 0) return m.picker_no_members();
		return m.picker_everyone_added();
	}

	const rsvpQueue = createRsvpChangeQueue({
		setOptimistic(eventId, entry) {
			const next = { ...ag.rsvpByEventId };
			if (entry) next[eventId] = entry;
			else delete next[eventId];
			ag.rsvpByEventId = next;
		},
		setPending(eventId, isPending) {
			pendingEventIds = withItem(pendingEventIds, eventId, isPending);
			if (isPending && ag.failedEventIds.has(eventId)) {
				ag.failedEventIds = without(ag.failedEventIds, eventId);
			}
			if (isPending && ag.savedEventIds.has(eventId)) {
				ag.savedEventIds = without(ag.savedEventIds, eventId);
			}
		},
		reconcile(eventId, entry) {
			const next = { ...ag.rsvpByEventId };
			if (entry) next[eventId] = entry;
			else delete next[eventId];
			ag.rsvpByEventId = next;
			const saved = new Set(ag.savedEventIds);
			saved.add(eventId);
			ag.savedEventIds = saved;
		},
		revert(eventId, before) {
			const next = { ...ag.rsvpByEventId };
			if (before) next[eventId] = before;
			else delete next[eventId];
			ag.rsvpByEventId = next;
			const failed = new Set(ag.failedEventIds);
			failed.add(eventId);
			ag.failedEventIds = failed;
			if (ag.savedEventIds.has(eventId)) {
				ag.savedEventIds = without(ag.savedEventIds, eventId);
			}
		}
	});

	function handleRsvpChange(item: AgendaItem, newStatus: RsvpStatus | null) {
		if (!selected) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const personId = selected.personId;
		const identity = { db: selected.db, personId };

		const current: RsvpEntry | undefined = ag.rsvpByEventId[item.id];
		const existing: MyRsvp | null = current
			? { rsvpId: current.rsvpId, eventId: item.id, status: current.status }
			: null;

		rsvpQueue.request({
			cfg,
			personId,
			memberId: ag.memberId,
			resolveMemberId: async () => {
				const id = await findMyMemberId(cfg, personId);
				if (sameCollectiveIdentity(get(selectedCollectiveIdentityStore), identity)) {
					ag.memberId = id;
					if (!id) ag.membership = 'non-member';
				}
				return id;
			},
			eventId: item.id,
			existing,
			newStatus
		});
	}

	function findWorkRowByFileId(fileId: string): WorkRow | undefined {
		for (const rows of Object.values(ag.worksByEventId)) {
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
		ag.pdfError = false;
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
				ag.pdfError = true;
			});
	}

	type ManageCfg = { db: string; token: string };

	const managePendingMarks = new Map<string, string[]>();

	const repertoireQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			const next = new Set(ag.managePendingKeys);
			for (const mark of [key, ...(managePendingMarks.get(key) ?? [])]) {
				if (pending) next.add(mark);
				else next.delete(mark);
			}
			ag.managePendingKeys = next;
			if (pending) ag.manageError = false;
		},
		reconcile(key) {
			managePendingMarks.delete(key);
			syncPanelRepertoireAfterAgendaWrite();
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) refreshWorksAfterWrite();
		},
		revert(key) {
			managePendingMarks.delete(key);
			ag.manageError = true;
			syncPanelRepertoireAfterAgendaWrite();
			refreshWorksAfterWrite();
		}
	});

	function manageCfg(): ManageCfg | null {
		if (!selected) return null;
		return { db: selected.db, token: getToken() ?? '' };
	}

	function handleAddWork(workId: string) {
		if (isOffline) return;
		const cfg = manageCfg();
		const seasonId = ag.currentSeasonId;
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
		const editionName = ag.libraryEditions.find((e) => e.id === editionId)?.name ?? '';
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
		const row = ag.worksByEventId[eventId]?.find((r) => r.id === itemId);
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
		const repertoireBefore = ag.seasonRepertoire;
		repertoireQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				dropRow(itemId);
				ag.seasonRepertoire = ag.seasonRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				restoreRow(snapshot);
				ag.seasonRepertoire = repertoireBefore;
			}
		});
	}

	const PANEL_ADD_WORK_KEY = '__panel_add_work__';

	function refreshPanelRepertoire(): void {
		const cfg = manageCfg();
		const seasonId = seq.panelRepertoireSeasonId;
		if (!cfg || seasonId === null) return;
		const thisRequest = seq.requestId;
		const thisSwitch = seasonManageSwitchGeneration;
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== seq.requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				ag.panelRepertoire = items;
				ag.panelRepertoireItemsOk = true;
			})
			.catch(() => {
			});
	}

	function syncPanelRepertoireAfterAgendaWrite(): void {
		if (!seasonManageOpen) return;
		if (ag.manageableSeasonId === null || ag.manageableSeasonId !== ag.currentSeasonId) return;
		refreshPanelRepertoire();
	}

	const panelQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			panelPendingKeys = withItem(panelPendingKeys, key, pending);
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
		const seasonId = ag.manageableSeasonId;
		if (!cfg || seasonId === null) return;
		panelQueue.request(PANEL_ADD_WORK_KEY, async () => {
			await createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function handlePanelStatusChange(itemId: string, status: RepertoireStatus) {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = ag.panelRepertoire.find((item) => item.id === itemId)?.status;
		if (before === undefined) return;
		const thisSwitch = seasonManageSwitchGeneration;
		panelQueue.request(itemId, () => updateRepertoireStatus(cfg, itemId, status), {
			apply: () => {
				ag.panelRepertoire = ag.panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status } : item
				);
			},
			rollback: () => {
				if (thisSwitch !== seasonManageSwitchGeneration) return;
				ag.panelRepertoire = ag.panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status: before } : item
				);
			}
		});
	}

	function handlePanelRemoveItem(itemId: string) {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = ag.panelRepertoire;
		const thisSwitch = seasonManageSwitchGeneration;
		panelQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				ag.panelRepertoire = ag.panelRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				if (thisSwitch !== seasonManageSwitchGeneration) return;
				ag.panelRepertoire = before;
			}
		});
	}

	function handleMoveItem(eventId: string, itemId: string, direction: 'up' | 'down') {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const rows = ag.worksByEventId[eventId] ?? [];
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
		for (const edition of ag.libraryEditions) {
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
		for (const rows of Object.values(ag.worksByEventId)) {
			for (const row of rows) {
				if (row.kind !== 'repertoire' || row.workId === '' || out[row.id]) continue;
				const options =
					ag.scopedEditionsByWorkId[row.workId] ??
					(editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
						id: edition.id,
						label: editionLabel(edition)
					}));
				if (options.length > 0) out[row.id] = options;
			}
		}
		return out;
	});

	const editionsResolvedWorkIds = $derived(new Set(Object.keys(ag.scopedEditionsByWorkId)));

	const unknownEditionWorkIds = $derived(
		unresolvedEditionWorkIds(
			Object.values(ag.worksByEventId).flat(),
			editionOptionsByRowId,
			ag.libraryEditionsPartial,
			editionsResolvedWorkIds
		)
	);

	$effect(() => {
		const workIds = unknownEditionWorkIds;
		if (workIds.length === 0) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const thisRequest = seq.requestId;
		for (const workId of workIds) {
			if (seq.scopedEditionWorkIdsRequested.has(workId)) continue;
			seq.scopedEditionWorkIdsRequested.add(workId);
			listEditions(cfg, workId)
				.then((read) => {
					if (thisRequest !== seq.requestId) return;
					if (read.truncated) return;
					ag.scopedEditionsByWorkId = {
						...ag.scopedEditionsByWorkId,
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
		const workById = new Map(ag.libraryWorks.map((work) => [work.id, work]));
		const all: PickerOption[] = ag.libraryEditions.map((edition) => {
			const work = workById.get(edition.workId ?? '');
			const prefix = work === undefined ? '' : workLabel(work);
			return {
				id: edition.id,
				label: prefix === '' ? editionLabel(edition) : `${prefix} — ${editionLabel(edition)}`
			};
		});
		const out: Record<string, PickerOption[]> = {};
		for (const [eventId, rows] of Object.entries(ag.worksByEventId)) {
			const programmed = new Set(
				rows.filter((row) => row.kind === 'program').map((row) => row.editionId)
			);
			out[eventId] = all.filter((option) => !programmed.has(option.id));
		}
		return out;
	});

	$effect(() => {
		if (ag.libraryPickersLoading || ag.worksRowsLoading) return;
		const next: Record<string, boolean> = {};
		for (const [eventId, options] of Object.entries(pickableEditionsByEventId)) {
			next[eventId] = options.length > 0;
		}
		pickableEditionsVisibleByEventId = next;
	});

	const pickableWorksList = $derived(pickableWorks(ag.libraryWorks, ag.seasonRepertoire));

	$effect(() => {
		if (ag.libraryPickersLoading || !ag.libraryPickersLoadSucceeded) return;
		pickableWorksVisible = pickableWorksList.length > 0;
	});

	const panelWorkRowSources = $derived(collectSources(ag.panelWorks, ag.panelEditions, ag.panelCopies));
	const panelWorkRows = $derived(
		buildWorkRows({ source: 'repertoire', items: ag.panelRepertoire }, panelWorkRowSources)
	);
	const panelPickableWorksList = $derived(pickableWorks(ag.panelWorks, ag.panelRepertoire));

	$effect(() => {
		if (ag.panelRepertoireLoading || !ag.panelRepertoireItemsOk || !ag.panelWorksSourcesOk) return;
		panelPickableWorksVisible = panelPickableWorksList.length > 0;
	});

	const worksManage = $derived.by<WorksManage | undefined>(() => {
		const anyEventRight = Object.values(ag.eventManageRights).some((right) => right === 'editor');
		if (ag.seasonManageRights !== 'editor' && !anyEventRight) return undefined;
		return {
			seasonRights: ag.seasonManageRights,
			eventRightsByEventId: ag.eventManageRights,
			pickableWorksList,
			pickableWorksVisible,
			pickableWorksPartial: ag.libraryWorksPartial,
			pickableEditionsPartial: ag.libraryEditionsPartial,
			pickableEditionsByEventId,
			pickableEditionsVisibleByEventId,
			editionOptionsByRowId,
			editionsResolvedWorkIds,
			pendingKeys: ag.managePendingKeys,
			onaddwork: handleAddWork,
			onstatuschange: handleStatusChange,
			onpinedition: handlePinEdition,
			onremoveitem: handleRemoveItem,
			onmoveitem: handleMoveItem,
			onaddprogramitem: handleAddProgramItem
		};
	});

	const attendanceQueue = createAttendanceChangeQueue(attendanceQueueHandlers(ag));

	function handleAttendanceToggle(memberId: string, newStatus: AttendanceStatus | null) {
		if (!selected || !ag.attendanceItem) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const current = ag.attendanceMap[memberId];
		const existing: EventAttendance | null = current
			? { attendanceId: current.attendanceId, memberId, status: current.status }
			: null;
		attendanceQueue.request({ cfg, eventId: ag.attendanceItem.id, memberId, existing, newStatus });
	}

	const attendancePanel = $derived.by<AttendancePanel | undefined>(() => {
		if (!ag.attendanceItem) return undefined;
		return {
			item: ag.attendanceItem,
			members: ag.attendanceRoster,
			attendanceByMemberId: ag.attendanceMap,
			rsvpByMemberId: ag.attendanceRsvpMap,
			loading: ag.attendanceLoading,
			error: ag.attendanceError,
			pendingMemberIds: ag.attendancePendingMemberIds,
			failedMemberIds: ag.attendanceFailedMemberIds,
			savedMemberIds: ag.attendanceSavedMemberIds,
			membersPartial: ag.rosterPartial,
			ontoggle: handleAttendanceToggle,
			onclose: closeAttendancePanel
		};
	});

	const myAttendanceByEventId = $derived.by(() => {
		const map: Record<string, AttendanceStatus> = {};
		for (const a of ag.myAttendance) map[a.eventId] = a.status;
		return map;
	});
	const mySeasonAttendance = $derived((() => {
		const recentIds = new Set(ag.recentItems.map((i) => i.id));
		return ag.myAttendance.filter((a) => recentIds.has(a.eventId));
	})());
	const mySeasonRate = $derived(deriveAttendanceRate(mySeasonAttendance, ag.recentItems.length));

	let seasonCreateOpen = $state(false);
	let seasonCreateSubmitting = $state(false);
	let seasonCreateStatus = $state('');

	const showSeasonCreate = $derived(ag.seasonCreateRights === 'editor');

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

	let seasonManageOpen = $state(false);
	let seasonManageSwitchGeneration = 0;
	let seasonManagePanelEl = $state<HTMLDivElement | null>(null);
	let seasonManagePanel = $state<SeasonManagePanel>();

	function resetSeasonManage(): void {
		seasonManageOpen = false;
		seasonManageSwitchGeneration += 1;
		seasonManagePanel?.resetPanelState();
		ag.panelRepertoire = [];
		seq.panelRepertoireSeasonId = null;
		ag.panelWorks = [];
		ag.panelWorksPartial = false;
		ag.panelEditions = [];
		ag.panelCopies = [];
		panelPendingKeys = new Set();
		ag.panelRepertoireError = false;
		panelManageError = false;
		panelManageStatus = '';
		ag.panelRepertoireLoading = false;
		ag.panelRepertoireItemsOk = false;
		ag.panelWorksSourcesOk = false;
		panelPickableWorksVisible = undefined;
	}

	function openSeasonManagePanel(): void {
		seasonManagePanel?.openSeasonManagePanel();
	}

	function closeSeasonManagePanel(): void {
		seasonManagePanel?.closeSeasonManagePanel();
	}

	function refreshSeasonManageLists(cfg: ManageCfg, seasonId: string): void {
		seasonManagePanel?.refreshSeasonManageLists(cfg, seasonId);
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
		if (ag.manageableSeasonId === null) return;
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
		if (ag.manageableSeasonId !== entry.form.seasonId) {
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
		ag.membership === 'member' && $completionGateStore !== 'complete' ? 'loading' : ag.membership
	);
	const gatedCanRsvp = $derived(
		ag.rsvpRights === 'not-editor'
			? 'not-editor'
			: $completionGateStore !== 'complete'
				? 'loading'
				: ag.rsvpRights
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
					{#if ag.sessionExpired}
						<SessionExpiredNotice centered />
					{:else if ag.agendaError}
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
						{#if ag.rsvpPartial}
							<p
								data-testid="rsvp-partial-notice"
								role="status"
								class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
							>
								{m.rsvp_partial_notice()}
							</p>
						{/if}
						{#if ag.attendancePartial}
							<p
								data-testid="attendance-partial-notice"
								role="status"
								class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
							>
								{m.attendance_partial_notice()}
							</p>
						{/if}
						{#if !ag.agendaLoading && ag.seasons.length === 0 && ag.seasonCreateRights === 'editor' && !seasonCreateOpen}
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
						<SeasonManagePanel
							bind:this={seasonManagePanel}
							{selected}
							seasons={ag.seasons}
							bind:manageableSeasonId={ag.manageableSeasonId}
							bind:manageableSeasonRights={ag.manageableSeasonRights}
							manageableSeasonRightsById={ag.manageableSeasonRightsById}
							bind:seasonManageOpen
							bind:seasonManagePanelEl
							bind:seriesCreateOpen
							bind:seriesCreateSubmitting
							bind:seriesCreateResumeByDb
							bind:seriesRunDb
							{seriesRunUnfinished}
							{seasonCardCollapseDisabled}
							{createEntryPointsBlocked}
							{eventCreateOpen}
							rosterRows={ag.rosterRows}
							rosterPartial={ag.rosterPartial}
							sectionsReadFailed={ag.sectionsReadFailed}
							locationSuggestionsId={LOCATION_SUGGESTIONS_ID}
							heldFileIds={ag.heldFileIds}
							{panelWorkRows}
							{panelPickableWorksList}
							{panelPickableWorksVisible}
							panelWorksPartial={ag.panelWorksPartial}
							{panelPendingKeys}
							panelAddWorkKey={PANEL_ADD_WORK_KEY}
							panelRepertoireError={ag.panelRepertoireError}
							{panelManageError}
							{panelManageStatus}
							currentRequestId={() => seq.requestId}
							switchGeneration={() => seasonManageSwitchGeneration}
							{getRoster}
							{getSections}
							{rosterPickerOptions}
							{pickerPromptText}
							{loadForSelected}
							{loadPanelRepertoire}
							{resetSeasonManage}
							{openEventCreateForm}
							{openSeriesCreateForm}
							{handlePdfClick}
							{handlePanelAddWork}
							{handlePanelStatusChange}
							{handlePanelRemoveItem}
							{isOffline}
							writeUnavailableText={m.write_unavailable_no_signal()}
							{listEventSeriesForSeason}
							{updateSeasonField}
							{addSeasonConductor}
							{apiRemoveSeasonConductor}
							{apiDeleteEventSeries}
							{apiCountSeriesOccurrences}
							{apiCountSeasonScope}
							{apiDeleteSeason}
							{canDeleteSeries}
						/>
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
								rosterPartial={ag.rosterPartial}
								sectionsReadFailed={ag.sectionsReadFailed}
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
								manageableSeasonId={ag.manageableSeasonId}
								seasons={ag.seasons}
								agendaTypeFilter={ag.agendaTypeFilter}
								{agendaFilterBucketOf}
								rosterPartial={ag.rosterPartial}
								sectionsReadFailed={ag.sectionsReadFailed}
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
										aria-pressed={ag.agendaTypeFilter === 'all' ? 'true' : 'false'}
										class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {ag.agendaTypeFilter ===
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
											aria-pressed={ag.agendaTypeFilter === type ? 'true' : 'false'}
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
								loading={ag.agendaLoading}
								rsvpByEventId={ag.rsvpByEventId}
								membership={gatedMembership}
								canRsvp={gatedCanRsvp}
								{pendingEventIds}
								failedEventIds={ag.failedEventIds}
								savedEventIds={ag.savedEventIds}
								recentItems={filteredRecentItems}
								conductorEventIds={ag.attendanceEventIds}
								{myAttendanceByEventId}
								worksByEventId={ag.worksByEventId}
								{worksManage}
								heldFileIds={ag.heldFileIds}
								scheduleItemsByEventId={ag.scheduleByEventId}
								{attendancePanel}
								{justCreatedEventId}
								emptyState={ag.agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
								recentEmptyState={ag.agendaTypeFilter !== 'all' && ag.recentItems.length > 0
									? agendaRecentFilterEmptyState
									: undefined}
								onpdfclick={handlePdfClick}
								onrsvpchange={handleRsvpChange}
								ontakeattendance={openAttendancePanel}
							>
								{#snippet seasonSummary()}
									<SeasonSummary
										myRate={mySeasonRate}
										canExpand={ag.seasonManageRights === 'editor'}
										expanded={ag.seasonSummaryExpanded}
										memberRates={ag.seasonMemberRates}
										membersPartial={ag.seasonRatesPartial}
										loading={ag.seasonRatesLoading}
										error={ag.seasonRatesError}
										onexpand={handleExpandSeasonSummary}
									/>
								{/snippet}
							</AgendaList>
							{/key}
						{:else}
							<AgendaMonthView
								items={filteredAgendaItems}
								loading={ag.agendaLoading}
								{justCreatedEventId}
								emptyState={ag.agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
							/>
						{/if}
						{#if ag.pdfError}
							<p data-testid="repertoire-pdf-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_pdf_error()}
							</p>
						{/if}
						{#if ag.manageError}
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
