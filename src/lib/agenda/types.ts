// The agenda output contract — the shape Byrd's UI renders against. One flat,
// upcoming, chronologically-sorted list of rehearsal-events for the selected
// collective. Field names match the T5 design spec.
export type AgendaItem = {
	/** Entu event entity id. */
	id: string;
	/** Event name (empty string if unnamed). */
	name: string;
	/** ISO datetime the event starts. */
	startDatetime: string;
	/** Duration in minutes — event value, else inherited from its series, else 0. */
	durationMinutes: number;
	/** Location — event value, else inherited from its series, else empty string. */
	location: string;
	/** Person entity ids of this event's own conductors (empty = inherit season's). */
	conductors: string[];
	/** #91 — `_owner` refs VISIBLE to the reading caller. Entu's rights props are
	 *  private-bucket, so a caller without a grant sees none at all; empty
	 *  therefore means "no rights here", which is exactly what the programme
	 *  management controls gate on — no per-event rights probe needed. */
	owners: string[];
	/** `_editor` refs visible to the reading caller; same bucket caveat. */
	editors: string[];
};

// (*MVOX:Josquin*)
