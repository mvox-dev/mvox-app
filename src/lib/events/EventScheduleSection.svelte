<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { cfgFor } from '$lib/entu/cfg';
	import { tallinnLocalToUtcIso, timeFormatStore, toTallinnLocalInputValue } from '$lib/preferences/timeFormat';
	import { compareScheduleItems } from '$lib/schedule/scheduleSort';
	import { scheduleRowTime } from '$lib/events/eventTime';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import DeleteConfirmPair from '$lib/components/DeleteConfirmPair.svelte';
	import type { ScheduleItem } from '$lib/schedule/scheduleData';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions, EventPageState } from '$lib/events/eventPageState';
	import { focusOnMount } from '$lib/a11y/focusable';
	import EditActivator from '$lib/components/EditActivator.svelte';

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
				console.error('event detail: schedule refresh failed', e);
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
					<li class="flex flex-col gap-0.5">
						<div class="flex items-center gap-2 text-sm text-ink">
							{#if isEditor && scheduleEditingId === row.id}
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
											value={scheduleEditName}
											use:focusOnMount
											oninput={(e) => {
												scheduleEditName = (
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
												value={scheduleEditDate}
												oninput={(e) =>
													(scheduleEditDate = (
														e.currentTarget as HTMLInputElement
													).value)}
											/>
											<TimeSelect
												prefix={`event-schedule-edit-datetime-${row.id}`}
												value={scheduleEditTime}
												onchange={(v) => (scheduleEditTime = v)}
											/>
										</div>
									</div>
								</div>
							{:else if isEditor}
								<EditActivator
									label={m.event_schedule_edit_aria_label()}
									data-testid={`event-schedule-edit-${row.id}`}
									disabled={scheduleWritePending[`schedule-edit-name-${row.id}`] ===
										true ||
										scheduleWritePending[`schedule-edit-datetime-${row.id}`] ===
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

							{#if isEditor && scheduleEditingId !== row.id}
								{#if scheduleRemoveArmedId === row.id}
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
											pending={scheduleWritePending[`schedule-remove-${row.id}`] === true}
											busy={scheduleWritePending[`schedule-remove-${row.id}`] === true}
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
						{#if scheduleRowError(row.id)}
							{@const rowError = scheduleRowError(row.id)!}
							<FormError data-testid={`event-schedule-error-${row.id}`}>
								{rowError()}
							</FormError>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if isEditor}
			{#if scheduleErrors[SCHEDULE_ADD_KEY]}
				{@const addError = scheduleErrors[SCHEDULE_ADD_KEY]!}
				<FormError id="event-schedule-add-error" data-testid="event-schedule-add-error">
					{addError()}
				</FormError>
			{/if}
			{#if scheduleAddOpen}
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
							aria-invalid={scheduleAddErrorField === 'name' ? true : undefined}
							aria-describedby={scheduleAddErrorField === 'name'
								? 'event-schedule-add-error'
								: undefined}
							value={scheduleAddName}
							use:focusOnMount
							oninput={(e) => {
								scheduleAddName = (e.currentTarget as HTMLInputElement).value;
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
							aria-describedby={scheduleAddErrorField === 'datetime'
								? 'event-schedule-add-error'
								: undefined}
							class="flex flex-wrap items-center gap-2 text-ink-2"
						>
							<input
								type="date"
								data-testid="event-schedule-add-datetime-date"
								aria-label={m.time_select_date_label()}
								aria-invalid={scheduleAddErrorField === 'datetime' ? true : undefined}
								class="min-w-0 border-b border-ink bg-transparent text-ink"
								value={scheduleAddDate}
								oninput={(e) => {
									scheduleAddDate = (e.currentTarget as HTMLInputElement).value;
									clearScheduleAddError();
								}}
							/>
							<TimeSelect
								prefix="event-schedule-add-datetime"
								value={scheduleAddTime}
								onchange={(v) => {
									scheduleAddTime = v;
									clearScheduleAddError();
								}}
							/>
						</div>
					</div>
					<button
						type="button"
						data-testid="event-schedule-add-submit"
						disabled={scheduleWritePending[SCHEDULE_ADD_KEY] === true || isOffline}
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
