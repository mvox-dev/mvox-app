<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import EventCreateForm from '$lib/agenda/EventCreateForm.svelte';
	import SeasonCreateForm from '$lib/agenda/SeasonCreateForm.svelte';
	import SeasonManagePanel from '$lib/agenda/SeasonManagePanel.svelte';
	import { agendaFilterBucketOf } from '$lib/agenda/agendaFilter';
	import { PANEL_ADD_WORK_KEY, type AgendaPanelState } from '$lib/agenda/agendaRepertoireQueues';
	import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
	import type { AgendaPageView } from '$lib/agenda/agendaPageView.svelte';
	import type { CreateFlowState } from '$lib/agenda/agendaCreateFlows';

	type Panel = ComponentProps<typeof SeasonManagePanel>;
	type EventForm = ComponentProps<typeof EventCreateForm>;
	type SeasonForm = ComponentProps<typeof SeasonCreateForm>;
	type Seams = Pick<
		Panel,
		| 'getRoster'
		| 'getSections'
		| 'rosterPickerOptions'
		| 'pickerPromptText'
		| 'loadForSelected'
		| 'loadPanelRepertoire'
		| 'resetSeasonManage'
		| 'openEventCreateForm'
		| 'openSeriesCreateForm'
		| 'handlePdfClick'
		| 'handlePanelAddWork'
		| 'handlePanelStatusChange'
		| 'handlePanelRemoveItem'
	>;

	let {
		ag,
		flow,
		manageableSeasonId = $bindable(),
		manageableSeasonRights = $bindable(),
		seriesCreateOpen = $bindable(),
		seriesCreateSubmitting = $bindable(),
		seriesCreateResumeByDb = $bindable(),
		seriesRunDb = $bindable(),
		seasonCreateSubmitting = $bindable(),
		seasonCreateStatus = $bindable(),
		eventCreateSubmitting = $bindable(),
		eventCreateStatus = $bindable(),
		seasonManagePanel = $bindable(),
		seasonManageOpen = $bindable(),
		seasonManagePanelEl = $bindable(),
		selected,
		panel,
		view,
		seams,
		listEventSeriesForSeason,
		updateSeasonField,
		addSeasonConductor,
		apiRemoveSeasonConductor,
		apiDeleteEventSeries,
		apiCountSeriesOccurrences,
		apiCountSeasonScope,
		apiDeleteSeason,
		canDeleteSeries,
		currentRequestId,
		switchGeneration,
		seriesRunUnfinished,
		createEntryPointsBlocked,
		locationSuggestionsId,
		isOffline,
		writeUnavailableText,
		openSeasonCreateForm,
		dismissSeasonCreateForm,
		closeSeasonCreateForm,
		refreshSeasonManageLists,
		dismissEventCreateForm,
		restoreEventCreateFocus,
		surfaceCreatedEvent,
		closeEventCreateForm
	}: {
		ag: AgendaLoadState;
		flow: CreateFlowState;
		manageableSeasonId: Panel['manageableSeasonId'];
		manageableSeasonRights: Panel['manageableSeasonRights'];
		seriesCreateOpen: boolean;
		seriesCreateSubmitting: boolean;
		seriesCreateResumeByDb: Panel['seriesCreateResumeByDb'];
		seriesRunDb: Panel['seriesRunDb'];
		seasonCreateSubmitting: boolean;
		seasonCreateStatus: string;
		eventCreateSubmitting: boolean;
		eventCreateStatus: string;
		seasonManagePanel: SeasonManagePanel | undefined;
		seasonManageOpen: boolean;
		seasonManagePanelEl: HTMLDivElement | null;
		selected: NonNullable<Panel['selected'] & EventForm['selected']>;
		panel: AgendaPanelState;
		view: AgendaPageView;
		seams: Seams;
		listEventSeriesForSeason: Panel['listEventSeriesForSeason'];
		updateSeasonField: Panel['updateSeasonField'];
		addSeasonConductor: Panel['addSeasonConductor'];
		apiRemoveSeasonConductor: Panel['apiRemoveSeasonConductor'];
		apiDeleteEventSeries: Panel['apiDeleteEventSeries'];
		apiCountSeriesOccurrences: Panel['apiCountSeriesOccurrences'];
		apiCountSeasonScope: Panel['apiCountSeasonScope'];
		apiDeleteSeason: Panel['apiDeleteSeason'];
		canDeleteSeries: Panel['canDeleteSeries'];
		currentRequestId: Panel['currentRequestId'];
		switchGeneration: Panel['switchGeneration'];
		seriesRunUnfinished: boolean;
		createEntryPointsBlocked: boolean;
		locationSuggestionsId: string;
		isOffline: boolean;
		writeUnavailableText: string;
		openSeasonCreateForm: () => void;
		dismissSeasonCreateForm: SeasonForm['dismiss'];
		closeSeasonCreateForm: SeasonForm['onclose'];
		refreshSeasonManageLists: EventForm['refreshSeasonManageLists'];
		dismissEventCreateForm: EventForm['dismiss'];
		restoreEventCreateFocus: EventForm['restoreEventCreateFocus'];
		surfaceCreatedEvent: EventForm['surfaceCreatedEvent'];
		closeEventCreateForm: EventForm['onclose'];
	} = $props();

	const showSeasonCreate = $derived(ag.seasonCreateRights === 'editor');
	const seasonCardCollapseDisabled = $derived(seasonManageOpen && seriesRunUnfinished);
