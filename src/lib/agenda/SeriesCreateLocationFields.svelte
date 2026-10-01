<!-- The series create form's location fieldset: duration and location. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Field from '$lib/components/Field.svelte';
	import { fieldErrorAttrs } from '$lib/a11y/formErrors';
	import type { SeriesCreateErrorField } from '$lib/agenda/seriesCreateResume';

	interface Props {
		duration: string;
		location: string;
		locationSuggestionsId: string;
		errorField: SeriesCreateErrorField;
		locked: boolean;
		onedit: () => void;
	}

	let {
		duration = $bindable(),
		location = $bindable(),
		locationSuggestionsId,
		errorField,
		locked,
		onedit
	}: Props = $props();
</script>

<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
	<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
		{m.series_create_group_location_label()}
	</legend>
	<Field label={m.series_create_duration_label()} disabled={locked}>
		{#snippet children(control)}
			<input
				type="number"
				data-testid="series-create-duration"
				{...fieldErrorAttrs(errorField, 'duration', 'series-create-error')}
				placeholder={m.series_create_duration_placeholder()}
				value={duration}
				oninput={(e) => {
					duration = (e.currentTarget as HTMLInputElement).value;
					onedit();
				}}
				disabled={control.disabled}
				class={control.class}
			/>
		{/snippet}
	</Field>
	<Field label={m.series_create_location_label()} disabled={locked}>
		{#snippet children(control)}
			<input
				type="text"
				data-testid="series-create-location"
				list={locationSuggestionsId}
				placeholder={m.series_create_location_placeholder()}
				value={location}
				oninput={(e) => (location = (e.currentTarget as HTMLInputElement).value)}
				disabled={control.disabled}
				class={control.class}
			/>
		{/snippet}
	</Field>
</fieldset>
