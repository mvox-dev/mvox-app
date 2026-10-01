<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/auth/session';
	import {
		collectiveState,
		selectedCollectiveStore,
		selectedCollectiveIdentityStore,
		pickerModeStore,
		selectCollective
	} from '$lib/collectives/store';
	import { findMyMemberId, listMyRsvps, rsvpsByEventId } from '$lib/rsvp/rsvpData';
	import { completionGateStore } from '$lib/profile/completionGate';
	import { loadActiveAndArchivedRosters } from '$lib/roster/memberLifecycle';
	import {
		listAttendance,
		listMyAttendance,
		listAllRsvpsForEvent,
		attendanceByMemberId
	} from '$lib/attendance/attendanceData';
	import { collectSources, buildWorkRows } from '$lib/repertoire/workRows';
	import { listScheduleItemsByEventId } from '$lib/schedule/scheduleData';
	import { listRepertoireItems } from '$lib/repertoire/repertoireData';
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
	import { listWorks, listEditions, listAllEditions, listAllCopies } from '$lib/library/libraryData';
	import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
	import {
		editionsByWorkId as editionsByWorkIdOf,
		editionOptionsByRowId as editionOptionsByRowIdOf,
		readScopedEditions
	} from '$lib/repertoire/editionOptions';
	import {
		attendancePanelOf,
		myAttendanceByEventIdOf,
		mySeasonRateOf,
		pickableEditionsByEventIdOf,
		visibleByEventId,
		worksManageOf
	} from '$lib/agenda/agendaWorksManage';
	import EventCreateForm from '$lib/agenda/EventCreateForm.svelte';
	import SeasonCreateForm from '$lib/agenda/SeasonCreateForm.svelte';
	import SeasonManagePanel from '$lib/agenda/SeasonManagePanel.svelte';
	import { createAgendaCreateFlows, createCreateFlowState } from '$lib/agenda/agendaCreateFlows';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import AgendaList from '$lib/agenda/AgendaList.svelte';
	import AgendaMonthView from '$lib/agenda/AgendaMonthView.svelte';
	import AgendaFilterBar from '$lib/agenda/AgendaFilterBar.svelte';
	import AgendaNotices from '$lib/agenda/AgendaNotices.svelte';
	import AgendaCollectivesStatus from '$lib/agenda/AgendaCollectivesStatus.svelte';
	import { agendaViewStore } from '$lib/preferences/agendaView';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
	import { createAgendaLoadState, createLoadCounters, createAgendaLoader } from '$lib/agenda/agendaLoad';
	import {
		agendaFilterBucketOf,
		agendaFilterChipsOf,
		filterAgendaItems,
		locationSuggestionsOf,
		type AgendaTypeFilter
	} from '$lib/agenda/agendaFilter';
	import { createAgendaPageHandlers } from '$lib/agenda/agendaPageHandlers';
	import {
		PANEL_ADD_WORK_KEY,
		createAgendaPanelState,
		createAgendaRepertoireQueues
	} from '$lib/agenda/agendaRepertoireQueues';
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
	import { writesAvailable } from '$lib/net/online';
	import { focusAfterRender } from '$lib/a11y/focusable';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	const auth = $derived($authStore);
	const collectives = $derived($collectiveState);
	const selected = $derived($selectedCollectiveStore);
	const pickerMode = $derived($pickerModeStore);
	const isOffline = $derived(!$writesAvailable);

	const ag = $state(createAgendaLoadState());
	const seq = createLoadCounters();
	let pendingEventIds = $state<Set<string>>(new Set());
	const flow = $state(createCreateFlowState());

	const {
		openSeasonCreateForm,
		closeSeasonCreateForm,
		dismissSeasonCreateForm,
		openEventCreateForm,
		openSeriesCreateForm,
		restoreSeriesCreateRun
	} = createAgendaCreateFlows(ag, flow, {
		selected: () => selected,
		entryPointsBlocked: () => createEntryPointsBlocked,
		seasonManageOpen: () => seasonManageOpen,
		openSeasonManagePanel
	});

	const {
		refreshPresence,
		rosterPickerOptions,
		pickerPromptText,
		handleRsvpChange,
		handlePdfClick,
		attendanceQueue,
		handleAttendanceToggle
	} = createAgendaPageHandlers(ag, {
		selected: () => selected,
		isOffline: () => isOffline,
		pendingEventIds: { get: () => pendingEventIds, set: (ids) => (pendingEventIds = ids) },
		findMyMemberId: (...a) => findMyMemberId(...a),
		panelWorkRows: () => panelWorkRows
	});

	const {
		getRoster,
		getSections,
		loadForSelected,
		refreshWorksAfterWrite,
		rowStore,
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
		closeEventCreateForm: () => (flow.eventCreateOpen = false),
		closeSeriesCreateForm: () => (flow.seriesCreateOpen = false),
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

	const agendaFilterChips = $derived(agendaFilterChipsOf(ag.agendaItems, ag.recentItems));
	const filteredAgendaItems = $derived(filterAgendaItems(ag.agendaItems, ag.agendaTypeFilter));
	const filteredRecentItems = $derived(filterAgendaItems(ag.recentItems, ag.agendaTypeFilter));
	function selectAgendaTypeFilter(value: AgendaTypeFilter) {
		ag.agendaTypeFilter = ag.agendaTypeFilter === value ? 'all' : value;
	}

	$effect(() => {
		if (ag.agendaTypeFilter !== 'all' && !agendaFilterChips.includes(ag.agendaTypeFilter)) {
			ag.agendaTypeFilter = 'all';
		}
	});

	const LOCATION_SUGGESTIONS_ID = 'agenda-location-suggestions';
	const locationSuggestions = $derived(locationSuggestionsOf(ag.recentItems, ag.agendaItems));

	let pickableEditionsVisibleByEventId = $state<Record<string, boolean>>({});
	let pickableWorksVisible = $state<boolean | undefined>(undefined);

	const panel = $state(createAgendaPanelState());

	const {
		repertoireQueue,
		rowHandlers,
		manageCfg,
		handlePanelAddWork,
		handlePanelStatusChange,
		handlePanelRemoveItem
	} = createAgendaRepertoireQueues(ag, seq, panel, {
		selected: () => selected,
		isOffline: () => isOffline,
		seasonManageOpen: () => seasonManageOpen,
		switchGeneration: () => seasonManageSwitchGeneration,
		refreshWorksAfterWrite,
		rows: rowStore,
		actions: {
			createRepertoireItem: (...a) => createRepertoireItem(...a),
			updateRepertoireStatus: (...a) => updateRepertoireStatus(...a),
			pinEdition: (...a) => pinEdition(...a),
			deleteProgramItem: (...a) => deleteProgramItem(...a),
			deleteRepertoireItem: (...a) => deleteRepertoireItem(...a),
			planProgramMove: (...a) => planProgramMove(...a),
			reorderProgramItems: (...a) => reorderProgramItems(...a),
			createProgramItem: (...a) => createProgramItem(...a)
		},
		createRepertoireWriteQueue,
		listRepertoireItems: (...a) => listRepertoireItems(...a)
	});

	const editionsByWorkId = $derived(editionsByWorkIdOf(ag.libraryEditions));
	const editionOptionsByRowId = $derived(
		editionOptionsByRowIdOf(
			Object.values(ag.worksByEventId).flat(),
			ag.scopedEditionsByWorkId,
			editionsByWorkId
		)
	);
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
		readScopedEditions(
			workIds,
			seq.scopedEditionWorkIdsRequested,
			(workId) => listEditions(cfg, workId),
			() => thisRequest === seq.requestId,
			(workId, options) => {
				ag.scopedEditionsByWorkId = { ...ag.scopedEditionsByWorkId, [workId]: options };
			}
		);
	});

	const pickableEditionsByEventId = $derived(
		pickableEditionsByEventIdOf(ag.libraryWorks, ag.libraryEditions, ag.worksByEventId)
	);

	$effect(() => {
		if (ag.libraryPickersLoading || ag.worksRowsLoading) return;
		pickableEditionsVisibleByEventId = visibleByEventId(pickableEditionsByEventId);
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
		panel.pickableWorksVisible = panelPickableWorksList.length > 0;
	});

	const worksManage = $derived(
		worksManageOf(ag, rowHandlers, {
			pickableWorksList,
			pickableWorksVisible,
			pickableEditionsByEventId,
			pickableEditionsVisibleByEventId,
			editionOptionsByRowId,
			editionsResolvedWorkIds
		})
	);

	const attendancePanel = $derived(attendancePanelOf(ag, handleAttendanceToggle, closeAttendancePanel));
	const myAttendanceByEventId = $derived(myAttendanceByEventIdOf(ag.myAttendance));
	const mySeasonRate = $derived(mySeasonRateOf(ag));

	const showSeasonCreate = $derived(ag.seasonCreateRights === 'editor');

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
		panel.pendingKeys = new Set();
		ag.panelRepertoireError = false;
		panel.manageError = false;
		panel.manageStatus = '';
		ag.panelRepertoireLoading = false;
		ag.panelRepertoireItemsOk = false;
		ag.panelWorksSourcesOk = false;
		panel.pickableWorksVisible = undefined;
	}

	function openSeasonManagePanel(): void {
		seasonManagePanel?.openSeasonManagePanel();
	}

	function closeSeasonManagePanel(): void {
		seasonManagePanel?.closeSeasonManagePanel();
	}

	function refreshSeasonManageLists(cfg: EntuCfg, seasonId: string): void {
		seasonManagePanel?.refreshSeasonManageLists(cfg, seasonId);
	}

	function restoreEventCreateFocus(): void {
		void focusAfterRender(() => seasonManagePanelEl);
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
		if (flow.eventCreateSubmitting) return;
		flow.eventCreateOpen = false;
		restoreEventCreateFocus();
	}

	const seriesCreateResume = $derived(
		selected ? (flow.seriesCreateResumeByDb[selected.db] ?? null) : null
	);

	const anyCreateSubmitting = $derived(
		flow.seasonCreateSubmitting || flow.eventCreateSubmitting || flow.seriesCreateSubmitting
	);

	const seriesRunUnfinished = $derived(flow.seriesCreateSubmitting || seriesCreateResume !== null);
	const createEntryPointsBlocked = $derived(anyCreateSubmitting || seriesRunUnfinished);

	const seasonCardCollapseDisabled = $derived(seasonManageOpen && seriesRunUnfinished);

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
		flow.seasonCreateStatus = '';
		flow.eventCreateStatus = '';
		untrack(() => loadForSelected());
	});
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
								onclick={() => loadForSelected()}
							>
								{m.agenda_retry()}
							</button>
						</div>
					{:else}
						<AgendaNotices
							rsvpPartial={ag.rsvpPartial}
							attendancePartial={ag.attendancePartial}
							showOnboarding={!ag.agendaLoading &&
								ag.seasons.length === 0 &&
								ag.seasonCreateRights === 'editor' &&
								!flow.seasonCreateOpen}
						/>
						{#if showSeasonCreate && !flow.seasonCreateOpen}
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
							bind:seriesCreateOpen={flow.seriesCreateOpen}
							bind:seriesCreateSubmitting={flow.seriesCreateSubmitting}
							bind:seriesCreateResumeByDb={flow.seriesCreateResumeByDb}
							bind:seriesRunDb={flow.seriesRunDb}
							{seriesRunUnfinished}
							{seasonCardCollapseDisabled}
							{createEntryPointsBlocked}
							eventCreateOpen={flow.eventCreateOpen}
							rosterRows={ag.rosterRows}
							rosterPartial={ag.rosterPartial}
							sectionsReadFailed={ag.sectionsReadFailed}
							locationSuggestionsId={LOCATION_SUGGESTIONS_ID}
							heldFileIds={ag.heldFileIds}
							partLinkDb={selected.db}
							{panelWorkRows}
							{panelPickableWorksList}
							panelPickableWorksVisible={panel.pickableWorksVisible}
							panelWorksPartial={ag.panelWorksPartial}
							panelPendingKeys={panel.pendingKeys}
							panelAddWorkKey={PANEL_ADD_WORK_KEY}
							panelRepertoireError={ag.panelRepertoireError}
							panelManageError={panel.manageError}
							panelManageStatus={panel.manageStatus}
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
							class:sr-only={!flow.seasonCreateStatus}
						>
							{flow.seasonCreateStatus}
						</div>
						{#if showSeasonCreate && flow.seasonCreateOpen}
							<SeasonCreateForm
								{selected}
								rosterPartial={ag.rosterPartial}
								sectionsReadFailed={ag.sectionsReadFailed}
								bind:submitting={flow.seasonCreateSubmitting}
								bind:status={flow.seasonCreateStatus}
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
							class:sr-only={!flow.eventCreateStatus}
						>
							{flow.eventCreateStatus}
						</div>
						{#if flow.eventCreateOpen}
							<EventCreateForm
								{selected}
								manageableSeasonId={ag.manageableSeasonId}
								seasons={ag.seasons}
								agendaTypeFilter={ag.agendaTypeFilter}
								{agendaFilterBucketOf}
								rosterPartial={ag.rosterPartial}
								sectionsReadFailed={ag.sectionsReadFailed}
								locationSuggestionsId={LOCATION_SUGGESTIONS_ID}
								bind:submitting={flow.eventCreateSubmitting}
								bind:status={flow.eventCreateStatus}
								{getRoster}
								{getSections}
								{rosterPickerOptions}
								{pickerPromptText}
								{loadForSelected}
								{refreshSeasonManageLists}
								dismiss={dismissEventCreateForm}
								onclose={() => (flow.eventCreateOpen = false)}
								{restoreEventCreateFocus}
								{surfaceCreatedEvent}
							/>
						{/if}
						{#if agendaFilterChips.length > 0}
							<AgendaFilterBar
								chips={agendaFilterChips}
								filter={ag.agendaTypeFilter}
								onselect={selectAgendaTypeFilter}
							/>
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
								partLinkDb={selected.db}
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
						{#if ag.manageError}
							<p data-testid="repertoire-manage-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_manage_error()}
							</p>
						{/if}
					{/if}
				</div>
			</div>
	{:else}
		<AgendaCollectivesStatus {collectives} />
	{/if}
{/if}
