// @vitest-environment happy-dom
//
// #85 TA.4 RED — "my attendance" display + season summary.
//
// Two layers under test:
//
//   1. PURE derivations (./attendanceSummary — new module):
//      - deriveAttendanceRate(attendances, totalEvents) → { attended, total }
//        for the singer's own season line. `late` COUNTS as attended — she
//        showed up; the rate answers "was she there", not "was she punctual".
//        `absent` does not count. A past event with NO record does not count
//        (never defaulted to attended).
//      - deriveAllMemberRates(allAttendances, members, totalEvents) — the
//        conductor's full-roster rates: one entry per ROSTER member (roster
//        order preserved), zero-filled for members with no records at all.
//
//   2. PAGE composition (routes/+page.svelte):
//      - every RECENT (past) row carries an attendance badge with one of four
//        states: present / absent / late / not-recorded (a past event the
//        conductor never marked). The state rides on `data-status` — the
//        green/red/amber/grey dot is CSS keyed off that attribute.
//      - the season summary is ALWAYS visible at the top of the Recent
//        section — zero attendance data renders "Attended 0 of N", it never
//        hides the block.
//      - a member sees her OWN rate ("Attended 12 of 15 rehearsals").
//      - a CONDUCTOR can expand the summary into the full-roster per-member
//        rates; a non-conductor has no expand affordance at all.

import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveAttendanceRate, deriveAllMemberRates } from './attendanceSummary';
import type { EventAttendance, MyAttendance } from './attendanceData';

// ── 1. deriveAttendanceRate — the singer's own season line ────────────────────

function mine(eventId: string, status: MyAttendance['status']): MyAttendance {
	return { attendanceId: `att-${eventId}`, eventId, status };
}

describe('deriveAttendanceRate', () => {
	it('zero events → { attended: 0, total: 0 } (no divide-by-zero, no NaN smuggled out)', () => {
		expect(deriveAttendanceRate([], 0)).toEqual({ attended: 0, total: 0 });
	});

	it('zero attendance records over a real season → { attended: 0, total: N }', () => {
		expect(deriveAttendanceRate([], 15)).toEqual({ attended: 0, total: 15 });
	});

	it('all present → attended equals total', () => {
		const records = [mine('e1', 'present'), mine('e2', 'present'), mine('e3', 'present')];
		expect(deriveAttendanceRate(records, 3)).toEqual({ attended: 3, total: 3 });
	});

	it('all absent → { attended: 0, total: N } — absent records never count as attended', () => {
		const records = [mine('e1', 'absent'), mine('e2', 'absent'), mine('e3', 'absent')];
		expect(deriveAttendanceRate(records, 3)).toEqual({ attended: 0, total: 3 });
	});

	it('late COUNTS as attended (she was there), absent and not-recorded do not', () => {
		// 5 events this season: present, late, absent, and two never recorded.
		const records = [mine('e1', 'present'), mine('e2', 'late'), mine('e3', 'absent')];
		expect(deriveAttendanceRate(records, 5)).toEqual({ attended: 2, total: 5 });
	});
});

// ── 2. deriveAllMemberRates — the conductor's full-roster view ────────────────

function att(eventId: string, memberId: string, status: EventAttendance['status']): EventAttendance {
	return { attendanceId: `att-${eventId}-${memberId}`, memberId, status };
}

const roster = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' },
	{ memberId: 'm3', personId: 'pp-3', name: 'Carla Cantus', email: 'carla@example.com' }
];

