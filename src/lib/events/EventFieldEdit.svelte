<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import type { EventDetail } from '$lib/events/eventDetail';
	import { tallinnLocalToUtcIso, toTallinnLocalInputValue } from '$lib/preferences/timeFormat';
	import type { EditableEventField } from '$lib/events/eventFieldEdit';
	import type { Collective } from '$lib/collectives/types';
	import type { EventActions, EventEditState } from '$lib/events/eventPageState';
	import { focusAfterRender } from '$lib/a11y/focusable';
	import EventFieldEditTitle from '$lib/events/EventFieldEditTitle.svelte';
	import EventFieldEditTime from '$lib/events/EventFieldEditTime.svelte';
	import EventFieldEditNotes from '$lib/events/EventFieldEditNotes.svelte';

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

	$effect(() => {
		if (!isOffline) edit.heldOffline = false;
	});

	function settleFieldFocus(field: EditableEventField): void {
		const owed = edit.pendingFocusRestore[field] === true;
		delete edit.pendingFocusRestore[field];
		if (owed && edit.editingField === null) restorePencilFocus(field);
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

	function restorePencilFocus(field: EditableEventField): void {
		void focusAfterRender(() => edit.pencilRefs[field]);
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
			const cfg = cfgFor(selected.db);
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
		const cfg = cfgFor(selected.db);
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

<EventFieldEditTitle
	{detail}
	{edit}
	{isEditor}
	{isOffline}
	{beginFieldEdit}
	{confirmFieldEdit}
	{handleFieldKeydown}
/>

<EventFieldEditTime
	{detail}
	{edit}
	{isEditor}
	{isOffline}
	{beginFieldEdit}
	{confirmFieldEdit}
	{handleFieldKeydown}
/>

<EventFieldEditNotes
	{detail}
	{selected}
	{edit}
	{isEditor}
	{isOffline}
	{beginFieldEdit}
	{confirmFieldEdit}
	{handleFieldKeydown}
/>

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