</script>

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
	bind:manageableSeasonId
	bind:manageableSeasonRights
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
	eventCreateOpen={flow.eventCreateOpen}
	rosterRows={ag.rosterRows}
	rosterPartial={ag.rosterPartial}
	sectionsReadFailed={ag.sectionsReadFailed}
	{locationSuggestionsId}
	heldFileIds={ag.heldFileIds}
	partLinkDb={selected.db}
	panelWorkRows={view.panelWorkRows}
	panelPickableWorksList={view.panelPickableWorksList}
	panelPickableWorksVisible={panel.pickableWorksVisible}
	panelWorksPartial={ag.panelWorksPartial}
	panelPendingKeys={panel.pendingKeys}
	panelAddWorkKey={PANEL_ADD_WORK_KEY}
	panelRepertoireError={ag.panelRepertoireError}
	panelManageError={panel.manageError}
	panelManageStatus={panel.manageStatus}
	{currentRequestId}
	{switchGeneration}
	{...seams}
	{listEventSeriesForSeason}
	{updateSeasonField}
	{addSeasonConductor}
	{apiRemoveSeasonConductor}
	{apiDeleteEventSeries}
	{apiCountSeriesOccurrences}
	{apiCountSeasonScope}
	{apiDeleteSeason}
	{canDeleteSeries}
	{isOffline}
	{writeUnavailableText}
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
{#if showSeasonCreate && flow.seasonCreateOpen}
	<SeasonCreateForm
		{selected}
		rosterPartial={ag.rosterPartial}
		sectionsReadFailed={ag.sectionsReadFailed}
		bind:submitting={seasonCreateSubmitting}
		bind:status={seasonCreateStatus}
		getRoster={seams.getRoster}
		getSections={seams.getSections}
		rosterPickerOptions={seams.rosterPickerOptions}
		pickerPromptText={seams.pickerPromptText}
		loadForSelected={() => seams.loadForSelected()}
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
{#if flow.eventCreateOpen}
	<EventCreateForm
		{selected}
		manageableSeasonId={manageableSeasonId}
		seasons={ag.seasons}
		agendaTypeFilter={ag.agendaTypeFilter}
		{agendaFilterBucketOf}
		rosterPartial={ag.rosterPartial}
		sectionsReadFailed={ag.sectionsReadFailed}
		{locationSuggestionsId}
		bind:submitting={eventCreateSubmitting}
		bind:status={eventCreateStatus}
		getRoster={seams.getRoster}
		getSections={seams.getSections}
		rosterPickerOptions={seams.rosterPickerOptions}
		pickerPromptText={seams.pickerPromptText}
		loadForSelected={seams.loadForSelected}
		{refreshSeasonManageLists}
		dismiss={dismissEventCreateForm}
		onclose={closeEventCreateForm}
		{restoreEventCreateFocus}
		{surfaceCreatedEvent}
	/>
{/if}
