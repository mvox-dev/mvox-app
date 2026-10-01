<!-- #508 — [+ Series] dialog, moved out of +page.svelte's season-manage markup.
	Mounted only while open: untracked prop reads seed the form once at construction, deliberately.
	submitting/resumeByDb/seriesRunDb stay bindable: the page reads them across unmounts. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import { createEvent, createEventSeries } from '$lib/entity/entityCreate';
	import type { CreateEventSeriesInput } from '$lib/entity/entityCreate';
	import { generateEventDates, type RepeatPattern } from '$lib/events/recurrence';
	import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';
	import { groupByMonth, tallinnLocalToUtcIso } from '$lib/preferences/timeFormat';
	import { writesAvailable } from '$lib/net/online';
	import {
		setSeriesCreateResume,
		clearSeriesCreateResume,
		type SeriesCreateErrorField,
		type SeriesCreateFormSnapshot,
		type SeriesCreateResumeByDb
	} from '$lib/agenda/seriesCreateResume';
	import { focusAfterRender } from '$lib/a11y/focusable';
	import { formKeydown } from '$lib/a11y/formKeys';
	import SeriesCreateGeneralFields from '$lib/agenda/SeriesCreateGeneralFields.svelte';
	import SeriesCreateLocationFields from '$lib/agenda/SeriesCreateLocationFields.svelte';
	import SeriesCreateScheduleFields from '$lib/agenda/SeriesCreateScheduleFields.svelte';
	import SeriesCreatePreviewFields from '$lib/agenda/SeriesCreatePreviewFields.svelte';

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

	const initialResume = untrack(() => (selected ? (resumeByDb[selected.db] ?? null) : null));

	let seriesCreateSeasonId = $state(
		initialResume?.form.seasonId ?? untrack(() => manageableSeasonId) ?? ''
	);
	let seriesCreateName = $state(initialResume?.form.name ?? '');
	let seriesCreateType = $state(initialResume?.form.type ?? 'rehearsal');
	let seriesCreateDuration = $state(initialResume?.form.duration ?? '');
	let seriesCreateLocation = $state(initialResume?.form.location ?? '');
	let seriesCreateDescription = $state(initialResume?.form.description ?? '');
	let seriesCreateRepeat = $state<RepeatPattern>(initialResume?.form.repeat ?? 'weekly');
	let seriesCreateDay = $state(initialResume?.form.day ?? '');
	let seriesCreateTime = $state(initialResume?.form.time ?? '');
	let seriesCreateFrom = $state(initialResume?.form.from ?? untrack(() => seasonManageStartDate));
	let seriesCreateUntil = $state(initialResume?.form.until ?? untrack(() => seasonManageEndDate));
	let seriesCreateSkipDates = $state<string[]>(
		initialResume ? [...initialResume.form.skipDates] : []
	);
	let seriesCreateRevealedCount = $state(50);
	let seriesCreateError = $state<(() => string) | null>(null);
	let seriesCreateErrorField = $state<SeriesCreateErrorField>(null);
	let seriesCreateProgress = $state<{ current: number; total: number } | null>(null);

	const seriesCreateResume = $derived(selected ? (resumeByDb[selected.db] ?? null) : null);

	function setSeriesCreateError(msg: () => string, field: SeriesCreateErrorField): void {
		seriesCreateError = msg;
		seriesCreateErrorField = field;
	}

	function clearSeriesCreateError(): void {
		seriesCreateError = null;
		seriesCreateErrorField = null;
	}


	const seriesCreateLocked = $derived(seriesCreateResume !== null);

	const seriesCreateDayApplies = $derived(seriesCreateRepeat !== 'daily');
	const seriesCreateDayOfWeek = $derived(seriesCreateDay === '' ? 0 : Number(seriesCreateDay));

	function datesFor(skipDates: string[]): string[] {
		return generateEventDates({
			repeat: seriesCreateRepeat,
			dayOfWeek: seriesCreateDayOfWeek,
			timeOfDay: seriesCreateTime,
			from: seriesCreateFrom,
			until: seriesCreateUntil,
			skipDates
		});
	}

	const seriesCreateDatesReady = $derived(
		!(seriesCreateDayApplies && seriesCreateDay === '') &&
			!!seriesCreateTime &&
			!!seriesCreateFrom &&
			!!seriesCreateUntil
	);

	const seriesCreatePreviewDates = $derived(
		seriesCreateDatesReady ? datesFor(seriesCreateSkipDates) : null
	);

	const seriesCreateCandidateDates = $derived(seriesCreateDatesReady ? datesFor([]) : null);

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

	const seriesCreateMonthGroups = $derived(
		seriesCreateVisibleGridDates === null
			? null
			: groupByMonth(seriesCreateVisibleGridDates, seriesCreateIsoDay)
	);

	function restoreSeriesCreateFocus(): void {
		void focusAfterRender(() => seasonManagePanelEl);
	}

	function dismissSeriesCreateForm(): void {
		if (submitting) return;
		if (selected) resumeByDb = clearSeriesCreateResume(resumeByDb, selected.db);
		onclose();
		restoreSeriesCreateFocus();
	}

	function onSeriesCreateFormKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') event.stopPropagation();
		formKeydown(event, {
			close: dismissSeriesCreateForm,
			submit: () => {
				if (!seriesCreateNothingToSubmit) void submitSeriesCreate();
			}
		});
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

		const dates: string[] = resume?.remaining ?? datesFor(seriesCreateSkipDates);
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
		const cfg = cfgFor(current.db);
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
			const dbEntityId = await resolveDbEntityOrLog(
				cfg,
				{ area: 'agenda', action: 'series create' },
				current.personId
			);
			if (!dbEntityId) {
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
	<SeriesCreateGeneralFields
		bind:name={seriesCreateName}
		bind:eventType={seriesCreateType}
		bind:description={seriesCreateDescription}
		errorField={seriesCreateErrorField}
		locked={seriesCreateLocked}
		onedit={clearSeriesCreateError}
	/>

	<SeriesCreateLocationFields
		bind:duration={seriesCreateDuration}
		bind:location={seriesCreateLocation}
		{locationSuggestionsId}
		errorField={seriesCreateErrorField}
		locked={seriesCreateLocked}
		onedit={clearSeriesCreateError}
	/>

	<SeriesCreateScheduleFields
		bind:repeat={seriesCreateRepeat}
		bind:day={seriesCreateDay}
		bind:time={seriesCreateTime}
		bind:from={seriesCreateFrom}
		bind:until={seriesCreateUntil}
		dayApplies={seriesCreateDayApplies}
		errorField={seriesCreateErrorField}
		locked={seriesCreateLocked}
		onedit={clearSeriesCreateError}
	/>

	<SeriesCreatePreviewFields
		monthGroups={seriesCreateMonthGroups}
		previewDates={seriesCreatePreviewDates}
		resume={seriesCreateResume}
		skipDates={seriesCreateSkipDates}
		locked={seriesCreateLocked}
		hiddenCount={seriesCreateHiddenCount}
		nextBatchSize={seriesCreateNextBatchSize}
		showAllCount={seriesCreateShowAllCount}
		progress={seriesCreateProgress}
		error={seriesCreateError}
		{submitting}
		nothingToSubmit={seriesCreateNothingToSubmit}
		{isOffline}
		isoDay={seriesCreateIsoDay}
		ontoggleskip={toggleSeriesCreateSkipDate}
		onrevealnext={revealSeriesCreateNext}
		onrevealall={revealSeriesCreateAll}
		onsubmit={() => void submitSeriesCreate()}
		oncancel={dismissSeriesCreateForm}
	/>
</div>
