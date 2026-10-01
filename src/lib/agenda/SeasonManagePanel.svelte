<!-- #508 — season card + season-manage panel. The page keeps what it shares (open flag,
	panel element, switch generation, panel repertoire) and passes it in. -->
<script lang="ts">
	import { type ComponentProps } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import RepertoireElement from '$lib/agenda/RepertoireElement.svelte';
	import SeasonManageFields from '$lib/agenda/SeasonManageFields.svelte';
	import SeasonManageConductors from '$lib/agenda/SeasonManageConductors.svelte';
	import SeasonManageSeries from '$lib/agenda/SeasonManageSeries.svelte';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { SectionNode } from '$lib/sections/sectionData';
	import type { Season } from '$lib/seasons/types';
	import type { ManageRightsState } from '$lib/repertoire/types';
	import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
	import type { SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import type { SeasonEditableField, SeriesListItem } from '$lib/seasons/seasonManage';
	import {
		runSeasonManageDelete,
		seasonManageDeleteErrorText,
		type SeasonManageDeleteError,
		type SeasonManageDeleteSlot
	} from '$lib/agenda/seasonManageDelete';
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

	let seasonManageName = $state('');
	let seasonManageStartDate = $state('');
	let seasonManageEndDate = $state('');
	let seasonManageConductorIds = $state<string[]>([]);
	let seasonManageFieldsLoaded = $state(false);
	let seasonManageSeries = $state<SeriesListItem[]>([]);
	let seasonManageSeriesError = $state(false);
	let seasonManagePartial = $state(false);
	let seasonManageDeleteError = $state<SeasonManageDeleteError | null>(null);
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
	const seasonManageDeleteSlot: SeasonManageDeleteSlot = {
		get pendingId() {
			return seasonManageDeletePendingId;
		},
		set pendingId(v) {
			seasonManageDeletePendingId = v;
		},
		get error() {
			return seasonManageDeleteError;
		},
		set error(v) {
			seasonManageDeleteError = v;
		},
		get progress() {
			return seasonManageDeleteProgress;
		},
		set progress(v) {
			seasonManageDeleteProgress = v;
		},
		get generation() {
			return seasonManageDeleteGeneration;
		}
	};
	let seasonManageConductorError = $state(false);
	let seasonManageConductorPending = $state(false);
	let seasonManageConductorStatus = $state('');
	let seasonManageRosterLoading = $state(false);
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

	export function resetPanelState(): void {
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
		seasonManageConductorError = false;
		seasonManageConductorPending = false;
		seasonManageConductorStatus = '';
		seasonManageRosterLoading = false;
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditErrors = {};
		seasonEditPending = {};
		seasonEditStatus = '';
	}

	export function openSeasonManagePanel(): void {
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
		const cfg = cfgFor(selected.db);
		const seasonId = manageableSeasonId;
		const thisRequest = currentRequestId();
		const thisSwitch = switchGeneration();
		seasonManageSeriesError = false;
		seasonManageRosterLoading = true;
		getRoster(cfg)
			.catch((e) => {
				console.error('agenda: loading the roster for season management failed', e);
			})
			.finally(() => {
				if (thisRequest !== currentRequestId()) return;
				seasonManageRosterLoading = false;
			});
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for season management failed', e);
		});
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				seasonManageSeries = result.items;
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				console.error('agenda: loading the season\'s event series failed', e);
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

	export function closeSeasonManagePanel(): void {
		if (seriesRunUnfinished) return;
		seasonManageOpen = false;
		seasonEditingField = null;
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		seasonManageDeleteError = null;
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
				seasonManageSeries = result.items;
				seasonManageSeriesError = false;
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				console.error('agenda: refreshing the season\'s event series after an event create failed', e);
				seasonManageSeriesError = true;
			});
	}

	async function armSeasonManageDelete(rowId: string, confirmTestid: string): Promise<void> {
		seasonManageDeleteError = null;
		seasonManageDeleteArmed = rowId;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await focusTestIdAfterRender(confirmTestid);
	}

	async function disarmSeasonManageDelete(disarmTestid: string): Promise<void> {
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await focusTestIdAfterRender(disarmTestid);
	}

	async function armSeasonManageSeasonDelete(): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? cfgFor(selected.db) : null;
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

	function onSeasonManageSeasonDelete(): void {
		if (!selected || manageableSeasonId === null) return;
		if (seasonManageDeletePendingId !== null) return;
		if (isOffline) return;
		const cfg = cfgFor(selected.db);
		const seasonId = manageableSeasonId;
		const seasonName = seasonManageDeleteName;
		runSeasonManageDelete({
			slot: seasonManageDeleteSlot,
			rowId: SEASON_DELETE_ROW_ID,
			logId: seasonId,
			list: 'season',
			call: (onProgress) => apiDeleteSeason(cfg, seasonId, undefined, { onProgress }),
			onDone: () => {
				loadForSelected();
				seasonManageDeleteStatus = m.season_delete_success({ name: seasonName });
			}
		});
	}
