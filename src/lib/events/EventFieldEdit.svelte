<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { getToken } from '$lib/auth/storage';
	import { listEventLocations, type EventDetail } from '$lib/events/eventDetail';
	import {
		tallinnLocalToUtcIso,
		timeFormatStore,
		toTallinnLocalInputValue
	} from '$lib/preferences/timeFormat';
	import { parseStartAt, timeRange } from '$lib/events/eventTime';
	import { eventTypeLabel, CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import type { EditableEventField } from '$lib/events/eventFieldEdit';
	import type { Collective } from '$lib/collectives/types';
	import type { EventActions, EventEditState } from '$lib/events/eventPageState';

	let {
		detail,
		selected,
		edit,
		isEditor,
		isOffline,
		generation,
		actions,
		patchDetail
	}: {
		detail: EventDetail;
		selected: Collective | null;
		edit: EventEditState;
		isEditor: boolean;
		isOffline: boolean;
		generation: () => number;
		actions: EventActions;
		patchDetail: (field: EditableEventField, value: string | number) => void;
	} = $props();

	const dateFmt = $derived(
		new Intl.DateTimeFormat(getLocale(), {
			timeZone: 'Europe/Tallinn',
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);

	const startAt = $derived(parseStartAt(detail.startDatetime));

	const LOCATION_SUGGESTIONS_ID = 'event-edit-location-suggestions';
	function ensureLocationCorpusLoaded(): void {
		if (edit.locationCorpusRequested) return;
		edit.locationCorpusRequested = true;
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		listEventLocations(cfg)
			.then((result) => {
				edit.locationSuggestions = result.items;
				if (result.truncated) {
					console.warn('event detail: location-suggestion corpus is truncated');
				}
			})
			.catch((e) => {
				console.error('event detail: loading location suggestions failed', e);
			});
	}
	$effect(() => {
		if (!isOffline) edit.heldOffline = false;
	});

	function settleFieldFocus(field: EditableEventField): void {
		const owed = edit.pendingFocusRestore[field] === true;
		delete edit.pendingFocusRestore[field];
		if (owed && edit.editingField === null) restorePencilFocus(field);
	}

	function focusOnMount(node: HTMLElement): void {
		node.focus();
	}

	let editStatus = $state('');
	const editWriteGenerations = new Map<string, number>();

	const editWriteQueue = untrack(() =>
		actions.createRepertoireWriteQueue({
			setPending(key, pending) {
				edit.writePending = { ...edit.writePending, [key as EditableEventField]: pending };
				if (pending) {
					editWriteGenerations.set(key, generation());
					editStatus = '';
				}
			},
			reconcile(key) {
				const startedUnder = editWriteGenerations.get(key);
				editWriteGenerations.delete(key);
				edit.errors = { ...edit.errors, [key as EditableEventField]: false };
				settleFieldFocus(key as EditableEventField);
				if (startedUnder === generation()) editStatus = m.event_edit_saved();
			},
			revert(key) {
				editWriteGenerations.delete(key);
				edit.errors = { ...edit.errors, [key as EditableEventField]: true };
				settleFieldFocus(key as EditableEventField);
			}
		})
	);

	function fieldValue(d: EventDetail, field: EditableEventField): string | number {
		switch (field) {
			case 'event_name':
				return d.name;
			case 'start_datetime':
				return d.startDatetime;
			case 'duration_minutes':
				return d.durationMinutes;
			case 'location':
				return d.location;
			case 'description':
				return d.description;
			case 'event_type':
				return d.eventType;
		}
	}

	function beginFieldEdit(field: EditableEventField): void {
		if (!detail || edit.writePending[field] || isOffline) return;
		edit.errors = { ...edit.errors, [field]: false };
		edit.rangeErrors = { ...edit.rangeErrors, [field]: false };
		edit.heldOffline = false;
		if (field === 'start_datetime') {
			const seeded = toTallinnLocalInputValue(detail.startDatetime);
			const [datePart, timePart] = seeded.split('T');
			edit.draftDate = datePart ?? '';
			edit.draftTime = timePart ?? '';
			edit.draft = seeded;
		} else if (field === 'duration_minutes') {
			const startMs = new Date(detail.startDatetime).getTime();
			const seeded = Number.isNaN(startMs)
				? ''
				: toTallinnLocalInputValue(
						new Date(startMs + detail.durationMinutes * 60_000).toISOString()
					);
			const [datePart, timePart] = seeded.split('T');
			edit.draftDate = datePart ?? '';
			edit.draftTime = timePart ?? '';
			edit.draft = seeded;
		} else {
			edit.draft = String(fieldValue(detail, field));
		}
		edit.editingField = field;
	}

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

	function restorePencilFocus(field: EditableEventField): void {
		tick().then(() => edit.pencilRefs[field]?.focus());
	}

	function cancelFieldEdit(field: EditableEventField, restoreFocus: boolean): void {
		edit.editingField = null;
		edit.draft = '';
		edit.draftDate = '';
		edit.draftTime = '';
		edit.heldOffline = false;
		if (restoreFocus) restorePencilFocus(field);
	}

	function draftWireValue(field: EditableEventField): string | number | null {
		if (field === 'start_datetime') {
			const iso = tallinnLocalToUtcIso(edit.draft);
			return iso === '' ? null : iso;
		}
		if (edit.draft.trim() === '') return null;
		return edit.draft;
	}

	function draftDurationEndMinutesRaw(): number | null {
		if (!detail || edit.draft.trim() === '') return null;
		const endIso = tallinnLocalToUtcIso(edit.draft);
		if (endIso === '') return null;
		const startMs = new Date(detail.startDatetime).getTime();
		if (Number.isNaN(startMs)) return null;
		const endMs = new Date(endIso).getTime();
		return Math.round((endMs - startMs) / 60_000);
	}

	function isUnchanged(field: EditableEventField, value: string | number, before: string | number): boolean {
		if (field === 'start_datetime') {
			const a = new Date(String(value)).getTime();
			const b = new Date(String(before)).getTime();
			return !Number.isNaN(a) && !Number.isNaN(b) && a === b;
		}
		return value === before;
	}

	function confirmFieldEdit(field: EditableEventField, restoreFocus: boolean): void {
		if (!selected || !detail || edit.editingField !== field) return;
		if (isOffline) {
			edit.errors = { ...edit.errors, [field]: false };
			edit.heldOffline = true;
			return;
		}
		const before = fieldValue(detail, field);
		if (field === 'duration_minutes') {
			const raw = draftDurationEndMinutesRaw();
			if (raw === null || raw === before) {
				cancelFieldEdit(field, restoreFocus);
				return;
			}
			if (raw <= 0) {
				cancelFieldEdit(field, restoreFocus);
				editStatus = '';
				edit.rangeErrors = { ...edit.rangeErrors, duration_minutes: true };
				return;
			}
			edit.editingField = null;
			edit.pendingFocusRestore[field] = restoreFocus;
			const cfg = { db: selected.db, token: getToken() ?? '' };
			const evId = detail.id;
			editWriteQueue.request(
				field,
				() =>
					actions.updateEventField(cfg, evId, field, raw, fetch).catch((e) => {
						console.error('event detail: field edit failed', field, e);
						throw e;
					}),
				{
					apply: () => patchDetail(field, raw),
					rollback: () => patchDetail(field, before)
				}
			);
			return;
		}
		const value = draftWireValue(field);
		if (value === null || isUnchanged(field, value, before)) {
			cancelFieldEdit(field, restoreFocus);
			return;
		}
		edit.editingField = null;
		edit.pendingFocusRestore[field] = restoreFocus;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		editWriteQueue.request(
			field,
			() =>
				actions.updateEventField(cfg, evId, field, value, fetch).catch((e) => {
					console.error('event detail: field edit failed', field, e);
					throw e;
				}),
			{
				apply: () => patchDetail(field, value),
				rollback: () => patchDetail(field, before)
			}
		);
	}

	function handleFieldKeydown(e: KeyboardEvent, field: EditableEventField, multiline: boolean): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelFieldEdit(field, true);
		} else if (e.key === 'Enter' && !multiline) {
			e.preventDefault();
			confirmFieldEdit(field, true);
		}
	}
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
		<button
			type="button"
			data-testid="event-edit-btn-event_type"
			class="group flex min-h-11 w-fit appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left disabled:opacity-40"
			disabled={edit.writePending.event_type === true || isOffline}
			bind:this={edit.pencilRefs.event_type}
			onclick={() => beginFieldEdit('event_type')}
		>
			<span class="sr-only">{m.event_edit_event_type_aria_label()}</span>
			<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
			{#if detail.eventType}
				<span
					data-testid="event-detail-type"
					class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(detail.eventType)}"
				>
					{eventTypeLabel(detail.eventType)}
				</span>
			{/if}
		</button>
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
	<p data-testid="event-edit-error-event_type" role="alert" class="text-xs text-red-700">
		{m.event_edit_save_error()}
	</p>
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
		<button
			type="button"
			data-testid="event-edit-btn-name"
			class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-2xl disabled:opacity-40"
			disabled={edit.writePending.event_name === true || isOffline}
			bind:this={edit.pencilRefs.event_name}
			onclick={() => beginFieldEdit('event_name')}
		>
			<span class="sr-only">{m.event_edit_name_aria_label()}</span>
			<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
			<span id="event-detail-name-value">{detail.name}</span>
		</button>
	</h1>
{:else}
	<h1 data-testid="event-detail-name" class="font-display text-2xl">{detail.name}</h1>
{/if}
{#if edit.errors.event_name}
	<p data-testid="event-edit-error-name" role="alert" class="text-xs text-red-700">
		{m.event_edit_save_error()}
	</p>
{/if}

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
		<button
			type="button"
			data-testid="event-edit-btn-start_datetime"
			class="group flex min-h-11 w-full appearance-none flex-wrap items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
			disabled={edit.writePending.start_datetime === true || isOffline}
			bind:this={edit.pencilRefs.start_datetime}
			onclick={() => beginFieldEdit('start_datetime')}
		>
			<span class="sr-only">{m.event_edit_start_datetime_aria_label()}</span>
			<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
			<span data-testid="event-detail-time" class="flex flex-wrap items-center gap-2">
				<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
					startAt,
					detail.durationMinutes,
					$timeFormatStore
				)}
			</span>
		</button>
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
	<button
		type="button"
		data-testid="event-edit-btn-start_datetime"
		class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-ink-3 disabled:opacity-40"
		disabled={edit.writePending.start_datetime === true || isOffline}
		bind:this={edit.pencilRefs.start_datetime}
		onclick={() => beginFieldEdit('start_datetime')}
	>
		<span class="sr-only">{m.event_edit_start_datetime_aria_label()}</span>
		<span aria-hidden="true" class="group-hover:text-ink">✎</span>
	</button>
{/if}
{#if edit.errors.start_datetime}
	<p data-testid="event-edit-error-start_datetime" role="alert" class="text-xs text-red-700">
		{m.event_edit_save_error()}
	</p>
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
		<button
			type="button"
			data-testid="event-edit-btn-duration_minutes"
			class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
			disabled={edit.writePending.duration_minutes === true || isOffline}
			bind:this={edit.pencilRefs.duration_minutes}
			onclick={() => beginFieldEdit('duration_minutes')}
		>
			<span class="sr-only">{m.event_edit_duration_minutes_aria_label()}</span>
			<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
			{#if detail.durationMinutes > 0}
				<span data-testid="event-detail-duration">
					{m.agenda_duration_min({ minutes: detail.durationMinutes })}
				</span>
			{/if}
		</button>
	{:else}
		<p class="flex items-center gap-2 text-base text-ink-2">
			<span data-testid="event-detail-duration">
				{m.agenda_duration_min({ minutes: detail.durationMinutes })}
			</span>
		</p>
	{/if}
{/if}
{#if edit.rangeErrors.duration_minutes}
	<p data-testid="event-edit-error-duration_minutes" role="alert" class="text-xs text-red-700">
		{m.event_end_before_start()}
	</p>
{:else if edit.errors.duration_minutes}
	<p data-testid="event-edit-error-duration_minutes" role="alert" class="text-xs text-red-700">
		{m.event_edit_save_error()}
	</p>
{/if}

{#if edit.editingField === 'location'}
	<input
		type="text"
		data-testid="event-edit-input-location"
		aria-label={m.event_edit_location_aria_label()}
		class="border-b border-ink bg-transparent text-ink-2"
		list={LOCATION_SUGGESTIONS_ID}
		value={edit.draft}
		use:focusOnMount
		oninput={(e) => (edit.draft = (e.currentTarget as HTMLInputElement).value)}
		onfocus={ensureLocationCorpusLoaded}
		onblur={() => confirmFieldEdit('location', false)}
		onkeydown={(e) => handleFieldKeydown(e, 'location', false)}
	/>
	<datalist id={LOCATION_SUGGESTIONS_ID}>
		{#each edit.locationSuggestions as loc (loc)}
			<option value={loc}></option>
		{/each}
	</datalist>
{:else if detail.location || isEditor}
	{#if isEditor}
		<button
			type="button"
			data-testid="event-edit-btn-location"
			class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
			disabled={edit.writePending.location === true || isOffline}
			bind:this={edit.pencilRefs.location}
			onclick={() => beginFieldEdit('location')}
		>
			<span class="sr-only">{m.event_edit_location_aria_label()}</span>
			<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
			{#if detail.location}
				<span data-testid="event-detail-location">{detail.location}</span>
			{/if}
		</button>
	{:else}
		<p class="flex items-center gap-2 text-base text-ink-2">
			<span data-testid="event-detail-location">{detail.location}</span>
		</p>
	{/if}
{/if}
{#if edit.errors.location}
	<p data-testid="event-edit-error-location" role="alert" class="text-xs text-red-700">
		{m.event_edit_save_error()}
	</p>
{/if}

{#if detail.conductorNames.length > 0}
	<p data-testid="event-detail-conductors" class="text-base text-ink-2">
		{m.event_detail_conductor_label()}:
		{#each detail.conductorNames as conductorName, conductorIndex (conductorName + conductorIndex)}{#if conductorIndex > 0}{', '}{/if}<PersonName
				name={conductorName}
			/>{/each}
	</p>
{/if}

{#if edit.editingField === 'description'}
	<textarea
		data-testid="event-edit-input-description"
		aria-label={m.event_edit_description_aria_label()}
		class="mt-2 min-h-24 w-full border border-ink-4 bg-transparent p-2 text-ink"
		value={edit.draft}
		use:focusOnMount
		oninput={(e) => (edit.draft = (e.currentTarget as HTMLTextAreaElement).value)}
		onblur={() => confirmFieldEdit('description', false)}
		onkeydown={(e) => handleFieldKeydown(e, 'description', true)}
	></textarea>
{:else if detail.description || isEditor}
	{#if isEditor}
		<button
			type="button"
			data-testid="event-edit-btn-description"
			class="group mt-2 flex min-h-11 w-full appearance-none items-start gap-2 border-0 bg-transparent p-0 text-left text-base text-ink disabled:opacity-40"
			disabled={edit.writePending.description === true || isOffline}
			bind:this={edit.pencilRefs.description}
			onclick={() => beginFieldEdit('description')}
		>
			<span class="sr-only">{m.event_edit_description_aria_label()}</span>
			<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
			{#if detail.description}
				<span data-testid="event-detail-description">{detail.description}</span>
			{/if}
		</button>
	{:else}
		<p class="mt-2 flex items-start gap-2 text-base text-ink">
			<span data-testid="event-detail-description">{detail.description}</span>
		</p>
	{/if}
{/if}
{#if edit.errors.description}
	<p data-testid="event-edit-error-description" role="alert" class="text-xs text-red-700">
		{m.event_edit_save_error()}
	</p>
{/if}

{#if isEditor && isOffline}
	<p data-testid="event-edit-write-unavailable" role="status" class="text-xs text-ink-2">
		{m.write_unavailable_no_signal()}
	</p>
{/if}
{#if edit.heldOffline}
	<p data-testid="event-edit-held-offline" role="alert" class="text-xs text-ink-2">
		{m.write_held_no_signal()}
	</p>
{/if}

<div data-testid="event-edit-status" role="status" aria-live="polite" class="sr-only">
	{editStatus}
</div>
