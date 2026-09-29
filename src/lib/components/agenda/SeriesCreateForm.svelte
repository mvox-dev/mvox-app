<!-- #508 — [+ Series] dialog, moved out of +page.svelte's season-manage markup.
	Mounted only while open, so construction seeds a resume snapshot.
	submitting/resumeByDb/seriesRunDb stay bindable: the page reads them across unmounts. -->
<script lang="ts">
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import type { Collective } from '$lib/collectives/types';
	import { getToken } from '$lib/auth/storage';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import { CANONICAL_EVENT_TYPES, eventTypeLabel } from '$lib/events/eventTypeLabels';
	import { createEvent, createEventSeries } from '$lib/entity/entityCreate';
	import type { CreateEventSeriesInput } from '$lib/entity/entityCreate';
	import { generateEventDates, type RepeatPattern } from '$lib/events/recurrence';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import { tallinnLocalToUtcIso } from '$lib/preferences/timeFormat';
	import { writesAvailable } from '$lib/net/online';
	import {
		setSeriesCreateResume,
		clearSeriesCreateResume,
		type SeriesCreateErrorField,
		type SeriesCreateFormSnapshot,
		type SeriesCreateResumeByDb
	} from '$lib/agenda/seriesCreateResume';

	interface Props {
		selected: Collective | null;
		manageableSeasonId: string | null;
		seasonManageStartDate: string;
		seasonManageEndDate: string;
		seasonManagePanelEl: HTMLDivElement | null;
		locationSuggestionsId: string;
		submitting: boolean;
		resumeByDb: SeriesCreateResumeByDb;
		seriesRunDb: string | null;
		onclose: () => void;
		loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
		refreshSeasonManageLists: (cfg: { db: string; token: string }, seasonId: string) => void;
	}

	let {
		selected,
		manageableSeasonId,
		seasonManageStartDate,
		seasonManageEndDate,
		seasonManagePanelEl,
		locationSuggestionsId,
		submitting = $bindable(false),
		resumeByDb = $bindable({}),
		seriesRunDb = $bindable(null),
		onclose,
		loadForSelected,
		refreshSeasonManageLists
	}: Props = $props();

	const isOffline = $derived(!$writesAvailable);

	const initialResume = selected ? (resumeByDb[selected.db] ?? null) : null;

	let seriesCreateSeasonId = $state(initialResume?.form.seasonId ?? manageableSeasonId ?? '');
	let seriesCreateName = $state(initialResume?.form.name ?? '');
	let seriesCreateType = $state(initialResume?.form.type ?? 'rehearsal');
	let seriesCreateDuration = $state(initialResume?.form.duration ?? '');
	let seriesCreateLocation = $state(initialResume?.form.location ?? '');
	let seriesCreateDescription = $state(initialResume?.form.description ?? '');
	let seriesCreateRepeat = $state<RepeatPattern>(initialResume?.form.repeat ?? 'weekly');
	let seriesCreateDay = $state(initialResume?.form.day ?? '');
	let seriesCreateTime = $state(initialResume?.form.time ?? '');
	let seriesCreateFrom = $state(initialResume?.form.from ?? seasonManageStartDate);
	let seriesCreateUntil = $state(initialResume?.form.until ?? seasonManageEndDate);
	let seriesCreateSkipDates = $state<string[]>(
		initialResume ? [...initialResume.form.skipDates] : []
	);
	let seriesCreateRevealedCount = $state(50);
	let seriesCreateError = $state<(() => string) | null>(null);
	let seriesCreateErrorField = $state<SeriesCreateErrorField>(null);
	let seriesCreateProgress = $state<{ current: number; total: number } | null>(null);

	let seriesCreateNameInput = $state<HTMLInputElement | null>(null);

	const seriesCreateResume = $derived(selected ? (resumeByDb[selected.db] ?? null) : null);

	function setSeriesCreateError(msg: () => string, field: SeriesCreateErrorField): void {
		seriesCreateError = msg;
		seriesCreateErrorField = field;
	}

	function clearSeriesCreateError(): void {
		seriesCreateError = null;
		seriesCreateErrorField = null;
	}

	function seriesCreateDescribedBy(field: SeriesCreateErrorField): string | undefined {
		return seriesCreateErrorField === field ? 'series-create-error' : undefined;
	}

	function seriesCreateInvalid(field: SeriesCreateErrorField): true | undefined {
		return seriesCreateErrorField === field ? true : undefined;
	}

	const seriesCreateLocked = $derived(seriesCreateResume !== null);

	const seriesCreateDayApplies = $derived(seriesCreateRepeat !== 'daily');
	const seriesCreateDayOfWeek = $derived(seriesCreateDay === '' ? 0 : Number(seriesCreateDay));

	const seriesCreatePreviewDates = $derived.by(() => {
		if (seriesCreateDayApplies && seriesCreateDay === '') return null;
		if (!seriesCreateTime || !seriesCreateFrom || !seriesCreateUntil) {
			return null;
		}
		return generateEventDates({
			repeat: seriesCreateRepeat,
			dayOfWeek: seriesCreateDayOfWeek,
			timeOfDay: seriesCreateTime,
			from: seriesCreateFrom,
			until: seriesCreateUntil,
			skipDates: seriesCreateSkipDates
		});
	});

	const seriesCreateCandidateDates = $derived.by(() => {
		if (seriesCreateDayApplies && seriesCreateDay === '') return null;
		if (!seriesCreateTime || !seriesCreateFrom || !seriesCreateUntil) {
			return null;
		}
		return generateEventDates({
			repeat: seriesCreateRepeat,
			dayOfWeek: seriesCreateDayOfWeek,
			timeOfDay: seriesCreateTime,
			from: seriesCreateFrom,
			until: seriesCreateUntil,
			skipDates: []
		});
	});

	const seriesCreateGridDates = $derived.by(() => {
		if (seriesCreateCandidateDates === null) return null;
		return seriesCreateResume ? seriesCreateResume.remaining : seriesCreateCandidateDates;
	});

	$effect(() => {
		void seriesCreateGridDates;
		seriesCreateRevealedCount = 50;
	});

	const seriesCreateVisibleGridDates = $derived.by(() => {
		if (seriesCreateGridDates === null) return null;
		return seriesCreateGridDates.slice(0, seriesCreateRevealedCount);
	});

	const seriesCreateHiddenCount = $derived(
		seriesCreateGridDates === null
			? 0
			: Math.max(0, seriesCreateGridDates.length - seriesCreateRevealedCount)
	);

	const seriesCreateNextBatchSize = $derived(Math.min(50, seriesCreateHiddenCount));

	const seriesCreateShowAllCount = $derived(
		seriesCreateResume
			? (seriesCreateGridDates?.length ?? 0)
			: (seriesCreatePreviewDates?.length ?? 0)
	);

	function revealSeriesCreateNext(): void {
		seriesCreateRevealedCount += 50;
	}
	function revealSeriesCreateAll(): void {
		if (seriesCreateGridDates === null) return;
		seriesCreateRevealedCount = seriesCreateGridDates.length;
	}

	const seriesCreateNothingToSubmit = $derived(
		!seriesCreateResume &&
			seriesCreateCandidateDates !== null &&
			seriesCreateCandidateDates.length > 0 &&
			seriesCreatePreviewDates !== null &&
			seriesCreatePreviewDates.length === 0
	);

	function seriesCreateIsoDay(date: string): string {
		return date.slice(0, 10);
	}

	const seriesCreateMonthGroups = $derived.by(() => {
		if (seriesCreateVisibleGridDates === null) return null;
		const groups: { month: string; dates: string[] }[] = [];
		for (const date of seriesCreateVisibleGridDates) {
			const month = seriesCreateIsoDay(date).slice(0, 7);
			const current = groups[groups.length - 1];
			if (current && current.month === month) {
				current.dates.push(date);
			} else {
				groups.push({ month, dates: [date] });
			}
		}
		return groups;
	});

	function seriesCreateMonthLabel(month: string): string {
		const [year, monthNum] = month.split('-').map(Number);
		return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(
			new Date(year, monthNum - 1, 1)
		);
	}

	function restoreSeriesCreateFocus(): void {
		tick().then(() => seasonManagePanelEl?.focus());
	}

	function dismissSeriesCreateForm(): void {
		if (submitting) return;
		if (selected) resumeByDb = clearSeriesCreateResume(resumeByDb, selected.db);
		onclose();
		restoreSeriesCreateFocus();
	}

	function onSeriesCreateFormKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		dismissSeriesCreateForm();
	}

	function toggleSeriesCreateSkipDate(iso: string): void {
		if (seriesCreateLocked) return;
		seriesCreateSkipDates = seriesCreateSkipDates.includes(iso)
			? seriesCreateSkipDates.filter((d) => d !== iso)
			: [...seriesCreateSkipDates, iso].sort();
	}

	async function submitSeriesCreate(): Promise<void> {
		if (submitting) return;
		if (isOffline) return;
		clearSeriesCreateError();

		const resume = seriesCreateResume;
		const seasonId = seriesCreateSeasonId;
		const name = seriesCreateName.trim();
		if (!name) {
			setSeriesCreateError(m.series_create_name_required, 'name');
			return;
		}
		const typeValue = seriesCreateType.trim();
		if (!typeValue) {
			setSeriesCreateError(m.series_create_type_required, 'type');
			return;
		}
		const time = seriesCreateTime;
		if (!time) {
			setSeriesCreateError(m.series_create_time_required, 'time');
			return;
		}
		const durationValue = Number(seriesCreateDuration);
		if (!seriesCreateDuration.trim() || !Number.isFinite(durationValue)) {
			setSeriesCreateError(m.series_create_duration_required, 'duration');
			return;
		}
		if (!seriesCreateFrom) {
			setSeriesCreateError(m.series_create_from_required, 'from');
			return;
		}
		if (!seriesCreateUntil) {
			setSeriesCreateError(m.series_create_until_required, 'until');
			return;
		}
		if (seriesCreateUntil < seriesCreateFrom) {
			setSeriesCreateError(m.series_create_until_before_from, 'until');
			return;
		}
		if (seriesCreateDayApplies && seriesCreateDay === '') {
			setSeriesCreateError(m.series_create_day_required, 'day');
			return;
		}

		const dates: string[] =
			resume?.remaining ??
			generateEventDates({
				repeat: seriesCreateRepeat,
				dayOfWeek: seriesCreateDayOfWeek,
				timeOfDay: time,
				from: seriesCreateFrom,
				until: seriesCreateUntil,
				skipDates: seriesCreateSkipDates
			});
		if (dates.length === 0) {
			setSeriesCreateError(m.series_create_no_dates, null);
			return;
		}
		const total = resume?.total ?? dates.length;

		const current = selected;
		if (!current || !seasonId) {
			console.error('agenda: series create submitted with no selected collective/season');
			setSeriesCreateError(m.series_create_failed, null);
			return;
		}
		const cfg = { db: current.db, token: getToken() ?? '' };
		const panelSeasonId = manageableSeasonId;
		const runDb = cfg.db;
		const dbChanged = (): boolean => selected?.db !== runDb;
		const runForm: SeriesCreateFormSnapshot = resume?.form ?? {
			seasonId,
			name,
			type: typeValue,
			duration: seriesCreateDuration,
			location: seriesCreateLocation,
			description: seriesCreateDescription,
			repeat: seriesCreateRepeat,
			day: seriesCreateDay,
			time,
			from: seriesCreateFrom,
			until: seriesCreateUntil,
			skipDates: [...seriesCreateSkipDates]
		};
		const recordStop = (seriesId: string, index: number): void => {
			resumeByDb = setSeriesCreateResume(resumeByDb, runDb, {
				seriesId,
				remaining: dates.slice(index),
				total,
				form: runForm
			});
		};

		submitting = true;
		seriesRunDb = runDb;
		try {
			let dbEntityId: string | null;
			try {
				dbEntityId = await resolveDatabaseEntityId(cfg);
			} catch (e) {
				console.error('agenda: resolving the database entity for series create failed', e);
				if (!dbChanged()) setSeriesCreateError(m.series_create_failed, null);
				return;
			}
			if (!dbEntityId) {
				console.error('agenda: series create with no resolvable database entity', current.personId);
				if (!dbChanged()) setSeriesCreateError(m.series_create_failed, null);
				return;
			}
			if (dbChanged()) return;

			const intervalDays =
				seriesCreateRepeat === 'daily' ? 1 : seriesCreateRepeat === 'biweekly' ? 14 : 7;
			const trimmedLocation = seriesCreateLocation.trim();
			const trimmedDescription = seriesCreateDescription.trim();

			const startDate = seriesCreateIsoDay(dates[0]);
			const endDate = seriesCreateIsoDay(dates[dates.length - 1]);

			const seriesInput: CreateEventSeriesInput = {
				name,
				dbEntityId,
				extraParentIds: [seasonId],
				eventType: typeValue,
				intervalDays,
				startTime: time,
				durationMinutes: durationValue,
				startDate,
				endDate,
				...(trimmedLocation ? { defaultLocation: trimmedLocation } : {}),
				...(trimmedDescription ? { defaultDescription: trimmedDescription } : {})
			};

			let seriesId: string;
			if (resume) {
				seriesId = resume.seriesId;
			} else {
				try {
					seriesId = await createEventSeries(cfg, seriesInput);
				} catch (e) {
					console.error('agenda: series create failed', e);
					if (!dbChanged()) setSeriesCreateError(m.series_create_failed, null);
					return;
				}
			}
			if (dbChanged()) {
				recordStop(seriesId, 0);
				return;
			}

			const alreadyCreated = total - dates.length;
			let created = alreadyCreated;
			for (let i = 0; i < dates.length; i += 1) {
				if (dbChanged()) {
					recordStop(seriesId, i);
					break;
				}
				seriesCreateProgress = { current: created + 1, total };
				const startDatetime = tallinnLocalToUtcIso(dates[i]);
				try {
					await createEvent(cfg, {
						dbEntityId,
						seriesId,
						extraParentIds: [seasonId],
						eventType: typeValue,
						startDatetime
					});
					created += 1;
				} catch (e) {
					if (dbChanged()) {
						recordStop(seriesId, i);
						return;
					}
					console.error('agenda: bulk event create failed', e);
					seriesCreateProgress = null;
					recordStop(seriesId, i);
					setSeriesCreateError(() => m.series_create_bulk_failed({ created, total }), null);
					loadForSelected({ keepSeasonManage: true });
					if (panelSeasonId === seasonId) {
						refreshSeasonManageLists(cfg, seasonId);
					}
					return;
				}
			}
			if (dbChanged()) {
				if (created >= total) resumeByDb = clearSeriesCreateResume(resumeByDb, runDb);
				return;
			}
			seriesCreateProgress = null;
			resumeByDb = clearSeriesCreateResume(resumeByDb, runDb);
			onclose();
			loadForSelected({ keepSeasonManage: true });
			if (panelSeasonId === seasonId) {
				refreshSeasonManageLists(cfg, seasonId);
			}
			restoreSeriesCreateFocus();
		} finally {
			submitting = false;
			seriesRunDb = null;
		}
	}

	$effect(() => {
		if (seriesCreateNameInput) seriesCreateNameInput.focus();
	});
