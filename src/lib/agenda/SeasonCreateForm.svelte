<!-- #508 — season-create dialog, mounted only while open, so its roster/section
	prefetch runs once at construction. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import { focusOnMount } from '$lib/a11y/focusable';
	import { formKeydown } from '$lib/a11y/formKeys';
	import PersonName from '$lib/components/PersonName.svelte';
	import { createSeason } from '$lib/entity/entityCreate';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { SectionNode } from '$lib/sections/sectionData';
	import { writesAvailable } from '$lib/net/online';

	interface Props {
		selected: Collective | null;
		rosterPartial: boolean;
		sectionsReadFailed: boolean;
		submitting: boolean;
		status: string;
		getRoster: (cfg: { db: string; token: string }) => Promise<RosterRow[]>;
		getSections: (cfg: { db: string; token: string }) => Promise<SectionNode[]>;
		rosterPickerOptions: (excludeIds: readonly string[]) => Array<{ id: string; label: string }>;
		pickerPromptText: (optionCount: number, addPrompt: string) => string;
		loadForSelected: () => void;
		dismiss: () => void;
		onclose: () => void;
	}

	let {
		selected,
		rosterPartial,
		sectionsReadFailed,
		submitting = $bindable(false),
		status = $bindable(''),
		getRoster,
		getSections,
		rosterPickerOptions,
		pickerPromptText,
		loadForSelected,
		dismiss,
		onclose
	}: Props = $props();

	const isOffline = $derived(!$writesAvailable);

	let seasonCreateName = $state('');
	let seasonCreateStartDate = $state('');
	let seasonCreateEndDate = $state('');
	let seasonCreateConductors = $state<Array<{ id: string; name: string }>>([]);
	let seasonCreateError = $state<(() => string) | null>(null);
	let seasonCreateErrorField = $state<'name' | 'dates' | null>(null);
	const seasonConductorOptions = $derived(
		rosterPickerOptions(seasonCreateConductors.map((c) => c.id))
	);

	untrack(() => {
		const current = selected;
		if (!current) return;
		const cfg = cfgFor(current.db);
		getRoster(cfg).catch((e) => {
			console.error('agenda: loading the roster for the conductor picker failed', e);
		});
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for the conductor picker failed', e);
		});
	});

	function clearSeasonCreateError(): void {
		seasonCreateError = null;
		seasonCreateErrorField = null;
	}

	function setSeasonCreateError(msg: () => string, field: 'name' | 'dates' | null): void {
		seasonCreateError = msg;
		seasonCreateErrorField = field;
	}

	function onSeasonFormKeydown(event: KeyboardEvent): void {
		formKeydown(event, { close: dismiss, submit: () => void submitSeasonCreate() });
	}

	function onSeasonConductorSelect(selection: { id: string | null; label: string }): void {
		if (!selection.id) return;
		if (seasonCreateConductors.some((c) => c.id === selection.id)) return;
		seasonCreateConductors = [...seasonCreateConductors, { id: selection.id, name: selection.label }];
	}

	function removeSeasonConductor(id: string): void {
		seasonCreateConductors = seasonCreateConductors.filter((c) => c.id !== id);
	}

	async function submitSeasonCreate(): Promise<void> {
		if (submitting) return;
		if (isOffline) return;

		clearSeasonCreateError();
		status = '';

		const name = seasonCreateName.trim();
		if (!name) {
			setSeasonCreateError(m.season_name_required, 'name');
			return;
		}
		if (!seasonCreateStartDate || !seasonCreateEndDate) {
			setSeasonCreateError(m.season_dates_required, 'dates');
			return;
		}
		if (seasonCreateEndDate < seasonCreateStartDate) {
			setSeasonCreateError(m.season_date_range_invalid, 'dates');
			return;
		}

		const current = selected;
		if (!current) {
			console.error('agenda: season create submitted with no selected collective');
			setSeasonCreateError(m.season_create_failed, null);
			return;
		}
		const cfg = cfgFor(current.db);

		submitting = true;
		try {
			let dbEntityId: string | null;
			try {
				dbEntityId = await resolveDatabaseEntityId(cfg);
			} catch (e) {
				console.error('agenda: resolving the database entity for season create failed', e);
				setSeasonCreateError(m.season_create_failed, null);
				return;
			}
			if (!dbEntityId) {
				console.error('agenda: season create with no resolvable database entity', current.personId);
				setSeasonCreateError(m.season_create_failed, null);
				return;
			}

			try {
				await createSeason(cfg, {
					name,
					dbEntityId,
					startDate: seasonCreateStartDate,
					endDate: seasonCreateEndDate,
					conductorRefs: seasonCreateConductors.map((c) => c.id)
				});
			} catch (e) {
				console.error('agenda: season create failed', name, e);
				setSeasonCreateError(m.season_create_failed, null);
				return;
			}

			status = m.season_created({ name });
			onclose();
			loadForSelected();
		} finally {
			submitting = false;
		}
	}
