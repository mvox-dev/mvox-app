<!-- #508 — season card + season-manage panel. The page keeps what it shares (open flag,
	panel element, switch generation, panel repertoire) and passes it in. -->
<script lang="ts">
	import { type ComponentProps } from 'svelte';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import type RepertoireElement from '$lib/agenda/RepertoireElement.svelte';
	import SeasonCardHeader from '$lib/agenda/SeasonCardHeader.svelte';
	import SeasonManageDialog from '$lib/agenda/SeasonManageDialog.svelte';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { SectionNode } from '$lib/sections/sectionData';
	import type { Season } from '$lib/seasons/types';
	import type { ManageRightsState } from '$lib/repertoire/types';
	import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
	import type { SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import {
		createSeasonManagePanelState,
		resetSeasonManagePanelState,
		seasonManageDeleteSlotFor
	} from '$lib/agenda/seasonManagePanelState';
	import { focusAfterRender, focusTestIdAfterRender } from '$lib/a11y/focusable';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	type RepertoireProps = ComponentProps<typeof RepertoireElement>;

	interface Props {
		selected: Collective | null;
		seasons: Season[];
		manageableSeasonId: string | null;
		manageableSeasonRights: ManageRightsState;
		manageableSeasonRightsById: Record<string, ManageRightsState>;
		seasonManageOpen: boolean;
		seasonManagePanelEl: HTMLDivElement | null;
		seriesCreateOpen: boolean;
		seriesCreateSubmitting: boolean;
		seriesCreateResumeByDb: Record<string, SeriesResumeEntry>;
		seriesRunDb: string | null;
		seriesRunUnfinished: boolean;
		seasonCardCollapseDisabled: boolean;
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
		currentRequestId: () => number;
		switchGeneration: () => number;
		getRoster: (cfg: EntuCfg) => Promise<RosterRow[]>;
		getSections: (cfg: EntuCfg) => Promise<SectionNode[]>;
		rosterPickerOptions: (excludeIds: readonly string[]) => Array<{ id: string; label: string }>;
		pickerPromptText: (optionCount: number, addPrompt: string) => string;
		loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
		loadPanelRepertoire: (cfg: EntuCfg, seasonId: string) => void;
		resetSeasonManage: () => void;
		openEventCreateForm: () => void;
		openSeriesCreateForm: () => void;
		handlePdfClick: (fileId: string) => void;
		handlePanelAddWork: (workId: string) => void;
		handlePanelStatusChange: NonNullable<RepertoireProps['onstatuschange']>;
		handlePanelRemoveItem: (itemId: string) => void;
		isOffline: boolean;
		writeUnavailableText: string;
		listEventSeriesForSeason: typeof SeasonManage.listEventSeriesForSeason;
		updateSeasonField: typeof SeasonManage.updateSeasonField;
		addSeasonConductor: typeof SeasonManage.addSeasonConductor;
		apiRemoveSeasonConductor: typeof SeasonManage.removeSeasonConductor;
		apiDeleteEventSeries: typeof SeasonManage.deleteEventSeries;
		apiCountSeriesOccurrences: typeof SeasonManage.countSeriesOccurrences;
		apiCountSeasonScope: typeof SeasonManage.countSeasonScope;
		apiDeleteSeason: typeof SeasonManage.deleteSeason;
		canDeleteSeries: typeof RepertoireActions.canDeleteSeries;
	}

	let {
		selected,
		seasons,
		manageableSeasonId = $bindable(),
		manageableSeasonRights = $bindable(),
		manageableSeasonRightsById,
		seasonManageOpen = $bindable(),
		seasonManagePanelEl = $bindable(),
		seriesCreateOpen = $bindable(),
		seriesCreateSubmitting = $bindable(),
		seriesCreateResumeByDb = $bindable(),
		seriesRunDb = $bindable(),
		seriesRunUnfinished,
		seasonCardCollapseDisabled,
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
		currentRequestId,
		switchGeneration,
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
		handlePanelRemoveItem,
		isOffline,
		writeUnavailableText,
		listEventSeriesForSeason,
		updateSeasonField,
		addSeasonConductor,
		apiRemoveSeasonConductor,
		apiDeleteEventSeries,
		apiCountSeriesOccurrences,
		apiCountSeasonScope,
		apiDeleteSeason,
		canDeleteSeries
	}: Props = $props();

	const manageableSeasonEntries = $derived(
		seasons.filter((s) => manageableSeasonRightsById[s.id] === 'editor')
	);
	const showSeasonCard = $derived(manageableSeasonEntries.length > 0);

	let sm = $state(createSeasonManagePanelState());
	const seasonManageDeleteSlot = seasonManageDeleteSlotFor(() => sm);
	const seasonManageDeleteName = $derived(
		sm.seasonManageFieldsLoaded
			? sm.seasonManageName
			: (seasons.find((s) => s.id === manageableSeasonId)?.name ?? '')
	);
	let seasonCardEl = $state<HTMLDivElement | null>(null);
	$effect(() => {
		if (!isOffline) sm.seasonEditHeldOffline = false;
	});

	export function resetPanelState(): void {
		resetSeasonManagePanelState(sm);
	}

	export function openSeasonManagePanel(): void {
		if (!selected || manageableSeasonId === null) return;
		seasonManageOpen = true;
		sm.seasonEditingField = null;
		if (!sm.seasonManageFieldsLoaded) {
			const season = seasons.find((s) => s.id === manageableSeasonId);
			sm.seasonManageName = season?.name ?? '';
			sm.seasonManageStartDate = season?.startDate ?? '';
			sm.seasonManageEndDate = season?.endDate ?? '';
			sm.seasonManageConductorIds = season?.conductors ?? [];
			sm.seasonManageFieldsLoaded = true;
		}
		const cfg = cfgFor(selected.db);
		const seasonId = manageableSeasonId;
		const thisRequest = currentRequestId();
		const thisSwitch = switchGeneration();
		sm.seasonManageSeriesError = false;
		sm.seasonManageRosterLoading = true;
		getRoster(cfg)
			.catch((e) => {
				console.error('agenda: loading the roster for season management failed', e);
			})
			.finally(() => {
				if (thisRequest !== currentRequestId()) return;
				sm.seasonManageRosterLoading = false;
			});
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for season management failed', e);
		});
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				sm.seasonManageSeries = result.items;
				sm.seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				console.error('agenda: loading the season\'s event series failed', e);
				sm.seasonManageSeriesError = true;
				sm.seasonManagePartial = false;
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

	export function closeSeasonManagePanel(): void {
		if (seriesRunUnfinished) return;
		seasonManageOpen = false;
		sm.seasonEditingField = null;
		sm.seasonManageDeleteArmed = null;
		sm.seasonManageArmedSeriesCount = null;
		sm.seasonManageDeleteScope = null;
		sm.seasonManageDeleteError = null;
		const closedSeasonId = manageableSeasonId;
		void focusAfterRender(() =>
			seasonCardEl?.querySelector<HTMLButtonElement>(
				`[data-testid="season-card-expand"][data-season-manage-id="${closedSeasonId}"]`
			)
		);
	}

	$effect(() => {
		if (seasonManageOpen && seasonManagePanelEl) seasonManagePanelEl.focus();
	});

	function onSeasonManagePanelKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') closeSeasonManagePanel();
	}

	export function refreshSeasonManageLists(cfg: EntuCfg, seasonId: string): void {
		const thisRequest = currentRequestId();
		const thisSwitch = switchGeneration();
		loadPanelRepertoire(cfg, seasonId);
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				sm.seasonManageSeries = result.items;
				sm.seasonManageSeriesError = false;
				sm.seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				console.error('agenda: refreshing the season\'s event series after an event create failed', e);
				sm.seasonManageSeriesError = true;
			});
	}

	async function armSeasonManageDelete(rowId: string, confirmTestid: string): Promise<void> {
		sm.seasonManageDeleteError = null;
		sm.seasonManageDeleteArmed = rowId;
		sm.seasonManageArmedSeriesCount = null;
		sm.seasonManageDeleteScope = null;
		await focusTestIdAfterRender(confirmTestid);
	}

	async function disarmSeasonManageDelete(disarmTestid: string): Promise<void> {
		sm.seasonManageDeleteArmed = null;
		sm.seasonManageArmedSeriesCount = null;
		sm.seasonManageDeleteScope = null;
		await focusTestIdAfterRender(disarmTestid);
	}
