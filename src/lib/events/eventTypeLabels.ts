// #194/#202 — ONE shared event-type label map.
//
// Extracted VERBATIM from the event detail page (#101 review F3), which held
// the only copy. #202 puts a type label on every agenda row too, and a second
// inline copy is exactly the drift class the WorkRow/AttendanceBadge cleanups
// already paid for.
//
// The eight known types come from the v4E schema's `event_type` note
// (schema.ts: rehearsal | concert | festival | retreat | workshop | meeting |
// social | other). `event_type` itself is FREE TEXT on the wire (Entu's
// `mandatory`/enum hints are UI-only, not enforced) — an UNKNOWN value falls
// back to its raw string: visibly wrong beats invisibly blank.
import { m } from '$lib/paraglide/messages.js';

export const EVENT_TYPE_LABEL: Record<string, () => string> = {
	rehearsal: m.event_type_rehearsal,
	concert: m.event_type_concert,
	festival: m.event_type_festival,
	retreat: m.event_type_retreat,
	workshop: m.event_type_workshop,
	meeting: m.event_type_meeting,
	social: m.event_type_social,
	other: m.event_type_other
};

/** Localized label for a known type; the RAW value for an unknown one
 *  ('proov' stays 'proov'); '' for '' (no invented label for a type-less
 *  event).
 *
 *  #194/#202 review F4 — the lookup is OWN-PROPERTY guarded. A bare
 *  `EVENT_TYPE_LABEL[eventType]` on an object literal ALSO resolves
 *  Object.prototype members, so a free-text `event_type` of 'toString'
 *  rendered '[object Object]' and 'constructor'/'valueOf' returned a
 *  non-string out of a `: string` function. `event_type` is free text on the
 *  wire — those are reachable values, not hypotheticals. */
export function eventTypeLabel(eventType: string): string {
	const label = Object.hasOwn(EVENT_TYPE_LABEL, eventType)
		? EVENT_TYPE_LABEL[eventType]
		: undefined;
	return label?.() ?? eventType;
}

// (*MVOX:Palestrina* — #194/#202 GREEN)
