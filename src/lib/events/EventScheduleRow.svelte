<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { timeFormatStore } from '$lib/preferences/timeFormat';
	import { scheduleRowTime } from '$lib/events/eventTime';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import type { ScheduleItem } from '$lib/schedule/scheduleData';
	import { focusOnMount } from '$lib/a11y/focusable';
	import EditActivator from '$lib/components/EditActivator.svelte';

	let {
		row,
		isEditor,
		isOffline,
		editingId,
		removeArmedId,
		writePending,
		rowError,
		editName = $bindable(),
		editDate = $bindable(),
		editTime = $bindable(),
		clearScheduleError,
		handleScheduleNameBlur,
		handleScheduleNameKeydown,
		handleScheduleEditDatetimeFocusOut,
		beginScheduleEdit,
		armScheduleRemove,
		cancelScheduleRemove,
		confirmScheduleRemove
	}: {
		row: ScheduleItem;
		isEditor: boolean;
		isOffline: boolean;
		editingId: string | null;
		removeArmedId: string | null;
		writePending: Record<string, boolean>;
		rowError: (() => string) | null;
		editName: string;
		editDate: string;
		editTime: string;
		clearScheduleError: (...keys: string[]) => void;
		handleScheduleNameBlur: (e: FocusEvent, id: string) => void;
		handleScheduleNameKeydown: (e: KeyboardEvent, id: string) => void;
		handleScheduleEditDatetimeFocusOut: (e: FocusEvent, id: string) => void;
		beginScheduleEdit: (row: ScheduleItem) => void;
		armScheduleRemove: (id: string) => void;
		cancelScheduleRemove: () => void;
		confirmScheduleRemove: (id: string) => void;
	} = $props();
</script>

<li class="flex flex-col gap-0.5">
	<div class="flex items-center gap-2 text-sm text-ink">
		{#if isEditor && editingId === row.id}
			<div
				data-schedule-edit-row={row.id}
				class="flex flex-1 flex-wrap items-end gap-2"
			>
				<div class="flex flex-col gap-0.5">
					<label
						for={`event-schedule-edit-name-input-${row.id}`}
						class="text-xs text-ink-2"
					>
						{m.event_schedule_name_label()}
					</label>
					<input
						type="text"
						id={`event-schedule-edit-name-input-${row.id}`}
						data-testid={`event-schedule-edit-name-${row.id}`}
						class="border-b border-ink bg-transparent text-ink"
						value={editName}
						use:focusOnMount
						oninput={(e) => {
							editName = (
								e.currentTarget as HTMLInputElement
							).value;
							clearScheduleError(`schedule-edit-name-${row.id}`);
						}}
						onblur={(e) => handleScheduleNameBlur(e, row.id)}
						onkeydown={(e) => handleScheduleNameKeydown(e, row.id)}
					/>
				</div>
				<div class="flex flex-col gap-0.5">
					<span
						id={`event-schedule-edit-datetime-${row.id}-label`}
						class="text-xs text-ink-2">{m.event_schedule_datetime_label()}</span
					>
					<div
						data-testid={`event-schedule-edit-datetime-${row.id}`}
						role="group"
						aria-labelledby={`event-schedule-edit-datetime-${row.id}-label`}
						class="flex flex-wrap items-center gap-2 text-ink-2"
						onfocusout={(e) =>
							handleScheduleEditDatetimeFocusOut(e, row.id)}
					>
						<input
							type="date"
							data-testid={`event-schedule-edit-datetime-${row.id}-date`}
							aria-label={m.time_select_date_label()}
							class="min-w-0 border-b border-ink bg-transparent text-ink"
							value={editDate}
							oninput={(e) =>
								(editDate = (
									e.currentTarget as HTMLInputElement
								).value)}
						/>
						<TimeSelect
							prefix={`event-schedule-edit-datetime-${row.id}`}
							value={editTime}
							onchange={(v) => (editTime = v)}
						/>
					</div>
				</div>
			</div>
		{:else if isEditor}
			<EditActivator
				label={m.event_schedule_edit_aria_label()}
				data-testid={`event-schedule-edit-${row.id}`}
				disabled={writePending[`schedule-edit-name-${row.id}`] ===
					true ||
					writePending[`schedule-edit-datetime-${row.id}`] ===
						true ||
					isOffline}
				class="flex-1 items-center gap-2 text-sm text-ink"
				onclick={() => beginScheduleEdit(row)}
			>
				<span data-testid="event-schedule-row-name">{row.name}</span>
				<span data-testid="event-schedule-row-time" class="text-ink-2"
					>{scheduleRowTime(row.datetime, $timeFormatStore)}</span
				>
			</EditActivator>
		{:else}
			<span data-testid="event-schedule-row-name">{row.name}</span>
			<span data-testid="event-schedule-row-time" class="text-ink-2"
				>{scheduleRowTime(row.datetime, $timeFormatStore)}</span
			>
		{/if}

		{#if isEditor && editingId !== row.id}
			{#if removeArmedId === row.id}
				<div class="flex items-center gap-1">
					<DeleteConfirmPair
						confirmTestid={`event-schedule-remove-confirm-${row.id}`}
						cancelTestid={`event-schedule-remove-cancel-${row.id}`}
						confirmLabel={m.event_schedule_remove_confirm_aria_label({
							name: row.name
						})}
						cancelLabel={m.event_schedule_remove_cancel_aria_label({
							name: row.name
						})}
						confirmText={m.event_schedule_remove_confirm_short()}
						cancelText={m.event_schedule_remove_cancel_short()}
						pending={writePending[`schedule-remove-${row.id}`] === true}
						busy={writePending[`schedule-remove-${row.id}`] === true}
						{isOffline}
						onconfirm={() => confirmScheduleRemove(row.id)}
						oncancel={() => cancelScheduleRemove()}
					/>
				</div>
			{:else}
				<DeleteTrigger
					data-testid={`event-schedule-remove-${row.id}`}
					aria-label={m.event_schedule_remove_aria_label({ name: row.name })}
					iconClass="h-4 w-4"
					disabled={isOffline}
					onclick={() => armScheduleRemove(row.id)}
				/>
			{/if}
		{/if}
	</div>
	{#if rowError}
		<FormError data-testid={`event-schedule-error-${row.id}`}>
			{rowError()}
		</FormError>
	{/if}
</li>
