<!-- #508 — season-create dialog, mounted only while open, so its roster/section
	prefetch runs once at construction. -->
<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import FormActions from '$lib/components/FormActions.svelte';
	import { fieldErrorAttrs } from '$lib/a11y/formErrors';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import { focusOnMount } from '$lib/a11y/focusable';
	import { formKeydown } from '$lib/a11y/formKeys';
	import ConductorChips from '$lib/agenda/ConductorChips.svelte';
	import { createSeason } from '$lib/entity/entityCreate';
	import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';
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
			const dbEntityId = await resolveDbEntityOrLog(
				cfg,
				{ area: 'agenda', action: 'season create' },
				current.personId
			);
			if (!dbEntityId) {
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
		{...fieldErrorAttrs(seasonCreateErrorField, 'name', 'season-create-error')}
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
			{...fieldErrorAttrs(seasonCreateErrorField, 'dates', 'season-create-error')}
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
			{...fieldErrorAttrs(seasonCreateErrorField, 'dates', 'season-create-error')}
			value={seasonCreateEndDate}
			oninput={(e) => {
				seasonCreateEndDate = (e.currentTarget as HTMLInputElement).value;
				clearSeasonCreateError();
			}}
			class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
	</div>
	<ConductorChips
		bind:conductors={seasonCreateConductors}
		testid="season-create-conductor"
		ariaLabel={m.season_conductor_label()}
		partial={rosterPartial}
		orderFallback={sectionsReadFailed}
		{rosterPickerOptions}
		prompt={(n) => pickerPromptText(n, m.season_conductor_placeholder())}
	/>
	{#if seasonCreateError}
		<FormError id="season-create-error" data-testid="season-create-error">
			{seasonCreateError()}
		</FormError>
	{/if}
	<FormActions
		testid="season-create"
		submitLabel={m.season_create_submit()}
		cancelLabel={m.roster_cancel()}
		{submitting}
		{isOffline}
		onsubmit={() => void submitSeasonCreate()}
		oncancel={dismiss}
	/>
</div>