</script>

{#if showSeasonCard || seasonManageOpen}
	<div
		data-testid="agenda-admin-card"
		bind:this={seasonCardEl}
		class="mb-3 rounded-md border border-ink-4 p-1.5"
	>
		<SeasonCardHeader
			bind:sm
			{selected}
			{manageableSeasonEntries}
			{manageableSeasonId}
			{seasonManageOpen}
			{showSeasonCard}
			{seriesRunUnfinished}
			{seasonCardCollapseDisabled}
			{seasonManageDeleteName}
			{isOffline}
			{seasonManageDeleteSlot}
			{openSeasonManagePanelFor}
			{closeSeasonManagePanel}
			{onSeasonManagePanelKeydown}
			{armSeasonManageDelete}
			{disarmSeasonManageDelete}
			{loadForSelected}
			{apiCountSeasonScope}
			{apiDeleteSeason}
		/>
		{#if seasonManageOpen}
			<SeasonManageDialog
				bind:sm
				{selected}
				{manageableSeasonId}
				{manageableSeasonRights}
				bind:seasonManagePanelEl
				bind:seriesCreateOpen
				bind:seriesCreateSubmitting
				bind:seriesCreateResumeByDb
				bind:seriesRunDb
				{createEntryPointsBlocked}
				{eventCreateOpen}
				{rosterRows}
				{rosterPartial}
				{sectionsReadFailed}
				{locationSuggestionsId}
				{heldFileIds}
				{partLinkDb}
				{panelWorkRows}
				{panelPickableWorksList}
				{panelPickableWorksVisible}
				{panelWorksPartial}
				{panelPendingKeys}
				{panelAddWorkKey}
				{panelRepertoireError}
				{panelManageError}
				{panelManageStatus}
				{switchGeneration}
				{rosterPickerOptions}
				{pickerPromptText}
				{loadForSelected}
				{openEventCreateForm}
				{openSeriesCreateForm}
				{handlePdfClick}
				{handlePanelAddWork}
				{handlePanelStatusChange}
				{handlePanelRemoveItem}
				{isOffline}
				{writeUnavailableText}
				{seasonManageDeleteSlot}
				{armSeasonManageDelete}
				{disarmSeasonManageDelete}
				{refreshSeasonManageLists}
				{onSeasonManagePanelKeydown}
				{updateSeasonField}
				{addSeasonConductor}
				{apiRemoveSeasonConductor}
				{apiDeleteEventSeries}
				{apiCountSeriesOccurrences}
				{canDeleteSeries}
			/>
		{/if}
	</div>
{/if}
<div data-testid="season-manage-delete-status" role="status" aria-live="polite" class="sr-only">
	{sm.seasonManageDeleteStatus}
</div>