describe('deriveAllMemberRates', () => {
	it('returns one entry per ROSTER member, in roster order — including members with zero records', () => {
		// Flattened attendance across the season's past events: m1 was at both,
		// m2 was marked absent once, m3 was never recorded anywhere.
		const all = [
			att('e1', 'm1', 'present'),
			att('e2', 'm1', 'late'),
			att('e1', 'm2', 'absent')
		];
		expect(deriveAllMemberRates(all, roster, 2)).toEqual([
			{ memberId: 'm1', name: 'Alice Alto', attended: 2, total: 2 },
			{ memberId: 'm2', name: 'Berta Bass', attended: 0, total: 2 },
			{ memberId: 'm3', name: 'Carla Cantus', attended: 0, total: 2 }
		]);
	});

	it('a record for someone NOT on the roster is ignored — no phantom row', () => {
		const all = [att('e1', 'm-ghost', 'present')];
		const rates = deriveAllMemberRates(all, roster, 1);
		expect(rates.map((r) => r.memberId)).toEqual(['m1', 'm2', 'm3']);
	});

	it('empty roster → [] regardless of records', () => {
		expect(deriveAllMemberRates([att('e1', 'm1', 'present')], [], 3)).toEqual([]);
	});

	it('zero events → every member at { attended: 0, total: 0 }', () => {
		expect(deriveAllMemberRates([], roster, 0)).toEqual([
			{ memberId: 'm1', name: 'Alice Alto', attended: 0, total: 0 },
			{ memberId: 'm2', name: 'Berta Bass', attended: 0, total: 0 },
			{ memberId: 'm3', name: 'Carla Cantus', attended: 0, total: 0 }
		]);
	});
});

// ── 3. Page composition — badges + season summary ─────────────────────────────

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		// #101 TE.1 -- every agenda row now carries an event-detail link.
		agenda_row_link_label: (p: { event: string }) => `View details for ${p.event}`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		agenda_recent: () => 'Recent',
		agenda_take_attendance: () => 'Take attendance',
		agenda_take_attendance_label: (p: { event: string }) => `Take attendance for ${p.event}`,
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		// #85 — the fourth badge state: a past event with no record for me.
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_toggle_aria_label: (p: { name: string; status: string }) => `Mark ${p.name} as ${p.status}`,
		attendance_badge_aria_label: (p: { status: string }) => `Attendance: ${p.status}`,
		attendance_rsvp_none: () => 'No answer',
		attendance_rsvp_aria_label: (p: { name: string; rsvp: string }) => `RSVP for ${p.name}: ${p.rsvp}`,
		attendance_load_error: () => "Couldn't load attendance.",
		// #113 review F4 — the panel's loading state now carries an sr-only
		// role="status" saying so (focus lands in the panel while it loads).
		attendance_loading: () => 'Loading attendance…',
		attendance_ready: (p: { count: number }) => `Attendance loaded, ${p.count} members`,
		attendance_save_failed: () => 'Could not save attendance.',
		attendance_tally: (p: { present: number; absent: number; late: number }) =>
			`${p.present} present · ${p.absent} absent · ${p.late} late`,
		attendance_close: () => 'Close',
		// #85 — season summary strings.
		attendance_season_rate: (p: { attended: number; total: number }) =>
			`Attended ${p.attended} of ${p.total} rehearsals`,
		attendance_member_rate: (p: { attended: number; total: number }) =>
			`${p.attended} of ${p.total}`,
		attendance_season_summary: () => 'This season',
		attendance_all_members: () => 'All members',
		attendance_season_loading: () => 'Loading…',
		attendance_season_load_error: () => "Couldn't load member rates."
	}
}));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadRosterMock,
	listAttendanceMock,
	listMyAttendanceMock,
	listAllRsvpsForEventMock,
	createAttendanceMock,
	updateAttendanceStatusMock,
	deleteAttendanceMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	createAttendanceMock: vi.fn(),
	updateAttendanceStatusMock: vi.fn(),
	deleteAttendanceMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// #91 TR.3 — +page.svelte now imports the repertoire WRITE layer (and the
