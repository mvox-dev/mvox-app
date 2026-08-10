// Entu raw shapes + domain types for the season/rehearsal reads. Harvested from
// the polyphony prototype, slimmed to the slice-1 agenda read path (RSVP tally,
// conductor, series-admin shapes dropped — those are later slices).

export interface SeasonRaw {
	_id: string;
	name?: Array<{ string: string }>;
	start_date?: Array<{ date: string }>;
	end_date?: Array<{ date: string }>;
	conductor?: Array<{ reference: string }>;
}

export interface Season {
	id: string;
	name: string;
	startDate: string;
	endDate: string;
	/** Person entity ids of this season's conductors (empty if none set). */
	conductors: string[];
}

export interface SeriesRaw {
	_id: string;
	duration_minutes?: Array<{ number: number }>;
	default_location?: Array<{ string: string }>;
}

export interface RehearsalRaw {
	_id: string;
	name?: Array<{ string: string }>;
	start_datetime?: Array<{ datetime: string }>;
	duration_minutes?: Array<{ number: number }>;
	location?: Array<{ string: string }>;
	// `_parent` denormalizes each parent's `entity_type` (verified in the member-search
	// contract) — used to find the event's `event_series` parent without an org arg.
	_parent?: Array<{ reference: string; entity_type?: string }>;
	conductor?: Array<{ reference: string }>;
}

// (*MVOX:Josquin*)
