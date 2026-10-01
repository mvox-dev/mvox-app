<!-- The series create form's schedule fieldset: repeat, day, time and the date range. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Field from '$lib/components/Field.svelte';
	import { fieldErrorAttrs } from '$lib/a11y/formErrors';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import type { RepeatPattern } from '$lib/events/recurrence';
	import type { SeriesCreateErrorField } from '$lib/agenda/seriesCreateResume';

	interface Props {
		repeat: RepeatPattern;
		day: string;
		time: string;
		from: string;
		until: string;
		dayApplies: boolean;
		errorField: SeriesCreateErrorField;
		locked: boolean;
		onedit: () => void;
	}

	let {
		repeat = $bindable(),
		day = $bindable(),
		time = $bindable(),
		from = $bindable(),
		until = $bindable(),
		dayApplies,
		errorField,
		locked,
		onedit
	}: Props = $props();

	const timeErrorAttrs = $derived(fieldErrorAttrs(errorField, 'time', 'series-create-error'));
</script>

<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
	<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
		{m.series_create_group_schedule_label()}
	</legend>
	<div class="flex gap-2">
		<Field label={m.series_create_repeat_label()} disabled={locked} grow>
			{#snippet children(control)}
				<select
					data-testid="series-create-repeat"
					value={repeat}
					onchange={(e) =>
						(repeat = (e.currentTarget as HTMLSelectElement).value as RepeatPattern)}
					disabled={control.disabled}
					class={control.class}
				>
					<option value="weekly">{m.series_create_repeat_weekly()}</option>
					<option value="biweekly">{m.series_create_repeat_biweekly()}</option>
					<option value="daily">{m.series_create_repeat_daily()}</option>
				</select>
			{/snippet}
		</Field>
		{#if dayApplies}
			<Field label={m.series_create_day_label()} disabled={locked} grow>
				{#snippet children(control)}
					<select
						data-testid="series-create-day"
						{...fieldErrorAttrs(errorField, 'day', 'series-create-error')}
						value={day}
						onchange={(e) => {
							day = (e.currentTarget as HTMLSelectElement).value;
							onedit();
						}}
						disabled={control.disabled}
						class={control.class}
					>
						<option value="">{m.series_create_day_placeholder()}</option>
						<option value="1">{m.series_create_day_1()}</option>
						<option value="2">{m.series_create_day_2()}</option>
						<option value="3">{m.series_create_day_3()}</option>
						<option value="4">{m.series_create_day_4()}</option>
						<option value="5">{m.series_create_day_5()}</option>
						<option value="6">{m.series_create_day_6()}</option>
						<option value="0">{m.series_create_day_0()}</option>
					</select>
				{/snippet}
			</Field>
		{/if}
	</div>

	<div class="flex flex-col gap-0.5">
		<span id="series-create-time-label" class="text-xs text-ink-2">
			{m.series_create_time_label()}
		</span>
		<div
			data-testid="series-create-time"
			role="group"
			aria-labelledby="series-create-time-label"
			class="flex gap-2"
		>
			<TimeSelect
				prefix="series-create-time"
				value={time}
				disabled={locked}
				invalid={timeErrorAttrs['aria-invalid']}
				describedBy={timeErrorAttrs['aria-describedby']}
				onchange={(v) => {
					time = v;
					onedit();
				}}
			/>
		</div>
	</div>

	<div class="flex gap-2">
		<Field label={m.series_create_from_label()} disabled={locked} grow>
			{#snippet children(control)}
				<input
					type="date"
					data-testid="series-create-from"
					{...fieldErrorAttrs(errorField, 'from', 'series-create-error')}
					value={from}
					oninput={(e) => {
						from = (e.currentTarget as HTMLInputElement).value;
						onedit();
					}}
					disabled={control.disabled}
					class={control.class}
				/>
			{/snippet}
		</Field>
		<Field label={m.series_create_until_label()} disabled={locked} grow>
			{#snippet children(control)}
				<input
					type="date"
					data-testid="series-create-until"
					{...fieldErrorAttrs(errorField, 'until', 'series-create-error')}
					value={until}
					oninput={(e) => {
						until = (e.currentTarget as HTMLInputElement).value;
						onedit();
					}}
					disabled={control.disabled}
					class={control.class}
				/>
			{/snippet}
		</Field>
	</div>
</fieldset>