// library reads that feed its pickers), which reaches entuFetch ->
// $lib/entu-config -> $env/dynamic/public: unavailable outside a SvelteKit
// request context under happy-dom. Same one-line fix the library/profile specs
// already use; the real modules keep running, only the base url is stubbed.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
// ...and the page resolves management rights per season/event on every load.
// Only that ONE call is stubbed (the pure helpers and the write functions stay
// real): left alone it issues a live request per agenda event, which is both a
// network call from a unit test and a source of teardown AbortErrors. The
// management surface itself is covered end-to-end in
// page.repertoire-manage-wiring.spec.ts.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: (rsvps: Array<{ rsvpId: string; eventId: string; status: string }>) => {
		const map: Record<string, { rsvpId: string; status: string }> = {};
		for (const r of rsvps) map[r.eventId] = { rsvpId: r.rsvpId, status: r.status };
		return map;
	},
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: loadRosterMock
}));
// NOTE: ./attendanceSummary is deliberately NOT mocked — the page must run the
// REAL derive functions; these route tests cover the wiring end to end.
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: listAttendanceMock,
	listMyAttendance: listMyAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	createAttendance: createAttendanceMock,
	updateAttendanceStatus: updateAttendanceStatusMock,
	deleteAttendance: deleteAttendanceMock,
	attendanceByMemberId: (
		records: Array<{ attendanceId: string; memberId: string; status: string }>
	) => {
		const map: Record<string, { attendanceId: string; status: string }> = {};
		for (const r of records) map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
		return map;
	}
}));

// #90 TR.2 — the page now resolves each row's Works element and signs PDFs on
// click. Mocked here for the same reason agendaData/rsvpData are: both modules
// pull in $lib/entu/request -> $env/dynamic/public, which is unavailable
// outside a SvelteKit request context under happy-dom (and neither belongs in
// these specs' subject).
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from '../../routes/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetConductor } from '$lib/attendance/conductorStore';

function agendaItem(id: string, startDatetime: string, conductors: string[] = []) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors,
		owners: [],
		editors: []
	};
}

function setAuthedWithOneCollective(personId = 'person-p') {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: personId },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	completionGateStore.set('complete');
}

/**
 * A MEMBER (not conductor) with four past rehearsals this season and one
 * upcoming. Her own records: present @ past-1, absent @ past-2, late @ past-3;
 * past-4 was never recorded.
 */
function setMemberFixture() {
	loadFullAgendaMock.mockResolvedValue({
		upcoming: [agendaItem('up-1', '2027-06-17T16:00:00.000Z')],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z'),
			agendaItem('past-3', '2026-05-27T16:00:00.000Z'),
			agendaItem('past-4', '2026-05-20T16:00:00.000Z')
		],
		seasonId: 's1',
		seasonConductors: ['someone-else'], seasonOwners: [], seasonEditors: [] // person-p holds no conductor seat
	});
	findMyMemberIdMock.mockResolvedValue('m-me');
	listMyAttendanceMock.mockResolvedValue([
		{ attendanceId: 'a1', eventId: 'past-1', status: 'present' },
		{ attendanceId: 'a2', eventId: 'past-2', status: 'absent' },
		{ attendanceId: 'a3', eventId: 'past-3', status: 'late' }
	]);
	setAuthedWithOneCollective('person-p');
}

/**
 * A CONDUCTOR (who is also member m1) with two past rehearsals. Full-event
 * attendance: past-1 → m1 present + m2 absent; past-2 → m1 late (m2 unrecorded).
 * Expected rates: m1 attended 2 of 2, m2 attended 0 of 2.
 */
function setConductorFixture() {
	loadFullAgendaMock.mockResolvedValue({
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z')
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: []
	});
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyAttendanceMock.mockResolvedValue([
		{ attendanceId: 'a1', eventId: 'past-1', status: 'present' },
		{ attendanceId: 'a2', eventId: 'past-2', status: 'late' }
	]);
	loadRosterMock.mockResolvedValue([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
	]);
	const attendanceByEvent: Record<string, EventAttendance[]> = {
		'past-1': [
			{ attendanceId: 'x1', memberId: 'm1', status: 'present' },
			{ attendanceId: 'x2', memberId: 'm2', status: 'absent' }
		],
		'past-2': [{ attendanceId: 'x3', memberId: 'm1', status: 'late' }]
	};
	listAttendanceMock.mockImplementation((_cfg: unknown, eventId: string) =>
		Promise.resolve(attendanceByEvent[eventId] ?? [])
	);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

// Safe defaults so unrelated resolve calls don't hang.
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listMyAttendanceMock.mockReset().mockResolvedValue([]);
	listAllRsvpsForEventMock.mockReset();
	createAttendanceMock.mockReset();
	updateAttendanceStatusMock.mockReset();
	deleteAttendanceMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
	resetConductor();
});