</script>

<div
	data-testid="series-create-form"
	role="dialog"
	aria-label={m.series_create_form_label()}
	tabindex="-1"
	class="mt-1 flex flex-col gap-1.5 border-b border-dashed border-ink-5 pb-3"
	onkeydown={onSeriesCreateFormKeydown}
>
	{#if isOffline}
		<p data-testid="series-create-write-unavailable" class="text-xs text-ink-2">
			{m.write_unavailable_no_signal()}
		</p>
	{/if}
	<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
		<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
			{m.series_create_group_general_label()}
		</legend>
		<label class="flex w-full flex-col gap-0.5">
			<span class="text-xs text-ink-2">{m.series_create_name_label()}</span>
			<input
				type="text"
				data-testid="series-create-name"
				bind:this={seriesCreateNameInput}
				aria-invalid={seriesCreateInvalid('name')}
				aria-describedby={seriesCreateDescribedBy('name')}
				placeholder={m.series_create_name_placeholder()}
				disabled={seriesCreateLocked}
				value={seriesCreateName}
				oninput={(e) => {
					seriesCreateName = (e.currentTarget as HTMLInputElement).value;
					clearSeriesCreateError();
				}}
				class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
			/>
		</label>
		<label class="flex w-full flex-col gap-0.5">
			<span data-testid="series-create-type-label" class="text-xs text-ink-2">
				{m.series_create_type_label()}
			</span>
			<select
				data-testid="series-create-type"
				aria-invalid={seriesCreateInvalid('type')}
				aria-describedby={seriesCreateDescribedBy('type')}
				disabled={seriesCreateLocked}
				value={seriesCreateType}
				onchange={(e) => {
					seriesCreateType = (e.currentTarget as HTMLSelectElement).value;
					clearSeriesCreateError();
				}}
				class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
			>
				{#each CANONICAL_EVENT_TYPES as type (type)}
					<option value={type}>{eventTypeLabel(type)}</option>
				{/each}
			</select>
		</label>
		<label class="flex w-full flex-col gap-0.5">
			<span class="text-xs text-ink-2">
				{m.series_create_description_label()}
			</span>
			<textarea
				data-testid="series-create-description"
				placeholder={m.series_create_description_placeholder()}
				disabled={seriesCreateLocked}
				value={seriesCreateDescription}
				oninput={(e) =>
					(seriesCreateDescription = (e.currentTarget as HTMLTextAreaElement).value)}
				class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
			></textarea>
		</label>
	</fieldset>

	<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
		<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
			{m.series_create_group_location_label()}
		</legend>
		<label class="flex w-full flex-col gap-0.5">
			<span class="text-xs text-ink-2">
				{m.series_create_duration_label()}
			</span>
			<input
				type="number"
				data-testid="series-create-duration"
				aria-invalid={seriesCreateInvalid('duration')}
				aria-describedby={seriesCreateDescribedBy('duration')}
				placeholder={m.series_create_duration_placeholder()}
				disabled={seriesCreateLocked}
				value={seriesCreateDuration}
				oninput={(e) => {
					seriesCreateDuration = (e.currentTarget as HTMLInputElement).value;
					clearSeriesCreateError();
				}}
				class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
			/>
		</label>
		<label class="flex w-full flex-col gap-0.5">
			<span class="text-xs text-ink-2">
				{m.series_create_location_label()}
			</span>
			<input
				type="text"
				data-testid="series-create-location"
				list={locationSuggestionsId}
				placeholder={m.series_create_location_placeholder()}
				disabled={seriesCreateLocked}
				value={seriesCreateLocation}
				oninput={(e) => (seriesCreateLocation = (e.currentTarget as HTMLInputElement).value)}
				class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
			/>
		</label>
	</fieldset>

	<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
		<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
			{m.series_create_group_schedule_label()}
		</legend>
		<div class="flex gap-2">
			<label class="flex min-w-0 flex-1 flex-col gap-0.5">
				<span class="text-xs text-ink-2">
					{m.series_create_repeat_label()}
				</span>
				<select
					data-testid="series-create-repeat"
					disabled={seriesCreateLocked}
					value={seriesCreateRepeat}
					onchange={(e) =>
						(seriesCreateRepeat = (e.currentTarget as HTMLSelectElement).value as RepeatPattern)}
					class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
				>
					<option value="weekly">{m.series_create_repeat_weekly()}</option>
					<option value="biweekly">{m.series_create_repeat_biweekly()}</option>
					<option value="daily">{m.series_create_repeat_daily()}</option>
				</select>
			</label>
			{#if seriesCreateDayApplies}
				<label class="flex min-w-0 flex-1 flex-col gap-0.5">
					<span class="text-xs text-ink-2">
						{m.series_create_day_label()}
					</span>
					<select
						data-testid="series-create-day"
						aria-invalid={seriesCreateInvalid('day')}
						aria-describedby={seriesCreateDescribedBy('day')}
						disabled={seriesCreateLocked}
						value={seriesCreateDay}
						onchange={(e) => {
							seriesCreateDay = (e.currentTarget as HTMLSelectElement).value;
							clearSeriesCreateError();
						}}
						class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
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
				</label>
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
					value={seriesCreateTime}
					disabled={seriesCreateLocked}
					invalid={seriesCreateInvalid('time')}
					describedBy={seriesCreateDescribedBy('time')}
					onchange={(v) => {
						seriesCreateTime = v;
						clearSeriesCreateError();
					}}
				/>
			</div>
		</div>

		<div class="flex gap-2">
			<label class="flex min-w-0 flex-1 flex-col gap-0.5">
				<span class="text-xs text-ink-2">{m.series_create_from_label()}</span>
				<input
					type="date"
					data-testid="series-create-from"
					aria-invalid={seriesCreateInvalid('from')}
					aria-describedby={seriesCreateDescribedBy('from')}
					disabled={seriesCreateLocked}
					value={seriesCreateFrom}
					oninput={(e) => {
						seriesCreateFrom = (e.currentTarget as HTMLInputElement).value;
						clearSeriesCreateError();
					}}
					class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
				/>
			</label>
			<label class="flex min-w-0 flex-1 flex-col gap-0.5">
				<span class="text-xs text-ink-2">{m.series_create_until_label()}</span>
				<input
					type="date"
					data-testid="series-create-until"
					aria-invalid={seriesCreateInvalid('until')}
					aria-describedby={seriesCreateDescribedBy('until')}
					disabled={seriesCreateLocked}
					value={seriesCreateUntil}
					oninput={(e) => {
						seriesCreateUntil = (e.currentTarget as HTMLInputElement).value;
						clearSeriesCreateError();
					}}
					class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
				/>
			</label>
		</div>
	</fieldset>

	<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
		<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
			{m.series_create_group_preview_label()}
		</legend>
		{#if seriesCreateMonthGroups !== null}
			<div data-testid="series-create-preview" class="text-xs text-ink-2">
				<p class="tracking-wide uppercase">
					{m.series_create_preview_label()}
				</p>
				{#if !seriesCreateResume && seriesCreatePreviewDates !== null}
					<p data-testid="series-create-preview-count" class="text-ink">
						{seriesCreatePreviewDates.length === 1
							? m.series_create_preview_count_one()
							: m.series_create_preview_count_other({
									count: seriesCreatePreviewDates.length
								})}
					</p>
				{/if}
				<div class="flex flex-col gap-2">
					{#each seriesCreateMonthGroups as group (group.month)}
						<div class="flex flex-col gap-1.5">
							<h4
								data-testid="series-create-month-{group.month}"
								class="text-xs tracking-wide text-ink-2 uppercase"
							>
								{seriesCreateMonthLabel(group.month)}
							</h4>
							<div class="flex flex-wrap gap-1.5">
								{#each group.dates as date (date)}
									{@const iso = seriesCreateIsoDay(date)}
									{@const skipped = !seriesCreateResume && seriesCreateSkipDates.includes(iso)}
									<button
										type="button"
										data-testid="series-create-date-{iso}"
										aria-pressed={skipped ? 'false' : 'true'}
										aria-label={skipped ? m.series_create_date_skipped({ date: iso }) : undefined}
										disabled={seriesCreateLocked}
										class="flex min-h-11 min-w-11 items-center justify-center border border-ink-5 px-1.5 text-xs disabled:opacity-50 {skipped
											? 'text-ink-2 line-through'
											: 'text-ink'}"
										onclick={() => toggleSeriesCreateSkipDate(iso)}
									>
										{iso}
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>
				{#if seriesCreateHiddenCount > 0}
					<div class="flex gap-2">
						<button
							type="button"
							data-testid="series-create-show-next"
							class="flex min-h-11 items-center border border-ink-5 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
							onclick={revealSeriesCreateNext}
						>
							{m.series_create_show_next_label({ count: seriesCreateNextBatchSize })}
						</button>
						<button
							type="button"
							data-testid="series-create-show-all"
							class="flex min-h-11 items-center border border-ink-5 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
							onclick={revealSeriesCreateAll}
						>
							{m.series_create_show_all_label({
								count: seriesCreateShowAllCount
							})}
						</button>
					</div>
				{/if}
			</div>
		{/if}

		{#if seriesCreateResume}
			<p data-testid="series-create-resume" class="text-xs text-ink-2">
				{m.series_create_resume_notice({
					remaining: seriesCreateResume.remaining.length,
					total: seriesCreateResume.total
				})}
			</p>
		{/if}

		{#if seriesCreateProgress}
			<p data-testid="series-create-progress" role="status" class="text-xs text-ink-2">
				{m.series_create_progress({
					current: seriesCreateProgress.current,
					total: seriesCreateProgress.total
				})}
			</p>
		{/if}

		{#if seriesCreateError}
			<p id="series-create-error" data-testid="series-create-error" role="alert" class="text-xs text-red-700">
				{seriesCreateError()}
			</p>
		{/if}

		<div class="flex gap-2">
			<button
				type="button"
				data-testid="series-create-submit"
				disabled={submitting || seriesCreateNothingToSubmit || isOffline}
				aria-busy={submitting}
				class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
				onclick={() => void submitSeriesCreate()}
			>
				{m.series_create_submit()}
			</button>
			<button
				type="button"
				data-testid="series-create-cancel"
				disabled={submitting}
				class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
				onclick={dismissSeriesCreateForm}
			>
				{m.roster_cancel()}
			</button>
		</div>
	</fieldset>
</div>
