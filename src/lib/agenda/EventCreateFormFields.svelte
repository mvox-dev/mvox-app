<!-- #646 — the [+ Event] form's field rows; the form keeps the state and the submit. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Field from '$lib/components/Field.svelte';
	import { fieldErrorAttrs } from '$lib/a11y/formErrors';
	import { focusOnMount } from '$lib/a11y/focusable';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import { CANONICAL_EVENT_TYPES, eventTypeLabel } from '$lib/events/eventTypeLabels';
	import type { SeriesDefaults, SeriesOption } from '$lib/seasons/seasonManage';
	import type { Season } from '$lib/seasons/types';

	interface Props {
		seasons: Season[];
		locationSuggestionsId: string;
		eventCreateErrorField: 'type' | 'season' | 'datetime' | 'name' | 'end' | null;
		eventCreateSeasonId: string;
		eventCreateSeriesId: string;
		eventCreateSeriesOptions: SeriesOption[];
		eventCreateSeriesDefaults: SeriesDefaults | null;
		eventCreateType: string;
		eventCreateName: string;
		eventCreateDate: string;
		eventCreateTime: string;
		eventCreateEndDate: string;
		eventCreateEndTime: string;
		eventCreateEndTouched: boolean;
		eventCreateLocation: string;
		eventCreateDescription: string;
		eventCreateCapacity: string;
		clearEventCreateError: () => void;
		handleEventCreateSeasonChange: (newSeasonId: string) => void;
		handleEventCreateSeriesChange: (newSeriesId: string) => void;
	}

	let {
		seasons,
		locationSuggestionsId,
		eventCreateErrorField,
		eventCreateSeasonId,
		eventCreateSeriesId,
		eventCreateSeriesOptions,
		eventCreateSeriesDefaults,
		eventCreateType = $bindable(),
		eventCreateName = $bindable(),
		eventCreateDate = $bindable(),
		eventCreateTime = $bindable(),
		eventCreateEndDate = $bindable(),
		eventCreateEndTime = $bindable(),
		eventCreateEndTouched = $bindable(),
		eventCreateLocation = $bindable(),
		eventCreateDescription = $bindable(),
		eventCreateCapacity = $bindable(),
		clearEventCreateError,
		handleEventCreateSeasonChange,
		handleEventCreateSeriesChange
	}: Props = $props();

	const datetimeErrorAttrs = $derived(
		fieldErrorAttrs(eventCreateErrorField, 'datetime', 'event-create-error')
	);
	const endErrorAttrs = $derived(
		fieldErrorAttrs(eventCreateErrorField, 'end', 'event-create-error')
	);
</script>

