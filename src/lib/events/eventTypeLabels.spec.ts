// #194/#202 RED — ONE shared event-type label map.
//
// The map already exists, but INSIDE src/routes/event/[id]/+page.svelte (#101
// review F3). #202 puts a type label on every agenda row too, and a second
// inline copy is exactly the drift class the WorkRow/AttendanceBadge cleanups
// already paid for. Contract pinned here (GREEN extracts the detail page's map
// VERBATIM into this module and makes the page import it):
//
//   $lib/events/eventTypeLabels exports
//     - EVENT_TYPE_LABEL: Record<string, () => string> — the eight v4E schema
//       types (schema.ts `event_type` note: rehearsal | concert | festival |
//       retreat | workshop | meeting | social | other), each mapped to its
//       paraglide message fn
//     - eventTypeLabel(eventType: string): string — localized label for a known
//       type; the RAW value for an unknown one (`event_type` is free text —
//       'proov' must surface as 'proov', visibly wrong beats invisibly blank);
//       '' for ''.
import { describe, expect, it, vi } from 'vitest';

// Enumerated message mock — each key returns a DISTINCT marker so the test can
// prove the label went through paraglide (not a hardcoded English string).
vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		// #266 — the two new types get their own stubbed markers: an unstubbed
		// key resolving oddly (undefined → raw-key fallback) would silently pass
		// the wrong path.
		event_type_service: () => '[msg:service]',
		event_type_festival: () => '[msg:festival]',
		event_type_retreat: () => '[msg:retreat]',
		event_type_trip: () => '[msg:trip]',
		event_type_workshop: () => '[msg:workshop]',
		event_type_meeting: () => '[msg:meeting]',
		event_type_social: () => '[msg:social]',
		event_type_other: () => '[msg:other]'
	}
}));

import { EVENT_TYPE_LABEL, eventTypeLabel } from './eventTypeLabels';

// #266 — trip and service join the vocabulary: TEN types, in the NEW pinned
// order — service beside concert (performance family), trip beside retreat
// (travel family). Hand-typed on purpose: this list is the independent guard
// on the production map, never derived from it.
const SCHEMA_TYPES = [
	'rehearsal',
	'concert',
	'service',
	'festival',
	'retreat',
	'trip',
	'workshop',
	'meeting',
	'social',
	'other'
] as const;

describe('eventTypeLabels — shared event-type label map (#194/#202, #266)', () => {
	it('EVENT_TYPE_LABEL covers exactly the ten canonical types, IN THE PINNED ORDER — insertion order is CANONICAL_EVENT_TYPES and thus render order everywhere (#266)', () => {
		// Exact order, not .sort(): CANONICAL_EVENT_TYPES = Object.keys of this
		// map, and every picker/chip row renders in that order.
		expect(Object.keys(EVENT_TYPE_LABEL)).toEqual([...SCHEMA_TYPES]);
	});

	it('every known type resolves through its paraglide message', () => {
		for (const t of SCHEMA_TYPES) {
			expect(eventTypeLabel(t)).toBe(`[msg:${t}]`);
		}
	});

	it("an unknown free-text type falls back to its RAW value — 'proov' stays 'proov'", () => {
		expect(eventTypeLabel('proov')).toBe('proov');
	});

	it("'' stays '' (an event with no type gets no invented label)", () => {
		expect(eventTypeLabel('')).toBe('');
	});

	// Review F4 — the fallback must survive Object.prototype keys. `event_type`
	// is free text on the wire, so 'toString'/'constructor'/'valueOf' are
	// reachable values; an unguarded `map[key]` resolved the PROTOTYPE member
	// and returned '[object Object]' (or a non-string object) out of a
	// `: string` function.
	it.each(['toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf'])(
		"the Object.prototype key '%s' falls back to its RAW value, still a string",
		(key) => {
			const label = eventTypeLabel(key);
			expect(typeof label).toBe('string');
			expect(label).toBe(key);
		}
	);
});

// (*MVOX:Palestrina* — #194/#202 RED)
