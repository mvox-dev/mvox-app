<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import PersonName from '$lib/components/PersonName.svelte';
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
				<li
					data-testid="season-manage-conductor-{personId}"
					data-conductor-key={key}
					class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
				>
					<PersonName name={seasonConductorLabel(personId)} />
					<!-- #237: unlink is not destroy — this chip keeps its × and muted
					     tone on purpose; DeleteTrigger is for Table A only. -->
					<button
						type="button"
						data-testid="season-manage-conductor-remove-{personId}"
						aria-label={m.season_conductor_remove({
							name: seasonConductorLabel(personId)
						})}
						disabled={seasonManageConductorPending || isOffline}
						class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50"
						onclick={() => onSeasonManageConductorRemove(personId, entryIndex)}
					>
						&times;
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="mt-1.5">
		<select
			data-testid="season-manage-conductor-select"
			aria-label={m.season_conductor_label()}
			disabled={seasonManageConductorOptions.length === 0 ||
				seasonManageConductorPending ||
				isOffline}
			value=""
			onchange={(e) => {
				const target = e.currentTarget as HTMLSelectElement;
				const personId = target.value;
				target.value = '';
				if (!personId) return;
				const label =
					seasonManageConductorOptions.find((o) => o.id === personId)
						?.label ?? '';
				onSeasonManageConductorSelect({ id: personId, label });
			}}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
		>
			<option value="" disabled selected hidden>
				{pickerPromptText(
					seasonManageConductorOptions.length,
					m.season_conductor_placeholder()
				)}
			</option>
			{#each seasonManageConductorOptions as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
		{#if rosterPartial}
			<p data-testid="season-manage-conductor-partial-notice" role="status" class="text-xs text-ink-2">
				{m.picker_partial_members_notice()}
			</p>
		{/if}
		{#if sectionsReadFailed}
			<p
				data-testid="season-manage-conductor-order-note"
				class="text-xs text-ink-2"
			>
				{m.picker_order_fallback()}
			</p>
		{/if}
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
