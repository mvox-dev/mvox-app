// src/lib/events/eventFieldEdit.ts
//
// #104 TE.4 (GREEN) — the write half of inline event editing on the detail
// page. One function, one field, one immediate round-trip: per-tap writes,
// same posture as attendanceData/repertoireActions — there is no "save all"
// payload anywhere in this module's API.
//
// The ATOMIC overwrite choreography (#264 PO ruling, branch (i): GET existing
// value-id(s) → ONE POST pairing the old id with the new value, Entu's native
// overwrite) lives in ONE place: $lib/entu/replaceProperty — see that module's
// header for the full rationale. This module only decides WHICH wire slot
// each field is written under.
//
// Non-2xx anywhere throws (fail loud, no silent success) — the caller
// (+page.svelte) is what turns that into an optimistic-revert + inline error.
import { replaceEntityProperty, type EntuWireValue } from '$lib/entu/replaceProperty';

export type EditableEventField =
	| 'name'
	| 'start_datetime'
	| 'duration_minutes'
	| 'location'
	| 'description'
	| 'event_type';

/** Which wire value key each editable field is written under. */
function wireProp(field: EditableEventField, value: string | number): EntuWireValue {
	switch (field) {
		case 'start_datetime':
			return { type: field, datetime: value };
		case 'duration_minutes':
			return { type: field, number: value };
		default:
			return { type: field, string: value };
	}
}

export async function updateEventField(
	cfg: { db: string; token: string },
	eventId: string,
	field: EditableEventField,
	value: string | number,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(cfg, eventId, wireProp(field, value), fetchImpl, 'updateEventField');
}

// (*MVOX:Josquin*)
