import type { RepeatPattern } from '$lib/events/recurrence';

// #508 — split out of routes/+page.svelte's series-create section so
// both the page (which owns the map across SeriesCreateForm mounts/unmounts)
// and the form itself can share one type + one pair of pure map edits.

export type SeriesCreateErrorField =
	| 'name'
	| 'type'
	| 'time'
	| 'duration'
	| 'day'
	| 'from'
	| 'until'
	| null;

export type SeriesCreateFormSnapshot = {
	seasonId: string;
	name: string;
	type: string;
	duration: string;
	location: string;
	description: string;
	repeat: RepeatPattern;
	day: string;
	time: string;
	from: string;
	until: string;
	skipDates: string[];
};

export type SeriesResumeEntry = {
	seriesId: string;
	remaining: string[];
	total: number;
	form: SeriesCreateFormSnapshot;
};

export type SeriesCreateResumeByDb = Record<string, SeriesResumeEntry>;

export function setSeriesCreateResume(
	map: SeriesCreateResumeByDb,
	db: string,
	entry: SeriesResumeEntry
): SeriesCreateResumeByDb {
	return { ...map, [db]: entry };
}

export function clearSeriesCreateResume(map: SeriesCreateResumeByDb, db: string): SeriesCreateResumeByDb {
	if (!(db in map)) return map;
	const next = { ...map };
	delete next[db];
	return next;
}
