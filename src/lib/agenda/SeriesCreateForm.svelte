<!-- #508 — [+ Series] dialog, moved out of +page.svelte's season-manage markup.
	Mounted only while open: untracked prop reads seed the form once at construction, deliberately.
	submitting/resumeByDb/seriesRunDb stay bindable: the page reads them across unmounts. -->
<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { createEvent, createEventSeries } from '$lib/entity/entityCreate';
	import type { RepeatPattern } from '$lib/events/recurrence';
	import { writesAvailable } from '$lib/net/online';
	import {
		setSeriesCreateResume,
		clearSeriesCreateResume,
		type SeriesCreateErrorField,
		type SeriesCreateResumeByDb
	} from '$lib/agenda/seriesCreateResume';
	import { focusAfterRender } from '$lib/a11y/focusable';
	import { formKeydown } from '$lib/a11y/formKeys';
	import { createSeriesCreateDateGrid } from '$lib/agenda/seriesCreateDateGrid.svelte';
	import { runSeriesCreate } from '$lib/agenda/seriesCreateSubmit';
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

	const grid = createSeriesCreateDateGrid({
		repeat: () => seriesCreateRepeat,
		day: () => seriesCreateDay,
		time: () => seriesCreateTime,
		from: () => seriesCreateFrom,
		until: () => seriesCreateUntil,
		skipDates: () => seriesCreateSkipDates,
		resume: () => seriesCreateResume
	});

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
				if (!grid.nothingToSubmit) void submitSeriesCreate();
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
		await runSeriesCreate({
			form: {
				seasonId: seriesCreateSeasonId,
				name: seriesCreateName,
				type: seriesCreateType,
				duration: seriesCreateDuration,
				location: seriesCreateLocation,
				description: seriesCreateDescription,
				repeat: seriesCreateRepeat,
				day: seriesCreateDay,
				time: seriesCreateTime,
				from: seriesCreateFrom,
				until: seriesCreateUntil,
				skipDates: [...seriesCreateSkipDates]
			},
			dayApplies: grid.dayApplies,
			resume: seriesCreateResume,
			datesFor: grid.datesFor,
			selected: () => selected,
			manageableSeasonId,
			seams: {
				createEventSeries: (cfg, input) => createEventSeries(cfg, input),
				createEvent: (cfg, input) => createEvent(cfg, input)
			},
			setError: setSeriesCreateError,
			setProgress: (progress) => (seriesCreateProgress = progress),
			setRunning: (runDb) => {
				submitting = runDb !== null;
				seriesRunDb = runDb;
			},
			recordResume: (db, entry) => (resumeByDb = setSeriesCreateResume(resumeByDb, db, entry)),
			clearResume: (db) => (resumeByDb = clearSeriesCreateResume(resumeByDb, db)),
			onclose,
			loadForSelected,
			refreshSeasonManageLists,
			restoreFocus: restoreSeriesCreateFocus
		});
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
		dayApplies={grid.dayApplies}
		errorField={seriesCreateErrorField}
		locked={seriesCreateLocked}
		onedit={clearSeriesCreateError}
	/>

	<SeriesCreatePreviewFields
		monthGroups={grid.monthGroups}
		previewDates={grid.previewDates}
		resume={seriesCreateResume}
		skipDates={seriesCreateSkipDates}
		locked={seriesCreateLocked}
		hiddenCount={grid.hiddenCount}
		nextBatchSize={grid.nextBatchSize}
		showAllCount={grid.showAllCount}
		progress={seriesCreateProgress}
		error={seriesCreateError}
		{submitting}
		nothingToSubmit={grid.nothingToSubmit}
		{isOffline}
		ontoggleskip={toggleSeriesCreateSkipDate}
		onrevealnext={grid.revealNext}
		onrevealall={grid.revealAll}
		onsubmit={() => void submitSeriesCreate()}
		oncancel={dismissSeriesCreateForm}
	/>
</div>
