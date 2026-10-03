// Shared event-type labels: known type → localized label, unknown free text → raw value.
import { describe, expect, it, vi } from 'vitest';

// Each key returns a distinct marker, proving the label went through paraglide.
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]',
		event_type_service: () => '[msg:service]',
		event_type_festival: () => '[msg:festival]',
		event_type_retreat: () => '[msg:retreat]',
		event_type_trip: () => '[msg:trip]',
		event_type_workshop: () => '[msg:workshop]',
		event_type_meeting: () => '[msg:meeting]',
		event_type_social: () => '[msg:social]',
		event_type_other: () => '[msg:other]'
	})
);

import { EVENT_TYPE_LABEL, eventTypeLabel } from './eventTypeLabels';

// Hand-typed on purpose: the independent guard on the production map, never derived from it.
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
		// Exact order, not .sort(): every picker and chip row renders in this order.
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

	// event_type is free text: an unguarded map[key] would return a prototype member.
	it.each(['toString', 'valueOf', 'constructor', 'hasOwnProperty', 'isPrototypeOf'])(
		"the Object.prototype key '%s' falls back to its RAW value, still a string",
		(key) => {
			const label = eventTypeLabel(key);
			expect(typeof label).toBe('string');
			expect(label).toBe(key);
		}
	);
});

// (*MVOX:Palestrina*)
