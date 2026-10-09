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
	import { canDeleteSeries } from '$lib/repertoire/repertoireActions';
	import type SeasonManagePanel from '$lib/agenda/SeasonManagePanel.svelte';
	import { createAgendaCreateFlows, createCreateFlowState } from '$lib/agenda/agendaCreateFlows';
	import ListOfStuff from '$lib/components/ListOfStuff.svelte';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import AgendaNotices from '$lib/agenda/AgendaNotices.svelte';
	import AgendaCollectivesStatus from '$lib/agenda/AgendaCollectivesStatus.svelte';
	import AgendaManageArea from '$lib/agenda/AgendaManageArea.svelte';
	import AgendaListArea from '$lib/agenda/AgendaListArea.svelte';
	import { agendaViewStore } from '$lib/preferences/agendaView';
	import { createAgendaLoadState, createLoadCounters, createAgendaLoader } from '$lib/agenda/agendaLoad';
	import { createAgendaPageHandlers } from '$lib/agenda/agendaPageHandlers';
	import {
		createAgendaPanelState,
		createAgendaRepertoireQueues,
		resetPanelRepertoire
	} from '$lib/agenda/agendaRepertoireQueues';
	import { agendaLoaderReads, agendaRepertoireSeams } from '$lib/agenda/agendaPageSeams';
	import { createAgendaPageView } from '$lib/agenda/agendaPageView.svelte';
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
	const reads = agendaLoaderReads();

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
		findMyMemberId: reads.findMyMemberId,
		panelWorkRows: () => view.panelWorkRows
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
		pendingEntriesForEvent: (eventId) => attendanceQueue.pendingEntriesForEvent(eventId),
		resetSeasonManage,
		closeSeasonCreateForm,
		closeEventCreateForm: () => (flow.eventCreateOpen = false),
		closeSeriesCreateForm: () => (flow.seriesCreateOpen = false),
		restoreSeriesCreateRun,
		refreshPresence,
		...reads
	});

	const LOCATION_SUGGESTIONS_ID = 'agenda-location-suggestions';

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
		...agendaRepertoireSeams()
	});

	const view = createAgendaPageView(ag, seq, panel, { rowHandlers, manageCfg });

	let seasonManageOpen = $state(false);
	let seasonManageSwitchGeneration = 0;
	let seasonManagePanelEl = $state<HTMLDivElement | null>(null);
	let seasonManagePanel = $state<SeasonManagePanel>();

	function resetSeasonManage(): void {
		seasonManageOpen = false;
		seasonManageSwitchGeneration += 1;
		seasonManagePanel?.resetPanelState();
		resetPanelRepertoire(ag, seq, panel);
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
			? view.filteredAgendaItems.some((it) => it.id === id)
			: view.filteredAgendaItems.some((it) => it.id === id) ||
				view.filteredRecentItems.some((it) => it.id === id);
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
					{#each view.locationSuggestions as loc (loc)}
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
					{#if ag.sessionExpired || ag.agendaError}
						<ListOfStuff title={m.nav_agenda()}>
							{#if ag.sessionExpired}
								<SessionExpiredNotice centered />
							{:else}
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
							{/if}
						</ListOfStuff>
					{:else}
						<AgendaNotices
							rsvpPartial={ag.rsvpPartial}
							attendancePartial={ag.attendancePartial}
							showOnboarding={!ag.agendaLoading &&
								ag.seasons.length === 0 &&
								ag.seasonCreateRights === 'editor' &&
								!flow.seasonCreateOpen}
						/>
						<AgendaManageArea
							{ag}
							{flow}
							bind:manageableSeasonId={ag.manageableSeasonId}
							bind:manageableSeasonRights={ag.manageableSeasonRights}
							bind:seriesCreateOpen={flow.seriesCreateOpen}
							bind:seriesCreateSubmitting={flow.seriesCreateSubmitting}
							bind:seriesCreateResumeByDb={flow.seriesCreateResumeByDb}
							bind:seriesRunDb={flow.seriesRunDb}
							bind:seasonCreateSubmitting={flow.seasonCreateSubmitting}
							bind:seasonCreateStatus={flow.seasonCreateStatus}
							bind:eventCreateSubmitting={flow.eventCreateSubmitting}
							bind:eventCreateStatus={flow.eventCreateStatus}
							bind:seasonManagePanel
							bind:seasonManageOpen
							bind:seasonManagePanelEl
							{selected}
							{panel}
							{view}
							seams={{
								getRoster,
								getSections,
								rosterPickerOptions,
								pickerPromptText,
								loadForSelected,
								loadPanelRepertoire,
								resetSeasonManage,
								openEventCreateForm,
								openSeriesCreateForm,
								handlePdfClick,
								handlePanelAddWork,
								handlePanelStatusChange,
								handlePanelRemoveItem
							}}
							{listEventSeriesForSeason}
							{updateSeasonField}
							{addSeasonConductor}
							{apiRemoveSeasonConductor}
							{apiDeleteEventSeries}
							{apiCountSeriesOccurrences}
							{apiCountSeasonScope}
							{apiDeleteSeason}
							{canDeleteSeries}
							currentRequestId={() => seq.requestId}
							switchGeneration={() => seasonManageSwitchGeneration}
							{seriesRunUnfinished}
							{createEntryPointsBlocked}
							locationSuggestionsId={LOCATION_SUGGESTIONS_ID}
							{isOffline}
							writeUnavailableText={m.write_unavailable_no_signal()}
							{openSeasonCreateForm}
							{dismissSeasonCreateForm}
							{closeSeasonCreateForm}
							{refreshSeasonManageLists}
							{dismissEventCreateForm}
							{restoreEventCreateFocus}
							{surfaceCreatedEvent}
							closeEventCreateForm={() => (flow.eventCreateOpen = false)}
						/>
						<AgendaListArea
							{ag}
							{view}
							{selected}
							{pendingEventIds}
							{justCreatedEventId}
							onpdfclick={handlePdfClick}
							onrsvpchange={handleRsvpChange}
							ontakeattendance={openAttendancePanel}
							onexpandseasonsummary={handleExpandSeasonSummary}
							onattendancetoggle={handleAttendanceToggle}
							onattendanceclose={closeAttendancePanel}
						/>
					{/if}
				</div>
			</div>
	{:else}
		<AgendaCollectivesStatus {collectives} />
	{/if}
{/if}