describe('+page — attendance badges on Recent rows (#85 TA.4)', () => {
	it('each past row carries a badge in the matching state: present / absent / late / not-recorded', async () => {
		setMemberFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-badge-past-1"]')).not.toBeNull();
		});

		const expected: Array<[string, string, string]> = [
			['past-1', 'present', 'Present'],
			['past-2', 'absent', 'Absent'],
			['past-3', 'late', 'Late'],
			// past-4 has NO record — an explicit not-recorded badge, never a blank
			// and never a defaulted status.
			['past-4', 'not-recorded', 'Not recorded']
		];
		for (const [eventId, status, label] of expected) {
			const badge = container.querySelector(`[data-testid="attendance-badge-${eventId}"]`)!;
			expect(badge).not.toBeNull();
			// The state rides on data-status — the green/red/amber/grey dot is CSS
			// keyed off this attribute, so this IS the visual contract.
			expect(badge.getAttribute('data-status')).toBe(status);
			expect(badge.textContent).toContain(label);
		}
	});

	it('my own attendance is loaded via listMyAttendance with MY member id — one call, not per-event', async () => {
		setMemberFixture();
		render(Page);

		await waitFor(() => {
			expect(listMyAttendanceMock).toHaveBeenCalled();
		});
		expect(listMyAttendanceMock).toHaveBeenCalledTimes(1);
		expect(listMyAttendanceMock.mock.calls[0][1]).toBe('m-me');
	});

	it('UPCOMING rows never carry an attendance badge — attendance is a past-only fact', async () => {
		setMemberFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-row-up-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="attendance-badge-up-1"]')).toBeNull();
	});
});

describe('+page — season summary (#85 TA.4)', () => {
	it('is ALWAYS visible at the top of the Recent section — zero attendance data shows "Attended 0 of N", never hides the block', async () => {
		setMemberFixture();
		listMyAttendanceMock.mockResolvedValue([]); // no records at all

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-summary"]')).not.toBeNull();
		});

		const summary = container.querySelector('[data-testid="season-summary"]')!;
		// Inside the Recent section, ABOVE the first recent row.
		expect(container.querySelector('[data-testid="agenda-recent"]')!.contains(summary)).toBe(true);
		const firstRow = container.querySelector('[data-testid="agenda-recent-row-past-1"]')!;
		expect(
			// eslint-disable-next-line no-bitwise
			summary.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		// Not conditional on data: zero records renders the zero rate, not nothing.
		expect(summary.textContent).toContain('Attended 0 of 4 rehearsals');
	});

	it("a member sees her OWN rate — late counts as attended: 'Attended 2 of 4 rehearsals'", async () => {
		// present @ past-1 + late @ past-3 = 2 attended; absent @ past-2 and
		// unrecorded past-4 do not count. 4 past events total.
		setMemberFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-season-rate"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="my-season-rate"]')!.textContent).toContain(
			'Attended 2 of 4 rehearsals'
		);
	});
});

describe('+page — conductor full-roster rates in the expanded summary (#85 TA.4)', () => {
	it('a conductor can expand the season summary into per-member rates for the WHOLE roster', async () => {
		setConductorFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="season-summary-expand"]')!);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull();
		});
		// m1: present @ past-1 + late @ past-2 → 2 of 2 (late counts as attended).
		const m1 = container.querySelector('[data-testid="member-rate-m1"]')!;
		expect(m1.textContent).toContain('Alice Alto');
		expect(m1.textContent).toContain('2 of 2');
		// m2: absent @ past-1, unrecorded @ past-2 → 0 of 2 — she still gets a row
		// (roster-driven, zero-filled), she does not vanish for lack of records.
		const m2 = container.querySelector('[data-testid="member-rate-m2"]')!;
		expect(m2).not.toBeNull();
		expect(m2.textContent).toContain('Berta Bass');
		expect(m2.textContent).toContain('0 of 2');
	});

	it('a NON-conductor has no expand affordance and no per-member rows — the roster view is unreachable', async () => {
		setMemberFixture(); // person-p holds no conductor seat
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-summary"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="season-summary-expand"]')).toBeNull();
		expect(container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});
});

