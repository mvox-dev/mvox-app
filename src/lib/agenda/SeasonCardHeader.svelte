<!-- #641 — the season card's rows and the open season's title row; #917: a delete on each row. -->
<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import { focusAfterRender } from '$lib/a11y/focusable';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import type { Season } from '$lib/seasons/types';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import {
		isSeasonDeletePending,
		runSeasonManageDelete,
		seasonDeleteRowId,
		seasonManageDeleteErrorText,
		type SeasonManageDeleteSlot
	} from '$lib/agenda/seasonManageDelete';
	import type { SeasonManagePanelState } from '$lib/agenda/seasonManagePanelState';

	interface Props {
		sm: SeasonManagePanelState;
		selected: Collective | null;
		manageableSeasonEntries: Season[];
		ownedSeasonIds: Set<string>;
		manageableSeasonId: string | null;
		seasonManageOpen: boolean;
		showSeasonCard: boolean;
		seriesRunUnfinished: boolean;
		seasonCardCollapseDisabled: boolean;
		seasonManageDeleteName: string;
		isOffline: boolean;
		seasonManageDeleteSlot: SeasonManageDeleteSlot;
		openSeasonManagePanelFor: (seasonId: string) => void;
		closeSeasonManagePanel: () => void;
		onSeasonManagePanelKeydown: (event: KeyboardEvent) => void;
		armSeasonManageDelete: (rowId: string, confirmTestid: string) => Promise<void>;
		disarmSeasonManageDelete: (disarmTestid: string) => Promise<void>;
		loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
		apiCountSeasonScope: typeof SeasonManage.countSeasonScope;
		apiDeleteSeason: typeof SeasonManage.deleteSeason;
	}

	let {
		sm = $bindable(),
		selected,
		manageableSeasonEntries,
		ownedSeasonIds,
		manageableSeasonId,
		seasonManageOpen,
		showSeasonCard,
		seriesRunUnfinished,
		seasonCardCollapseDisabled,
		seasonManageDeleteName,
		isOffline,
		seasonManageDeleteSlot,
		openSeasonManagePanelFor,
		closeSeasonManagePanel,
		onSeasonManagePanelKeydown,
		armSeasonManageDelete,
		disarmSeasonManageDelete,
		loadForSelected,
		apiCountSeasonScope,
		apiDeleteSeason
	}: Props = $props();

	// One delete slot for the card: arming a row disarms any other.
	const openRowId = $derived(
		manageableSeasonId === null ? null : seasonDeleteRowId(manageableSeasonId)
	);
	// #917 — Entu deletes a season only for its _owner; an _editor gets no trashcan.
	const openRowOwned = $derived(
		manageableSeasonId !== null && ownedSeasonIds.has(manageableSeasonId)
	);
	const rowName = (ms: Season): string =>
		ms.id === manageableSeasonId ? seasonManageDeleteName : ms.name;

	async function armSeasonDelete(seasonId: string, confirmTestid: string): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? cfgFor(selected.db) : null;
		const rowId = seasonDeleteRowId(seasonId);
		const isDeleteCurrent = sm.seasonManageDeleteLoad.whileCurrent();
		await armSeasonManageDelete(rowId, confirmTestid);
		if (!cfg) return;
		try {
			const scope = await apiCountSeasonScope(cfg, seasonId);
			if (
				isDeleteCurrent() &&
				sm.seasonManageDeleteArmed === rowId
			) {
				sm.seasonManageDeleteScope = scope;
			}
		} catch (e) {
			if (!isDeleteCurrent()) return;
			reportProblem({ area: 'agenda', action: 'counting what the season delete removes', error: e });
		}
	}

	async function disarmRowDelete(seasonId: string): Promise<void> {
		sm.seasonManageDeleteArmed = null;
		sm.seasonManageArmedSeriesCount = null;
		sm.seasonManageDeleteScope = null;
		await focusAfterRender(() =>
			document.querySelector<HTMLElement>(
				`[data-testid="season-row-delete"][data-season-manage-id="${seasonId}"]`
			)
		);
	}

	function onSeasonDelete(seasonId: string, seasonName: string): void {
		if (!selected) return;
		if (sm.seasonManageDeletePendingId !== null) return;
		if (isOffline) return;
		const cfg = cfgFor(selected.db);
		runSeasonManageDelete({
			slot: seasonManageDeleteSlot,
			rowId: seasonDeleteRowId(seasonId),
			logId: seasonId,
			list: 'season',
			call: (onProgress) => apiDeleteSeason(cfg, seasonId, undefined, { onProgress }),
			onDone: () => {
				loadForSelected();
				sm.seasonManageDeleteStatus = m.season_delete_success({ name: seasonName });
			}
		});
	}

	function confirmLabel(name: string): string {
		const scope = sm.seasonManageDeleteScope;
		return scope !== null
			? m.season_delete_confirm_scope({
					name,
					series: scope.series,
					events: scope.events,
					repertoire: scope.repertoireItems
				})
			: m.season_manage_delete_confirm({ name });
	}

	function confirmText(): string {
		const scope = sm.seasonManageDeleteScope;
		return scope !== null
			? m.season_delete_confirm_scope_short({
					series: scope.series,
					events: scope.events,
					repertoire: scope.repertoireItems
				})
			: m.season_manage_delete_confirm_short();
	}
