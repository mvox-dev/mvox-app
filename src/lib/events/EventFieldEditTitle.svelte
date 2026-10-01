<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { eventTypeLabel, CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EditableEventField } from '$lib/events/eventFieldEdit';
	import type { EventEditState } from '$lib/events/eventPageState';
	import { focusOnMount } from '$lib/a11y/focusable';
	import EditActivator from '$lib/components/EditActivator.svelte';

	let {
		detail,
		edit,
		isEditor,
		isOffline,
		beginFieldEdit,
		confirmFieldEdit,
		handleFieldKeydown
	}: {
		detail: EventDetail;
		edit: EventEditState;
		isEditor: boolean;
		isOffline: boolean;
		beginFieldEdit: (field: EditableEventField) => void;
		confirmFieldEdit: (field: EditableEventField, restoreFocus: boolean) => void;
		handleFieldKeydown: (e: KeyboardEvent, field: EditableEventField, multiline: boolean) => void;
	} = $props();
</script>

{#if edit.editingField === 'event_type'}
	<select
		data-testid="event-edit-input-event_type"
		aria-label={m.event_edit_event_type_aria_label()}
		class="w-fit border-b border-ink bg-transparent text-ink-2"
		value={edit.draft}
		use:focusOnMount
		onchange={(e) => (edit.draft = (e.currentTarget as HTMLSelectElement).value)}
		onblur={() => confirmFieldEdit('event_type', false)}
		onkeydown={(e) => handleFieldKeydown(e, 'event_type', false)}
	>
		<option value=""></option>
		{#each CANONICAL_EVENT_TYPES as type (type)}
			<option value={type}>{eventTypeLabel(type)}</option>
		{/each}
	</select>
{:else if detail.eventType || isEditor}
	{#if isEditor}
		<EditActivator
			label={m.event_edit_event_type_aria_label()}
			data-testid="event-edit-btn-event_type"
			class="w-fit items-center gap-2"
			disabled={edit.writePending.event_type === true || isOffline}
			bind:element={edit.pencilRefs.event_type}
			onclick={() => beginFieldEdit('event_type')}
		>
			{#if detail.eventType}
				<span
					data-testid="event-detail-type"
					class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(detail.eventType)}"
				>
					{eventTypeLabel(detail.eventType)}
				</span>
			{/if}
		</EditActivator>
	{:else}
		<span
			data-testid="event-detail-type"
			class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(detail.eventType)}"
		>
			{eventTypeLabel(detail.eventType)}
		</span>
	{/if}
{/if}
{#if edit.errors.event_type}
	<FormError data-testid="event-edit-error-event_type">
		{m.event_edit_save_error()}
	</FormError>
{/if}
{#if edit.editingField === 'event_name'}
	<input
		type="text"
		data-testid="event-edit-input-name"
		aria-label={m.event_edit_name_aria_label()}
		class="border-b border-ink bg-transparent font-display text-2xl"
		value={edit.draft}
		use:focusOnMount
		oninput={(e) => (edit.draft = (e.currentTarget as HTMLInputElement).value)}
		onblur={() => confirmFieldEdit('event_name', false)}
		onkeydown={(e) => handleFieldKeydown(e, 'event_name', false)}
	/>
{:else if isEditor}
	<h1
		data-testid="event-detail-name"
		aria-labelledby="event-detail-name-value"
		class="font-display text-2xl"
	>
		<EditActivator
			label={m.event_edit_name_aria_label()}
			data-testid="event-edit-btn-name"
			class="w-full items-center gap-2 font-display text-2xl"
			disabled={edit.writePending.event_name === true || isOffline}
			bind:element={edit.pencilRefs.event_name}
			onclick={() => beginFieldEdit('event_name')}
		>
			<span id="event-detail-name-value">{detail.name}</span>
		</EditActivator>
	</h1>
{:else}
	<h1 data-testid="event-detail-name" class="font-display text-2xl">{detail.name}</h1>
{/if}
{#if edit.errors.event_name}
	<FormError data-testid="event-edit-error-name">
		{m.event_edit_save_error()}
	</FormError>
{/if}