<Field label={m.event_create_type_label()} labelTestid="event-create-type-label">
	{#snippet children(control)}
		<select
			data-testid="event-create-type"
			{...fieldErrorAttrs(eventCreateErrorField, 'type', 'event-create-error')}
			value={eventCreateType}
			onchange={(e) => {
				eventCreateType = (e.currentTarget as HTMLSelectElement).value;
				clearEventCreateError();
			}}
			disabled={control.disabled}
			class={control.class}
		>
			<option value="">{m.event_create_type_placeholder()}</option>
			{#each CANONICAL_EVENT_TYPES as type (type)}
				<option value={type}>{eventTypeLabel(type)}</option>
			{/each}
		</select>
	{/snippet}
</Field>

<Field label={m.event_create_season_label()}>
	{#snippet children(control)}
		<select
			data-testid="event-create-season"
			{...fieldErrorAttrs(eventCreateErrorField, 'season', 'event-create-error')}
			value={eventCreateSeasonId}
			onchange={(e) =>
				handleEventCreateSeasonChange((e.currentTarget as HTMLSelectElement).value)}
			disabled={control.disabled}
			class={control.class}
		>
			<option value="">{m.event_create_season_placeholder()}</option>
			{#each seasons as season (season.id)}
				<option value={season.id}>{season.name}</option>
			{/each}
		</select>
	{/snippet}
</Field>

<Field label={m.event_create_series_label()} disabled={eventCreateSeasonId === ''}>
	{#snippet children(control)}
		<select
			data-testid="event-create-series"
			value={eventCreateSeriesId}
			onchange={(e) =>
				handleEventCreateSeriesChange((e.currentTarget as HTMLSelectElement).value)}
			disabled={control.disabled}
			class={control.class}
		>
			<option value="">{m.event_create_series_none()}</option>
			{#each eventCreateSeriesOptions as series (series.id)}
				<option value={series.id}>{series.name}</option>
			{/each}
		</select>
	{/snippet}
</Field>

{#if eventCreateSeriesId === ''}
	<p data-testid="event-create-series-hint" class="text-xs text-ink-2">
		{m.event_create_series_hint()}
	</p>
{/if}

<Field label={m.event_create_name_label()}>
	{#snippet children(control)}
		<input
			type="text"
			data-testid="event-create-name"
			use:focusOnMount
			{...fieldErrorAttrs(eventCreateErrorField, 'name', 'event-create-error')}
			placeholder={m.event_create_name_placeholder()}
			value={eventCreateName}
			oninput={(e) => {
				eventCreateName = (e.currentTarget as HTMLInputElement).value;
				clearEventCreateError();
			}}
			disabled={control.disabled}
			class={control.class}
		/>
	{/snippet}
</Field>
{#if eventCreateSeriesDefaults?.name}
	<p data-testid="event-create-name-inherited" class="text-xs text-ink-2">
		{m.event_create_inherited_from_series({ value: eventCreateSeriesDefaults.name })}
	</p>
{/if}

<div class="flex flex-col gap-0.5">
	<span id="event-create-start-label" class="text-xs text-ink-2">
		{m.event_create_start_label()}
	</span>
	<div
		data-testid="event-create-datetime"
		role="group"
		aria-labelledby="event-create-start-label"
		class="flex flex-wrap gap-2"
	>
		<input
			type="date"
			data-testid="event-create-datetime-date"
			aria-label={m.time_select_date_label()}
			{...datetimeErrorAttrs}
			value={eventCreateDate}
			oninput={(e) => {
				eventCreateDate = (e.currentTarget as HTMLInputElement).value;
				if (!eventCreateEndTouched) eventCreateEndDate = eventCreateDate;
				clearEventCreateError();
			}}
			class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
		<TimeSelect
			prefix="event-create-datetime"
			value={eventCreateTime}
			invalid={datetimeErrorAttrs['aria-invalid']}
			describedBy={datetimeErrorAttrs['aria-describedby']}
			onchange={(v) => {
				eventCreateTime = v;
				clearEventCreateError();
			}}
		/>
	</div>
</div>

<div class="flex flex-col gap-0.5">
	<span id="event-create-end-label" class="text-xs text-ink-2">
		{m.event_create_end_label()}
	</span>
	<div
		data-testid="event-create-end"
		role="group"
		aria-labelledby="event-create-end-label"
		class="flex flex-wrap gap-2"
	>
		<input
			type="date"
			data-testid="event-create-end-date"
			aria-label={m.time_select_date_label()}
			{...endErrorAttrs}
			value={eventCreateEndDate}
			oninput={(e) => {
				eventCreateEndDate = (e.currentTarget as HTMLInputElement).value;
				eventCreateEndTouched = true;
				clearEventCreateError();
			}}
			class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
		<TimeSelect
			prefix="event-create-end"
			value={eventCreateEndTime}
			invalid={endErrorAttrs['aria-invalid']}
			describedBy={endErrorAttrs['aria-describedby']}
			onchange={(v) => {
				eventCreateEndTime = v;
				clearEventCreateError();
			}}
		/>
	</div>
</div>
{#if eventCreateSeriesDefaults && eventCreateSeriesDefaults.durationMinutes !== null}
	<p data-testid="event-create-duration-inherited" class="text-xs text-ink-2">
		{m.event_create_inherited_from_series({
			value: m.agenda_duration_min({
				minutes: eventCreateSeriesDefaults.durationMinutes
			})
		})}
	</p>
{/if}

<Field label={m.event_create_capacity_label()}>
	{#snippet children(control)}
		<input
			type="number"
			data-testid="event-create-capacity"
			placeholder={m.event_create_capacity_placeholder()}
			value={eventCreateCapacity}
			oninput={(e) =>
				(eventCreateCapacity = (e.currentTarget as HTMLInputElement).value)}
			disabled={control.disabled}
			class={control.class}
		/>
	{/snippet}
</Field>

<Field label={m.event_create_location_label()}>
	{#snippet children(control)}
		<input
			type="text"
			data-testid="event-create-location"
			list={locationSuggestionsId}
			placeholder={m.event_create_location_placeholder()}
			value={eventCreateLocation}
			oninput={(e) =>
				(eventCreateLocation = (e.currentTarget as HTMLInputElement).value)}
			disabled={control.disabled}
			class={control.class}
		/>
	{/snippet}
</Field>
{#if eventCreateSeriesDefaults?.defaultLocation}
	<p data-testid="event-create-location-inherited" class="text-xs text-ink-2">
		{m.event_create_inherited_from_series({
			value: eventCreateSeriesDefaults.defaultLocation
		})}
	</p>
{/if}

<Field label={m.event_create_description_label()}>
	{#snippet children(control)}
		<textarea
			data-testid="event-create-description"
			placeholder={m.event_create_description_placeholder()}
			value={eventCreateDescription}
			oninput={(e) =>
				(eventCreateDescription = (e.currentTarget as HTMLTextAreaElement).value)}
			disabled={control.disabled}
			class={control.class}
		></textarea>
	{/snippet}
</Field>
{#if eventCreateSeriesDefaults?.defaultDescription}
	<p data-testid="event-create-description-inherited" class="text-xs text-ink-2">
		{m.event_create_inherited_from_series({
			value: eventCreateSeriesDefaults.defaultDescription
		})}
	</p>
{/if}
