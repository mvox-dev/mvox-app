// The dates a series-create form offers: candidates, preview, the paged grid and its month groups.
import { generateEventDates, type RepeatPattern } from '$lib/events/recurrence';
import { groupByMonth } from '$lib/preferences/timeFormat';
import type { SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';

const PAGE = 50;

export interface SeriesCreateDateInputs {
	repeat: () => RepeatPattern;
	day: () => string;
	time: () => string;
	from: () => string;
	until: () => string;
	skipDates: () => string[];
	resume: () => SeriesResumeEntry | null;
}

export function seriesCreateIsoDay(date: string): string {
	return date.slice(0, 10);
}

export function createSeriesCreateDateGrid(inputs: SeriesCreateDateInputs) {
	let revealedCount = $state(PAGE);

	const dayApplies = $derived(inputs.repeat() !== 'daily');
	const dayOfWeek = $derived(inputs.day() === '' ? 0 : Number(inputs.day()));

	function datesFor(skipDates: string[]): string[] {
		return generateEventDates({
			repeat: inputs.repeat(),
			dayOfWeek,
			timeOfDay: inputs.time(),
			from: inputs.from(),
			until: inputs.until(),
			skipDates
		});
	}

	const datesReady = $derived(
		!(dayApplies && inputs.day() === '') && !!inputs.time() && !!inputs.from() && !!inputs.until()
	);
	const previewDates = $derived(datesReady ? datesFor(inputs.skipDates()) : null);
	const candidateDates = $derived(datesReady ? datesFor([]) : null);
	const gridDates = $derived.by(() => {
		if (candidateDates === null) return null;
		const resume = inputs.resume();
		return resume ? resume.remaining : candidateDates;
	});

	$effect(() => {
		void gridDates;
		revealedCount = PAGE;
	});

	const visibleGridDates = $derived(gridDates === null ? null : gridDates.slice(0, revealedCount));
	const hiddenCount = $derived(
		gridDates === null ? 0 : Math.max(0, gridDates.length - revealedCount)
	);
	const nextBatchSize = $derived(Math.min(PAGE, hiddenCount));
	const showAllCount = $derived(
		inputs.resume() ? (gridDates?.length ?? 0) : (previewDates?.length ?? 0)
	);
	const nothingToSubmit = $derived(
		!inputs.resume() &&
			candidateDates !== null &&
			candidateDates.length > 0 &&
			previewDates !== null &&
			previewDates.length === 0
	);
	const monthGroups = $derived(
		visibleGridDates === null ? null : groupByMonth(visibleGridDates, seriesCreateIsoDay)
	);

	return {
		get dayApplies() {
			return dayApplies;
		},
		get previewDates() {
			return previewDates;
		},
		get hiddenCount() {
			return hiddenCount;
		},
		get nextBatchSize() {
			return nextBatchSize;
		},
		get showAllCount() {
			return showAllCount;
		},
		get nothingToSubmit() {
			return nothingToSubmit;
		},
		get monthGroups() {
			return monthGroups;
		},
		datesFor,
		revealNext(): void {
			revealedCount += PAGE;
		},
		revealAll(): void {
			if (gridDates === null) return;
			revealedCount = gridDates.length;
		}
	};
}
