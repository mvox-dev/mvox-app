<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import FormActions from '$lib/components/FormActions.svelte';
	import { fieldErrorAttrs } from '$lib/a11y/formErrors';
	import { cfgFor } from '$lib/entu/cfg';
	import { generateIntervalDates } from '$lib/events/recurrence';
	import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';
	import { tallinnLocalToUtcIso, tallinnWallClockParts } from '$lib/preferences/timeFormat';
	import type { ConvertEventToSeriesInput } from '$lib/events/eventConvert';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions } from '$lib/events/eventPageState';
	import { focusTestIdAfterRender } from '$lib/a11y/focusable';

	let {
		detail,
		selected,
		canConvert,
		isOffline,
		generation,
		actions,
		refreshDetail
	}: {
		detail: EventDetail;
		selected: Collective | null;
		canConvert: boolean;
		isOffline: boolean;
		generation: () => number;
		actions: EventActions;
		refreshDetail: (evId: string, g: number) => Promise<void>;
	} = $props();

	let eventConvertOpen = $state(false);
	let eventConvertIntervalDays = $state('7');
	let eventConvertDuration = $state('');
	let eventConvertEndDate = $state('');
	let eventConvertSubmitting = $state(false);
	let eventConvertError = $state<(() => string) | null>(null);
	type EventConvertErrorField = 'interval' | 'duration' | 'end' | null;
	let eventConvertErrorField = $state<EventConvertErrorField>(null);
	let eventConvertProgress = $state<{ current: number; total: number } | null>(null);
	type EventConvertResume = {
		seriesId: string;
		dbEntityId: string;
		eventType: string;
		remaining: string[];
		total: number;
	};
	let eventConvertResume = $state<EventConvertResume | null>(null);
	let eventConvertFormEl = $state<HTMLDivElement | null>(null);

	function openEventConvertForm(): void {
		eventConvertOpen = true;
		eventConvertIntervalDays = '7';
		eventConvertDuration = '';
		eventConvertEndDate = '';
		eventConvertProgress = null;
		clearEventConvertError();
	}

	function closeEventConvertForm(): void {
		eventConvertOpen = false;
		eventConvertProgress = null;
		eventConvertResume = null;
		clearEventConvertError();
	}

	function setEventConvertError(message: () => string, field: EventConvertErrorField): void {
		eventConvertError = message;
		eventConvertErrorField = field;
	}

	function clearEventConvertError(): void {
		eventConvertError = null;
		eventConvertErrorField = null;
	}


	const eventConvertLocked = $derived(eventConvertResume !== null);

	function restoreEventConvertFocus(): void {
		void focusTestIdAfterRender('event-detail-convert');
	}

	function dismissEventConvertForm(): void {
		if (eventConvertSubmitting) return;
		closeEventConvertForm();
		restoreEventConvertFocus();
	}

	function onEventConvertFormKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		dismissEventConvertForm();
	}

	$effect(() => {
		if (eventConvertOpen && eventConvertFormEl) eventConvertFormEl.focus();
	});

	function eventConvertStepOf(e: unknown): string {
		if (e && typeof e === 'object' && 'step' in e) {
			const step = (e as { step?: unknown }).step;
			if (typeof step === 'string' && step) return step;
		}
		return 'unknown';
	}

	const EVENT_CONVERT_RESOLVE_STEP = 'resolve-collective';

	function eventConvertRefusalMessage(e: unknown): (() => string) | null {
		if (!e || typeof e !== 'object' || !('reason' in e)) return null;
		const reason = (e as { reason?: unknown }).reason;
		if (reason === 'missing-name') return m.event_convert_missing_name;
		if (reason === 'missing-event-type') return m.event_convert_missing_type;
		return null;
	}

	async function submitEventConvert(): Promise<void> {
		if (eventConvertSubmitting) return;
		if (isOffline) return;
		if (!selected || !detail || detail.seasonId === null) return;
		clearEventConvertError();

		const resume = eventConvertResume;

		const { date: startDate, time: startTime } = tallinnWallClockParts(detail.startDatetime);
		if (!startDate || !startTime) {
			console.error('event detail: converting an event with no readable start', detail.id, detail.startDatetime);
			setEventConvertError(m.event_convert_start_missing, null);
			return;
		}
		const intervalDays = Number(eventConvertIntervalDays);
		if (!eventConvertIntervalDays.trim() || !Number.isFinite(intervalDays) || intervalDays < 1) {
			setEventConvertError(m.event_convert_interval_required, 'interval');
			return;
		}
		const durationMinutes = Number(eventConvertDuration);
		if (!eventConvertDuration.trim() || !Number.isFinite(durationMinutes) || durationMinutes < 1) {
			setEventConvertError(m.event_convert_duration_required, 'duration');
			return;
		}
		if (!eventConvertEndDate) {
			setEventConvertError(m.event_convert_end_required, 'end');
			return;
		}
		if (eventConvertEndDate < startDate) {
			setEventConvertError(m.event_convert_end_before_start, 'end');
			return;
		}

		const cfg = cfgFor(selected.db);
		const seasonId = detail.seasonId;
		const eventId = detail.id;
		const g = generation();

		eventConvertSubmitting = true;
		try {
			let seriesId: string;
			let dbEntityId: string;
			let eventType: string;
			let occurrences: string[];
			let total: number;
			let created: number;

			if (resume) {
				({ seriesId, dbEntityId, eventType, total } = resume);
				occurrences = resume.remaining;
				created = total - occurrences.length;
			} else {
				const resolvedDbEntityId = await resolveDbEntityOrLog(
					cfg,
					{ area: 'event detail', action: 'event conversion' },
					selected.personId
				);
				if (!resolvedDbEntityId) {
					if (g === generation())
						setEventConvertError(
							() => m.event_convert_failed({ step: EVENT_CONVERT_RESOLVE_STEP }),
							null
						);
					return;
				}
				if (g !== generation()) return;
				dbEntityId = resolvedDbEntityId;
				const input: ConvertEventToSeriesInput = {
					eventId,
					dbEntityId,
					seasonId,
					intervalDays,
					startTime,
					startDate,
					endDate: eventConvertEndDate,
					durationMinutes
				};
				try {
					const result = await actions.convertEventToSeries(cfg, input);
					seriesId = result.seriesId;
					eventType = result.eventType;
				} catch (e) {
					console.error('event detail: event conversion failed', eventId, e);
					if (g === generation()) {
						const step = eventConvertStepOf(e);
						setEventConvertError(
							eventConvertRefusalMessage(e) ?? (() => m.event_convert_failed({ step })),
							null
						);
					}
					return;
				}
				if (g !== generation()) return;
				occurrences = generateIntervalDates({
					startDate,
					intervalDays,
					timeOfDay: startTime,
					until: eventConvertEndDate
				}).slice(1);
				total = occurrences.length;
				created = 0;
			}

			for (let i = 0; i < occurrences.length; i += 1) {
				if (g !== generation()) {
					console.warn(
						'event detail: collective/route switched mid-conversion — the series keeps the occurrences already written',
						seriesId
					);
					return;
				}
				eventConvertProgress = { current: created + 1, total };
				try {
					await actions.createEvent(cfg, {
						dbEntityId,
						seriesId,
						extraParentIds: [seasonId],
						eventType,
						startDatetime: tallinnLocalToUtcIso(occurrences[i])
					});
					created += 1;
				} catch (e) {
					console.error('event detail: generating a converted series occurrence failed', seriesId, e);
					eventConvertProgress = null;
					if (g !== generation()) return;
					eventConvertResume = {
						seriesId,
						dbEntityId,
						eventType,
						remaining: occurrences.slice(i),
						total
					};
					setEventConvertError(() => m.event_convert_generate_failed({ created, total }), null);
					return;
				}
			}
			if (g !== generation()) return;
			eventConvertProgress = null;
			closeEventConvertForm();
			await refreshDetail(eventId, g);
		} finally {
			eventConvertSubmitting = false;
		}
	}
