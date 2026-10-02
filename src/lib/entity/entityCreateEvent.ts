// Creates for the agenda's season, event_series and event, each one type lookup and one POST.
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import {
	conductorProps,
	optional,
	optionalNumber,
	parentIdsFor,
	postCreate,
	requireDateRange,
	requireNumber,
	requireText,
	type WireProp
} from './entityCreateShared';

export interface CreateSeasonInput {
	name: string;
	// The collective's database entity: the required parent, sent first and never looked up.
	dbEntityId: string;
	extraParentIds?: string[];
	startDate: string;
	endDate: string;
	conductorRefs?: string[];
}

export interface CreateEventSeriesInput {
	name: string;
	dbEntityId: string;
	extraParentIds?: string[];
	eventType: string;
	intervalDays: number;
	startTime: string;
	durationMinutes: number;
	startDate: string;
	endDate: string;
	defaultLocation?: string;
	defaultDescription?: string;
}

export interface CreateEventInput {
	name?: string;
	dbEntityId: string;
	// Its own field: a series parent is what lets the name be blank and inherited.
	seriesId?: string;
	// listEvents selects on the season parent with no ancestor expansion, so it goes here too.
	extraParentIds?: string[];
	// Required though v4E lets it inherit: every reader shows the event's own event_type.
	eventType: string;
	startDatetime: string;
	durationMinutes?: number;
	location?: string;
	description?: string;
	conductorRefs?: string[];
	capacity?: number;
}

export async function createSeason(
	cfg: EntuCfg,
	input: CreateSeasonInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createSeason';
	const name = requireText(fn, 'name', input.name);
	const { start, end } = requireDateRange(
		fn,
		'startDate',
		input.startDate,
		'endDate',
		input.endDate
	);
	const parentIds = parentIdsFor(fn, input.dbEntityId, input.extraParentIds);

	const props: WireProp[] = [
		{ type: 'name', string: name },
		{ type: 'start_date', date: start },
		{ type: 'end_date', date: end },
		...conductorProps(input.conductorRefs)
	];
	return postCreate(cfg, 'season', parentIds, props, fetchImpl);
}

export async function createEventSeries(
	cfg: EntuCfg,
	input: CreateEventSeriesInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createEventSeries';
	const name = requireText(fn, 'name', input.name);
	const eventType = requireText(fn, 'eventType', input.eventType);
	const startTime = requireText(fn, 'startTime', input.startTime);
	const intervalDays = requireNumber(fn, 'intervalDays', input.intervalDays, 1);
	const durationMinutes = requireNumber(fn, 'durationMinutes', input.durationMinutes, 1);
	const { start, end } = requireDateRange(
		fn,
		'startDate',
		input.startDate,
		'endDate',
		input.endDate
	);
	const parentIds = parentIdsFor(fn, input.dbEntityId, input.extraParentIds);

	const props: WireProp[] = [
		{ type: 'name', string: name },
		{ type: 'event_type', string: eventType },
		{ type: 'interval_days', number: intervalDays },
		{ type: 'start_time', string: startTime },
		{ type: 'start_date', date: start },
		{ type: 'end_date', date: end },
		{ type: 'duration_minutes', number: durationMinutes },
		...optional('default_location', input.defaultLocation),
		...optional('default_description', input.defaultDescription)
	];
	return postCreate(cfg, 'event_series', parentIds, props, fetchImpl);
}

export async function createEvent(
	cfg: EntuCfg,
	input: CreateEventInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const fn = 'createEvent';
	const eventType = requireText(fn, 'eventType', input.eventType);
	const startDatetime = requireText(fn, 'startDatetime', input.startDatetime);
	const seriesId = input.seriesId?.trim();
	// Only a series gives a name to inherit; a standalone event must carry its own.
	const name = seriesId ? input.name : requireText(fn, 'name', input.name);
	const parentIds = parentIdsFor(fn, input.dbEntityId, [
		seriesId,
		...(input.extraParentIds ?? [])
	]);

	const props: WireProp[] = [
		...optional('event_name', name),
		{ type: 'event_type', string: eventType },
		{ type: 'start_datetime', datetime: startDatetime },
		...optionalNumber('duration_minutes', input.durationMinutes),
		...optional('location', input.location),
		...optional('description', input.description),
		...conductorProps(input.conductorRefs),
		...optionalNumber('capacity', input.capacity)
	];
	return postCreate(cfg, 'event', parentIds, props, fetchImpl);
}

// (*MVOX:Josquin*)
