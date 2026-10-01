<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { timeFormatStore, longDayFormatter } from '$lib/preferences/timeFormat';
	import { parseStartAt, timeRange } from '$lib/events/eventTime';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
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

	const dateFmt = $derived(longDayFormatter());

	const startAt = $derived(parseStartAt(detail.startDatetime));

	function updateCompositeDraft(datePart: string, timePart: string): void {
		edit.draftDate = datePart;
		edit.draftTime = timePart;
		edit.draft = datePart && timePart ? `${datePart}T${timePart}` : '';
	}

	function handleStartDatetimeFocusOut(e: FocusEvent): void {
		const wrapper = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && wrapper.contains(next)) return;
		confirmFieldEdit('start_datetime', false);
	}

	function handleDurationEndFocusOut(e: FocusEvent): void {
		const wrapper = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && wrapper.contains(next)) return;
		confirmFieldEdit('duration_minutes', false);
	}
</script>

{#if edit.editingField === 'start_datetime'}
	<div
		data-testid="event-edit-input-start_datetime"
		role="group"
		aria-label={m.event_edit_start_datetime_aria_label()}
		class="flex flex-wrap items-center gap-2 text-ink-2"
		onfocusout={handleStartDatetimeFocusOut}
	>
		<input
			type="date"
			data-testid="event-edit-input-start_datetime-date"
			aria-label={m.time_select_date_label()}
			class="min-w-0 border-b border-ink bg-transparent text-ink-2"
			value={edit.draftDate}
			use:focusOnMount
			oninput={(e) =>
				updateCompositeDraft((e.currentTarget as HTMLInputElement).value, edit.draftTime)}
			onkeydown={(e) => handleFieldKeydown(e, 'start_datetime', false)}
		/>
		<TimeSelect
			prefix="event-edit-input-start_datetime"
			value={edit.draftTime}
			onkeydown={(e) => handleFieldKeydown(e, 'start_datetime', false)}
			onchange={(v) => updateCompositeDraft(edit.draftDate, v)}
		/>
	</div>
{:else if startAt}
	{#if isEditor}
		<EditActivator
			label={m.event_edit_start_datetime_aria_label()}
			data-testid="event-edit-btn-start_datetime"
			class="w-full flex-wrap items-center gap-2 text-base text-ink-2"
			disabled={edit.writePending.start_datetime === true || isOffline}
			bind:element={edit.pencilRefs.start_datetime}
			onclick={() => beginFieldEdit('start_datetime')}
		>
			<span data-testid="event-detail-time" class="flex flex-wrap items-center gap-2">
				<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
					startAt,
					detail.durationMinutes,
					$timeFormatStore
				)}
			</span>
		</EditActivator>
	{:else}
		<p data-testid="event-detail-time" class="flex flex-wrap items-center gap-2 text-base text-ink-2">
			<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
				startAt,
				detail.durationMinutes,
				$timeFormatStore
			)}
		</p>
	{/if}
{:else if isEditor}
	<EditActivator
		label={m.event_edit_start_datetime_aria_label()}
		data-testid="event-edit-btn-start_datetime"
		class="w-full items-center gap-2 text-xs text-ink-3"
		disabled={edit.writePending.start_datetime === true || isOffline}
		bind:element={edit.pencilRefs.start_datetime}
		onclick={() => beginFieldEdit('start_datetime')}
	/>
{/if}
{#if edit.errors.start_datetime}
	<FormError data-testid="event-edit-error-start_datetime">
		{m.event_edit_save_error()}
	</FormError>
{/if}

{#if edit.editingField === 'duration_minutes'}
	<div
		data-testid="event-edit-input-duration_minutes"
		role="group"
		aria-label={m.event_edit_duration_minutes_aria_label()}
		class="flex flex-wrap items-center gap-2 text-ink-2"
		onfocusout={handleDurationEndFocusOut}
	>
		<input
			type="date"
			data-testid="event-edit-input-duration_minutes-date"
			aria-label={m.time_select_date_label()}
			class="min-w-0 border-b border-ink bg-transparent text-ink-2"
			value={edit.draftDate}
			use:focusOnMount
			oninput={(e) =>
				updateCompositeDraft((e.currentTarget as HTMLInputElement).value, edit.draftTime)}
			onkeydown={(e) => handleFieldKeydown(e, 'duration_minutes', false)}
		/>
		<TimeSelect
			prefix="event-edit-input-duration_minutes"
			value={edit.draftTime}
			onkeydown={(e) => handleFieldKeydown(e, 'duration_minutes', false)}
			onchange={(v) => updateCompositeDraft(edit.draftDate, v)}
		/>
	</div>
{:else if detail.durationMinutes > 0 || isEditor}
	{#if isEditor}
		<EditActivator
			label={m.event_edit_duration_minutes_aria_label()}
			data-testid="event-edit-btn-duration_minutes"
			class="w-full items-center gap-2 text-base text-ink-2"
			disabled={edit.writePending.duration_minutes === true || isOffline}
			bind:element={edit.pencilRefs.duration_minutes}
			onclick={() => beginFieldEdit('duration_minutes')}
		>
			{#if detail.durationMinutes > 0}
				<span data-testid="event-detail-duration">
					{m.agenda_duration_min({ minutes: detail.durationMinutes })}
				</span>
			{/if}
		</EditActivator>
	{:else}
		<p class="flex items-center gap-2 text-base text-ink-2">
			<span data-testid="event-detail-duration">
				{m.agenda_duration_min({ minutes: detail.durationMinutes })}
			</span>
		</p>
	{/if}
{/if}
{#if edit.rangeErrors.duration_minutes}
	<FormError data-testid="event-edit-error-duration_minutes">
		{m.event_end_before_start()}
	</FormError>
{:else if edit.errors.duration_minutes}
	<FormError data-testid="event-edit-error-duration_minutes">
		{m.event_edit_save_error()}
	</FormError>
{/if}
