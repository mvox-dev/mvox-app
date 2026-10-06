<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import FormError from '$lib/components/FormError.svelte';
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail, EventInheritedField } from '$lib/events/eventDetail';
	import type { SeriesDefaults } from '$lib/seasons/seasonManage';
	import type { EventActions, EventSeriesState } from '$lib/events/eventPageState';

	let {
		detail,
		selected,
		series,
		isOffline,
		generation,
		actions,
		refreshDetail
	}: {
		detail: EventDetail;
		selected: Collective | null;
		series: EventSeriesState;
		isOffline: boolean;
		generation: () => number;
		actions: EventActions;
		refreshDetail: (evId: string, g: number) => Promise<void>;
	} = $props();

	const isOwnerTier = $derived(selected !== null && detail.ownerIds.includes(selected.personId));

	const seriesUnassignGated = $derived(!isOwnerTier && detail.seriesId !== null);

	function seriesFieldLabel(field: EventInheritedField): string {
		switch (field) {
			case 'name':
				return m.event_detail_series_field_name();
			case 'durationMinutes':
				return m.event_detail_series_field_duration();
			case 'location':
				return m.event_detail_series_field_location();
			case 'description':
				return m.event_detail_series_field_description();
		}
	}

	function seriesFieldBecomes(field: EventInheritedField, defaults: SeriesDefaults): string {
		switch (field) {
			case 'name':
				return defaults.name;
			case 'durationMinutes':
				return defaults.durationMinutes !== null ? String(defaults.durationMinutes) : '';
			case 'location':
				return defaults.defaultLocation;
			case 'description':
				return defaults.defaultDescription;
		}
	}

	async function onSeriesSelectChange(e: Event): Promise<void> {
		const selectEl = e.currentTarget as HTMLSelectElement;
		const newId = selectEl.value;
		if (!selected) return;
		if (isOffline) return;
		const previousId = detail.seriesId ?? '';
		series.error = null;
		series.status = '';
		if (newId === previousId) {
			series.armedTarget = null;
			series.previewDefaults = null;
			return;
		}
		if (detail.inheritedFields.length === 0) {
			await commitSeriesChange(newId, selectEl);
			return;
		}
		series.armedTarget = { id: newId };
		series.previewDefaults = null;
		if (newId === '') return;
		const cfg = cfgFor(selected.db);
		try {
			const defaults = await actions.getSeriesDefaults(cfg, newId);
			if (series.armedTarget?.id !== newId) return;
			series.previewDefaults = defaults;
		} catch (err) {
			if (series.armedTarget?.id !== newId) return;
			reportProblem({ area: 'event', action: 'loading the series defaults', error: err });
			series.armedTarget = null;
			selectEl.value = previousId;
			series.error = m.event_detail_series_save_error();
		}
	}

	async function cancelSeriesChange(): Promise<void> {
		series.armedTarget = null;
		series.previewDefaults = null;
		series.error = null;
		await tick();
		const selectEl = document.querySelector<HTMLSelectElement>('[data-testid="event-series-select"]');
		if (selectEl) selectEl.value = detail.seriesId ?? '';
		selectEl?.focus();
	}

	async function confirmSeriesChange(): Promise<void> {
		if (!series.armedTarget || series.pending) return;
		const selectEl = document.querySelector<HTMLSelectElement>('[data-testid="event-series-select"]');
		await commitSeriesChange(series.armedTarget.id, selectEl);
	}

	async function commitSeriesChange(newId: string, selectEl: HTMLSelectElement | null): Promise<void> {
		if (!selected) return;
		if (isOffline) return;
		const g = generation();
		const evId = detail.id;
		const previousId = detail.seriesId ?? '';
		series.pending = true;
		series.error = null;
		series.status = '';
		const cfg = cfgFor(selected.db);
		try {
			if (newId === '') {
				await actions.unassignEventSeries(cfg, evId);
			} else {
				await actions.reassignEventSeries(cfg, evId, newId);
			}
			if (g !== generation()) return;
			series.armedTarget = null;
			series.previewDefaults = null;
			await refreshDetail(evId, g);
			if (g !== generation()) return;
			series.pending = false;
			series.status = m.event_detail_series_saved();
		} catch (err) {
			if (g !== generation()) return;
			console.error('event detail: series write failed', evId, err);
			series.armedTarget = null;
			series.previewDefaults = null;
			series.pending = false;
			series.error = m.event_detail_series_save_error();
			if (selectEl) selectEl.value = previousId;
		}
	}
</script>

<select
	id="event-series-select"
	data-testid="event-series-select"
	value={detail.seriesId ?? ''}
	disabled={series.pending || isOffline}
	onchange={(e) => void onSeriesSelectChange(e)}
	class="w-fit border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
>
	{#if !seriesUnassignGated}
		<option value="">{m.event_detail_series_none()}</option>
	{/if}
	{#each series.options as option (option.id)}
		<option value={option.id}>{option.name}</option>
	{/each}
</select>
{#if seriesUnassignGated}
	<p data-testid="event-series-rights-note" class="text-xs text-ink-3">
		{m.event_detail_series_rights_note()}
	</p>
{/if}
{#if detail.inheritedFields.length > 0}
	<p class="flex flex-wrap items-baseline gap-x-1 text-xs text-ink-3">
		<span>{m.event_detail_series_inherited_label()}</span>
		{#if detail.inheritedFields.includes('name')}
			<span data-testid="event-series-inherited-name"
				>{m.event_detail_series_field_name()}</span
			>
		{/if}
		{#if detail.inheritedFields.includes('durationMinutes')}
			<span data-testid="event-series-inherited-duration"
				>{m.event_detail_series_field_duration()}</span
			>
		{/if}
		{#if detail.inheritedFields.includes('location')}
			<span data-testid="event-series-inherited-location"
				>{m.event_detail_series_field_location()}</span
			>
		{/if}
		{#if detail.inheritedFields.includes('description')}
			<span data-testid="event-series-inherited-description"
				>{m.event_detail_series_field_description()}</span
			>
		{/if}
	</p>
{/if}
{#if series.armedTarget && detail.inheritedFields.length > 0 && (series.armedTarget.id === '' || series.previewDefaults)}
	<div
		data-testid="event-series-confirm"
		class="flex flex-col gap-1.5 border border-ink-5 bg-paper p-2 text-xs"
	>
		<ul class="flex flex-col gap-0.5">
			{#each detail.inheritedFields as field (field)}
				<li>
					{seriesFieldLabel(field)}{#if series.armedTarget.id !== ''}:
						{seriesFieldBecomes(field, series.previewDefaults!)}{/if}
				</li>
			{/each}
			{#if series.armedTarget.id === '' && detail.inheritedFields.includes('name')}
				<li class="text-red-700">
					{m.event_detail_series_unassign_name_empty()}
				</li>
			{/if}
		</ul>
		<div class="flex gap-2">
			<button
				type="button"
				data-testid="event-series-confirm-apply"
				disabled={series.pending || isOffline}
				aria-busy={series.pending}
				class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
				onclick={() => void confirmSeriesChange()}
			>
				{m.event_detail_series_confirm_apply()}
			</button>
			<button
				type="button"
				data-testid="event-series-confirm-cancel"
				disabled={series.pending}
				class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
				onclick={() => void cancelSeriesChange()}
			>
				{m.event_detail_series_confirm_cancel()}
			</button>
		</div>
	</div>
{/if}
<p data-testid="event-series-status" role="status" aria-live="polite" class="text-xs text-ink-3">
	{series.status}
</p>
{#if series.error}
	<FormError data-testid="event-series-error">
		{series.error}
	</FormError>
{/if}
