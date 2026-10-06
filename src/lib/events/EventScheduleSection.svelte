<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { tallinnLocalToUtcIso, toTallinnLocalInputValue } from '$lib/preferences/timeFormat';
	import { compareScheduleItems } from '$lib/schedule/scheduleSort';
	import type { ScheduleItem } from '$lib/schedule/scheduleData';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions, EventPageState } from '$lib/events/eventPageState';
	import EventScheduleRow from '$lib/events/EventScheduleRow.svelte';
	import EventScheduleAddForm from '$lib/events/EventScheduleAddForm.svelte';

	let {
		detail,
		selected,
		ev,
		isEditor,
		isOffline,
		generation,
		actions
	}: {
		detail: EventDetail;
		selected: Collective | null;
		ev: EventPageState;
		isEditor: boolean;
		isOffline: boolean;
		generation: () => number;
		actions: EventActions;
	} = $props();

	let mounted = true;
	$effect(() => () => {
		mounted = false;
	});

	function manageCfg(): { db: string; token: string } | null {
		return selected ? cfgFor(selected.db) : null;
	}

	let scheduleAddOpen = $state(false);
	let scheduleAddName = $state('');
	let scheduleAddDate = $state('');
	let scheduleAddTime = $state('');
	let scheduleEditingId = $state<string | null>(null);
	let scheduleEditName = $state('');
	let scheduleEditDate = $state('');
	let scheduleEditTime = $state('');
	let scheduleRemoveArmedId = $state<string | null>(null);
	let scheduleWritePending = $state<Record<string, boolean>>({});
	let scheduleErrors = $state<Record<string, (() => string) | null>>({});
	let scheduleStatus = $state('');
	let scheduleAddErrorField = $state<'name' | 'datetime' | null>(null);

	const SCHEDULE_ADD_KEY = 'schedule-add';

	function patchScheduleRow(id: string, patch: Partial<ScheduleItem>): void {
		ev.scheduleRows = ev.scheduleRows
			.map((row) => (row.id === id ? { ...row, ...patch } : row))
			.sort(compareScheduleItems);
	}
	function dropScheduleRow(id: string): void {
		ev.scheduleRows = ev.scheduleRows.filter((row) => row.id !== id);
	}
	function restoreScheduleRow(row: ScheduleItem): void {
		if (ev.scheduleRows.some((r) => r.id === row.id)) return;
		ev.scheduleRows = [...ev.scheduleRows, row].sort(compareScheduleItems);
	}

	const scheduleWriteGenerations = new Map<string, number>();

	const scheduleQueue = untrack(() =>
		actions.createRepertoireWriteQueue({
			setPending(key, pending) {
				scheduleWritePending = { ...scheduleWritePending, [key]: pending };
				if (pending) {
					scheduleWriteGenerations.set(key, generation());
					scheduleStatus = '';
				}
			},
			reconcile(key) {
				const startedUnder = scheduleWriteGenerations.get(key);
				scheduleWriteGenerations.delete(key);
				clearScheduleError(key);
				if (key === SCHEDULE_ADD_KEY) {
					refreshSchedule();
					scheduleAddOpen = false;
					scheduleAddName = '';
					scheduleAddDate = '';
					scheduleAddTime = '';
				}
				if (startedUnder === generation()) scheduleStatus = m.event_schedule_saved();
			},
			revert(key) {
				scheduleWriteGenerations.delete(key);
				console.error('event detail: schedule write failed', key);
				if (key === SCHEDULE_ADD_KEY) scheduleAddErrorField = null;
				setScheduleError(key, m.event_schedule_save_error);
			}
		})
	);

	function setScheduleError(key: string, msg: () => string): void {
		scheduleErrors = { ...scheduleErrors, [key]: msg };
	}
	function clearScheduleError(...keys: string[]): void {
		const next = { ...scheduleErrors };
		for (const key of keys) next[key] = null;
		scheduleErrors = next;
	}
	function scheduleRowErrorKeys(id: string): string[] {
		return [`schedule-edit-name-${id}`, `schedule-edit-datetime-${id}`, `schedule-remove-${id}`];
	}
	function scheduleRowError(id: string): (() => string) | null {
		for (const key of scheduleRowErrorKeys(id)) {
			const msg = scheduleErrors[key];
			if (msg) return msg;
		}
		return null;
	}

	function refreshSchedule(): void {
		const cfg = manageCfg();
		if (!mounted || !cfg || !detail) return;
		const evId = detail.id;
		const g = generation();
		actions.listScheduleItems(cfg, evId, fetch)
			.then((rows) => {
				if (g !== generation()) return;
				ev.scheduleRows = rows;
			})
			.catch((e) => {
				if (g !== generation()) return;
				reportProblem({ area: 'event', action: 're-reading the schedule', error: e });
			});
	}

	function beginScheduleAdd(): void {
		scheduleAddOpen = true;
		clearScheduleAddError();
		scheduleAddName = '';
		const seeded = toTallinnLocalInputValue(detail?.startDatetime ?? '');
		scheduleAddDate = seeded.split('T')[0] ?? '';
		scheduleAddTime = '';
	}

	function cancelScheduleAdd(): void {
		scheduleAddOpen = false;
		clearScheduleAddError();
		scheduleAddName = '';
		scheduleAddDate = '';
		scheduleAddTime = '';
	}

	function clearScheduleAddError(): void {
		scheduleAddErrorField = null;
		clearScheduleError(SCHEDULE_ADD_KEY);
	}
	function setScheduleAddError(msg: () => string, field: 'name' | 'datetime'): void {
		scheduleAddErrorField = field;
		scheduleStatus = '';
		setScheduleError(SCHEDULE_ADD_KEY, msg);
	}

	function submitScheduleAdd(): void {
		if (isOffline) return;
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		clearScheduleAddError();
		const name = scheduleAddName.trim();
		if (name === '') {
			setScheduleAddError(m.event_schedule_name_required, 'name');
			return;
		}
		if (!scheduleAddDate || !scheduleAddTime) {
			setScheduleAddError(m.event_schedule_datetime_required, 'datetime');
			return;
		}
		const iso = tallinnLocalToUtcIso(`${scheduleAddDate}T${scheduleAddTime}`);
		if (iso === '') {
			setScheduleAddError(m.event_schedule_datetime_required, 'datetime');
			return;
		}
		const eventIdForSchedule = detail.id;
		scheduleQueue.request(SCHEDULE_ADD_KEY, async () => {
			await actions.createScheduleItem(cfg, { eventId: eventIdForSchedule, name, datetime: iso });
		});
	}

	function beginScheduleEdit(row: ScheduleItem): void {
		if (isOffline) return;
		scheduleRemoveArmedId = null;
		clearScheduleError(...scheduleRowErrorKeys(row.id));
		scheduleEditingId = row.id;
		scheduleEditName = row.name;
		const seeded = toTallinnLocalInputValue(row.datetime);
		const [datePart, timePart] = seeded.split('T');
		scheduleEditDate = datePart ?? '';
		scheduleEditTime = timePart ?? '';
	}

	function cancelScheduleEdit(): void {
		scheduleEditingId = null;
		scheduleEditName = '';
		scheduleEditDate = '';
		scheduleEditTime = '';
	}

	function staysInsideScheduleRowEditor(origin: HTMLElement, next: Node | null): boolean {
		if (!next) return false;
		const wrapper = origin.closest('[data-schedule-edit-row]');
		return wrapper !== null && wrapper.contains(next);
	}

	function commitScheduleName(id: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = ev.scheduleRows.find((r) => r.id === id);
		if (!cfg || !row || scheduleEditingId !== id) return;
		const value = scheduleEditName.trim();
		if (value === '') {
			scheduleStatus = '';
			setScheduleError(`schedule-edit-name-${id}`, m.event_schedule_name_required);
			return;
		}
		clearScheduleError(`schedule-edit-name-${id}`);
		if (value === row.name) return;
		const before = row.name;
		scheduleQueue.request(`schedule-edit-name-${id}`, () => actions.updateScheduleItemField(cfg, id, 'name', value), {
			apply: () => patchScheduleRow(id, { name: value }),
			rollback: () => patchScheduleRow(id, { name: before })
		});
	}

	function commitScheduleDatetime(id: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = ev.scheduleRows.find((r) => r.id === id);
		if (!cfg || !row || scheduleEditingId !== id) return;
		if (!scheduleEditDate || !scheduleEditTime) return;
		const iso = tallinnLocalToUtcIso(`${scheduleEditDate}T${scheduleEditTime}`);
		if (iso === '' || new Date(iso).getTime() === new Date(row.datetime).getTime()) return;
		const before = row.datetime;
		scheduleQueue.request(
			`schedule-edit-datetime-${id}`,
			() => actions.updateScheduleItemField(cfg, id, 'datetime', iso),
			{
				apply: () => patchScheduleRow(id, { datetime: iso }),
				rollback: () => patchScheduleRow(id, { datetime: before })
			}
		);
	}

	function handleScheduleEditDatetimeFocusOut(e: FocusEvent, id: string): void {
		const group = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && group.contains(next)) return;
		commitScheduleDatetime(id);
		if (staysInsideScheduleRowEditor(group, next)) return;
		scheduleEditingId = null;
	}

	function handleScheduleNameBlur(e: FocusEvent, id: string): void {
		const input = e.currentTarget as HTMLElement;
		commitScheduleName(id);
		if (staysInsideScheduleRowEditor(input, e.relatedTarget as Node | null)) return;
		if (scheduleEditName.trim() === '') return;
		scheduleEditingId = null;
	}

	function handleScheduleNameKeydown(e: KeyboardEvent, id: string): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelScheduleEdit();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			commitScheduleName(id);
			if (scheduleEditName.trim() !== '') scheduleEditingId = null;
		}
	}

	function armScheduleRemove(id: string): void {
		if (isOffline) return;
		scheduleEditingId = null;
		clearScheduleError(...scheduleRowErrorKeys(id));
		scheduleRemoveArmedId = id;
	}
	function cancelScheduleRemove(): void {
		scheduleRemoveArmedId = null;
	}
	function confirmScheduleRemove(id: string): void {
		if (isOffline) return;
		const cfg = manageCfg();
		const row = ev.scheduleRows.find((r) => r.id === id);
		if (!cfg || !row) return;
		scheduleRemoveArmedId = null;
		scheduleQueue.request(`schedule-remove-${id}`, () => actions.removeScheduleItem(cfg, id), {
			apply: () => dropScheduleRow(id),
			rollback: () => restoreScheduleRow(row)
		});
	}

	const showScheduleSection = $derived(ev.scheduleLoaded && (ev.scheduleRows.length > 0 || isEditor));
