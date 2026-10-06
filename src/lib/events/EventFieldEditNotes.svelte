<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { listEventLocations, type EventDetail } from '$lib/events/eventDetail';
	import PersonName from '$lib/components/PersonName.svelte';
	import type { Collective } from '$lib/collectives/types';
	import type { EditableEventField } from '$lib/events/eventFieldEdit';
	import type { EventEditState } from '$lib/events/eventPageState';
	import { focusOnMount } from '$lib/a11y/focusable';
	import EditActivator from '$lib/components/EditActivator.svelte';

	let {
		detail,
		selected,
		edit,
		isEditor,
		isOffline,
		beginFieldEdit,
		confirmFieldEdit,
		handleFieldKeydown
	}: {
		detail: EventDetail;
		selected: Collective | null;
		edit: EventEditState;
		isEditor: boolean;
		isOffline: boolean;
		beginFieldEdit: (field: EditableEventField) => void;
		confirmFieldEdit: (field: EditableEventField, restoreFocus: boolean) => void;
		handleFieldKeydown: (e: KeyboardEvent, field: EditableEventField, multiline: boolean) => void;
	} = $props();

	const LOCATION_SUGGESTIONS_ID = 'event-edit-location-suggestions';
	function ensureLocationCorpusLoaded(): void {
		if (edit.locationCorpusRequested) return;
		edit.locationCorpusRequested = true;
		if (!selected) return;
		const cfg = cfgFor(selected.db);
		listEventLocations(cfg)
			.then((result) => {
				edit.locationSuggestions = result.items;
				if (result.truncated) {
					console.warn('event detail: location-suggestion corpus is truncated');
				}
			})
			.catch((e) => {
				reportProblem({ area: 'event', action: 'loading the location suggestions', error: e });
			});
	}
</script>

{#if edit.editingField === 'location'}
	<input
		type="text"
		data-testid="event-edit-input-location"
		aria-label={m.event_edit_location_aria_label()}
		class="border-b border-ink bg-transparent text-ink-2"
		list={LOCATION_SUGGESTIONS_ID}
		value={edit.draft}
		use:focusOnMount
		oninput={(e) => (edit.draft = (e.currentTarget as HTMLInputElement).value)}
		onfocus={ensureLocationCorpusLoaded}
		onblur={() => confirmFieldEdit('location', false)}
		onkeydown={(e) => handleFieldKeydown(e, 'location', false)}
	/>
	<datalist id={LOCATION_SUGGESTIONS_ID}>
		{#each edit.locationSuggestions as loc (loc)}
			<option value={loc}></option>
		{/each}
	</datalist>
{:else if detail.location || isEditor}
	{#if isEditor}
		<EditActivator
			label={m.event_edit_location_aria_label()}
			data-testid="event-edit-btn-location"
			class="w-full items-center gap-2 text-base text-ink-2"
			disabled={edit.writePending.location === true || isOffline}
			bind:element={edit.pencilRefs.location}
			onclick={() => beginFieldEdit('location')}
		>
			{#if detail.location}
				<span data-testid="event-detail-location">{detail.location}</span>
			{/if}
		</EditActivator>
	{:else}
		<p class="flex items-center gap-2 text-base text-ink-2">
			<span data-testid="event-detail-location">{detail.location}</span>
		</p>
	{/if}
{/if}
{#if edit.errors.location}
	<FormError data-testid="event-edit-error-location">
		{m.event_edit_save_error()}
	</FormError>
{/if}

{#if detail.conductorNames.length > 0}
	<p data-testid="event-detail-conductors" class="text-base text-ink-2">
		{m.event_detail_conductor_label()}:
		{#each detail.conductorNames as conductorName, conductorIndex (conductorName + conductorIndex)}{#if conductorIndex > 0}{', '}{/if}<PersonName
				name={conductorName}
			/>{/each}
	</p>
{/if}

{#if edit.editingField === 'description'}
	<textarea
		data-testid="event-edit-input-description"
		aria-label={m.event_edit_description_aria_label()}
		class="mt-2 min-h-24 w-full border border-ink-4 bg-transparent p-2 text-ink"
		value={edit.draft}
		use:focusOnMount
		oninput={(e) => (edit.draft = (e.currentTarget as HTMLTextAreaElement).value)}
		onblur={() => confirmFieldEdit('description', false)}
		onkeydown={(e) => handleFieldKeydown(e, 'description', true)}
	></textarea>
{:else if detail.description || isEditor}
	{#if isEditor}
		<EditActivator
			label={m.event_edit_description_aria_label()}
			data-testid="event-edit-btn-description"
			class="mt-2 w-full items-start gap-2 text-base text-ink"
			disabled={edit.writePending.description === true || isOffline}
			bind:element={edit.pencilRefs.description}
			onclick={() => beginFieldEdit('description')}
		>
			{#if detail.description}
				<span data-testid="event-detail-description">{detail.description}</span>
			{/if}
		</EditActivator>
	{:else}
		<p class="mt-2 flex items-start gap-2 text-base text-ink">
			<span data-testid="event-detail-description">{detail.description}</span>
		</p>
	{/if}
{/if}
{#if edit.errors.description}
	<FormError data-testid="event-edit-error-description">
		{m.event_edit_save_error()}
	</FormError>
{/if}
