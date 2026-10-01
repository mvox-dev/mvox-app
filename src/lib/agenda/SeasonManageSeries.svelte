<script lang="ts">
	import PartialNotice from '$lib/components/PartialNotice.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import SeriesCreateForm from '$lib/agenda/SeriesCreateForm.svelte';
	import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
	import type { SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import type { SeriesListItem } from '$lib/seasons/seasonManage';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import {
		runSeasonManageDelete,
		seasonManageDeleteErrorText,
		type SeasonManageDeleteError,
		type SeasonManageDeleteSlot
	} from '$lib/agenda/seasonManageDelete';

	interface Props {
		selected: Collective | null;
		manageableSeasonId: string | null;
		seasonManageStartDate: string;
		seasonManageEndDate: string;
		seasonManagePanelEl: HTMLDivElement | null;
		seriesCreateOpen: boolean;
		seriesCreateSubmitting: boolean;
		seriesCreateResumeByDb: Record<string, SeriesResumeEntry>;
		seriesRunDb: string | null;
		createEntryPointsBlocked: boolean;
		locationSuggestionsId: string;
		isOffline: boolean;
		seasonManageSeries: SeriesListItem[];
		seasonManageSeriesError: boolean;
		seasonManagePartial: boolean;
		seasonManageDeleteError: SeasonManageDeleteError | null;
		seasonManageDeleteArmed: string | null;
		seasonManageArmedSeriesCount: number | null;
		seasonManageDeletePendingId: string | null;
		seasonManageDeleteStatus: string;
		seasonManageDeleteSlot: SeasonManageDeleteSlot;
		armSeasonManageDelete: (rowId: string, confirmTestid: string) => Promise<void>;
		disarmSeasonManageDelete: (disarmTestid: string) => Promise<void>;
		openSeriesCreateForm: () => void;
		loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
		refreshSeasonManageLists: (cfg: EntuCfg, seasonId: string) => void;
		apiDeleteEventSeries: typeof SeasonManage.deleteEventSeries;
		apiCountSeriesOccurrences: typeof SeasonManage.countSeriesOccurrences;
		canDeleteSeries: typeof RepertoireActions.canDeleteSeries;
	}

	let {
		selected,
		manageableSeasonId,
		seasonManageStartDate,
		seasonManageEndDate,
		seasonManagePanelEl,
		seriesCreateOpen = $bindable(),
		seriesCreateSubmitting = $bindable(),
		seriesCreateResumeByDb = $bindable(),
		seriesRunDb = $bindable(),
		createEntryPointsBlocked,
		locationSuggestionsId,
		isOffline,
		seasonManageSeries = $bindable(),
		seasonManageSeriesError,
		seasonManagePartial,
		seasonManageDeleteError,
		seasonManageDeleteArmed = $bindable(),
		seasonManageArmedSeriesCount = $bindable(),
		seasonManageDeletePendingId,
		seasonManageDeleteStatus = $bindable(),
		seasonManageDeleteSlot,
		armSeasonManageDelete,
		disarmSeasonManageDelete,
		openSeriesCreateForm,
		loadForSelected,
		refreshSeasonManageLists,
		apiDeleteEventSeries,
		apiCountSeriesOccurrences,
		canDeleteSeries
	}: Props = $props();

	async function armSeasonManageSeriesDelete(series: SeriesListItem): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? cfgFor(selected.db) : null;
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

	function refreshAfterSeasonManageDelete(cfg: EntuCfg): void {
		const panelSeasonId = manageableSeasonId;
		loadForSelected({ keepSeasonManage: true });
		if (panelSeasonId !== null) refreshSeasonManageLists(cfg, panelSeasonId);
	}

	function onSeasonManageSeriesDelete(series: SeriesListItem): void {
		if (!selected) return;
		if (seasonManageDeletePendingId !== null) return;
		if (isOffline) return;
		const cfg = cfgFor(selected.db);
		runSeasonManageDelete({
			slot: seasonManageDeleteSlot,
			rowId: series.id,
			logId: series.id,
			list: 'series',
			call: (onProgress) => apiDeleteEventSeries(cfg, series.id, undefined, { onProgress }),
			onDone: (deletedOccurrences) => {
				seasonManageDeleteArmed = null;
				seasonManageArmedSeriesCount = null;
				seasonManageSeries = seasonManageSeries.filter((row) => row.id !== series.id);
				seasonManageDeleteStatus =
					deletedOccurrences > 0
						? m.season_manage_series_deleted({ name: series.name, count: deletedOccurrences })
						: m.season_manage_deleted({ name: series.name });
				refreshAfterSeasonManageDelete(cfg);
			}
		});
	}
</script>

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
			{locationSuggestionsId}
			bind:submitting={seriesCreateSubmitting}
			bind:resumeByDb={seriesCreateResumeByDb}
			bind:seriesRunDb
			onclose={() => (seriesCreateOpen = false)}
			{loadForSelected}
			{refreshSeasonManageLists}
		/>
	{/if}
	{#if seasonManagePartial}
		<PartialNotice
			testid="season-manage-partial-notice"
			text={m.season_manage_partial_notice()}
			class="mt-1 text-xs"
		/>
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
						<DeleteConfirmPair
							confirmTestid="season-manage-series-delete-confirm-{series.id}"
							cancelTestid="season-manage-series-delete-cancel-{series.id}"
							confirmLabel={seasonManageArmedSeriesCount !== null &&
							seasonManageArmedSeriesCount > 0
								? m.season_manage_series_delete_confirm({
										name: series.name,
										count: seasonManageArmedSeriesCount
									})
								: m.season_manage_delete_confirm({ name: series.name })}
							cancelLabel={m.season_manage_delete_cancel({ name: series.name })}
							confirmText={seasonManageArmedSeriesCount !== null &&
							seasonManageArmedSeriesCount > 0
								? m.season_manage_series_delete_confirm_short({
										count: seasonManageArmedSeriesCount
									})
								: m.season_manage_delete_confirm_short()}
							cancelText={m.season_manage_delete_cancel_short()}
							pending={seasonManageDeletePendingId !== null}
							busy={seasonManageDeletePendingId === series.id}
							{isOffline}
							onconfirm={() => onSeasonManageSeriesDelete(series)}
							oncancel={() =>
								void disarmSeasonManageDelete(`season-manage-series-delete-${series.id}`)}
						/>
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
