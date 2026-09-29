<script lang="ts">
	// Same load-on-effect/requestId-guard shape as roster and the agenda: a stale
	// load can never clobber a newer route-param combination. No getToken()-missing
	// gate here: the token threads straight through to Entu, the real authority.
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { getToken } from '$lib/auth/storage';
	import { get } from 'svelte/store';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		listEventLocations,
		EventDetailLoadError,
		type EventDetail,
		type EventInheritedField
	} from '$lib/events/eventDetail';
	// Two load/refresh pairs: loadEventPageDetail/loadEventPageWorkRows store
	// AND serve the mounted screen; the refresh* twins only store, for the
	// post-write re-read — same cache contract as the agenda's.
	import {
		loadEventPageDetail,
		refreshEventPageDetail,
		loadEventPageWorkRows,
		refreshEventPageWorkRows
	} from '$lib/events/eventPageData';
	import { resetServedFromCache, servedFromCache } from '$lib/entu/readCache';
	import { reassignEventSeries, unassignEventSeries } from '$lib/events/eventSeriesActions';
	import { convertEventToSeries, type ConvertEventToSeriesInput } from '$lib/events/eventConvert';
	import { createEvent } from '$lib/entity/entityCreate';
	import { generateIntervalDates } from '$lib/events/recurrence';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		tallinnLocalToUtcIso
	} from '$lib/preferences/timeFormat';
	import { eventTypeLabel, CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	// deleteEvent is imported directly (not re-exported elsewhere) so the
	// event-delete spec's partial vi.mock('$lib/seasons/seasonManage', ...),
	// which replaces only deleteEvent, still resolves the rest for real.
	import {
		deleteEvent,
		listSeriesOptionsForSeason,
		getSeriesDefaults,
		type SeriesOption,
		type SeriesDefaults
	} from '$lib/seasons/seasonManage';
	// The error discriminators live in their OWN module, not in seasonManage —
	// see deleteErrors.ts's header: importing them from seasonManage would make
	// them `undefined` under the spec's wholesale-replacement mock shape.
	import { isDeleteForbidden, isEventCascadePartial } from '$lib/seasons/deleteErrors';
	import {
		findMyMemberId,
		findMyRsvpForEvent,
		type MyRsvp,
		type RsvpStatus
	} from '$lib/rsvp/rsvpData';
	import { createRsvpChangeQueue, type RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
	import {
		listAllRsvpsForEvent,
		listAttendance,
		attendanceByMemberId,
		type AttendanceStatus,
		type EventAttendance
	} from '$lib/attendance/attendanceData';
	import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
	import { loadRoster, listActiveMembers, type RosterRow } from '$lib/roster/rosterData';
	import { loadRosterIncludingArchived } from '$lib/roster/memberLifecycle';
	import type { AgendaItem } from '$lib/agenda/types';
	import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
	import {
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
		type Edition,
		type Work
	} from '$lib/library/libraryData';
	import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
	import type { ManageRightsState, PickerOption, RepertoireStatus, WorkRow } from '$lib/repertoire/types';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { workLabel } from '$lib/repertoire/workLabel';
	import RsvpControl from '$lib/components/agenda/RsvpControl.svelte';
	import RsvpNonMemberHint from '$lib/components/agenda/RsvpNonMemberHint.svelte';
	import RepertoireElement, {
		ADD_PROGRAMME_KEY,
		ADD_WORK_KEY
	} from '$lib/components/agenda/RepertoireElement.svelte';
	import AttendanceSurface from '$lib/components/attendance/AttendanceSurface.svelte';
	import AttendanceBadge from '$lib/components/attendance/AttendanceBadge.svelte';
	import TakeAttendanceButton from '$lib/components/attendance/TakeAttendanceButton.svelte';
	import { updateEventField, type EditableEventField } from '$lib/events/eventFieldEdit';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import {
		listScheduleItems,
		createScheduleItem,
		updateScheduleItemField,
		removeScheduleItem,
		compareScheduleItems,
		type ScheduleItem
	} from '$lib/schedule/scheduleData';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import { writesAvailable } from '$lib/net/online';

	const selected = $derived($selectedCollectiveStore);
	const eventId = $derived(page.params.id ?? '');
	const isOffline = $derived(!$writesAvailable);

	type Status =
		| 'loading'
		| 'no-collective'
		| 'load-error'
		| 'not-available'
		| 'session-expired'
		| 'ready';

	let generation = 0;

	const writeGenerations = new Map<string, number>();

	function isCurrentWrite(evId: string): boolean {
		return (
			detail !== null && evId === detail.id && writeGenerations.get(evId) === generation
		);
	}

	let status = $state<Status>('loading');
	let detail = $state<EventDetail | null>(null);

	let memberId = $state<string | null>(null);
	let membership = $state<'loading' | 'member' | 'non-member'>('loading');
	let rsvpRights = $state<'loading' | 'editor' | 'not-editor'>('loading');
	let myRsvp = $state<RsvpEntry | null>(null);
	let rsvpPending = $state(false);
	let rsvpFailed = $state(false);
	let rsvpSaved = $state(false);

	let tally = $state<{
		going: number;
		not_going: number;
		maybe: number;
		late: number;
		not_responded: number | null;
	} | null>(null);
	let tallyError = $state(false);

	const RSVP_TALLY_STATUS_ORDER = ['going', 'not_going', 'maybe', 'late', 'not_responded'] as const;
	type RsvpTallyStatus = (typeof RSVP_TALLY_STATUS_ORDER)[number];

	let tallyMemberIdsByStatus = $state<Record<
		'going' | 'not_going' | 'maybe' | 'late',
		string[]
	> | null>(null);
	let tallyNotRespondedMemberIds = $state<string[] | null>(null);
	let tallyRawRowCount = $state(0);

	let tallyCardOpen = $state(false);
	let tallyCardNames = $state<Record<string, string> | null>(null);
	let tallyCardNamesError = $state(false);
	let tallyCardNamesPartial = $state(false);
	let tallyMembersPartial = $state(false);

	let deleteArmed = $state(false);
	let deletePending = $state(false);
	let deleteError = $state<{
		reason: 'forbidden' | 'partial' | 'generic';
		deleted?: number;
		total?: number;
	} | null>(null);

	let seriesOptions = $state<SeriesOption[]>([]);
	let seriesOptionsLoaded = $state(false);
	let seriesArmedTarget = $state<{ id: string } | null>(null);
	let seriesPreviewDefaults = $state<SeriesDefaults | null>(null);
	let seriesPending = $state(false);
	let seriesError = $state<string | null>(null);
	let seriesStatus = $state('');

	let seasonId = $state<string | null>(null);
	let seasonManageRights = $state<ManageRightsState>('not-editor');
	let workRows = $state<WorkRow[]>([]);
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
					console.error('event detail: file presence read failed', e);
				});
		} catch (e) {
			console.error('event detail: file presence read failed', e);
		}
	}

	let libraryWorks = $state<Work[]>([]);
	let libraryEditions = $state<Edition[]>([]);
	let libraryWorksPartial = $state(false);
	let libraryEditionsPartial = $state(false);
	let scopedEditionsByWorkId = $state<Record<string, PickerOption[]>>({});
	let scopedEditionWorkIdsRequested = new Set<string>();
	let seasonRepertoire = $state<RepertoireItem[]>([]);
	let libraryPickersLoading = $state(false);
	let libraryPickersLoadSucceeded = $state(false);
	let pickableWorksVisible = $state<boolean | undefined>(undefined);
	let managePendingKeys = $state<Set<string>>(new Set());
	let manageError = $state(false);
	let manageStatus = $state('');

	let scheduleRows = $state<ScheduleItem[]>([]);
	let scheduleLoaded = $state(false);
	let scheduleAddOpen = $state(false);
	let scheduleAddName = $state('');
	let scheduleAddDate = $state('');
	let scheduleAddTime = $state('');
	let scheduleEditingId = $state<string | null>(null);
	let scheduleEditName = $state('');
	let scheduleEditDate = $state('');
	let scheduleEditTime = $state('');
	let scheduleRemoveArmedId = $state<string | null>(null);
	let scheduleWritePending = $state<Record<string, boolean>>({});
	let scheduleErrors = $state<Record<string, (() => string) | null>>({});
	let scheduleStatus = $state('');
	let scheduleAddErrorField = $state<'name' | 'datetime' | null>(null);

	let attendanceMap = $state<Record<string, { attendanceId: string; status: AttendanceStatus }>>(
		{}
	);
	let attendancePanelOpen = $state(false);
	let attendancePanelLoading = $state(false);
	let attendancePanelError = $state(false);
	let attendanceRoster = $state<RosterRow[]>([]);
	let attendanceRosterPartial = $state(false);
	let attendanceRsvpMap = $state<Record<string, { rsvpId: string; status: string }>>({});
	let attendancePendingMemberIds = $state<Set<string>>(new Set());
	let attendanceFailedMemberIds = $state<Set<string>>(new Set());
	let attendanceSavedMemberIds = $state<Set<string>>(new Set());

	const isEditor = $derived(
		detail !== null &&
			selected !== null &&
			manageRightsFrom(detail.ownerIds, detail.editorIds, selected.personId) === 'editor'
	);

	const isOwnerTier = $derived(
		detail !== null && selected !== null && detail.ownerIds.includes(selected.personId)
	);

	const seriesUnassignGated = $derived(
		detail !== null && !isOwnerTier && detail.seriesId !== null
	);

	const canConvert = $derived(
		detail !== null && isEditor && detail.seriesId === null && detail.seasonId !== null
	);

	let eventConvertOpen = $state(false);
	let eventConvertIntervalDays = $state('7');
	let eventConvertDuration = $state('');
	let eventConvertEndDate = $state('');
	let eventConvertSubmitting = $state(false);
	let eventConvertError = $state<string | null>(null);
	type EventConvertErrorField = 'interval' | 'duration' | 'end' | null;
	let eventConvertErrorField = $state<EventConvertErrorField>(null);
	let eventConvertProgress = $state<{ current: number; total: number } | null>(null);
	type EventConvertResume = {
		seriesId: string;
		dbEntityId: string;
		eventType: string;
		remaining: string[];
		total: number;
	};
	let eventConvertResume = $state<EventConvertResume | null>(null);
	let eventConvertFormEl = $state<HTMLDivElement | null>(null);

	function resetConvertState(): void {
		eventConvertOpen = false;
		eventConvertIntervalDays = '7';
		eventConvertDuration = '';
		eventConvertEndDate = '';
		eventConvertError = null;
		eventConvertErrorField = null;
		eventConvertProgress = null;
		eventConvertResume = null;
	}

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const id = eventId;
		const g = ++generation;
		if (!current || !id) {
			status = 'no-collective';
			detail = null;
			resetRsvpState();
			resetComposeState();
			resetDeleteState();
			resetSeriesState();
			resetConvertState();
			return;
		}
		status = 'loading';
		detail = null;
		resetRsvpState();
		resetComposeState();
		resetDeleteState();
		resetConvertState();
		resetServedFromCache();
		try {
			const cfg = { db: current.db, token: getToken() ?? '' };
			const loaded = await loadEventPageDetail(cfg, id);
			if (g !== generation) return;
			detail = loaded;
			status = 'ready';
			loadRsvpControl(cfg, current.personId, id, g);
			loadTally(cfg, id, g, isPastDetail(loaded));
			loadComposeSurfaces(cfg, loaded, current.personId, g);
		} catch (e) {
			if (g !== generation) return;
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				detail = null;
				return;
			}
			console.error('event detail: load failed', e);
			status = e instanceof EventDetailLoadError && e.unavailable ? 'not-available' : 'load-error';
			detail = null;
		}
	}

	function resetRsvpState(): void {
		memberId = null;
		membership = 'loading';
		rsvpRights = 'loading';
		myRsvp = null;
		rsvpPending = false;
		rsvpFailed = false;
		rsvpSaved = false;
		tally = null;
		tallyError = false;
		tallyMemberIdsByStatus = null;
		tallyNotRespondedMemberIds = null;
		tallyRawRowCount = 0;
		tallyCardOpen = false;
		tallyCardNames = null;
		tallyCardNamesError = false;
		tallyCardNamesPartial = false;
		tallyMembersPartial = false;
	}

	function resetDeleteState(): void {
		deleteArmed = false;
		deletePending = false;
		deleteError = null;
	}

	function resetSeriesState(): void {
		seriesOptions = [];
		seriesOptionsLoaded = false;
		seriesArmedTarget = null;
		seriesPreviewDefaults = null;
		seriesPending = false;
		seriesError = null;
		seriesStatus = '';
	}

	function resetComposeState(): void {
		seasonId = null;
		seasonManageRights = 'not-editor';
		workRows = [];
		heldFileIds = null;
		libraryWorks = [];
		libraryEditions = [];
		libraryWorksPartial = false;
		libraryEditionsPartial = false;
		scopedEditionsByWorkId = {};
		scopedEditionWorkIdsRequested = new Set<string>();
		seasonRepertoire = [];
		libraryPickersLoading = true;
		libraryPickersLoadSucceeded = false;
		managePendingKeys = new Set();
		manageError = false;
		manageStatus = '';
		editStatus = '';
		scheduleRows = [];
		scheduleLoaded = false;
		scheduleAddOpen = false;
		scheduleAddName = '';
		scheduleAddDate = '';
		scheduleAddTime = '';
		scheduleEditingId = null;
		scheduleEditName = '';
		scheduleEditDate = '';
		scheduleEditTime = '';
		scheduleRemoveArmedId = null;
		scheduleWritePending = {};
		scheduleErrors = {};
		scheduleStatus = '';
		scheduleAddErrorField = null;
		attendanceMap = {};
		attendancePanelOpen = false;
		attendancePanelLoading = false;
		attendancePanelError = false;
		attendanceRoster = [];
		attendanceRosterPartial = false;
		attendanceRsvpMap = {};
		attendancePendingMemberIds = new Set();
		attendanceFailedMemberIds = new Set();
		attendanceSavedMemberIds = new Set();
	}

	function loadRsvpControl(cfg: EntuCfg, personId: string, evId: string, g: number): void {
		resolveManageRights(cfg, personId, personId).then((state) => {
			if (g !== generation) return;
			rsvpRights = state === 'editor' ? 'editor' : 'not-editor';
		});

		findMyMemberId(cfg, personId)
			.then((id) => {
				if (g !== generation) return;
				memberId = id;
				membership = id ? 'member' : 'non-member';
			})
			.catch(() => {
				if (g !== generation) return;
				memberId = null;
				membership = 'loading';
			});

		findMyRsvpForEvent(cfg, personId, evId)
			.then((entry) => {
				if (g !== generation) return;
				myRsvp = entry;
			})
			.catch(() => {
				if (g !== generation) return;
				myRsvp = null;
			});
	}

	function loadTally(cfg: EntuCfg, evId: string, g: number, past: boolean): void {
		Promise.all([
			listAllRsvpsForEvent(cfg, evId),
			past ? Promise.resolve<null>(null) : listActiveMembers(cfg)
		])
			.then(([rows, activeMembersRead]) => {
				if (g !== generation) return;
				const activeMembers = activeMembersRead?.items;
				tallyMembersPartial = activeMembersRead?.truncated ?? false;
				const scoped = activeMembers
					? rows.filter((r) => activeMembers.some((am) => am.memberId === r.memberId))
					: rows;
				const answeredMemberIds = new Set(scoped.map((r) => r.memberId));
				const notResponded = activeMembers
					? activeMembers.filter((am) => !answeredMemberIds.has(am.memberId)).map((am) => am.memberId)
					: null;
				tallyError = false;
				tallyRawRowCount = rows.length;
				tallyMemberIdsByStatus = {
					going: scoped.filter((r) => r.status === 'going').map((r) => r.memberId),
					not_going: scoped.filter((r) => r.status === 'not_going').map((r) => r.memberId),
					maybe: scoped.filter((r) => r.status === 'maybe').map((r) => r.memberId),
					late: scoped.filter((r) => r.status === 'late').map((r) => r.memberId)
				};
				tallyNotRespondedMemberIds = notResponded;
				tally = {
					going: tallyMemberIdsByStatus.going.length,
					not_going: tallyMemberIdsByStatus.not_going.length,
					maybe: tallyMemberIdsByStatus.maybe.length,
					late: tallyMemberIdsByStatus.late.length,
					not_responded: notResponded?.length ?? null
				};
			})
			.catch((e) => {
				if (g !== generation) return;
				console.error('event detail: tally load failed', e);
				tally = null;
				tallyError = true;
				tallyMemberIdsByStatus = null;
				tallyNotRespondedMemberIds = null;
				tallyRawRowCount = 0;
				tallyCardOpen = false;
				tallyCardNames = null;
				tallyCardNamesError = false;
				tallyCardNamesPartial = false;
				tallyMembersPartial = false;
			});
	}

	function retryTally(): void {
		const current = selected;
		const loaded = detail;
		if (!current || !loaded) return;
		tallyError = false;
		loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation, isPastDetail(loaded));
	}

	const showTallyCardToggle = $derived(
		tally !== null &&
			!tallyError &&
			(tallyRawRowCount > 0 || (tallyNotRespondedMemberIds?.length ?? 0) > 0)
	);

	const tallyCardGroups = $derived.by<
		{ status: RsvpTallyStatus; count: number; memberIds: string[] }[] | null
	>(() => {
		if (!tally || !tallyMemberIdsByStatus) return null;
		const groups: { status: RsvpTallyStatus; count: number; memberIds: string[] }[] = [
			{ status: 'going', count: tally.going, memberIds: tallyMemberIdsByStatus.going },
			{ status: 'not_going', count: tally.not_going, memberIds: tallyMemberIdsByStatus.not_going },
			{ status: 'maybe', count: tally.maybe, memberIds: tallyMemberIdsByStatus.maybe },
			{ status: 'late', count: tally.late, memberIds: tallyMemberIdsByStatus.late }
		];
		if (tallyNotRespondedMemberIds !== null) {
			groups.push({
				status: 'not_responded',
				count: tallyNotRespondedMemberIds.length,
				memberIds: tallyNotRespondedMemberIds
			});
		}
		return groups;
	});

	function rsvpTallyStatusLabel(status: RsvpTallyStatus): string {
		switch (status) {
			case 'going':
				return m.rsvp_status_going();
			case 'not_going':
				return m.rsvp_status_not_going();
			case 'maybe':
				return m.rsvp_status_maybe();
			case 'late':
				return m.rsvp_status_late();
			case 'not_responded':
				return m.rsvp_status_not_responded();
		}
	}

	function loadTallyCardNames(): void {
		const current = selected;
		const loaded = detail;
		if (!current || !loaded) return;
		const g = generation;
		const evId = loaded.id;
		const cfg = { db: current.db, token: getToken() ?? '' };
		tallyCardNamesError = false;
		const read = isPastDetail(loaded) ? loadRosterIncludingArchived(cfg) : loadRoster(cfg);
		read
			.then((rosterRead) => {
				if (g !== generation || detail?.id !== evId) return;
				const names: Record<string, string> = {};
				for (const row of rosterRead.items) names[row.memberId] = row.name;
				tallyCardNames = names;
				tallyCardNamesPartial = rosterRead.truncated;
			})
			.catch((e) => {
				console.error('event detail: tally card roster load failed', e);
				if (g !== generation || detail?.id !== evId) return;
				tallyCardNames = null;
				tallyCardNamesPartial = false;
				tallyCardNamesError = true;
			});
	}

	function retryTallyCardNames(): void {
		loadTallyCardNames();
	}

	function toggleTallyCard(): void {
		if (tallyCardOpen) {
			tallyCardOpen = false;
			return;
		}
		tallyCardOpen = true;
		loadTallyCardNames();
	}



	async function armDelete(): Promise<void> {
		if (isOffline) return;
		deleteError = null;
		deleteArmed = true;
		await tick();
		document.querySelector<HTMLElement>('[data-testid="event-detail-delete-confirm"]')?.focus();
	}

	async function cancelDelete(): Promise<void> {
		deleteArmed = false;
		deleteError = null;
		await tick();
		document.querySelector<HTMLElement>('[data-testid="event-detail-delete"]')?.focus();
	}

	async function confirmDelete(): Promise<void> {
		if (!selected || !detail || deletePending) return;
		if (isOffline) return;
		deletePending = true;
		deleteError = null;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		try {
			await deleteEvent(cfg, evId);
			goto('/');
		} catch (e) {
			console.error('event detail: delete failed', evId, e);
			if (isDeleteForbidden(e)) {
				deleteError = { reason: 'forbidden' };
			} else if (isEventCascadePartial(e)) {
				const partial = e as { deletedCount?: number; totalCount?: number };
				deleteError = {
					reason: 'partial',
					deleted: partial.deletedCount ?? 0,
					total: partial.totalCount ?? 0
				};
			} else {
				deleteError = { reason: 'generic' };
			}
			deletePending = false;
		}
	}

	function deleteErrorText(failure: NonNullable<typeof deleteError>): string {
		switch (failure.reason) {
			case 'forbidden':
				return m.event_detail_delete_forbidden();
			case 'partial':
				return m.event_detail_delete_partial({
					deleted: failure.deleted ?? 0,
					total: failure.total ?? 0
				});
			default:
				return m.event_detail_delete_error();
		}
	}

	const rsvpQueue = createRsvpChangeQueue({
		setOptimistic(evId, entry) {
			if (!isCurrentWrite(evId)) return;
			myRsvp = entry;
		},
		setPending(evId, isPending) {
			if (isPending) writeGenerations.set(evId, generation);
			if (!isCurrentWrite(evId)) return;
			rsvpPending = isPending;
			if (isPending) rsvpFailed = false;
			if (isPending) rsvpSaved = false;
		},
		reconcile(evId, entry) {
			const stillCurrent = isCurrentWrite(evId);
			writeGenerations.delete(evId);
			if (!stillCurrent) return;
			myRsvp = entry;
			rsvpSaved = true;
			const current = selected;
			const loaded = detail;
			if (current && loaded) {
				loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation, isPastDetail(loaded));
			}
		},
		revert(evId, before) {
			const stillCurrent = isCurrentWrite(evId);
			writeGenerations.delete(evId);
			if (!stillCurrent) return;
			myRsvp = before;
			rsvpFailed = true;
			rsvpSaved = false;
		}
	});

	function handleRsvpChange(newStatus: RsvpStatus | null): void {
		if (!selected || !detail) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const personId = selected.personId;
		const g = generation;
		const existing: MyRsvp | null = myRsvp
			? { rsvpId: myRsvp.rsvpId, eventId: detail.id, status: myRsvp.status }
			: null;
		rsvpQueue.request({
			cfg,
			personId,
			memberId,
			resolveMemberId: async () => {
				const id = await findMyMemberId(cfg, personId);
				if (g === generation) {
					memberId = id;
					if (!id) membership = 'non-member';
				}
				return id;
			},
			eventId: detail.id,
			existing,
			newStatus
		});
	}

	$effect(() => {
		void selected;
		void eventId;
		loadForSelected().catch((e) => {
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('event detail: load failed', e);
			status = 'load-error';
		});
	});

	const TZ = 'Europe/Tallinn';
	const dateFmt = $derived(
		new Intl.DateTimeFormat(getLocale(), {
			timeZone: TZ,
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);

	function parseStartAt(raw: string): Date | null {
		if (raw === '') return null;
		const parsed = new Date(raw);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	const startAt = $derived.by(() => parseStartAt(detail?.startDatetime ?? ''));

	const isPast = $derived(startAt !== null && startAt.getTime() < Date.now());
	function isPastDetail(d: EventDetail): boolean {
		const start = parseStartAt(d.startDatetime);
		return start !== null && start.getTime() < Date.now();
	}

	function timeRange(start: Date, minutes: number): string {
		const mode = $timeFormatStore;
		const startStr = formatTime(tallinnHHMM(start), mode);
		if (minutes <= 0) return startStr;
		const endStr = formatTime(tallinnHHMM(new Date(start.getTime() + minutes * 60_000)), mode);
		return `${startStr}–${endStr}`;
	}

	function scheduleRowTime(iso: string): string {
		return formatTime(tallinnHHMM(new Date(iso)), $timeFormatStore);
	}



	type ComposeCfg = { db: string; token: string };

	const eventManageRights = $derived<ManageRightsState>(isEditor ? 'editor' : 'not-editor');

	function loadComposeSurfaces(cfg: ComposeCfg, loaded: EventDetail, personId: string, g: number): void {
		const sid = loaded.seasonId;
		seasonId = sid;
		const seasonRights: ManageRightsState =
			sid === null
				? 'not-editor'
				: manageRightsFrom(loaded.seasonOwnerIds, loaded.seasonEditorIds, personId);
		seasonManageRights = seasonRights;
		const eventEditor = manageRightsFrom(loaded.ownerIds, loaded.editorIds, personId) === 'editor';

		if (eventEditor && sid !== null) loadSeriesOptions(cfg, sid, g);

		loadEventPageWorkRows(cfg, [loaded.id], sid, fetch, {
			includeInactive: seasonRights === 'editor'
		})
			.then((byEvent) => {
				if (g !== generation) return;
				workRows = byEvent[loaded.id] ?? [];
			})
			.catch(() => {
				if (g !== generation) return;
				workRows = [];
			});

		refreshPresence(cfg.db, personId, () => g === generation);

		if (seasonRights === 'editor' || eventEditor) loadManagePickers(cfg, sid, g);

		listScheduleItems(cfg, loaded.id, fetch)
			.then((rows) => {
				if (g !== generation) return;
				scheduleRows = rows;
				scheduleLoaded = true;
			})
			.catch((e) => {
				console.error('event detail: schedule load failed', e);
				if (g !== generation) return;
				scheduleRows = [];
				scheduleLoaded = true;
			});

		if (isPastDetail(loaded)) {
			listAttendance(cfg, loaded.id)
				.then((records) => {
					if (g !== generation) return;
					attendanceMap = attendanceByMemberId(records);
				})
				.catch((e) => {
					console.error('event detail: attendance load failed', e);
					if (g !== generation) return;
					attendanceMap = {};
				});
		}
	}

	function loadSeriesOptions(cfg: ComposeCfg, sid: string, g: number): void {
		listSeriesOptionsForSeason(cfg, sid, fetch)
			.then((list) => {
				if (g !== generation) return;
				seriesOptions = list;
				seriesOptionsLoaded = true;
			})
			.catch((e) => {
				console.error('event detail: series options load failed', e);
				if (g !== generation) return;
				seriesOptions = [];
				seriesOptionsLoaded = true;
			});
	}

	function seriesFieldLabel(field: EventInheritedField): string {
		switch (field) {
			case 'name':
				return m.event_detail_series_field_name();
			case 'durationMinutes':
				return m.event_detail_series_field_duration();
			case 'location':
				return m.event_detail_series_field_location();
			case 'description':
				return m.event_detail_series_field_description();
		}
	}

	function seriesFieldBecomes(field: EventInheritedField, defaults: SeriesDefaults): string {
		switch (field) {
			case 'name':
				return defaults.name;
			case 'durationMinutes':
				return defaults.durationMinutes !== null ? String(defaults.durationMinutes) : '';
			case 'location':
				return defaults.defaultLocation;
			case 'description':
				return defaults.defaultDescription;
		}
	}

	async function onSeriesSelectChange(e: Event): Promise<void> {
		const selectEl = e.currentTarget as HTMLSelectElement;
		const newId = selectEl.value;
		if (!detail || !selected) return;
		if (isOffline) return;
		const previousId = detail.seriesId ?? '';
		seriesError = null;
		seriesStatus = '';
		if (newId === previousId) {
			seriesArmedTarget = null;
			seriesPreviewDefaults = null;
			return;
		}
		if (detail.inheritedFields.length === 0) {
			await commitSeriesChange(newId, selectEl);
			return;
		}
		seriesArmedTarget = { id: newId };
		seriesPreviewDefaults = null;
		if (newId === '') return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		try {
			const defaults = await getSeriesDefaults(cfg, newId);
			if (seriesArmedTarget?.id !== newId) return;
			seriesPreviewDefaults = defaults;
		} catch (err) {
			console.error('event detail: series preview load failed', err);
			if (seriesArmedTarget?.id !== newId) return;
			seriesArmedTarget = null;
			selectEl.value = previousId;
			seriesError = m.event_detail_series_save_error();
		}
	}

	async function cancelSeriesChange(): Promise<void> {
		if (!detail) return;
		seriesArmedTarget = null;
		seriesPreviewDefaults = null;
		seriesError = null;
		await tick();
		const selectEl = document.querySelector<HTMLSelectElement>('[data-testid="event-series-select"]');
		if (selectEl) selectEl.value = detail.seriesId ?? '';
		selectEl?.focus();
	}

	async function confirmSeriesChange(): Promise<void> {
		if (!seriesArmedTarget || seriesPending) return;
		const selectEl = document.querySelector<HTMLSelectElement>('[data-testid="event-series-select"]');
		await commitSeriesChange(seriesArmedTarget.id, selectEl);
	}

	async function commitSeriesChange(newId: string, selectEl: HTMLSelectElement | null): Promise<void> {
		if (!detail || !selected) return;
		if (isOffline) return;
		const g = generation;
		const evId = detail.id;
		const previousId = detail.seriesId ?? '';
		seriesPending = true;
		seriesError = null;
		seriesStatus = '';
		const cfg = { db: selected.db, token: getToken() ?? '' };
		try {
			if (newId === '') {
				await unassignEventSeries(cfg, evId);
			} else {
				await reassignEventSeries(cfg, evId, newId);
			}
			if (g !== generation) return;
			seriesArmedTarget = null;
			seriesPreviewDefaults = null;
			await refreshEventDetail(evId, g);
			if (g !== generation) return;
			seriesPending = false;
			seriesStatus = m.event_detail_series_saved();
		} catch (err) {
			if (g !== generation) return;
			console.error('event detail: series write failed', evId, err);
			seriesArmedTarget = null;
			seriesPreviewDefaults = null;
			seriesPending = false;
			seriesError = m.event_detail_series_save_error();
			if (selectEl) selectEl.value = previousId;
		}
	}

	async function refreshEventDetail(evId: string, g: number): Promise<void> {
		if (!selected) return;
		try {
			const cfg = { db: selected.db, token: getToken() ?? '' };
			const refreshed = await refreshEventPageDetail(cfg, evId);
			if (g !== generation) return;
			detail = refreshed;
		} catch (err) {
			if (g !== generation) return;
			console.error('event detail: post-series-write refresh failed', evId, err);
		}
	}


	function tallinnWallClockParts(isoUtc: string): { date: string; time: string } {
		const instant = new Date(isoUtc);
		if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: TZ,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).formatToParts(instant);
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
		return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
	}

	function openEventConvertForm(): void {
		eventConvertOpen = true;
		eventConvertIntervalDays = '7';
		eventConvertDuration = '';
		eventConvertEndDate = '';
		eventConvertProgress = null;
		clearEventConvertError();
	}

	function closeEventConvertForm(): void {
		eventConvertOpen = false;
		eventConvertProgress = null;
		eventConvertResume = null;
		clearEventConvertError();
	}

	function setEventConvertError(message: string, field: EventConvertErrorField): void {
		eventConvertError = message;
		eventConvertErrorField = field;
	}

	function clearEventConvertError(): void {
		eventConvertError = null;
		eventConvertErrorField = null;
	}

	function eventConvertDescribedBy(field: EventConvertErrorField): string | undefined {
		return eventConvertErrorField === field ? 'event-convert-error' : undefined;
	}

	function eventConvertInvalid(field: EventConvertErrorField): true | undefined {
		return eventConvertErrorField === field ? true : undefined;
	}

	const eventConvertLocked = $derived(eventConvertResume !== null);

	function restoreEventConvertFocus(): void {
		tick().then(() =>
			document.querySelector<HTMLElement>('[data-testid="event-detail-convert"]')?.focus()
		);
	}

	function dismissEventConvertForm(): void {
		if (eventConvertSubmitting) return;
		closeEventConvertForm();
		restoreEventConvertFocus();
	}

	function onEventConvertFormKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		dismissEventConvertForm();
	}

	$effect(() => {
		if (eventConvertOpen && eventConvertFormEl) eventConvertFormEl.focus();
	});

	function eventConvertStepOf(e: unknown): string {
		if (e && typeof e === 'object' && 'step' in e) {
			const step = (e as { step?: unknown }).step;
			if (typeof step === 'string' && step) return step;
		}
		return 'unknown';
	}

	const EVENT_CONVERT_RESOLVE_STEP = 'resolve-collective';

	function eventConvertRefusalMessage(e: unknown): string | null {
		if (!e || typeof e !== 'object' || !('reason' in e)) return null;
		const reason = (e as { reason?: unknown }).reason;
		if (reason === 'missing-name') return m.event_convert_missing_name();
		if (reason === 'missing-event-type') return m.event_convert_missing_type();
		return null;
	}

	async function submitEventConvert(): Promise<void> {
		if (eventConvertSubmitting) return;
		if (isOffline) return;
		if (!selected || !detail || detail.seasonId === null) return;
		clearEventConvertError();

		const resume = eventConvertResume;

		const { date: startDate, time: startTime } = tallinnWallClockParts(detail.startDatetime);
		if (!startDate || !startTime) {
			console.error('event detail: converting an event with no readable start', detail.id, detail.startDatetime);
			setEventConvertError(m.event_convert_start_missing(), null);
			return;
		}
		const intervalDays = Number(eventConvertIntervalDays);
		if (!eventConvertIntervalDays.trim() || !Number.isFinite(intervalDays) || intervalDays < 1) {
			setEventConvertError(m.event_convert_interval_required(), 'interval');
			return;
		}
		const durationMinutes = Number(eventConvertDuration);
		if (!eventConvertDuration.trim() || !Number.isFinite(durationMinutes) || durationMinutes < 1) {
			setEventConvertError(m.event_convert_duration_required(), 'duration');
			return;
		}
		if (!eventConvertEndDate) {
			setEventConvertError(m.event_convert_end_required(), 'end');
			return;
		}
		if (eventConvertEndDate < startDate) {
			setEventConvertError(m.event_convert_end_before_start(), 'end');
			return;
		}

		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = detail.seasonId;
		const eventId = detail.id;
		const g = generation;

		eventConvertSubmitting = true;
		try {
			let seriesId: string;
			let dbEntityId: string;
			let eventType: string;
			let occurrences: string[];
			let total: number;
			let created: number;

			if (resume) {
				({ seriesId, dbEntityId, eventType, total } = resume);
				occurrences = resume.remaining;
				created = total - occurrences.length;
			} else {
				let resolvedDbEntityId: string | null;
				try {
					resolvedDbEntityId = await resolveDatabaseEntityId(cfg);
				} catch (e) {
					console.error('event detail: resolving the database entity for event conversion failed', e);
					if (g === generation)
						setEventConvertError(m.event_convert_failed({ step: EVENT_CONVERT_RESOLVE_STEP }), null);
					return;
				}
				if (!resolvedDbEntityId) {
					console.error(
						'event detail: event conversion with no resolvable database entity',
						selected.personId
					);
					if (g === generation)
						setEventConvertError(m.event_convert_failed({ step: EVENT_CONVERT_RESOLVE_STEP }), null);
					return;
				}
				if (g !== generation) return;
				dbEntityId = resolvedDbEntityId;
				const input: ConvertEventToSeriesInput = {
					eventId,
					dbEntityId,
					seasonId,
					intervalDays,
					startTime,
					startDate,
					endDate: eventConvertEndDate,
					durationMinutes
				};
				try {
					const result = await convertEventToSeries(cfg, input);
					seriesId = result.seriesId;
					eventType = result.eventType;
				} catch (e) {
					console.error('event detail: event conversion failed', eventId, e);
					if (g === generation)
						setEventConvertError(
							eventConvertRefusalMessage(e) ?? m.event_convert_failed({ step: eventConvertStepOf(e) }),
							null
						);
					return;
				}
				if (g !== generation) return;
				occurrences = generateIntervalDates({
					startDate,
					intervalDays,
					timeOfDay: startTime,
					until: eventConvertEndDate
				}).slice(1);
				total = occurrences.length;
				created = 0;
			}

			for (let i = 0; i < occurrences.length; i += 1) {
				if (g !== generation) {
					console.warn(
						'event detail: collective/route switched mid-conversion — the series keeps the occurrences already written',
						seriesId
					);
					return;
				}
				eventConvertProgress = { current: created + 1, total };
				try {
					await createEvent(cfg, {
						dbEntityId,
						seriesId,
						extraParentIds: [seasonId],
						eventType,
						startDatetime: tallinnLocalToUtcIso(occurrences[i])
					});
					created += 1;
				} catch (e) {
					console.error('event detail: generating a converted series occurrence failed', seriesId, e);
					eventConvertProgress = null;
					if (g !== generation) return;
					eventConvertResume = {
						seriesId,
						dbEntityId,
						eventType,
						remaining: occurrences.slice(i),
						total
					};
					setEventConvertError(m.event_convert_generate_failed({ created, total }), null);
					return;
				}
			}
			if (g !== generation) return;
			eventConvertProgress = null;
			closeEventConvertForm();
			await refreshEventDetail(eventId, g);
		} finally {
			eventConvertSubmitting = false;
		}
	}

	function loadManagePickers(cfg: ComposeCfg, sid: string | null, g: number): void {
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			sid === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, sid)
		])
			.then(([worksRead, editionsRead, repertoire]) => {
				if (g !== generation) return;
				libraryWorks = worksRead.items;
				libraryEditions = editionsRead.items;
				libraryWorksPartial = worksRead.truncated;
				libraryEditionsPartial = editionsRead.truncated;
				seasonRepertoire = repertoire;
				libraryPickersLoading = false;
				libraryPickersLoadSucceeded = true;
			})
			.catch(() => {
				if (g !== generation) return;
				libraryWorks = [];
				libraryEditions = [];
				libraryWorksPartial = false;
				libraryEditionsPartial = false;
				seasonRepertoire = [];
				libraryPickersLoading = false;
				libraryPickersLoadSucceeded = false;
			});
	}


	function manageCfg(): ComposeCfg | null {
		return selected ? { db: selected.db, token: getToken() ?? '' } : null;
	}

	function handlePdfClick(fileId: string): void {
		if (!selected) return;
		const row = workRows.find((r) => r.fileId === fileId);
		goto(`/part/${fileId}?db=${selected.db}`, {
			state: row
				? {
						partLabel: {
							work: row.workName,
							composer: row.composer,
							edition: row.editionName,
							filename: row.fileName
						}
					}
				: {}
		});
	}

	function refreshWorks(): void {
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const evId = detail.id;
		const g = generation;
		refreshEventPageWorkRows(cfg, [evId], seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (g !== generation) return;
				workRows = byEvent[evId] ?? [];
			})
			.catch(() => {
			});
		if (seasonId !== null && seasonManageRights === 'editor') {
			listRepertoireItems(cfg, seasonId)
				.then((items) => {
					if (g !== generation) return;
					seasonRepertoire = items;
				})
				.catch(() => {
				});
		}
	}

	const repertoireQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			const next = new Set(managePendingKeys);
			if (pending) next.add(key);
			else next.delete(key);
			managePendingKeys = next;
			if (pending) {
				manageError = false;
				manageStatus = '';
			}
		},
		reconcile(key) {
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) refreshWorks();
			manageStatus = m.repertoire_manage_saved();
		},
		revert(key) {
			console.error('event detail: repertoire write failed', key);
			refreshWorks();
			manageError = true;
		}
	});

	function findWorkRow(itemId: string): WorkRow | undefined {
		return workRows.find((row) => row.id === itemId);
	}
	function patchWorkRow(itemId: string, patch: Partial<WorkRow>): void {
		workRows = workRows.map((row) => (row.id === itemId ? { ...row, ...patch } : row));
	}
	function dropWorkRow(itemId: string): void {
		workRows = workRows.filter((row) => row.id !== itemId);
	}
	function restoreWorkRow(index: number, row: WorkRow): void {
		if (workRows.some((r) => r.id === row.id)) return;
		const next = [...workRows];
		next.splice(Math.min(index, next.length), 0, row);
		workRows = next;
	}
	function setWorkOrdinals(ordinalById: Map<string, number>): void {
		workRows = workRows.map((row) =>
			ordinalById.has(row.id) ? { ...row, ordinal: ordinalById.get(row.id)! } : row
		);
	}

	function handleAddWork(workId: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || seasonId === null) return;
		const sid = seasonId;
		repertoireQueue.request(ADD_WORK_KEY, async () => {
			await createRepertoireItem(cfg, { seasonId: sid, workId });
		});
	}

	function handleStatusChange(itemId: string, status: RepertoireStatus): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = row.status;
		repertoireQueue.request(itemId, () => updateRepertoireStatus(cfg, itemId, status), {
			apply: () => patchWorkRow(itemId, { status }),
			rollback: () => patchWorkRow(itemId, { status: before })
		});
	}

	function handlePinEdition(itemId: string, editionId: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = { editionId: row.editionId, editionName: row.editionName };
		const editionName = libraryEditions.find((e) => e.id === editionId)?.name ?? '';
		repertoireQueue.request(itemId, () => pinEdition(cfg, itemId, editionId), {
			apply: () => patchWorkRow(itemId, { editionId, editionName }),
			rollback: () => patchWorkRow(itemId, before)
		});
	}

	function handleRemoveItem(itemId: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row) return;
		const index = workRows.findIndex((r) => r.id === itemId);
		if (row.kind === 'program') {
			repertoireQueue.request(itemId, () => deleteProgramItem(cfg, itemId), {
				apply: () => dropWorkRow(itemId),
				rollback: () => restoreWorkRow(index, row)
			});
			return;
		}
		const repertoireBefore = seasonRepertoire;
		repertoireQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				dropWorkRow(itemId);
				seasonRepertoire = seasonRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				restoreWorkRow(index, row);
				seasonRepertoire = repertoireBefore;
			}
		});
	}

	function handleMoveItem(itemId: string, direction: 'up' | 'down'): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const items = workRows
			.filter((row) => row.kind === 'program')
			.map((row) => ({ id: row.id, ordinal: row.ordinal ?? 0 }));
		const plan = planProgramMove(items, itemId, direction);
		if (plan.length === 0) return;
		const key = `move:${detail.id}`;
		const before = new Map(
			plan.map((entry) => [entry.id, items.find((i) => i.id === entry.id)?.ordinal ?? 0])
		);
		const after = new Map(plan.map((entry) => [entry.id, entry.ordinal]));
		repertoireQueue.request(key, () => reorderProgramItems(cfg, plan), {
			apply: () => setWorkOrdinals(after),
			rollback: () => setWorkOrdinals(before)
		});
	}

	function handleAddProgramItem(editionId: string, ordinal: number): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const eventIdForProgram = detail.id;
		repertoireQueue.request(ADD_PROGRAMME_KEY, async () => {
			await createProgramItem(cfg, { eventId: eventIdForProgram, editionId, ordinal });
		});
	}


	const SCHEDULE_ADD_KEY = 'schedule-add';

	function patchScheduleRow(id: string, patch: Partial<ScheduleItem>): void {
		scheduleRows = scheduleRows
			.map((row) => (row.id === id ? { ...row, ...patch } : row))
			.sort(compareScheduleItems);
	}
	function dropScheduleRow(id: string): void {
		scheduleRows = scheduleRows.filter((row) => row.id !== id);
	}
	function restoreScheduleRow(row: ScheduleItem): void {
		if (scheduleRows.some((r) => r.id === row.id)) return;
		scheduleRows = [...scheduleRows, row].sort(compareScheduleItems);
	}

	const scheduleWriteGenerations = new Map<string, number>();

	const scheduleQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			scheduleWritePending = { ...scheduleWritePending, [key]: pending };
			if (pending) {
				scheduleWriteGenerations.set(key, generation);
				scheduleStatus = '';
			}
		},
		reconcile(key) {
			const startedUnder = scheduleWriteGenerations.get(key);
			scheduleWriteGenerations.delete(key);
			clearScheduleError(key);
			if (key === SCHEDULE_ADD_KEY) {
				refreshSchedule();
				scheduleAddOpen = false;
				scheduleAddName = '';
				scheduleAddDate = '';
				scheduleAddTime = '';
			}
			if (startedUnder === generation) scheduleStatus = m.event_schedule_saved();
		},
		revert(key) {
			scheduleWriteGenerations.delete(key);
			console.error('event detail: schedule write failed', key);
			if (key === SCHEDULE_ADD_KEY) scheduleAddErrorField = null;
			setScheduleError(key, m.event_schedule_save_error);
		}
	});

	function setScheduleError(key: string, msg: () => string): void {
		scheduleErrors = { ...scheduleErrors, [key]: msg };
	}
	function clearScheduleError(...keys: string[]): void {
		const next = { ...scheduleErrors };
		for (const key of keys) next[key] = null;
		scheduleErrors = next;
	}
	function scheduleRowErrorKeys(id: string): string[] {
		return [`schedule-edit-name-${id}`, `schedule-edit-datetime-${id}`, `schedule-remove-${id}`];
	}
	function scheduleRowError(id: string): (() => string) | null {
		for (const key of scheduleRowErrorKeys(id)) {
			const msg = scheduleErrors[key];
			if (msg) return msg;
		}
		return null;
	}

	function refreshSchedule(): void {
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const evId = detail.id;
		const g = generation;
		listScheduleItems(cfg, evId, fetch)
			.then((rows) => {
				if (g !== generation) return;
				scheduleRows = rows;
			})
			.catch((e) => {
				console.error('event detail: schedule refresh failed', e);
			});
	}

	function beginScheduleAdd(): void {
		scheduleAddOpen = true;
		clearScheduleAddError();
		scheduleAddName = '';
		const seeded = toTallinnLocalInputValue(detail?.startDatetime ?? '');
		scheduleAddDate = seeded.split('T')[0] ?? '';
		scheduleAddTime = '';
	}

	function cancelScheduleAdd(): void {
		scheduleAddOpen = false;
		clearScheduleAddError();
		scheduleAddName = '';
		scheduleAddDate = '';
		scheduleAddTime = '';
	}

	function clearScheduleAddError(): void {
		scheduleAddErrorField = null;
		clearScheduleError(SCHEDULE_ADD_KEY);
	}
	function setScheduleAddError(msg: () => string, field: 'name' | 'datetime'): void {
		scheduleAddErrorField = field;
		scheduleStatus = '';
		setScheduleError(SCHEDULE_ADD_KEY, msg);
	}

	function submitScheduleAdd(): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		clearScheduleAddError();
		const name = scheduleAddName.trim();
		if (name === '') {
			setScheduleAddError(m.event_schedule_name_required, 'name');
			return;
		}
		if (!scheduleAddDate || !scheduleAddTime) {
			setScheduleAddError(m.event_schedule_datetime_required, 'datetime');
			return;
		}
		const iso = tallinnLocalToUtcIso(`${scheduleAddDate}T${scheduleAddTime}`);
		if (iso === '') {
			setScheduleAddError(m.event_schedule_datetime_required, 'datetime');
			return;
		}
		const eventIdForSchedule = detail.id;
		scheduleQueue.request(SCHEDULE_ADD_KEY, async () => {
			await createScheduleItem(cfg, { eventId: eventIdForSchedule, name, datetime: iso });
		});
	}

	function beginScheduleEdit(row: ScheduleItem): void {
		if (isOffline) return;
		scheduleRemoveArmedId = null;
		clearScheduleError(...scheduleRowErrorKeys(row.id));
		scheduleEditingId = row.id;
		scheduleEditName = row.name;
		const seeded = toTallinnLocalInputValue(row.datetime);
		const [datePart, timePart] = seeded.split('T');
		scheduleEditDate = datePart ?? '';
		scheduleEditTime = timePart ?? '';
	}

	function cancelScheduleEdit(): void {
		scheduleEditingId = null;
		scheduleEditName = '';
		scheduleEditDate = '';
		scheduleEditTime = '';
	}

	function staysInsideScheduleRowEditor(origin: HTMLElement, next: Node | null): boolean {
		if (!next) return false;
		const wrapper = origin.closest('[data-schedule-edit-row]');
		return wrapper !== null && wrapper.contains(next);
	}

	function commitScheduleName(id: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = scheduleRows.find((r) => r.id === id);
		if (!cfg || !row || scheduleEditingId !== id) return;
		const value = scheduleEditName.trim();
		if (value === '') {
			scheduleStatus = '';
			setScheduleError(`schedule-edit-name-${id}`, m.event_schedule_name_required);
			return;
		}
		clearScheduleError(`schedule-edit-name-${id}`);
		if (value === row.name) return;
		const before = row.name;
		scheduleQueue.request(`schedule-edit-name-${id}`, () => updateScheduleItemField(cfg, id, 'name', value), {
			apply: () => patchScheduleRow(id, { name: value }),
			rollback: () => patchScheduleRow(id, { name: before })
		});
	}

	function commitScheduleDatetime(id: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = scheduleRows.find((r) => r.id === id);
		if (!cfg || !row || scheduleEditingId !== id) return;
		if (!scheduleEditDate || !scheduleEditTime) return;
		const iso = tallinnLocalToUtcIso(`${scheduleEditDate}T${scheduleEditTime}`);
		if (iso === '' || new Date(iso).getTime() === new Date(row.datetime).getTime()) return;
		const before = row.datetime;
		scheduleQueue.request(
			`schedule-edit-datetime-${id}`,
			() => updateScheduleItemField(cfg, id, 'datetime', iso),
			{
				apply: () => patchScheduleRow(id, { datetime: iso }),
				rollback: () => patchScheduleRow(id, { datetime: before })
			}
		);
	}

	function handleScheduleEditDatetimeFocusOut(e: FocusEvent, id: string): void {
		const group = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && group.contains(next)) return;
		commitScheduleDatetime(id);
		if (staysInsideScheduleRowEditor(group, next)) return;
		scheduleEditingId = null;
	}

	function handleScheduleNameBlur(e: FocusEvent, id: string): void {
		const input = e.currentTarget as HTMLElement;
		commitScheduleName(id);
		if (staysInsideScheduleRowEditor(input, e.relatedTarget as Node | null)) return;
		if (scheduleEditName.trim() === '') return;
		scheduleEditingId = null;
	}

	function handleScheduleNameKeydown(e: KeyboardEvent, id: string): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelScheduleEdit();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			commitScheduleName(id);
			if (scheduleEditName.trim() !== '') scheduleEditingId = null;
		}
	}

	function armScheduleRemove(id: string): void {
		if (isOffline) return;
		scheduleEditingId = null;
		clearScheduleError(...scheduleRowErrorKeys(id));
		scheduleRemoveArmedId = id;
	}
	function cancelScheduleRemove(): void {
		scheduleRemoveArmedId = null;
	}
	function confirmScheduleRemove(id: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = scheduleRows.find((r) => r.id === id);
		if (!cfg || !row) return;
		scheduleRemoveArmedId = null;
		scheduleQueue.request(`schedule-remove-${id}`, () => removeScheduleItem(cfg, id), {
			apply: () => dropScheduleRow(id),
			rollback: () => restoreScheduleRow(row)
		});
	}

	const showScheduleSection = $derived(scheduleLoaded && (scheduleRows.length > 0 || isEditor));


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
		for (const row of workRows) {
			if (row.kind !== 'repertoire' || row.workId === '') continue;
			const options =
				scopedEditionsByWorkId[row.workId] ??
				(editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
					id: edition.id,
					label: editionLabel(edition)
				}));
			if (options.length > 0) out[row.id] = options;
		}
		return out;
	});

	const editionsResolvedWorkIds = $derived(new Set(Object.keys(scopedEditionsByWorkId)));

	const unknownEditionWorkIds = $derived(
		unresolvedEditionWorkIds(
			workRows,
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
		const g = generation;
		for (const workId of workIds) {
			if (scopedEditionWorkIdsRequested.has(workId)) continue;
			scopedEditionWorkIdsRequested.add(workId);
			listEditions(cfg, workId)
				.then((read) => {
					if (g !== generation) return;
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

	const pickableEditionsList = $derived.by(() => {
		const workById = new Map(libraryWorks.map((work) => [work.id, work]));
		const programmed = new Set(
			workRows.filter((row) => row.kind === 'program').map((row) => row.editionId)
		);
		return libraryEditions
			.filter((edition) => !programmed.has(edition.id))
			.map((edition) => {
				const work = workById.get(edition.workId ?? '');
				const prefix = work === undefined ? '' : workLabel(work);
				return {
					id: edition.id,
					label: prefix === '' ? editionLabel(edition) : `${prefix} — ${editionLabel(edition)}`
				};
			});
	});

	const pickableWorksList = $derived(pickableWorks(libraryWorks, seasonRepertoire));

	$effect(() => {
		if (libraryPickersLoading || !libraryPickersLoadSucceeded) return;
		pickableWorksVisible = pickableWorksList.length > 0;
	});

	const showWorksSection = $derived(
		workRows.length > 0 || seasonManageRights === 'editor' || eventManageRights === 'editor'
	);

	const worksContext = $derived<'repertoire' | 'programme'>(
		workRows.some((row) => row.kind === 'program') ? 'programme' : 'repertoire'
	);


	const myAttendanceStatus = $derived<AttendanceStatus | 'not-recorded' | null>(
		memberId === null ? null : (attendanceMap[memberId]?.status ?? 'not-recorded')
	);

	const hasAttendanceRecords = $derived(Object.keys(attendanceMap).length > 0);

	const attendanceTally = $derived.by(() => {
		let present = 0;
		let absent = 0;
		let late = 0;
		for (const entry of Object.values(attendanceMap)) {
			if (entry.status === 'present') present++;
			else if (entry.status === 'absent') absent++;
			else if (entry.status === 'late') late++;
		}
		return { present, absent, late };
	});

	const canMarkAttendanceForEvent = $derived(
		detail !== null &&
			selected !== null &&
			canMarkAttendance(
				{ owners: detail.ownerIds, editors: detail.editorIds },
				selected.personId
			)
	);

	const showAttendanceSection = $derived(
		isPast && detail !== null && (hasAttendanceRecords || canMarkAttendanceForEvent)
	);

	const agendaItemForPanel = $derived<AgendaItem | null>(
		detail === null
			? null
			: {
					id: detail.id,
					name: detail.name,
					startDatetime: detail.startDatetime,
					durationMinutes: detail.durationMinutes,
					location: detail.location,
					conductors: detail.conductorIds,
					owners: detail.ownerIds,
					editors: detail.editorIds
				}
	);

	function openAttendancePanel(): void {
		if (!selected || !detail || !canMarkAttendanceForEvent) return;
		attendancePanelOpen = true;
		attendancePanelLoading = true;
		attendancePanelError = false;
		attendanceSavedMemberIds = new Set();
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		const g = generation;
		Promise.all([loadRoster(cfg), listAttendance(cfg, evId), listAllRsvpsForEvent(cfg, evId)])
			.then(([rosterRead, records, rsvps]) => {
				if (g !== generation || detail?.id !== evId) return;
				attendanceRoster = rosterRead.items;
				attendanceRosterPartial = rosterRead.truncated;
				attendanceMap = attendanceByMemberId(records);
				const rsvpMap: Record<string, { rsvpId: string; status: string }> = {};
				for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
				attendanceRsvpMap = rsvpMap;
				attendancePanelLoading = false;
			})
			.catch((e) => {
				console.error('event detail: attendance panel load failed', e);
				if (g !== generation || detail?.id !== evId) return;
				attendancePanelLoading = false;
				attendancePanelError = true;
				attendanceRosterPartial = false;
			});
	}

	function closeAttendancePanel(): void {
		attendancePanelOpen = false;
		tick().then(() => {
			document
				.querySelector<HTMLElement>(
					'[data-testid="event-detail-attendance"] [data-testid="take-attendance-btn"]'
				)
				?.focus();
		});
	}

	const attendanceWriteGenerations = new Map<string, number>();
	function isCurrentAttendanceWrite(evId: string, targetMemberId: string): boolean {
		return (
			detail !== null &&
			evId === detail.id &&
			attendanceWriteGenerations.get(targetMemberId) === generation
		);
	}

	const attendanceQueue = createAttendanceChangeQueue({
		setOptimistic(evId, targetMemberId, entry) {
			if (!isCurrentAttendanceWrite(evId, targetMemberId)) return;
			const next = { ...attendanceMap };
			if (entry) next[targetMemberId] = entry;
			else delete next[targetMemberId];
			attendanceMap = next;
		},
		setPending(evId, targetMemberId, pending) {
			if (pending) attendanceWriteGenerations.set(targetMemberId, generation);
			if (!isCurrentAttendanceWrite(evId, targetMemberId)) return;
			const next = new Set(attendancePendingMemberIds);
			if (pending) next.add(targetMemberId);
			else next.delete(targetMemberId);
			attendancePendingMemberIds = next;
			if (pending) {
				const failed = new Set(attendanceFailedMemberIds);
				failed.delete(targetMemberId);
				attendanceFailedMemberIds = failed;
				const saved = new Set(attendanceSavedMemberIds);
				saved.delete(targetMemberId);
				attendanceSavedMemberIds = saved;
			}
		},
		reconcile(evId, targetMemberId, entry) {
			const stillCurrent = isCurrentAttendanceWrite(evId, targetMemberId);
			attendanceWriteGenerations.delete(targetMemberId);
			if (!stillCurrent) return;
			const next = { ...attendanceMap };
			if (entry) next[targetMemberId] = entry;
			else delete next[targetMemberId];
			attendanceMap = next;
			const saved = new Set(attendanceSavedMemberIds);
			saved.add(targetMemberId);
			attendanceSavedMemberIds = saved;
		},
		revert(evId, targetMemberId, before) {
			const stillCurrent = isCurrentAttendanceWrite(evId, targetMemberId);
			attendanceWriteGenerations.delete(targetMemberId);
			if (!stillCurrent) return;
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

	function handleAttendanceToggle(targetMemberId: string, newStatus: AttendanceStatus | null): void {
		if (!selected || !detail) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const current = attendanceMap[targetMemberId];
		const existing: EventAttendance | null = current
			? { attendanceId: current.attendanceId, memberId: targetMemberId, status: current.status }
			: null;
		attendanceQueue.request({ cfg, eventId: detail.id, memberId: targetMemberId, existing, newStatus });
	}


	let editingField = $state<EditableEventField | null>(null);
	let editDraft = $state('');

	const LOCATION_SUGGESTIONS_ID = 'event-edit-location-suggestions';
	let locationSuggestions = $state<string[]>([]);
	let locationCorpusRequested = false;
	function ensureLocationCorpusLoaded(): void {
		if (locationCorpusRequested) return;
		locationCorpusRequested = true;
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		listEventLocations(cfg)
			.then((result) => {
				locationSuggestions = result.items;
				if (result.truncated) {
					console.warn('event detail: location-suggestion corpus is truncated');
				}
			})
			.catch((e) => {
				console.error('event detail: loading location suggestions failed', e);
			});
	}
	let editDraftDate = $state('');
	let editDraftTime = $state('');
	let editErrors = $state<Partial<Record<EditableEventField, boolean>>>({});
	let editRangeErrors = $state<Partial<Record<EditableEventField, boolean>>>({});
	let editHeldOffline = $state(false);
	$effect(() => {
		if (!isOffline) editHeldOffline = false;
	});
	let editWritePending = $state<Partial<Record<EditableEventField, boolean>>>({});
	let editStatus = $state('');

	let pencilRefs: Partial<Record<EditableEventField, HTMLButtonElement>> = {};

	let pendingFocusRestore: Partial<Record<EditableEventField, boolean>> = {};

	function settleFieldFocus(field: EditableEventField): void {
		const owed = pendingFocusRestore[field] === true;
		delete pendingFocusRestore[field];
		if (owed && editingField === null) restorePencilFocus(field);
	}

	function focusOnMount(node: HTMLElement): void {
		node.focus();
	}

	const editWriteGenerations = new Map<string, number>();

	const editWriteQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			editWritePending = { ...editWritePending, [key as EditableEventField]: pending };
			if (pending) {
				editWriteGenerations.set(key, generation);
				editStatus = '';
			}
		},
		reconcile(key) {
			const startedUnder = editWriteGenerations.get(key);
			editWriteGenerations.delete(key);
			editErrors = { ...editErrors, [key as EditableEventField]: false };
			settleFieldFocus(key as EditableEventField);
			if (startedUnder === generation) editStatus = m.event_edit_saved();
		},
		revert(key) {
			editWriteGenerations.delete(key);
			editErrors = { ...editErrors, [key as EditableEventField]: true };
			settleFieldFocus(key as EditableEventField);
		}
	});

	function fieldValue(d: EventDetail, field: EditableEventField): string | number {
		switch (field) {
			case 'event_name':
				return d.name;
			case 'start_datetime':
				return d.startDatetime;
			case 'duration_minutes':
				return d.durationMinutes;
			case 'location':
				return d.location;
			case 'description':
				return d.description;
			case 'event_type':
				return d.eventType;
		}
	}

	function applyFieldLocally(field: EditableEventField, value: string | number): void {
		if (!detail) return;
		switch (field) {
			case 'event_name':
				detail = { ...detail, name: value as string };
				break;
			case 'start_datetime':
				detail = { ...detail, startDatetime: value as string };
				break;
			case 'duration_minutes':
				detail = { ...detail, durationMinutes: value as number };
				break;
			case 'location':
				detail = { ...detail, location: value as string };
				break;
			case 'description':
				detail = { ...detail, description: value as string };
				break;
			case 'event_type':
				detail = { ...detail, eventType: value as string };
				break;
		}
	}

	function toTallinnLocalInputValue(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: TZ,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).formatToParts(date);
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
		return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
	}


	function beginFieldEdit(field: EditableEventField): void {
		if (!detail || editWritePending[field] || isOffline) return;
		editErrors = { ...editErrors, [field]: false };
		editRangeErrors = { ...editRangeErrors, [field]: false };
		editHeldOffline = false;
		if (field === 'start_datetime') {
			const seeded = toTallinnLocalInputValue(detail.startDatetime);
			const [datePart, timePart] = seeded.split('T');
			editDraftDate = datePart ?? '';
			editDraftTime = timePart ?? '';
			editDraft = seeded;
		} else if (field === 'duration_minutes') {
			const startMs = new Date(detail.startDatetime).getTime();
			const seeded = Number.isNaN(startMs)
				? ''
				: toTallinnLocalInputValue(
						new Date(startMs + detail.durationMinutes * 60_000).toISOString()
					);
			const [datePart, timePart] = seeded.split('T');
			editDraftDate = datePart ?? '';
			editDraftTime = timePart ?? '';
			editDraft = seeded;
		} else {
			editDraft = String(fieldValue(detail, field));
		}
		editingField = field;
	}

	function updateCompositeDraft(datePart: string, timePart: string): void {
		editDraftDate = datePart;
		editDraftTime = timePart;
		editDraft = datePart && timePart ? `${datePart}T${timePart}` : '';
	}

	function handleStartDatetimeFocusOut(e: FocusEvent): void {
		const wrapper = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && wrapper.contains(next)) return;
		confirmFieldEdit('start_datetime', false);
	}

	function handleDurationEndFocusOut(e: FocusEvent): void {
		const wrapper = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && wrapper.contains(next)) return;
		confirmFieldEdit('duration_minutes', false);
	}

	function restorePencilFocus(field: EditableEventField): void {
		tick().then(() => pencilRefs[field]?.focus());
	}

	function cancelFieldEdit(field: EditableEventField, restoreFocus: boolean): void {
		editingField = null;
		editDraft = '';
		editDraftDate = '';
		editDraftTime = '';
		editHeldOffline = false;
		if (restoreFocus) restorePencilFocus(field);
	}

	function draftWireValue(field: EditableEventField): string | number | null {
		if (field === 'start_datetime') {
			const iso = tallinnLocalToUtcIso(editDraft);
			return iso === '' ? null : iso;
		}
		if (editDraft.trim() === '') return null;
		return editDraft;
	}

	function draftDurationEndMinutesRaw(): number | null {
		if (!detail || editDraft.trim() === '') return null;
		const endIso = tallinnLocalToUtcIso(editDraft);
		if (endIso === '') return null;
		const startMs = new Date(detail.startDatetime).getTime();
		if (Number.isNaN(startMs)) return null;
		const endMs = new Date(endIso).getTime();
		return Math.round((endMs - startMs) / 60_000);
	}

	function isUnchanged(field: EditableEventField, value: string | number, before: string | number): boolean {
		if (field === 'start_datetime') {
			const a = new Date(String(value)).getTime();
			const b = new Date(String(before)).getTime();
			return !Number.isNaN(a) && !Number.isNaN(b) && a === b;
		}
		return value === before;
	}

	function confirmFieldEdit(field: EditableEventField, restoreFocus: boolean): void {
		if (!selected || !detail || editingField !== field) return;
		if (isOffline) {
			editErrors = { ...editErrors, [field]: false };
			editHeldOffline = true;
			return;
		}
		const before = fieldValue(detail, field);
		if (field === 'duration_minutes') {
			const raw = draftDurationEndMinutesRaw();
			if (raw === null || raw === before) {
				cancelFieldEdit(field, restoreFocus);
				return;
			}
			if (raw <= 0) {
				cancelFieldEdit(field, restoreFocus);
				editStatus = '';
				editRangeErrors = { ...editRangeErrors, duration_minutes: true };
				return;
			}
			editingField = null;
			pendingFocusRestore[field] = restoreFocus;
			const cfg = { db: selected.db, token: getToken() ?? '' };
			const evId = detail.id;
			editWriteQueue.request(
				field,
				() =>
					updateEventField(cfg, evId, field, raw, fetch).catch((e) => {
						console.error('event detail: field edit failed', field, e);
						throw e;
					}),
				{
					apply: () => applyFieldLocally(field, raw),
					rollback: () => applyFieldLocally(field, before)
				}
			);
			return;
		}
		const value = draftWireValue(field);
		if (value === null || isUnchanged(field, value, before)) {
			cancelFieldEdit(field, restoreFocus);
			return;
		}
		editingField = null;
		pendingFocusRestore[field] = restoreFocus;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		editWriteQueue.request(
			field,
			() =>
				updateEventField(cfg, evId, field, value, fetch).catch((e) => {
					console.error('event detail: field edit failed', field, e);
					throw e;
				}),
			{
				apply: () => applyFieldLocally(field, value),
				rollback: () => applyFieldLocally(field, before)
			}
		);
	}

	function handleFieldKeydown(e: KeyboardEvent, field: EditableEventField, multiline: boolean): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelFieldEdit(field, true);
		} else if (e.key === 'Enter' && !multiline) {
			e.preventDefault();
			confirmFieldEdit(field, true);
		}
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<a
			data-testid="event-detail-back"
			href="/"
			class="flex w-fit items-baseline gap-1 text-xs text-ink-2 underline"
		>
			<span aria-hidden="true">←</span>
			<span>{m.event_detail_back()}</span>
		</a>

		{#if status === 'loading'}
			<div
				data-testid="event-detail-skeleton"
				class="flex animate-pulse flex-col gap-2"
				aria-hidden="true"
			>
				<div class="h-6 w-2/3 rounded bg-ink-5"></div>
				<div class="h-4 w-1/2 rounded bg-ink-5"></div>
				<div class="h-4 w-1/3 rounded bg-ink-5"></div>
			</div>
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
		{:else if status === 'load-error'}
			<div data-testid="event-detail-load-error" role="alert" class="flex flex-col gap-2">
				<p class="text-sm text-red-700">{m.event_detail_load_error()}</p>
				<button
					type="button"
					data-testid="event-detail-retry"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.event_detail_retry()}
				</button>
			</div>
		{:else if status === 'not-available'}
			<p data-testid="event-detail-not-available" role="alert" class="text-sm">
				{m.event_detail_not_in_collective()}
			</p>
		{:else if status === 'no-collective'}
			<p data-testid="event-detail-no-collective" class="text-sm">
				{m.event_detail_no_collective()}
			</p>
		{:else if detail}
			<div class="flex flex-col gap-1.5">
				{#if $servedFromCache}
					<AsOfLine readAt={$servedFromCache} testid="event-detail-as-of" class="mb-1" />
				{/if}
				{#if isEditor && detail.seasonId !== null && seriesOptionsLoaded}
					<div class="flex flex-col gap-1 border-b border-dashed border-ink-5 pb-2">
						<label for="event-series-select" class="text-xs text-ink-2">
							{m.event_detail_series_label()}
						</label>
						{#if isOffline}
							<p
								data-testid="event-series-write-unavailable"
								role="status"
								class="text-xs text-ink-2"
							>
								{m.write_unavailable_no_signal()}
							</p>
						{/if}
						<select
							id="event-series-select"
							data-testid="event-series-select"
							value={detail.seriesId ?? ''}
							disabled={seriesPending || isOffline}
							onchange={(e) => void onSeriesSelectChange(e)}
							class="w-fit border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
						>
							{#if !seriesUnassignGated}
								<option value="">{m.event_detail_series_none()}</option>
							{/if}
							{#each seriesOptions as series (series.id)}
								<option value={series.id}>{series.name}</option>
							{/each}
						</select>
						{#if seriesUnassignGated}
							<p data-testid="event-series-rights-note" class="text-xs text-ink-3">
								{m.event_detail_series_rights_note()}
							</p>
						{/if}
						{#if detail.inheritedFields.length > 0}
							<p class="flex flex-wrap items-baseline gap-x-1 text-xs text-ink-3">
								<span>{m.event_detail_series_inherited_label()}</span>
								{#if detail.inheritedFields.includes('name')}
									<span data-testid="event-series-inherited-name"
										>{m.event_detail_series_field_name()}</span
									>
								{/if}
								{#if detail.inheritedFields.includes('durationMinutes')}
									<span data-testid="event-series-inherited-duration"
										>{m.event_detail_series_field_duration()}</span
									>
								{/if}
								{#if detail.inheritedFields.includes('location')}
									<span data-testid="event-series-inherited-location"
										>{m.event_detail_series_field_location()}</span
									>
								{/if}
								{#if detail.inheritedFields.includes('description')}
									<span data-testid="event-series-inherited-description"
										>{m.event_detail_series_field_description()}</span
									>
								{/if}
							</p>
						{/if}
						{#if seriesArmedTarget && detail.inheritedFields.length > 0 && (seriesArmedTarget.id === '' || seriesPreviewDefaults)}
							<div
								data-testid="event-series-confirm"
								class="flex flex-col gap-1.5 border border-ink-5 bg-paper p-2 text-xs"
							>
								<ul class="flex flex-col gap-0.5">
									{#each detail.inheritedFields as field (field)}
										<li>
											{seriesFieldLabel(field)}{#if seriesArmedTarget.id !== ''}:
												{seriesFieldBecomes(field, seriesPreviewDefaults!)}{/if}
										</li>
									{/each}
									{#if seriesArmedTarget.id === '' && detail.inheritedFields.includes('name')}
										<li class="text-red-700">
											{m.event_detail_series_unassign_name_empty()}
										</li>
									{/if}
								</ul>
								<div class="flex gap-2">
									<button
										type="button"
										data-testid="event-series-confirm-apply"
										disabled={seriesPending || isOffline}
										aria-busy={seriesPending}
										class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
										onclick={() => void confirmSeriesChange()}
									>
										{m.event_detail_series_confirm_apply()}
									</button>
									<button
										type="button"
										data-testid="event-series-confirm-cancel"
										disabled={seriesPending}
										class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
										onclick={() => void cancelSeriesChange()}
									>
										{m.event_detail_series_confirm_cancel()}
									</button>
								</div>
							</div>
						{/if}
						{#if seriesStatus}
							<p
								data-testid="event-series-status"
								role="status"
								aria-live="polite"
								class="text-xs text-ink-3"
							>
								{seriesStatus}
							</p>
						{/if}
						{#if seriesError}
							<p data-testid="event-series-error" role="alert" class="text-xs text-red-700">
								{seriesError}
							</p>
						{/if}
					</div>
				{/if}
				{#if canConvert}
					{#if !eventConvertOpen}
						<button
							type="button"
							data-testid="event-detail-convert"
							class="flex min-h-11 w-fit items-center text-xs text-ink underline"
							onclick={openEventConvertForm}
						>
							{m.event_detail_convert()}
						</button>
					{:else}
						<div
							data-testid="event-convert-form"
							role="dialog"
							aria-label={m.event_convert_form_label()}
							tabindex="-1"
							bind:this={eventConvertFormEl}
							class="flex flex-col gap-1.5 border border-dashed border-ink-5 p-2"
							onkeydown={onEventConvertFormKeydown}
						>
							{#if isOffline}
								<p data-testid="event-convert-write-unavailable" class="text-xs text-ink-2">
									{m.write_unavailable_no_signal()}
								</p>
							{/if}
							<label class="flex w-full flex-col gap-0.5">
								<span class="text-xs text-ink-2">
									{m.event_convert_interval_label()}
								</span>
								<input
									type="number"
									min="1"
									data-testid="event-convert-interval"
									aria-label={m.event_convert_interval_label()}
									aria-invalid={eventConvertInvalid('interval')}
									aria-describedby={eventConvertDescribedBy('interval')}
									disabled={eventConvertLocked}
									value={eventConvertIntervalDays}
									oninput={(e) => {
										eventConvertIntervalDays = (
											e.currentTarget as HTMLInputElement
										).value;
										clearEventConvertError();
									}}
									class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
								/>
							</label>
							<label class="flex w-full flex-col gap-0.5">
								<span class="text-xs text-ink-2">
									{m.event_convert_duration_label()}
								</span>
								<input
									type="number"
									min="1"
									data-testid="event-convert-duration"
									aria-label={m.event_convert_duration_label()}
									aria-invalid={eventConvertInvalid('duration')}
									aria-describedby={eventConvertDescribedBy('duration')}
									disabled={eventConvertLocked}
									value={eventConvertDuration}
									oninput={(e) => {
										eventConvertDuration = (
											e.currentTarget as HTMLInputElement
										).value;
										clearEventConvertError();
									}}
									class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
								/>
							</label>
							<p
								data-testid="event-convert-start-date"
								class="flex w-full flex-col gap-0.5"
							>
								<span class="text-xs text-ink-2">
									{m.event_convert_start_date_label()}
								</span>
								<span class="text-ink">
									{tallinnWallClockParts(detail.startDatetime).date}
								</span>
							</p>
							<label class="flex w-full flex-col gap-0.5">
								<span class="text-xs text-ink-2">
									{m.event_convert_end_date_label()}
								</span>
								<input
									type="date"
									data-testid="event-convert-end-date"
									aria-label={m.event_convert_end_date_label()}
									aria-invalid={eventConvertInvalid('end')}
									aria-describedby={eventConvertDescribedBy('end')}
									disabled={eventConvertLocked}
									value={eventConvertEndDate}
									oninput={(e) => {
										eventConvertEndDate = (
											e.currentTarget as HTMLInputElement
										).value;
										clearEventConvertError();
									}}
									class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
								/>
							</label>
							{#if eventConvertProgress}
								<p
									data-testid="event-convert-progress"
									role="status"
									aria-live="polite"
									class="text-xs text-ink-2"
								>
									{m.event_convert_progress({
										current: eventConvertProgress.current,
										total: eventConvertProgress.total
									})}
								</p>
							{/if}
							{#if eventConvertResume}
								<p data-testid="event-convert-resume-notice" class="text-xs text-ink-2">
									{m.event_convert_resume_notice({
										remaining: eventConvertResume.remaining.length,
										total: eventConvertResume.total
									})}
								</p>
							{/if}
							{#if eventConvertError}
								<p
									id="event-convert-error"
									data-testid="event-convert-error"
									role="alert"
									class="text-xs text-red-700"
								>
									{eventConvertError}
								</p>
							{/if}
							<div class="flex gap-2">
								<button
									type="button"
									data-testid="event-convert-submit"
									disabled={eventConvertSubmitting || isOffline}
									aria-busy={eventConvertSubmitting}
									class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
									onclick={() => void submitEventConvert()}
								>
									{m.event_convert_submit()}
								</button>
								<button
									type="button"
									data-testid="event-convert-cancel"
									disabled={eventConvertSubmitting}
									class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
									onclick={dismissEventConvertForm}
								>
									{m.event_convert_cancel()}
								</button>
							</div>
						</div>
					{/if}
				{/if}
				{#if editingField === 'event_type'}
					<select
						data-testid="event-edit-input-event_type"
						aria-label={m.event_edit_event_type_aria_label()}
						class="w-fit border-b border-ink bg-transparent text-ink-2"
						value={editDraft}
						use:focusOnMount
						onchange={(e) => (editDraft = (e.currentTarget as HTMLSelectElement).value)}
						onblur={() => confirmFieldEdit('event_type', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'event_type', false)}
					>
						<option value=""></option>
						{#each CANONICAL_EVENT_TYPES as type (type)}
							<option value={type}>{eventTypeLabel(type)}</option>
						{/each}
					</select>
				{:else if detail.eventType || isEditor}
					{#if isEditor}
						<button
							type="button"
							data-testid="event-edit-btn-event_type"
							class="group flex min-h-11 w-fit appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left disabled:opacity-40"
							disabled={editWritePending.event_type === true || isOffline}
							bind:this={pencilRefs.event_type}
							onclick={() => beginFieldEdit('event_type')}
						>
							<span class="sr-only">{m.event_edit_event_type_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.eventType}
								<span
									data-testid="event-detail-type"
									class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(detail.eventType)}"
								>
									{eventTypeLabel(detail.eventType)}
								</span>
							{/if}
						</button>
					{:else}
						<span
							data-testid="event-detail-type"
							class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(detail.eventType)}"
						>
							{eventTypeLabel(detail.eventType)}
						</span>
					{/if}
				{/if}
				{#if editErrors.event_type}
					<p data-testid="event-edit-error-event_type" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}
				{#if editingField === 'event_name'}
					<input
						type="text"
						data-testid="event-edit-input-name"
						aria-label={m.event_edit_name_aria_label()}
						class="border-b border-ink bg-transparent font-display text-2xl"
						value={editDraft}
						use:focusOnMount
						oninput={(e) => (editDraft = (e.currentTarget as HTMLInputElement).value)}
						onblur={() => confirmFieldEdit('event_name', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'event_name', false)}
					/>
				{:else if isEditor}
					<h1
						data-testid="event-detail-name"
						aria-labelledby="event-detail-name-value"
						class="font-display text-2xl"
					>
						<button
							type="button"
							data-testid="event-edit-btn-name"
							class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-2xl disabled:opacity-40"
							disabled={editWritePending.event_name === true || isOffline}
							bind:this={pencilRefs.event_name}
							onclick={() => beginFieldEdit('event_name')}
						>
							<span class="sr-only">{m.event_edit_name_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							<span id="event-detail-name-value">{detail.name}</span>
						</button>
					</h1>
				{:else}
					<h1 data-testid="event-detail-name" class="font-display text-2xl">{detail.name}</h1>
				{/if}
				{#if editErrors.event_name}
					<p data-testid="event-edit-error-name" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				{#if editingField === 'start_datetime'}
					<div
						data-testid="event-edit-input-start_datetime"
						role="group"
						aria-label={m.event_edit_start_datetime_aria_label()}
						class="flex flex-wrap items-center gap-2 text-ink-2"
						onfocusout={handleStartDatetimeFocusOut}
					>
						<input
							type="date"
							data-testid="event-edit-input-start_datetime-date"
							aria-label={m.time_select_date_label()}
							class="min-w-0 border-b border-ink bg-transparent text-ink-2"
							value={editDraftDate}
							use:focusOnMount
							oninput={(e) =>
								updateCompositeDraft((e.currentTarget as HTMLInputElement).value, editDraftTime)}
							onkeydown={(e) => handleFieldKeydown(e, 'start_datetime', false)}
						/>
						<TimeSelect
							prefix="event-edit-input-start_datetime"
							value={editDraftTime}
							onkeydown={(e) => handleFieldKeydown(e, 'start_datetime', false)}
							onchange={(v) => updateCompositeDraft(editDraftDate, v)}
						/>
					</div>
				{:else if startAt}
					{#if isEditor}
						<button
							type="button"
							data-testid="event-edit-btn-start_datetime"
							class="group flex min-h-11 w-full appearance-none flex-wrap items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
							disabled={editWritePending.start_datetime === true || isOffline}
							bind:this={pencilRefs.start_datetime}
							onclick={() => beginFieldEdit('start_datetime')}
						>
							<span class="sr-only">{m.event_edit_start_datetime_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							<span data-testid="event-detail-time" class="flex flex-wrap items-center gap-2">
								<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
									startAt,
									detail.durationMinutes
								)}
							</span>
						</button>
					{:else}
						<p data-testid="event-detail-time" class="flex flex-wrap items-center gap-2 text-base text-ink-2">
							<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
								startAt,
								detail.durationMinutes
							)}
						</p>
					{/if}
				{:else if isEditor}
					<button
						type="button"
						data-testid="event-edit-btn-start_datetime"
						class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-ink-3 disabled:opacity-40"
						disabled={editWritePending.start_datetime === true || isOffline}
						bind:this={pencilRefs.start_datetime}
						onclick={() => beginFieldEdit('start_datetime')}
					>
						<span class="sr-only">{m.event_edit_start_datetime_aria_label()}</span>
						<span aria-hidden="true" class="group-hover:text-ink">✎</span>
					</button>
				{/if}
				{#if editErrors.start_datetime}
					<p data-testid="event-edit-error-start_datetime" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				{#if editingField === 'duration_minutes'}
					<div
						data-testid="event-edit-input-duration_minutes"
						role="group"
						aria-label={m.event_edit_duration_minutes_aria_label()}
						class="flex flex-wrap items-center gap-2 text-ink-2"
						onfocusout={handleDurationEndFocusOut}
					>
						<input
							type="date"
							data-testid="event-edit-input-duration_minutes-date"
							aria-label={m.time_select_date_label()}
							class="min-w-0 border-b border-ink bg-transparent text-ink-2"
							value={editDraftDate}
							use:focusOnMount
							oninput={(e) =>
								updateCompositeDraft((e.currentTarget as HTMLInputElement).value, editDraftTime)}
							onkeydown={(e) => handleFieldKeydown(e, 'duration_minutes', false)}
						/>
						<TimeSelect
							prefix="event-edit-input-duration_minutes"
							value={editDraftTime}
							onkeydown={(e) => handleFieldKeydown(e, 'duration_minutes', false)}
							onchange={(v) => updateCompositeDraft(editDraftDate, v)}
						/>
					</div>
				{:else if detail.durationMinutes > 0 || isEditor}
					{#if isEditor}
						<button
							type="button"
							data-testid="event-edit-btn-duration_minutes"
							class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
							disabled={editWritePending.duration_minutes === true || isOffline}
							bind:this={pencilRefs.duration_minutes}
							onclick={() => beginFieldEdit('duration_minutes')}
						>
							<span class="sr-only">{m.event_edit_duration_minutes_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.durationMinutes > 0}
								<span data-testid="event-detail-duration">
									{m.agenda_duration_min({ minutes: detail.durationMinutes })}
								</span>
							{/if}
						</button>
					{:else}
						<p class="flex items-center gap-2 text-base text-ink-2">
							<span data-testid="event-detail-duration">
								{m.agenda_duration_min({ minutes: detail.durationMinutes })}
							</span>
						</p>
					{/if}
				{/if}
				{#if editRangeErrors.duration_minutes}
					<p data-testid="event-edit-error-duration_minutes" role="alert" class="text-xs text-red-700">
						{m.event_end_before_start()}
					</p>
				{:else if editErrors.duration_minutes}
					<p data-testid="event-edit-error-duration_minutes" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				{#if editingField === 'location'}
					<input
						type="text"
						data-testid="event-edit-input-location"
						aria-label={m.event_edit_location_aria_label()}
						class="border-b border-ink bg-transparent text-ink-2"
						list={LOCATION_SUGGESTIONS_ID}
						value={editDraft}
						use:focusOnMount
						oninput={(e) => (editDraft = (e.currentTarget as HTMLInputElement).value)}
						onfocus={ensureLocationCorpusLoaded}
						onblur={() => confirmFieldEdit('location', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'location', false)}
					/>
					<datalist id={LOCATION_SUGGESTIONS_ID}>
						{#each locationSuggestions as loc (loc)}
							<option value={loc}></option>
						{/each}
					</datalist>
				{:else if detail.location || isEditor}
					{#if isEditor}
						<button
							type="button"
							data-testid="event-edit-btn-location"
							class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
							disabled={editWritePending.location === true || isOffline}
							bind:this={pencilRefs.location}
							onclick={() => beginFieldEdit('location')}
						>
							<span class="sr-only">{m.event_edit_location_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.location}
								<span data-testid="event-detail-location">{detail.location}</span>
							{/if}
						</button>
					{:else}
						<p class="flex items-center gap-2 text-base text-ink-2">
							<span data-testid="event-detail-location">{detail.location}</span>
						</p>
					{/if}
				{/if}
				{#if editErrors.location}
					<p data-testid="event-edit-error-location" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				{#if detail.conductorNames.length > 0}
					<p data-testid="event-detail-conductors" class="text-base text-ink-2">
						{m.event_detail_conductor_label()}:
						{#each detail.conductorNames as conductorName, conductorIndex (conductorName + conductorIndex)}{#if conductorIndex > 0}{', '}{/if}<PersonName
								name={conductorName}
							/>{/each}
					</p>
				{/if}

				{#if editingField === 'description'}
					<textarea
						data-testid="event-edit-input-description"
						aria-label={m.event_edit_description_aria_label()}
						class="mt-2 min-h-24 w-full border border-ink-4 bg-transparent p-2 text-ink"
						value={editDraft}
						use:focusOnMount
						oninput={(e) => (editDraft = (e.currentTarget as HTMLTextAreaElement).value)}
						onblur={() => confirmFieldEdit('description', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'description', true)}
					></textarea>
				{:else if detail.description || isEditor}
					{#if isEditor}
						<button
							type="button"
							data-testid="event-edit-btn-description"
							class="group mt-2 flex min-h-11 w-full appearance-none items-start gap-2 border-0 bg-transparent p-0 text-left text-base text-ink disabled:opacity-40"
							disabled={editWritePending.description === true || isOffline}
							bind:this={pencilRefs.description}
							onclick={() => beginFieldEdit('description')}
						>
							<span class="sr-only">{m.event_edit_description_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.description}
								<span data-testid="event-detail-description">{detail.description}</span>
							{/if}
						</button>
					{:else}
						<p class="mt-2 flex items-start gap-2 text-base text-ink">
							<span data-testid="event-detail-description">{detail.description}</span>
						</p>
					{/if}
				{/if}
				{#if editErrors.description}
					<p data-testid="event-edit-error-description" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				{#if isEditor && isOffline}
					<p data-testid="event-edit-write-unavailable" role="status" class="text-xs text-ink-2">
						{m.write_unavailable_no_signal()}
					</p>
				{/if}
				{#if editHeldOffline}
					<p data-testid="event-edit-held-offline" role="alert" class="text-xs text-ink-2">
						{m.write_held_no_signal()}
					</p>
				{/if}

				<div data-testid="event-edit-status" role="status" aria-live="polite" class="sr-only">
					{editStatus}
				</div>

				{#if showScheduleSection}
					<section
						data-testid="event-detail-schedule"
						class="mt-4 flex flex-col gap-2"
						aria-labelledby="event-detail-schedule-heading"
					>
						<h2 id="event-detail-schedule-heading" class="font-display text-lg text-ink-2">
							{m.event_schedule_heading()}
						</h2>
						{#if isEditor && isOffline}
							<p
								data-testid="event-schedule-write-unavailable"
								role="status"
								class="text-xs text-ink-2"
							>
								{m.write_unavailable_no_signal()}
							</p>
						{/if}
						{#if scheduleRows.length > 0}
							<ul class="flex flex-col gap-1">
								{#each scheduleRows as row (row.id)}
									<li class="flex flex-col gap-0.5">
										<div class="flex items-center gap-2 text-sm text-ink">
											{#if isEditor && scheduleEditingId === row.id}
												<div
													data-schedule-edit-row={row.id}
													class="flex flex-1 flex-wrap items-end gap-2"
												>
													<div class="flex flex-col gap-0.5">
														<label
															for={`event-schedule-edit-name-input-${row.id}`}
															class="text-xs text-ink-2"
														>
															{m.event_schedule_name_label()}
														</label>
														<input
															type="text"
															id={`event-schedule-edit-name-input-${row.id}`}
															data-testid={`event-schedule-edit-name-${row.id}`}
															class="border-b border-ink bg-transparent text-ink"
															value={scheduleEditName}
															use:focusOnMount
															oninput={(e) => {
																scheduleEditName = (
																	e.currentTarget as HTMLInputElement
																).value;
																clearScheduleError(`schedule-edit-name-${row.id}`);
															}}
															onblur={(e) => handleScheduleNameBlur(e, row.id)}
															onkeydown={(e) => handleScheduleNameKeydown(e, row.id)}
														/>
													</div>
													<div class="flex flex-col gap-0.5">
														<span
															id={`event-schedule-edit-datetime-${row.id}-label`}
															class="text-xs text-ink-2">{m.event_schedule_datetime_label()}</span
														>
														<div
															data-testid={`event-schedule-edit-datetime-${row.id}`}
															role="group"
															aria-labelledby={`event-schedule-edit-datetime-${row.id}-label`}
															class="flex flex-wrap items-center gap-2 text-ink-2"
															onfocusout={(e) =>
																handleScheduleEditDatetimeFocusOut(e, row.id)}
														>
															<input
																type="date"
																data-testid={`event-schedule-edit-datetime-${row.id}-date`}
																aria-label={m.time_select_date_label()}
																class="min-w-0 border-b border-ink bg-transparent text-ink"
																value={scheduleEditDate}
																oninput={(e) =>
																	(scheduleEditDate = (
																		e.currentTarget as HTMLInputElement
																	).value)}
															/>
															<TimeSelect
																prefix={`event-schedule-edit-datetime-${row.id}`}
																value={scheduleEditTime}
																onchange={(v) => (scheduleEditTime = v)}
															/>
														</div>
													</div>
												</div>
											{:else if isEditor}
												<button
													type="button"
													data-testid={`event-schedule-edit-${row.id}`}
													disabled={scheduleWritePending[`schedule-edit-name-${row.id}`] ===
														true ||
														scheduleWritePending[`schedule-edit-datetime-${row.id}`] ===
															true ||
														isOffline}
													class="group flex min-h-11 flex-1 appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-sm text-ink disabled:opacity-40"
													onclick={() => beginScheduleEdit(row)}
												>
													<span class="sr-only">{m.event_schedule_edit_aria_label()}</span>
													<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
														>✎</span
													>
													<span data-testid="event-schedule-row-name">{row.name}</span>
													<span data-testid="event-schedule-row-time" class="text-ink-2"
														>{scheduleRowTime(row.datetime)}</span
													>
												</button>
											{:else}
												<span data-testid="event-schedule-row-name">{row.name}</span>
												<span data-testid="event-schedule-row-time" class="text-ink-2"
													>{scheduleRowTime(row.datetime)}</span
												>
											{/if}

											{#if isEditor && scheduleEditingId !== row.id}
												{#if scheduleRemoveArmedId === row.id}
													<div class="flex items-center gap-1">
														<button
															type="button"
															data-testid={`event-schedule-remove-confirm-${row.id}`}
															aria-label={m.event_schedule_remove_confirm_aria_label({
																name: row.name
															})}
															disabled={scheduleWritePending[
																`schedule-remove-${row.id}`
															] === true || isOffline}
															aria-busy={scheduleWritePending[`schedule-remove-${row.id}`] ===
																true}
															class="flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
															onclick={() => confirmScheduleRemove(row.id)}
														>
															{m.event_schedule_remove_confirm_short()}
														</button>
														<button
															type="button"
															data-testid={`event-schedule-remove-cancel-${row.id}`}
															aria-label={m.event_schedule_remove_cancel_aria_label({
																name: row.name
															})}
															disabled={scheduleWritePending[
																`schedule-remove-${row.id}`
															] === true}
															class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
															onclick={() => cancelScheduleRemove()}
														>
															{m.event_schedule_remove_cancel_short()}
														</button>
													</div>
												{:else}
													<DeleteTrigger
														data-testid={`event-schedule-remove-${row.id}`}
														aria-label={m.event_schedule_remove_aria_label({ name: row.name })}
														iconClass="h-4 w-4"
														disabled={isOffline}
														onclick={() => armScheduleRemove(row.id)}
													/>
												{/if}
											{/if}
										</div>
										{#if scheduleRowError(row.id)}
											{@const rowError = scheduleRowError(row.id)!}
											<p
												data-testid={`event-schedule-error-${row.id}`}
												role="alert"
												class="text-xs text-red-700"
											>
												{rowError()}
											</p>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if isEditor}
							{#if scheduleErrors[SCHEDULE_ADD_KEY]}
								{@const addError = scheduleErrors[SCHEDULE_ADD_KEY]!}
								<p
									id="event-schedule-add-error"
									data-testid="event-schedule-add-error"
									role="alert"
									class="text-xs text-red-700"
								>
									{addError()}
								</p>
							{/if}
							{#if scheduleAddOpen}
								<div class="flex flex-wrap items-end gap-2">
									<div class="flex flex-col gap-0.5">
										<label for="event-schedule-add-name-input" class="text-xs text-ink-2">
											{m.event_schedule_name_label()}
										</label>
										<input
											type="text"
											id="event-schedule-add-name-input"
											data-testid="event-schedule-add-name"
											class="border-b border-ink bg-transparent text-ink"
											aria-invalid={scheduleAddErrorField === 'name' ? true : undefined}
											aria-describedby={scheduleAddErrorField === 'name'
												? 'event-schedule-add-error'
												: undefined}
											value={scheduleAddName}
											use:focusOnMount
											oninput={(e) => {
												scheduleAddName = (e.currentTarget as HTMLInputElement).value;
												clearScheduleAddError();
											}}
										/>
									</div>
									<div class="flex flex-col gap-0.5">
										<span id="event-schedule-add-datetime-label" class="text-xs text-ink-2"
											>{m.event_schedule_datetime_label()}</span
										>
										<div
											data-testid="event-schedule-add-datetime"
											role="group"
											aria-labelledby="event-schedule-add-datetime-label"
											aria-describedby={scheduleAddErrorField === 'datetime'
												? 'event-schedule-add-error'
												: undefined}
											class="flex flex-wrap items-center gap-2 text-ink-2"
										>
											<input
												type="date"
												data-testid="event-schedule-add-datetime-date"
												aria-label={m.time_select_date_label()}
												aria-invalid={scheduleAddErrorField === 'datetime' ? true : undefined}
												class="min-w-0 border-b border-ink bg-transparent text-ink"
												value={scheduleAddDate}
												oninput={(e) => {
													scheduleAddDate = (e.currentTarget as HTMLInputElement).value;
													clearScheduleAddError();
												}}
											/>
											<TimeSelect
												prefix="event-schedule-add-datetime"
												value={scheduleAddTime}
												onchange={(v) => {
													scheduleAddTime = v;
													clearScheduleAddError();
												}}
											/>
										</div>
									</div>
									<button
										type="button"
										data-testid="event-schedule-add-submit"
										disabled={scheduleWritePending[SCHEDULE_ADD_KEY] === true || isOffline}
										class="flex min-h-11 items-center rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50"
										onclick={submitScheduleAdd}
									>
										{m.event_schedule_add_submit()}
									</button>
									<button
										type="button"
										data-testid="event-schedule-add-cancel"
										class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink"
										onclick={cancelScheduleAdd}
									>
										{m.event_schedule_add_cancel()}
									</button>
								</div>
							{:else}
								<button
									type="button"
									data-testid="event-schedule-add"
									class="flex min-h-11 items-center gap-1 self-start text-xs text-ink-2 underline hover:text-ink"
									onclick={beginScheduleAdd}
								>
									{m.event_schedule_add_label()}
								</button>
							{/if}
						{/if}
						<div
							data-testid="event-schedule-status"
							role="status"
							aria-live="polite"
							class="sr-only"
						>
							{scheduleStatus}
						</div>
					</section>
				{/if}

				<section
					data-testid="event-detail-rsvp"
					class="mt-3 flex flex-col gap-2"
					aria-labelledby="event-detail-rsvp-heading"
				>
					<h2 id="event-detail-rsvp-heading" class="font-display text-lg text-ink-2">
						{m.event_detail_rsvp_heading()}
					</h2>
					{#if isPast}
						<RsvpControl status={myRsvp?.status ?? null} pending={true} />
					{:else if membership === 'non-member'}
						<RsvpNonMemberHint />
					{:else if rsvpRights !== 'not-editor'}
						<RsvpControl
							status={myRsvp?.status ?? null}
							pending={rsvpRights === 'loading' || rsvpPending}
							saveFailed={rsvpFailed}
							saved={rsvpSaved}
							onchange={handleRsvpChange}
						/>
					{/if}
					{#snippet tallyLine()}
						{#if tally}
							<span data-testid="event-detail-tally" class="text-xs text-ink-2" aria-live="polite">
								<span data-testid="event-detail-tally-going"
									>{m.event_detail_tally_going({ count: tally.going })}</span
								>
								·
								<span data-testid="event-detail-tally-not_going"
									>{m.event_detail_tally_not_going({ count: tally.not_going })}</span
								>
								·
								<span data-testid="event-detail-tally-maybe"
									>{m.event_detail_tally_maybe({ count: tally.maybe })}</span
								>
								·
								<span data-testid="event-detail-tally-late"
									>{m.event_detail_tally_late({ count: tally.late })}</span
								>
								{#if tally.not_responded !== null}
									·
									<span data-testid="event-detail-tally-not_responded"
										>{m.event_detail_tally_not_responded({ count: tally.not_responded })}</span
									>
								{/if}
							</span>
						{/if}
					{/snippet}
					{#if tally}
						{#if showTallyCardToggle}
							<button
								type="button"
								data-testid="event-detail-tally-toggle"
								class="flex w-full flex-wrap items-baseline gap-1 text-left"
								aria-expanded={tallyCardOpen}
								onclick={toggleTallyCard}
							>
								{@render tallyLine()}
								<span class="sr-only"
									>{tallyCardOpen
										? m.event_detail_tally_card_collapse_label()
										: m.event_detail_tally_card_expand_label()}</span
								>
							</button>
							{#if tallyCardOpen}
								<div
									data-testid="event-detail-tally-card"
									class="flex flex-col gap-2 rounded-md border border-ink-5 p-2 text-xs text-ink-2"
								>
									{#if tallyCardNamesError}
										<p
											data-testid="event-detail-tally-card-names-error"
											role="status"
											class="flex flex-wrap items-baseline gap-2 text-red-700"
										>
											<span>{m.event_detail_tally_names_error()}</span>
											<button
												type="button"
												data-testid="event-detail-tally-card-names-retry"
												class="underline"
												onclick={retryTallyCardNames}
											>
												{m.event_detail_retry()}
											</button>
										</p>
									{/if}
									{#if tallyCardNamesPartial}
										<p data-testid="event-detail-tally-card-partial-notice" class="text-ink-2">
											{m.picker_partial_members_notice()}
										</p>
									{/if}
									{#if tallyCardNames === null && !tallyCardNamesError}
										<p data-testid="event-detail-tally-card-loading" class="text-ink-2">
											{m.picker_roster_loading()}
										</p>
									{/if}
									{#each tallyCardGroups ?? [] as group (group.status)}
										<div data-testid={`event-detail-tally-card-group-${group.status}`}>
											<h3 class="font-medium text-ink">
												{rsvpTallyStatusLabel(group.status)} ({group.count})
											</h3>
											{#if group.memberIds.length > 0 && tallyCardNames}
												<ul class="pl-3">
													{#each group.memberIds as memberId (memberId)}
														<li>
															<PersonName
																name={tallyCardNames[memberId] ??
																	m.event_detail_tally_name_unavailable()}
															/>
														</li>
													{/each}
												</ul>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						{:else}
							{@render tallyLine()}
						{/if}
						{#if tallyMembersPartial && tally.not_responded !== null && !tallyCardNamesPartial}
							<p data-testid="event-detail-tally-partial-notice" class="text-xs text-ink-2">
								{m.picker_partial_members_notice()}
							</p>
						{/if}
						{#if detail.capacity !== null}
							<p data-testid="event-detail-capacity" class="text-xs text-ink-2">
								{m.event_detail_capacity({ going: tally.going, capacity: detail.capacity })}
							</p>
						{/if}
					{/if}
					{#if tallyError}
						<p
							data-testid="event-detail-tally-error"
							role="status"
							class="flex flex-wrap items-baseline gap-2 text-xs text-red-700"
						>
							<span>{m.event_detail_tally_error()}</span>
							<button
								type="button"
								data-testid="event-detail-tally-retry"
								class="underline"
								onclick={retryTally}
							>
								{m.event_detail_retry()}
							</button>
						</p>
					{/if}
				</section>

				{#if showWorksSection}
					<section
						data-testid="event-detail-works"
						class="mt-4 flex flex-col gap-2"
						aria-labelledby="event-detail-works-heading"
					>
						<h2 id="event-detail-works-heading" class="font-display text-lg text-ink-2">
							{m.event_detail_works_heading()}
						</h2>
						<RepertoireElement
							rows={workRows}
							expanded={true}
							onpdfclick={handlePdfClick}
							{heldFileIds}
							partLinkDb={selected?.db}
							manageRights={seasonManageRights}
							seasonRights={seasonManageRights}
							eventRights={eventManageRights}
							context={worksContext}
							{pickableWorksList}
							{pickableWorksVisible}
							pickableWorksPartial={libraryWorksPartial}
							pickableEditions={pickableEditionsList}
							pickableEditionsPartial={libraryEditionsPartial}
							{editionOptionsByRowId}
							{editionsResolvedWorkIds}
							pendingKeys={managePendingKeys}
							onaddwork={handleAddWork}
							onstatuschange={handleStatusChange}
							onpinedition={handlePinEdition}
							onremoveitem={handleRemoveItem}
							onmoveitem={handleMoveItem}
							onaddprogramitem={handleAddProgramItem}
						/>
						{#if manageError}
							<p data-testid="repertoire-manage-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_manage_error()}
							</p>
						{/if}
						<div data-testid="repertoire-manage-status" role="status" aria-live="polite" class="sr-only">
							{manageStatus}
						</div>
					</section>
				{/if}

				{#if showAttendanceSection}
					<section
						data-testid="event-detail-attendance"
						class="mt-4 flex flex-col gap-2"
						aria-labelledby="event-detail-attendance-heading"
					>
						<h2 id="event-detail-attendance-heading" class="font-display text-lg text-ink-2">
							{m.event_detail_attendance_heading()}
						</h2>
						{#if myAttendanceStatus !== null}
							<AttendanceBadge status={myAttendanceStatus} testid="event-detail-attendance-badge" />
						{/if}
						{#if hasAttendanceRecords}
							<p
								data-testid="event-detail-attendance-tally"
								class="text-xs text-ink-2"
								aria-live="polite"
							>
								<span data-testid="event-detail-attendance-tally-present"
									>{m.event_detail_attendance_tally_present({ count: attendanceTally.present })}</span
								>
								·
								<span data-testid="event-detail-attendance-tally-absent"
									>{m.event_detail_attendance_tally_absent({ count: attendanceTally.absent })}</span
								>
								·
								<span data-testid="event-detail-attendance-tally-late"
									>{m.event_detail_attendance_tally_late({ count: attendanceTally.late })}</span
								>
							</p>
						{/if}
						{#if canMarkAttendanceForEvent && !attendancePanelOpen}
							<TakeAttendanceButton eventName={detail.name} onclick={openAttendancePanel} />
						{/if}
						{#if attendancePanelOpen && agendaItemForPanel}
							<AttendanceSurface
								item={agendaItemForPanel}
								members={attendanceRoster}
								attendanceByMemberId={attendanceMap}
								rsvpByMemberId={attendanceRsvpMap}
								loading={attendancePanelLoading}
								error={attendancePanelError}
								pendingMemberIds={attendancePendingMemberIds}
								failedMemberIds={attendanceFailedMemberIds}
								savedMemberIds={attendanceSavedMemberIds}
								membersPartial={attendanceRosterPartial}
								ontoggle={handleAttendanceToggle}
								onclose={closeAttendancePanel}
							/>
						{/if}
					</section>
				{/if}

				{#if isEditor}
					<div
						data-testid="event-detail-danger-zone"
						class="mt-6 flex flex-col items-start gap-1 border-t border-ink-3/20 pt-3"
					>
						{#if deleteArmed}
							<div class="flex items-center gap-2">
								<button
									type="button"
									data-testid="event-detail-delete-confirm"
									aria-label={m.event_detail_delete_confirm_aria_label()}
									disabled={deletePending || isOffline}
									aria-busy={deletePending}
									class="flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
									onclick={() => void confirmDelete()}
								>
									{m.event_detail_delete_confirm_short()}
								</button>
								<button
									type="button"
									data-testid="event-detail-delete-cancel"
									aria-label={m.event_detail_delete_cancel_aria_label()}
									disabled={deletePending}
									class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
									onclick={() => void cancelDelete()}
								>
									{m.event_detail_delete_cancel_short()}
								</button>
							</div>
						{:else}
							<DeleteTrigger
								data-testid="event-detail-delete"
								class="gap-1 px-1 text-xs underline"
								disabled={isOffline}
								onclick={() => void armDelete()}
							>
								{#snippet children()}
									{m.event_detail_delete_label()}
								{/snippet}
							</DeleteTrigger>
						{/if}
						{#if deleteError}
							<p data-testid="event-detail-delete-error" role="alert" class="text-xs text-red-700">
								{deleteErrorText(deleteError)}
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</main>
