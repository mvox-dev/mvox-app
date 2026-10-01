<!-- The series create form's general fieldset: name, event type and description. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Field from '$lib/components/Field.svelte';
	import { fieldErrorAttrs } from '$lib/a11y/formErrors';
	import { focusOnMount } from '$lib/a11y/focusable';
	import { CANONICAL_EVENT_TYPES, eventTypeLabel } from '$lib/events/eventTypeLabels';
	import type { SeriesCreateErrorField } from '$lib/agenda/seriesCreateResume';

	interface Props {
		name: string;
		eventType: string;
		description: string;
		errorField: SeriesCreateErrorField;
		locked: boolean;
		onedit: () => void;
	}

	let {
		name = $bindable(),
		eventType = $bindable(),
		description = $bindable(),
		errorField,
		locked,
		onedit
	}: Props = $props();
</script>

<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
	<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
		{m.series_create_group_general_label()}
	</legend>
	<Field label={m.series_create_name_label()} disabled={locked}>
		{#snippet children(control)}
			<input
				type="text"
				data-testid="series-create-name"
				use:focusOnMount
				{...fieldErrorAttrs(errorField, 'name', 'series-create-error')}
				placeholder={m.series_create_name_placeholder()}
				value={name}
				oninput={(e) => {
					name = (e.currentTarget as HTMLInputElement).value;
					onedit();
				}}
				{...control}
			/>
		{/snippet}
	</Field>
	<Field label={m.series_create_type_label()} labelTestid="series-create-type-label" disabled={locked}>
		{#snippet children(control)}
			<select
				data-testid="series-create-type"
				{...fieldErrorAttrs(errorField, 'type', 'series-create-error')}
				value={eventType}
				onchange={(e) => {
					eventType = (e.currentTarget as HTMLSelectElement).value;
					onedit();
				}}
				{...control}
			>
				{#each CANONICAL_EVENT_TYPES as type (type)}
					<option value={type}>{eventTypeLabel(type)}</option>
				{/each}
			</select>
		{/snippet}
	</Field>
	<Field label={m.series_create_description_label()} disabled={locked}>
		{#snippet children(control)}
			<textarea
				data-testid="series-create-description"
				placeholder={m.series_create_description_placeholder()}
				value={description}
				oninput={(e) =>
					(description = (e.currentTarget as HTMLTextAreaElement).value)}
				{...control}
			></textarea>
		{/snippet}
	</Field>
</fieldset>
