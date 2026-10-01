<!-- The series create form's location fieldset: duration and location. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">
			{m.series_create_duration_label()}
		</span>
		<input
			type="number"
			data-testid="series-create-duration"
			{...fieldErrorAttrs(errorField, 'duration', 'series-create-error')}
			placeholder={m.series_create_duration_placeholder()}
			disabled={locked}
			value={duration}
			oninput={(e) => {
				duration = (e.currentTarget as HTMLInputElement).value;
				onedit();
			}}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
		/>
	</label>
	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">
			{m.series_create_location_label()}
		</span>
		<input
			type="text"
			data-testid="series-create-location"
			list={locationSuggestionsId}
			placeholder={m.series_create_location_placeholder()}
			disabled={locked}
			value={location}
			oninput={(e) => (location = (e.currentTarget as HTMLInputElement).value)}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
		/>
	</label>
</fieldset>