</script>

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
							<DeleteConfirmPair
								confirmTestid="season-manage-delete-season-confirm"
								cancelTestid="season-manage-delete-season-cancel"
								confirmLabel={seasonManageDeleteScope !== null
									? m.season_delete_confirm_scope({
											name: seasonManageDeleteName,
											series: seasonManageDeleteScope.series,
											events: seasonManageDeleteScope.events,
											repertoire: seasonManageDeleteScope.repertoireItems
										})
									: m.season_manage_delete_confirm({ name: seasonManageDeleteName })}
								cancelLabel={m.season_manage_delete_cancel({ name: seasonManageDeleteName })}
								confirmText={seasonManageDeleteScope !== null
									? m.season_delete_confirm_scope_short({
											series: seasonManageDeleteScope.series,
											events: seasonManageDeleteScope.events,
											repertoire: seasonManageDeleteScope.repertoireItems
										})
									: m.season_manage_delete_confirm_short()}
								cancelText={m.season_manage_delete_cancel_short()}
								pending={seasonManageDeletePendingId !== null}
								busy={seasonManageDeletePendingId === SEASON_DELETE_ROW_ID}
								{isOffline}
								confirmClass="ml-auto"
								onconfirm={onSeasonManageSeasonDelete}
								oncancel={() => void disarmSeasonManageDelete('season-manage-delete-season')}
								onkeydown={onSeasonManagePanelKeydown}
							/>
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
					bind:seasonManageName
					bind:seasonManageStartDate
					bind:seasonManageEndDate
					bind:seasonEditingField
					bind:seasonEditDraft
					bind:seasonEditErrors
					bind:seasonEditHeldOffline
					bind:seasonEditPending
					bind:seasonEditStatus
				/>

				<SeasonManageConductors
					{selected}
					{manageableSeasonId}
					{isOffline}
					{rosterRows}
					{rosterPartial}
					{sectionsReadFailed}
					{seasonManageRosterLoading}
					{switchGeneration}
					{rosterPickerOptions}
					{pickerPromptText}
					{addSeasonConductor}
					{apiRemoveSeasonConductor}
					bind:seasonManageConductorIds
					bind:seasonManageConductorError
					bind:seasonManageConductorPending
					bind:seasonManageConductorStatus
				/>

				<SeasonManageSeries
					{selected}
					{manageableSeasonId}
					{seasonManageStartDate}
					{seasonManageEndDate}
					{seasonManagePanelEl}
					bind:seriesCreateOpen
					bind:seriesCreateSubmitting
					bind:seriesCreateResumeByDb
					bind:seriesRunDb
					{createEntryPointsBlocked}
					{locationSuggestionsId}
					{isOffline}
					bind:seasonManageSeries
					{seasonManageSeriesError}
					{seasonManagePartial}
					{seasonManageDeleteError}
					bind:seasonManageDeleteArmed
					bind:seasonManageArmedSeriesCount
					{seasonManageDeletePendingId}
					bind:seasonManageDeleteStatus
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
