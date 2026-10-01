// Season, series and event shapes for the agenda read path.
import type { EventWire, SeasonWire, SeriesWire } from '$lib/entu/wireTypes';

export type SeasonRaw = SeasonWire;

export interface Season {
	id: string;
	name: string;
	startDate: string;
	endDate: string;
	conductors: string[];
	/** `_owner` refs visible to the caller; empty also when the private bucket is hidden. */
	owners: string[];
	editors: string[];
}

export type SeriesRaw = Pick<SeriesWire, '_id' | 'name' | 'duration_minutes' | 'default_location'>;

export type EventRaw = Pick<
	EventWire,
	| '_id'
	| 'event_name'
	| 'start_datetime'
	| 'duration_minutes'
	| 'location'
	| 'event_type'
	| '_parent'
	| 'conductor'
	| '_owner'
	| '_editor'
>;
