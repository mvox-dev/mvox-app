<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import ConductorChip from '$lib/agenda/ConductorChip.svelte';
	import RosterPersonSelect from '$lib/roster/RosterPersonSelect.svelte';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	interface Props {
		selected: Collective | null;
		manageableSeasonId: string | null;
		isOffline: boolean;
		rosterRows: RosterRow[];
		rosterPartial: boolean;
		sectionsReadFailed: boolean;
		seasonManageRosterLoading: boolean;
		switchGeneration: () => number;
		rosterPickerOptions: (excludeIds: readonly string[]) => Array<{ id: string; label: string }>;
		pickerPromptText: (optionCount: number, addPrompt: string) => string;
		addSeasonConductor: typeof SeasonManage.addSeasonConductor;
		apiRemoveSeasonConductor: typeof SeasonManage.removeSeasonConductor;
		seasonManageConductorIds: string[];
		seasonManageConductorError: boolean;
		seasonManageConductorPending: boolean;
		seasonManageConductorStatus: string;
	}

	let {
		selected,
		manageableSeasonId,
		isOffline,
		rosterRows,
		rosterPartial,
		sectionsReadFailed,
		seasonManageRosterLoading,
		switchGeneration,
		rosterPickerOptions,
		pickerPromptText,
		addSeasonConductor,
		apiRemoveSeasonConductor,
		seasonManageConductorIds = $bindable(),
		seasonManageConductorError = $bindable(),
		seasonManageConductorPending = $bindable(),
		seasonManageConductorStatus = $bindable()
	}: Props = $props();

	const seasonManageConductorNameById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const row of rosterRows) map.set(row.personId, row.name);
		return map;
	});

	function seasonConductorLabel(personId: string): string {
		const name = seasonManageConductorNameById.get(personId);
		if (name) return name;
		return seasonManageRosterLoading
			? m.season_manage_conductor_loading()
			: m.season_manage_conductor_unknown();
	}

	const seasonManageConductorOptions = $derived(
		rosterPickerOptions(seasonManageConductorIds)
	);

	const seasonManageConductorEntries = $derived(
		(() => {
			const seen = new Map<string, number>();
			return seasonManageConductorIds.map((personId) => {
				const occurrence = seen.get(personId) ?? 0;
				seen.set(personId, occurrence + 1);
				return { key: `${personId}#${occurrence}`, personId };
			});
		})()
	);

	function runConductorWrite(
		verb: 'add' | 'remove',
		personId: string,
		nextIds: string[],
		revert: () => string[],
		write: (cfg: EntuCfg, seasonId: string, personId: string) => Promise<unknown>
	): void {
		if (!selected || manageableSeasonId === null) return;
		const cfg = cfgFor(selected.db);
		const seasonId = manageableSeasonId;
		const thisSeasonManage = switchGeneration();
		seasonManageConductorError = false;
		seasonManageConductorStatus = '';
		seasonManageConductorPending = true;
		seasonManageConductorIds = nextIds;
		write(cfg, seasonId, personId)
			.then(() => {
				if (thisSeasonManage !== switchGeneration()) return;
				seasonManageConductorPending = false;
				seasonManageConductorStatus = m.season_manage_conductor_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== switchGeneration()) return;
				console.error(`agenda: ${verb} season conductor failed`, personId, e);
				seasonManageConductorIds = revert();
				seasonManageConductorError = true;
				seasonManageConductorPending = false;
			});
	}

	function onSeasonManageConductorSelect(selection: { id: string | null; label: string }): void {
		if (seasonManageConductorPending || isOffline) return;
		if (!selection.id || !selected || manageableSeasonId === null) return;
		const personId = selection.id;
		if (seasonManageConductorIds.includes(personId)) return;
		runConductorWrite(
			'add',
			personId,
			[...seasonManageConductorIds, personId],
			() => seasonManageConductorIds.filter((id) => id !== personId),
			addSeasonConductor
		);
	}

	function onSeasonManageConductorRemove(personId: string, index: number): void {
		if (seasonManageConductorPending || isOffline) return;
		const before = seasonManageConductorIds;
		const nextIds = [
			...seasonManageConductorIds.slice(0, index),
			...seasonManageConductorIds.slice(index + 1)
		];
		runConductorWrite('remove', personId, nextIds, () => before, apiRemoveSeasonConductor);
	}
</script>

<div>
	<p class="text-xs tracking-wide text-ink-2 uppercase">
		{m.season_manage_conductors_label()}
	</p>
	{#if seasonManageConductorEntries.length > 0}
		<ul class="mt-1 flex flex-wrap gap-1.5">
			{#each seasonManageConductorEntries as { key, personId }, entryIndex (key)}
				<ConductorChip
					testid="season-manage-conductor"
					{personId}
					name={seasonConductorLabel(personId)}
					conductorKey={key}
					disabled={seasonManageConductorPending || isOffline}
					onremove={() => onSeasonManageConductorRemove(personId, entryIndex)}
				/>
			{/each}
		</ul>
	{/if}
	<div class="mt-1.5">
		<RosterPersonSelect
			testid="season-manage-conductor"
			options={seasonManageConductorOptions}
			prompt={pickerPromptText(
				seasonManageConductorOptions.length,
				m.season_conductor_placeholder()
			)}
			ariaLabel={m.season_conductor_label()}
			disabled={seasonManageConductorPending || isOffline}
			partial={rosterPartial}
			orderFallback={sectionsReadFailed}
			onselect={onSeasonManageConductorSelect}
		/>
	</div>
	{#if seasonManageConductorError}
		<p
			data-testid="season-manage-conductor-error"
			role="alert"
			class="text-xs text-red-700"
		>
			{m.season_manage_save_error()}
		</p>
	{/if}
	{#if seasonManageConductorPending}
		<p
			data-testid="season-manage-conductor-pending-notice"
			role="status"
			class="text-xs text-ink-2"
		>
			{m.season_manage_conductor_saving()}
		</p>
	{/if}
	<div
		data-testid="season-manage-conductor-status"
		role="status"
		aria-live="polite"
		class="sr-only"
	>
		{seasonManageConductorStatus}
	</div>
</div>