</script>

{#each manageableSeasonEntries as ms (ms.id)}
	{#if !seasonManageOpen || ms.id !== manageableSeasonId}
		{@const rowBusy =
			(seriesRunUnfinished && ms.id !== manageableSeasonId) ||
			isSeasonDeletePending(sm.seasonManageDeletePendingId)}
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="flex min-w-0 flex-1">
				<button
					type="button"
					data-testid="season-card-expand"
					data-season-manage-id={ms.id}
					aria-expanded="false"
					disabled={rowBusy}
					class="group flex w-full min-h-11 items-center gap-2 rounded-sm px-1.5 text-left font-display text-lg text-ink hover:bg-ink-5 disabled:opacity-50 disabled:hover:bg-transparent"
					onclick={() => openSeasonManagePanelFor(ms.id)}
				>
					<span class="sr-only">{m.season_manage_expand_label()}</span>
					<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">▸</span>
					<span>{ms.id === manageableSeasonId ? seasonManageDeleteName : ms.name}</span>
				</button>
			</h2>
			{#if ownedSeasonIds.has(ms.id)}
				{#if sm.seasonManageDeleteArmed === seasonDeleteRowId(ms.id)}
					<DeleteConfirmPair
						confirmTestid="season-row-delete-confirm"
						cancelTestid="season-row-delete-cancel"
						confirmLabel={confirmLabel(rowName(ms))}
						cancelLabel={m.season_manage_delete_cancel({ name: rowName(ms) })}
						confirmText={confirmText()}
						cancelText={m.season_manage_delete_cancel_short()}
						pending={sm.seasonManageDeletePendingId !== null}
						busy={sm.seasonManageDeletePendingId === seasonDeleteRowId(ms.id)}
						{isOffline}
						confirmClass="ml-auto"
						onconfirm={() => onSeasonDelete(ms.id, rowName(ms))}
						oncancel={() => void disarmRowDelete(ms.id)}
					/>
				{:else}
					<DeleteTrigger
						data-testid="season-row-delete"
						data-season-manage-id={ms.id}
						aria-label={m.season_manage_season_delete({ name: rowName(ms) })}
						class="ml-auto"
						disabled={isOffline || rowBusy}
						onclick={() => void armSeasonDelete(ms.id, 'season-row-delete-confirm')}
					/>
				{/if}
			{/if}
		</div>
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
					<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">▾</span>
					<span id="season-manage-label" data-testid="season-manage-label">
						{seasonManageDeleteName}
					</span>
				</button>
			</h2>
			{#if openRowOwned && sm.seasonManageDeleteArmed === openRowId}
				<DeleteConfirmPair
					confirmTestid="season-manage-delete-season-confirm"
					cancelTestid="season-manage-delete-season-cancel"
					confirmLabel={confirmLabel(seasonManageDeleteName)}
					cancelLabel={m.season_manage_delete_cancel({ name: seasonManageDeleteName })}
					confirmText={confirmText()}
					cancelText={m.season_manage_delete_cancel_short()}
					pending={sm.seasonManageDeletePendingId !== null}
					busy={sm.seasonManageDeletePendingId === openRowId}
					{isOffline}
					confirmClass="ml-auto"
					onconfirm={() => {
						if (manageableSeasonId !== null)
							onSeasonDelete(manageableSeasonId, seasonManageDeleteName);
					}}
					oncancel={() => void disarmSeasonManageDelete('season-manage-delete-season')}
					onkeydown={onSeasonManagePanelKeydown}
				/>
			{:else if openRowOwned}
				<DeleteTrigger
					data-testid="season-manage-delete-season"
					aria-label={m.season_manage_season_delete({ name: seasonManageDeleteName })}
					class="ml-auto"
					disabled={isOffline || isSeasonDeletePending(sm.seasonManageDeletePendingId)}
					onclick={() => {
						if (manageableSeasonId !== null)
							void armSeasonDelete(manageableSeasonId, 'season-manage-delete-season-confirm');
					}}
					onkeydown={onSeasonManagePanelKeydown}
				/>
			{/if}
		{/if}
	</div>
{/if}
{#if sm.seasonManageDeleteProgress !== null}
	<p data-testid="season-manage-delete-progress" role="status" class="mt-1 text-xs text-ink-2">
		{m.season_manage_delete_progress({
			current: sm.seasonManageDeleteProgress.current,
			total: sm.seasonManageDeleteProgress.total
		})}
	</p>
{/if}
{#if sm.seasonManageDeleteError?.list === 'season'}
	<FormError data-testid="season-manage-delete-error" class="mt-1">
		{seasonManageDeleteErrorText(sm.seasonManageDeleteError)}
	</FormError>
{/if}
