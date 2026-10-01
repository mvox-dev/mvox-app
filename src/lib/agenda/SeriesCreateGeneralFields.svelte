<!-- The series create form's general fieldset: name, event type and description. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{m.series_create_name_label()}</span>
		<input
			type="text"
			data-testid="series-create-name"
			use:focusOnMount
			{...fieldErrorAttrs(errorField, 'name', 'series-create-error')}
			placeholder={m.series_create_name_placeholder()}
			disabled={locked}
			value={name}
			oninput={(e) => {
				name = (e.currentTarget as HTMLInputElement).value;
				onedit();
			}}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
		/>
	</label>
	<label class="flex w-full flex-col gap-0.5">
		<span data-testid="series-create-type-label" class="text-xs text-ink-2">
			{m.series_create_type_label()}
		</span>
		<select
			data-testid="series-create-type"
			{...fieldErrorAttrs(errorField, 'type', 'series-create-error')}
			disabled={locked}
			value={eventType}
			onchange={(e) => {
				eventType = (e.currentTarget as HTMLSelectElement).value;
				onedit();
			}}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
		>
			{#each CANONICAL_EVENT_TYPES as type (type)}
				<option value={type}>{eventTypeLabel(type)}</option>
			{/each}
		</select>
	</label>
	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">
			{m.series_create_description_label()}
		</span>
		<textarea
			data-testid="series-create-description"
			placeholder={m.series_create_description_placeholder()}
			disabled={locked}
			value={description}
			oninput={(e) =>
				(description = (e.currentTarget as HTMLTextAreaElement).value)}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
		></textarea>
	</label>
</fieldset>