</script>

{#if canConvert}
	{#if !eventConvertOpen}
		<button
			type="button"
			data-testid="event-detail-convert"
			class="flex min-h-11 w-fit items-center text-xs text-ink underline"
			onclick={openEventConvertForm}
		>
			{m.event_detail_convert()}
		</button>
	{:else}
		<div
			data-testid="event-convert-form"
			role="dialog"
			aria-label={m.event_convert_form_label()}
			tabindex="-1"
			bind:this={eventConvertFormEl}
			class="flex flex-col gap-1.5 border border-dashed border-ink-5 p-2"
			onkeydown={onEventConvertFormKeydown}
		>
			{#if isOffline}
				<p data-testid="event-convert-write-unavailable" class="text-xs text-ink-2">
					{m.write_unavailable_no_signal()}
				</p>
			{/if}
			<label class="flex w-full flex-col gap-0.5">
				<span class="text-xs text-ink-2">
					{m.event_convert_interval_label()}
				</span>
				<input
					type="number"
					min="1"
					data-testid="event-convert-interval"
					aria-label={m.event_convert_interval_label()}
					{...fieldErrorAttrs(eventConvertErrorField, 'interval', 'event-convert-error')}
					disabled={eventConvertLocked}
					value={eventConvertIntervalDays}
					oninput={(e) => {
						eventConvertIntervalDays = (
							e.currentTarget as HTMLInputElement
						).value;
						clearEventConvertError();
					}}
					class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
				/>
			</label>
			<label class="flex w-full flex-col gap-0.5">
				<span class="text-xs text-ink-2">
					{m.event_convert_duration_label()}
				</span>
				<input
					type="number"
					min="1"
					data-testid="event-convert-duration"
					aria-label={m.event_convert_duration_label()}
					{...fieldErrorAttrs(eventConvertErrorField, 'duration', 'event-convert-error')}
					disabled={eventConvertLocked}
					value={eventConvertDuration}
					oninput={(e) => {
						eventConvertDuration = (
							e.currentTarget as HTMLInputElement
						).value;
						clearEventConvertError();
					}}
					class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
				/>
			</label>
			<p
				data-testid="event-convert-start-date"
				class="flex w-full flex-col gap-0.5"
			>
				<span class="text-xs text-ink-2">
					{m.event_convert_start_date_label()}
				</span>
				<span class="text-ink">
					{tallinnWallClockParts(detail.startDatetime).date}
				</span>
			</p>
			<label class="flex w-full flex-col gap-0.5">
				<span class="text-xs text-ink-2">
					{m.event_convert_end_date_label()}
				</span>
				<input
					type="date"
					data-testid="event-convert-end-date"
					aria-label={m.event_convert_end_date_label()}
					{...fieldErrorAttrs(eventConvertErrorField, 'end', 'event-convert-error')}
					disabled={eventConvertLocked}
					value={eventConvertEndDate}
					oninput={(e) => {
						eventConvertEndDate = (
							e.currentTarget as HTMLInputElement
						).value;
						clearEventConvertError();
					}}
					class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
				/>
			</label>
			{#if eventConvertProgress}
				<p
					data-testid="event-convert-progress"
					role="status"
					aria-live="polite"
					class="text-xs text-ink-2"
				>
					{m.event_convert_progress({
						current: eventConvertProgress.current,
						total: eventConvertProgress.total
					})}
				</p>
			{/if}
			{#if eventConvertResume}
				<p data-testid="event-convert-resume-notice" class="text-xs text-ink-2">
					{m.event_convert_resume_notice({
						remaining: eventConvertResume.remaining.length,
						total: eventConvertResume.total
					})}
				</p>
			{/if}
			{#if eventConvertError}
				<p
					id="event-convert-error"
					data-testid="event-convert-error"
					role="alert"
					class="text-xs text-red-700"
				>
					{eventConvertError()}
				</p>
			{/if}
			<FormActions
				testid="event-convert"
				submitLabel={m.event_convert_submit()}
				cancelLabel={m.event_convert_cancel()}
				submitting={eventConvertSubmitting}
				{isOffline}
				onsubmit={() => void submitEventConvert()}
				oncancel={dismissEventConvertForm}
			/>
		</div>
	{/if}
{/if}