describe('+page — F1 fix: cross-season records must not inflate season rate', () => {
	it('records from a PREVIOUS season do not inflate the current season rate', async () => {
		// Setup: member with attendance records for 5 events, but only 2 of those
		// events are in the current season's recentItems. Without the F1 fix,
		// mySeasonRate would be { attended: 4, total: 2 } — "Attended 4 of 2".
		loadFullAgendaMock.mockResolvedValue({
			upcoming: [],
			recent: [
				agendaItem('current-1', '2027-06-10T16:00:00.000Z'),
				agendaItem('current-2', '2027-06-03T16:00:00.000Z')
			],
			seasonId: 's2',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		findMyMemberIdMock.mockResolvedValue('m-me');
		// 5 records: 2 for current-season events, 3 for old-season events.
		// listMyAttendance returns ALL (no season filter on the server side).
		listMyAttendanceMock.mockResolvedValue([
			{ attendanceId: 'a1', eventId: 'current-1', status: 'present' },
			{ attendanceId: 'a2', eventId: 'current-2', status: 'late' },
			{ attendanceId: 'a3', eventId: 'old-1', status: 'present' },
			{ attendanceId: 'a4', eventId: 'old-2', status: 'present' },
			{ attendanceId: 'a5', eventId: 'old-3', status: 'late' }
		]);
		setAuthedWithOneCollective('person-p');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-season-rate"]')).not.toBeNull();
		});
		// Correct: 2 attended out of 2 current-season events (both present/late
		// count). The 3 old-season records must NOT inflate the count.
		expect(container.querySelector('[data-testid="my-season-rate"]')!.textContent).toContain(
			'Attended 2 of 2 rehearsals'
		);
	});
});

describe('+page — F2 fix: season roster rates error state', () => {
	it('a failed roster-rate load renders an error marker, not an empty member list', async () => {
		setConductorFixture();
		// Make the roster load (used by the expand) fail.
		loadRosterMock.mockRejectedValue(new Error('network'));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="season-summary-expand"]')!);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-rates-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="season-rates-error"]')!.textContent).toContain(
			"Couldn't load member rates."
		);
		// No phantom member rows.
		expect(container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});
});

describe('+page — F4 fix: summary and badges are gated on membership', () => {
	it('a non-member does NOT see the season summary or attendance badges', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming: [],
			recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z')],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		// Confirmed non-member (null member id).
		findMyMemberIdMock.mockResolvedValue(null);
		listMyAttendanceMock.mockResolvedValue([]);
		setAuthedWithOneCollective('person-p');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		// The Recent section renders, but summary and badges are hidden.
		expect(container.querySelector('[data-testid="season-summary"]')).toBeNull();
		expect(container.querySelector('[data-testid="attendance-badge-past-1"]')).toBeNull();
	});

	it('while membership is still loading, badges and summary are hidden (fail-safe)', async () => {
		loadFullAgendaMock.mockResolvedValue({
			upcoming: [],
			recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z')],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: []
		});
		// Member lookup hangs forever — membership stays 'loading'.
		findMyMemberIdMock.mockReturnValue(new Promise(() => {}));
		listMyAttendanceMock.mockResolvedValue([]);
		setAuthedWithOneCollective('person-p');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="season-summary"]')).toBeNull();
		expect(container.querySelector('[data-testid="attendance-badge-past-1"]')).toBeNull();
	});
});

// (*MVOX:Tallis*)
