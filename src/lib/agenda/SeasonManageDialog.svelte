<!-- #641 — the open season's manage dialog: fields, conductors, series, repertoire. -->
<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { type ComponentProps } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import RepertoireElement from '$lib/agenda/RepertoireElement.svelte';
	import SeasonManageFields from '$lib/agenda/SeasonManageFields.svelte';
	import SeasonManageConductors from '$lib/agenda/SeasonManageConductors.svelte';
	import SeasonManageSeries from '$lib/agenda/SeasonManageSeries.svelte';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { ManageRightsState } from '$lib/repertoire/types';
	import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
	import type { SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import type { SeasonManageDeleteSlot } from '$lib/agenda/seasonManageDelete';
	import type { SeasonManagePanelState } from '$lib/agenda/seasonManagePanelState';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	type RepertoireProps = ComponentProps<typeof RepertoireElement>;

	interface Props {
		sm: SeasonManagePanelState;
		selected: Collective | null;
		manageableSeasonId: string | null;
		manageableSeasonRights: ManageRightsState;
		seasonManagePanelEl: HTMLDivElement | null;
		seriesCreateOpen: boolean;
		seriesCreateSubmitting: boolean;
		seriesCreateResumeByDb: Record<string, SeriesResumeEntry>;
		seriesRunDb: string | null;
		createEntryPointsBlocked: boolean;
		eventCreateOpen: boolean;
		rosterRows: RosterRow[];
		rosterPartial: boolean;
		sectionsReadFailed: boolean;
		locationSuggestionsId: string;
		heldFileIds: RepertoireProps['heldFileIds'];
		partLinkDb: RepertoireProps['partLinkDb'];
		panelWorkRows: RepertoireProps['rows'];
		panelPickableWorksList: RepertoireProps['pickableWorksList'];
		panelPickableWorksVisible: RepertoireProps['pickableWorksVisible'];
		panelWorksPartial: boolean;
		panelPendingKeys: Set<string>;
		panelAddWorkKey: string;
		panelRepertoireError: boolean;
		panelManageError: boolean;
		panelManageStatus: string;
		switchGeneration: () => number;
		rosterPickerOptions: (excludeIds: readonly string[]) => Array<{ id: string; label: string }>;
		pickerPromptText: (optionCount: number, addPrompt: string) => string;
		loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
		openEventCreateForm: () => void;
		openSeriesCreateForm: () => void;
		handlePdfClick: (fileId: string) => void;
		handlePanelAddWork: (workId: string) => void;
		handlePanelStatusChange: NonNullable<RepertoireProps['onstatuschange']>;
		handlePanelRemoveItem: (itemId: string) => void;
		isOffline: boolean;
		writeUnavailableText: string;
		seasonManageDeleteSlot: SeasonManageDeleteSlot;
		armSeasonManageDelete: (rowId: string, confirmTestid: string) => Promise<void>;
		disarmSeasonManageDelete: (disarmTestid: string) => Promise<void>;
		refreshSeasonManageLists: (cfg: EntuCfg, seasonId: string) => void;
		onSeasonManagePanelKeydown: (event: KeyboardEvent) => void;
		updateSeasonField: typeof SeasonManage.updateSeasonField;
		addSeasonConductor: typeof SeasonManage.addSeasonConductor;
		apiRemoveSeasonConductor: typeof SeasonManage.removeSeasonConductor;
		apiDeleteEventSeries: typeof SeasonManage.deleteEventSeries;
		apiCountSeriesOccurrences: typeof SeasonManage.countSeriesOccurrences;
		canDeleteSeries: typeof RepertoireActions.canDeleteSeries;
	}

	let {
		sm = $bindable(),
		selected,
		manageableSeasonId,
		manageableSeasonRights,
		seasonManagePanelEl = $bindable(),
		seriesCreateOpen = $bindable(),
		seriesCreateSubmitting = $bindable(),
		seriesCreateResumeByDb = $bindable(),
		seriesRunDb = $bindable(),
		createEntryPointsBlocked,
		eventCreateOpen,
		rosterRows,
		rosterPartial,
		sectionsReadFailed,
		locationSuggestionsId,
		heldFileIds,
		partLinkDb,
		panelWorkRows,
		panelPickableWorksList,
		panelPickableWorksVisible,
		panelWorksPartial,
		panelPendingKeys,
		panelAddWorkKey,
		panelRepertoireError,
		panelManageError,
		panelManageStatus,
		switchGeneration,
		rosterPickerOptions,
		pickerPromptText,
		loadForSelected,
		openEventCreateForm,
		openSeriesCreateForm,
		handlePdfClick,
		handlePanelAddWork,
		handlePanelStatusChange,
		handlePanelRemoveItem,
		isOffline,
		writeUnavailableText,
		seasonManageDeleteSlot,
		armSeasonManageDelete,
		disarmSeasonManageDelete,
		refreshSeasonManageLists,
		onSeasonManagePanelKeydown,
		updateSeasonField,
		addSeasonConductor,
		apiRemoveSeasonConductor,
		apiDeleteEventSeries,
		apiCountSeriesOccurrences,
		canDeleteSeries
	}: Props = $props();
</script>

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
			{writeUnavailableText}
		</p>
	{/if}

	<SeasonManageFields
		{selected}
		{manageableSeasonId}
		{seasonManagePanelEl}
		{isOffline}
		{switchGeneration}
		{updateSeasonField}
		bind:seasonManageName={sm.seasonManageName}
		bind:seasonManageStartDate={sm.seasonManageStartDate}
		bind:seasonManageEndDate={sm.seasonManageEndDate}
		bind:seasonEditingField={sm.seasonEditingField}
		bind:seasonEditDraft={sm.seasonEditDraft}
		bind:seasonEditErrors={sm.seasonEditErrors}
		bind:seasonEditHeldOffline={sm.seasonEditHeldOffline}
		bind:seasonEditPending={sm.seasonEditPending}
		bind:seasonEditStatus={sm.seasonEditStatus}
	/>

	<SeasonManageConductors
		{selected}
		{manageableSeasonId}
		{isOffline}
		{rosterRows}
		{rosterPartial}
		{sectionsReadFailed}
		seasonManageRosterLoading={sm.seasonManageRosterLoading}
		{switchGeneration}
		{rosterPickerOptions}
		{pickerPromptText}
		{addSeasonConductor}
		{apiRemoveSeasonConductor}
		bind:seasonManageConductorIds={sm.seasonManageConductorIds}
		bind:seasonManageConductorError={sm.seasonManageConductorError}
		bind:seasonManageConductorPending={sm.seasonManageConductorPending}
		bind:seasonManageConductorStatus={sm.seasonManageConductorStatus}
	/>

	<SeasonManageSeries
		{selected}
		{manageableSeasonId}
		seasonManageStartDate={sm.seasonManageStartDate}
		seasonManageEndDate={sm.seasonManageEndDate}
		{seasonManagePanelEl}
		bind:seriesCreateOpen
		bind:seriesCreateSubmitting
		bind:seriesCreateResumeByDb
		bind:seriesRunDb
		{createEntryPointsBlocked}
		{locationSuggestionsId}
		{isOffline}
		bind:seasonManageSeries={sm.seasonManageSeries}
		seasonManageSeriesError={sm.seasonManageSeriesError}
		seasonManagePartial={sm.seasonManagePartial}
		seasonManageDeleteError={sm.seasonManageDeleteError}
		bind:seasonManageDeleteArmed={sm.seasonManageDeleteArmed}
		bind:seasonManageArmedSeriesCount={sm.seasonManageArmedSeriesCount}
		seasonManageDeletePendingId={sm.seasonManageDeletePendingId}
		bind:seasonManageDeleteStatus={sm.seasonManageDeleteStatus}
		{seasonManageDeleteSlot}
		{armSeasonManageDelete}
		{disarmSeasonManageDelete}
		{openSeriesCreateForm}
		{loadForSelected}
		{refreshSeasonManageLists}
		{apiDeleteEventSeries}
		{apiCountSeriesOccurrences}
		{canDeleteSeries}
	/>

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
			<FormError data-testid="season-manage-repertoire-error" class="mt-1">
				{m.season_manage_list_load_error()}
			</FormError>
		{/if}
		<RepertoireElement
			rows={panelWorkRows}
			context="repertoire"
			seasonRights={manageableSeasonRights}
			pickableWorksList={panelPickableWorksList}
			pickableWorksVisible={panelPickableWorksVisible}
			pickableWorksPartial={panelWorksPartial}
			pendingKeys={panelPendingKeys}
			addWorkKey={panelAddWorkKey}
			expanded={true}
			onpdfclick={handlePdfClick}
			{heldFileIds}
			{partLinkDb}
			onaddwork={handlePanelAddWork}
			onstatuschange={handlePanelStatusChange}
			onremoveitem={handlePanelRemoveItem}
		/>
		{#if panelManageError}
			<FormError data-testid="repertoire-manage-error" class="mt-1">
				{m.repertoire_manage_error()}
			</FormError>
		{/if}
		<div data-testid="repertoire-manage-status" role="status" aria-live="polite" class="sr-only">
			{panelManageStatus}
		</div>
	</div>
</div>
