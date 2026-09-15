// #356 RED — canMarkAttendance: THE one marking gate for attendance, on both
// surfaces (event view + agenda recent rows).
//
// Contract (issue #356, Gama): may this person WRITE attendance on this event?
//   canMarkAttendance(event, personId) === (manageRightsFrom(event.owners,
//   event.editors, personId) === 'editor')
// — owner-OR-editor on the EVENT, ownership subsuming editing (the same
// manageRightsFrom rule everything else in the app gates management on).
//
// The conductor SEAT deliberately does NOT count: a seat-only conductor holds
// no write rights on the event, and #356 retires the seat as a marking gate
// (it stays a display/expand signal — #365 under epic #362 owns its future).
//
// Lives beside manageRightsFrom in repertoireActions.ts: exported, pure, no IO.
import { describe, expect, it } from 'vitest';
import { canMarkAttendance } from './repertoireActions';

// Inline fixtures — full shape, assigned to consts so the structural contract
// (an event carrying owners/editors/conductors id lists, the agenda's own
// AgendaItem field names) is visible in one place.
const PERSON = 'person-p';

const ownedEvent = {
	owners: [PERSON, 'person-other'],
	editors: [] as string[],
	conductors: [] as string[]
};

const editedEvent = {
	owners: ['person-other'],
	editors: [PERSON],
	conductors: [] as string[]
};

// The seat WITHOUT rights — the exact case #356 exists for: before this slice
// the seat showed the button; now it must answer false.
const seatOnlyEvent = {
	owners: ['person-other'],
	editors: [] as string[],
	conductors: [PERSON]
};

const strangerEvent = {
	owners: ['person-other'],
	editors: ['person-other-2'],
	conductors: ['person-other-3']
};

describe('canMarkAttendance (#356) — owner-or-editor on the event, and NOTHING else', () => {
	it('an OWNER of the event may mark attendance (ownership subsumes editing)', () => {
		expect(canMarkAttendance(ownedEvent, PERSON)).toBe(true);
	});

	it('an EDITOR of the event may mark attendance', () => {
		expect(canMarkAttendance(editedEvent, PERSON)).toBe(true);
	});

	it('the conductor SEAT alone may NOT — seat-only answers false (the seat dies as a gate)', () => {
		expect(canMarkAttendance(seatOnlyEvent, PERSON)).toBe(false);
	});

	it('neither rights nor seat answers false', () => {
		expect(canMarkAttendance(strangerEvent, PERSON)).toBe(false);
	});
});

// (*MVOX:Tallis* — #356 RED)
