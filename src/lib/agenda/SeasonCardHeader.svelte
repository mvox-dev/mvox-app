<!-- #641 — the season card's expand list and the open season's title row with its delete. -->
<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import type { Season } from '$lib/seasons/types';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import {
		runSeasonManageDelete,
		seasonManageDeleteErrorText,
		type SeasonManageDeleteSlot
	} from '$lib/agenda/seasonManageDelete';
	import type { SeasonManagePanelState } from '$lib/agenda/seasonManagePanelState';

	interface Props {
		sm: SeasonManagePanelState;
		selected: Collective | null;
		manageableSeasonEntries: Season[];
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

	const SEASON_DELETE_ROW_ID = '__season__';

	async function armSeasonManageSeasonDelete(): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? cfgFor(selected.db) : null;
		const seasonId = manageableSeasonId;
		const generation = sm.seasonManageDeleteGeneration;
		await armSeasonManageDelete(SEASON_DELETE_ROW_ID, 'season-manage-delete-season-confirm');
		if (!cfg || seasonId === null) return;
		try {
			const scope = await apiCountSeasonScope(cfg, seasonId);
			if (
				generation === sm.seasonManageDeleteGeneration &&
				sm.seasonManageDeleteArmed === SEASON_DELETE_ROW_ID
			) {
				sm.seasonManageDeleteScope = scope;
			}
		} catch (e) {
			console.error('agenda: live season scope for the delete confirm failed', seasonId, e);
		}
	}

	function onSeasonManageSeasonDelete(): void {
		if (!selected || manageableSeasonId === null) return;
		if (sm.seasonManageDeletePendingId !== null) return;
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
				sm.seasonManageDeleteStatus = m.season_delete_success({ name: seasonName });
			}
		});
	}
</script>

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
				<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">▸</span>
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
					<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">▾</span>
					<span id="season-manage-label" data-testid="season-manage-label">
						{seasonManageDeleteName}
					</span>
				</button>
			</h2>
			{#if sm.seasonManageDeleteArmed === SEASON_DELETE_ROW_ID}
				<DeleteConfirmPair
					confirmTestid="season-manage-delete-season-confirm"
					cancelTestid="season-manage-delete-season-cancel"
					confirmLabel={sm.seasonManageDeleteScope !== null
						? m.season_delete_confirm_scope({
								name: seasonManageDeleteName,
								series: sm.seasonManageDeleteScope.series,
								events: sm.seasonManageDeleteScope.events,
								repertoire: sm.seasonManageDeleteScope.repertoireItems
							})
						: m.season_manage_delete_confirm({ name: seasonManageDeleteName })}
					cancelLabel={m.season_manage_delete_cancel({ name: seasonManageDeleteName })}
					confirmText={sm.seasonManageDeleteScope !== null
						? m.season_delete_confirm_scope_short({
								series: sm.seasonManageDeleteScope.series,
								events: sm.seasonManageDeleteScope.events,
								repertoire: sm.seasonManageDeleteScope.repertoireItems
							})
						: m.season_manage_delete_confirm_short()}
					cancelText={m.season_manage_delete_cancel_short()}
					pending={sm.seasonManageDeletePendingId !== null}
					busy={sm.seasonManageDeletePendingId === SEASON_DELETE_ROW_ID}
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
