<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import { focusOnMount } from '$lib/a11y/focusable';

	let {
		isOffline,
		addOpen,
		addError,
		addErrorField,
		addPending,
		addName = $bindable(),
		addDate = $bindable(),
		addTime = $bindable(),
		clearScheduleAddError,
		beginScheduleAdd,
		submitScheduleAdd,
		cancelScheduleAdd
	}: {
		isOffline: boolean;
		addOpen: boolean;
		addError: (() => string) | null;
		addErrorField: 'name' | 'datetime' | null;
		addPending: boolean;
		addName: string;
		addDate: string;
		addTime: string;
		clearScheduleAddError: () => void;
		beginScheduleAdd: () => void;
		submitScheduleAdd: () => void;
		cancelScheduleAdd: () => void;
	} = $props();
</script>

{#if addError}
	<FormError id="event-schedule-add-error" data-testid="event-schedule-add-error">
		{addError()}
	</FormError>
{/if}
{#if addOpen}
	<div class="flex flex-wrap items-end gap-2">
		<div class="flex flex-col gap-0.5">
			<label for="event-schedule-add-name-input" class="text-xs text-ink-2">
				{m.event_schedule_name_label()}
			</label>
			<input
				type="text"
				id="event-schedule-add-name-input"
				data-testid="event-schedule-add-name"
				class="border-b border-ink bg-transparent text-ink"
				aria-invalid={addErrorField === 'name' ? true : undefined}
				aria-describedby={addErrorField === 'name'
					? 'event-schedule-add-error'
					: undefined}
				value={addName}
				use:focusOnMount
				oninput={(e) => {
					addName = (e.currentTarget as HTMLInputElement).value;
					clearScheduleAddError();
				}}
			/>
		</div>
		<div class="flex flex-col gap-0.5">
			<span id="event-schedule-add-datetime-label" class="text-xs text-ink-2"
				>{m.event_schedule_datetime_label()}</span
			>
			<div
				data-testid="event-schedule-add-datetime"
				role="group"
				aria-labelledby="event-schedule-add-datetime-label"
				aria-describedby={addErrorField === 'datetime'
					? 'event-schedule-add-error'
					: undefined}
				class="flex flex-wrap items-center gap-2 text-ink-2"
			>
				<input
					type="date"
					data-testid="event-schedule-add-datetime-date"
					aria-label={m.time_select_date_label()}
					aria-invalid={addErrorField === 'datetime' ? true : undefined}
					class="min-w-0 border-b border-ink bg-transparent text-ink"
					value={addDate}
					oninput={(e) => {
						addDate = (e.currentTarget as HTMLInputElement).value;
						clearScheduleAddError();
					}}
				/>
				<TimeSelect
					prefix="event-schedule-add-datetime"
					value={addTime}
					onchange={(v) => {
						addTime = v;
						clearScheduleAddError();
					}}
				/>
			</div>
		</div>
		<button
			type="button"
			data-testid="event-schedule-add-submit"
			disabled={addPending || isOffline}
			class="flex min-h-11 items-center rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50"
			onclick={submitScheduleAdd}
		>
			{m.event_schedule_add_submit()}
		</button>
		<button
			type="button"
			data-testid="event-schedule-add-cancel"
			class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink"
			onclick={cancelScheduleAdd}
		>
			{m.event_schedule_add_cancel()}
		</button>
	</div>
{:else}
	<button
		type="button"
		data-testid="event-schedule-add"
		class="flex min-h-11 items-center gap-1 self-start text-xs text-ink-2 underline hover:text-ink"
		onclick={beginScheduleAdd}
	>
		{m.event_schedule_add_label()}
	</button>
{/if}
