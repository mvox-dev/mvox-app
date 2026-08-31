// Entu raw shapes + domain types for the season/rehearsal reads. Harvested from
// the polyphony prototype, slimmed to the slice-1 agenda read path (RSVP tally,
// conductor, series-admin shapes dropped — those are later slices).

// #91 review fix (F1) — `_owner`/`_editor` ride along on the ordinary list
// reads. They live in Entu's PRIVATE bucket: a caller with no rights grant
// reads the entity (domain `_sharing`) but simply does not see these props at
// all, so ABSENCE is the clean "not an editor" signal. That is exactly what the
// per-entity rights probe was asking for one GET at a time — asking for it in a
// query the page already makes costs nothing extra.
export interface RightsRefs {
	_owner?: Array<{ reference?: string }>;
	_editor?: Array<{ reference?: string }>;
}

export interface SeasonRaw extends RightsRefs {
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
	/** `_owner` refs VISIBLE to the reading caller. Empty both when there are
	 *  none and when the caller cannot see the private bucket — the two are
	 *  indistinguishable on the wire, and mean the same thing for rights. */
	owners: string[];
	/** `_editor` refs visible to the reading caller; same bucket caveat. */
	editors: string[];
}

export interface SeriesRaw {
	_id: string;
	// #101 review fix (F2) — an event with no `name` of its own inherits the
	// series' name, exactly as `loadEventDetail` already does. Without it the
	// agenda and the detail page disagreed about the same event's name, and the
	// agenda row's link had no accessible name to announce.
	name?: Array<{ string: string }>;
	duration_minutes?: Array<{ number: number }>;
	default_location?: Array<{ string: string }>;
}

export interface EventRaw extends RightsRefs {
	_id: string;
	name?: Array<{ string: string }>;
	start_datetime?: Array<{ datetime: string }>;
	duration_minutes?: Array<{ number: number }>;
	location?: Array<{ string: string }>;
	// #194/#202 — free-text on the wire ('rehearsal', 'proov', 'concert', …). Read
	// verbatim, NEVER inherited from the parent series (unlike duration/location):
	// the agenda labels what the event itself claims to be.
	event_type?: Array<{ string: string }>;
	// `_parent` denormalizes each parent's `entity_type` (verified in the member-search
	// contract) — used to find the event's `event_series` parent without an org arg.
	_parent?: Array<{ reference: string; entity_type?: string }>;
	conductor?: Array<{ reference: string }>;
}

// (*MVOX:Josquin*)