</script>

{#if showScheduleSection}
	<section
		data-testid="event-detail-schedule"
		class="mt-4 flex flex-col gap-2"
		aria-labelledby="event-detail-schedule-heading"
	>
		<h2 id="event-detail-schedule-heading" class="font-display text-lg text-ink-2">
			{m.event_schedule_heading()}
		</h2>
		{#if isEditor && isOffline}
			<p
				data-testid="event-schedule-write-unavailable"
				role="status"
				class="text-xs text-ink-2"
			>
				{m.write_unavailable_no_signal()}
			</p>
		{/if}
		{#if ev.scheduleRows.length > 0}
			<ul class="flex flex-col gap-1">
				{#each ev.scheduleRows as row (row.id)}
					<EventScheduleRow
						{row}
						{isEditor}
						{isOffline}
						editingId={scheduleEditingId}
						removeArmedId={scheduleRemoveArmedId}
						writePending={scheduleWritePending}
						rowError={scheduleRowError(row.id)}
						bind:editName={scheduleEditName}
						bind:editDate={scheduleEditDate}
						bind:editTime={scheduleEditTime}
						{clearScheduleError}
						{handleScheduleNameBlur}
						{handleScheduleNameKeydown}
						{handleScheduleEditDatetimeFocusOut}
						{beginScheduleEdit}
						{armScheduleRemove}
						{cancelScheduleRemove}
						{confirmScheduleRemove}
					/>
				{/each}
			</ul>
		{/if}

		{#if isEditor}
			<EventScheduleAddForm
				{isOffline}
				addOpen={scheduleAddOpen}
				addError={scheduleErrors[SCHEDULE_ADD_KEY] ?? null}
				addErrorField={scheduleAddErrorField}
				addPending={scheduleWritePending[SCHEDULE_ADD_KEY] === true}
				bind:addName={scheduleAddName}
				bind:addDate={scheduleAddDate}
				bind:addTime={scheduleAddTime}
				{clearScheduleAddError}
				{beginScheduleAdd}
				{submitScheduleAdd}
				{cancelScheduleAdd}
			/>
		{/if}
		<div
			data-testid="event-schedule-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{scheduleStatus}
		</div>
	</section>
{/if}