</script>

<div
	data-testid="season-create-form"
	role="dialog"
	aria-label={m.season_create_form_label()}
	tabindex="-1"
	class="mb-3 flex flex-col gap-1.5 border-b border-dashed border-ink-5 pb-3"
	onkeydown={onSeasonFormKeydown}
>
	{#if isOffline}
		<p data-testid="season-create-write-unavailable" class="text-xs text-ink-2">
			{m.write_unavailable_no_signal()}
		</p>
	{/if}
	<input
		type="text"
		data-testid="season-create-name"
		use:focusOnMount
		aria-label={m.season_name_label()}
		placeholder={m.season_name_label()}
		aria-invalid={seasonCreateErrorField === 'name' ? true : undefined}
		aria-describedby={seasonCreateErrorField === 'name'
			? 'season-create-error'
			: undefined}
		value={seasonCreateName}
		oninput={(e) => {
			seasonCreateName = (e.currentTarget as HTMLInputElement).value;
			clearSeasonCreateError();
		}}
		class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
	/>
	<div class="flex gap-2">
		<input
			type="date"
			data-testid="season-create-start"
			aria-label={m.season_start_date_label()}
			aria-invalid={seasonCreateErrorField === 'dates' ? true : undefined}
			aria-describedby={seasonCreateErrorField === 'dates'
				? 'season-create-error'
				: undefined}
			value={seasonCreateStartDate}
			oninput={(e) => {
				seasonCreateStartDate = (e.currentTarget as HTMLInputElement).value;
				clearSeasonCreateError();
			}}
			class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
		<input
			type="date"
			data-testid="season-create-end"
			aria-label={m.season_end_date_label()}
			aria-invalid={seasonCreateErrorField === 'dates' ? true : undefined}
			aria-describedby={seasonCreateErrorField === 'dates'
				? 'season-create-error'
				: undefined}
			value={seasonCreateEndDate}
			oninput={(e) => {
				seasonCreateEndDate = (e.currentTarget as HTMLInputElement).value;
				clearSeasonCreateError();
			}}
			class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
	</div>
	<select
		data-testid="season-create-conductor-select"
		aria-label={m.season_conductor_label()}
		disabled={seasonConductorOptions.length === 0}
		value=""
		onchange={(e) => {
			const target = e.currentTarget as HTMLSelectElement;
			const personId = target.value;
			target.value = '';
			if (!personId) return;
			const label =
				seasonConductorOptions.find((o) => o.id === personId)?.label ?? '';
			onSeasonConductorSelect({ id: personId, label });
		}}
		class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
	>
		<option value="" disabled selected hidden>
			{pickerPromptText(
				seasonConductorOptions.length,
				m.season_conductor_placeholder()
			)}
		</option>
		{#each seasonConductorOptions as option (option.id)}
			<option value={option.id}>{option.label}</option>
		{/each}
	</select>
	{#if rosterPartial}
		<p data-testid="season-create-conductor-partial-notice" role="status" class="text-xs text-ink-2">
			{m.picker_partial_members_notice()}
		</p>
	{/if}
	{#if sectionsReadFailed}
		<p data-testid="season-create-conductor-order-note" class="text-xs text-ink-2">
			{m.picker_order_fallback()}
		</p>
	{/if}
	{#if seasonCreateConductors.length > 0}
		<ul class="flex flex-wrap gap-1.5">
			{#each seasonCreateConductors as conductor (conductor.id)}
				<li
					data-testid="season-create-conductor-{conductor.id}"
					class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
				>
					<PersonName name={conductor.name} />
					<button
						type="button"
						data-testid="season-create-conductor-remove-{conductor.id}"
						aria-label={m.season_conductor_remove({ name: conductor.name })}
						class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink"
						onclick={() => removeSeasonConductor(conductor.id)}
					>
						&times;
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if seasonCreateError}
		<p
			id="season-create-error"
			role="alert"
			data-testid="season-create-error"
			class="text-xs text-red-700"
		>
			{seasonCreateError()}
		</p>
	{/if}
	<div class="flex gap-2">
		<button
			type="button"
			data-testid="season-create-submit"
			disabled={submitting || isOffline}
			aria-busy={submitting}
			class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
			onclick={() => void submitSeasonCreate()}
		>
			{m.season_create_submit()}
		</button>
		<button
			type="button"
			data-testid="season-create-cancel"
			disabled={submitting}
			class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
			onclick={dismiss}
		>
			{m.roster_cancel()}
		</button>
	</div>
</div>
