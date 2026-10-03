// @vitest-environment happy-dom

import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveAttendanceRate, deriveAllMemberRates } from './attendanceSummary';
import type { EventAttendance, MyAttendance } from './attendanceData';

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
		const records = [mine('e1', 'present'), mine('e2', 'late'), mine('e3', 'absent')];
		expect(deriveAttendanceRate(records, 5)).toEqual({ attended: 2, total: 5 });
	});
});

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

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('params', {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		agenda_view_toggle_label: () => 'Agenda view',
		agenda_view_list: () => 'List',
		agenda_view_month: () => 'Month',
		agenda_filter_empty: () => 'No events match this filter.',
		agenda_row_link_label: (p: { event: string }) => `View details for ${p.event}`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		agenda_recent: () => 'Recent',
		agenda_take_attendance: () => 'Take attendance',
		agenda_take_attendance_label: (p: { event: string }) => `Take attendance for ${p.event}`,
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_toggle_aria_label: (p: { name: string; status: string }) => `Mark ${p.name} as ${p.status}`,
		attendance_group_label: (p: { name: string }) => `Attendance for ${p.name}`,
		attendance_badge_aria_label: (p: { status: string }) => `Attendance: ${p.status}`,
		attendance_rsvp_none: () => 'No answer',
		attendance_rsvp_aria_label: (p: { name: string; rsvp: string }) => `RSVP for ${p.name}: ${p.rsvp}`,
		attendance_load_error: () => "Couldn't load attendance.",
		attendance_loading: () => 'Loading attendance…',
		attendance_ready: (p: { count: number }) => `Attendance loaded, ${p.count} members`,
		attendance_save_failed: () => 'Could not save attendance.',
		attendance_tally: (p: { present: number; absent: number; late: number }) =>
			`${p.present} present · ${p.absent} absent · ${p.late} late`,
		attendance_close: () => 'Close',
		attendance_season_rate: (p: { attended: number; total: number }) =>
			`Attended ${p.attended} of ${p.total} events`,
		attendance_member_rate: (p: { attended: number; total: number }) =>
			`${p.attended} of ${p.total}`,
		attendance_season_summary: () => 'This season',
		attendance_all_members: () => 'All members',
		attendance_season_loading: () => 'Loading…',
		attendance_season_load_error: () => "Couldn't load member rates."
	})
);

const {
	loadFullAgendaMock,
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
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
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
vi.mock('$lib/roster/memberLifecycle', () => ({
	loadInactiveRoster: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	loadActiveAndArchivedRosters: vi.fn(async (...args: unknown[]) => ({
		active: await loadRosterMock(...args),
		inactive: { items: [], total: 0, truncated: false }
	}))
}));
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

vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from '../../routes/+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId }] });
	completionGateStore.set('complete');
}

function setMemberFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
		upcoming: [agendaItem('up-1', '2027-06-17T16:00:00.000Z')],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z'),
			agendaItem('past-3', '2026-05-27T16:00:00.000Z'),
			agendaItem('past-4', '2026-05-20T16:00:00.000Z')
		],
		seasonId: 's1',
		seasonConductors: ['someone-else'], seasonOwners: [], seasonEditors: [], seasons: [] // person-p holds no conductor seat
	}));
	findMyMemberIdMock.mockResolvedValue('m-me');
	listMyAttendanceMock.mockResolvedValue(toListRead([
		{ attendanceId: 'a1', eventId: 'past-1', status: 'present' },
		{ attendanceId: 'a2', eventId: 'past-2', status: 'absent' },
		{ attendanceId: 'a3', eventId: 'past-3', status: 'late' }
	]));
	setAuthedWithOneCollective('person-p');
}

function setConductorFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z')
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: ['person-p'], seasons: []
	}));
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyAttendanceMock.mockResolvedValue(toListRead([
		{ attendanceId: 'a1', eventId: 'past-1', status: 'present' },
		{ attendanceId: 'a2', eventId: 'past-2', status: 'late' }
	]));
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
	]));
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

listMyRsvpsMock.mockResolvedValue(toListRead([]));

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
	resetAppState();
	resetGate();
});

describe('+page — attendance badges on Recent rows (#85 TA.4)', () => {
	it('each past row carries a badge in the matching state: present / absent / late / not-recorded', async () => {
		setMemberFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-badge-past-1"]')).not.toBeNull();
		});
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);

		const expected: Array<[string, string, string]> = [
			['past-1', 'present', 'Present'],
			['past-2', 'absent', 'Absent'],
			['past-3', 'late', 'Late'],
			['past-4', 'not-recorded', 'Not recorded']
		];
		for (const [eventId, status, label] of expected) {
			const badge = container.querySelector(`[data-testid="attendance-badge-${eventId}"]`)!;
			expect(badge).not.toBeNull();
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
		listMyAttendanceMock.mockResolvedValue(toListRead([])); // no records at all

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="season-summary"]')).not.toBeNull();
		});

		const summary = container.querySelector('[data-testid="season-summary"]')!;
		expect(container.querySelector('[data-testid="agenda-recent"]')!.contains(summary)).toBe(true);
		const firstRow = container.querySelector('[data-testid="agenda-recent-row-past-1"]')!;
		expect(
			// eslint-disable-next-line no-bitwise
			summary.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(summary.textContent).toContain('Attended 0 of 4 events');
	});

	it("a member sees her OWN rate — late counts as attended: 'Attended 2 of 4 events'", async () => {
		setMemberFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-season-rate"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="my-season-rate"]')!.textContent).toContain(
			'Attended 2 of 4 events'
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
		const m1 = container.querySelector('[data-testid="member-rate-m1"]')!;
		expect(m1.textContent).toContain('Alice Alto');
		expect(m1.textContent).toContain('2 of 2');
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
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			upcoming: [],
			recent: [
				agendaItem('current-1', '2027-06-10T16:00:00.000Z'),
				agendaItem('current-2', '2027-06-03T16:00:00.000Z')
			],
			seasonId: 's2',
			seasonConductors: [], seasonOwners: [], seasonEditors: [], seasons: []
		}));
		findMyMemberIdMock.mockResolvedValue('m-me');
		listMyAttendanceMock.mockResolvedValue(toListRead([
			{ attendanceId: 'a1', eventId: 'current-1', status: 'present' },
			{ attendanceId: 'a2', eventId: 'current-2', status: 'late' },
			{ attendanceId: 'a3', eventId: 'old-1', status: 'present' },
			{ attendanceId: 'a4', eventId: 'old-2', status: 'present' },
			{ attendanceId: 'a5', eventId: 'old-3', status: 'late' }
		]));
		setAuthedWithOneCollective('person-p');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-season-rate"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="my-season-rate"]')!.textContent).toContain(
			'Attended 2 of 2 events'
		);
	});
});

describe('+page — season rate denominator covers ALL event types (#194/#202 review F1)', () => {
	it('a mixed-type season counts every past event, and the sentence is event-neutral', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			upcoming: [],
			recent: [
				{ ...agendaItem('past-r1', '2026-06-10T16:00:00.000Z'), eventType: 'rehearsal' },
				{ ...agendaItem('past-r2', '2026-06-03T16:00:00.000Z'), eventType: 'proov' },
				{ ...agendaItem('past-c1', '2026-05-27T16:00:00.000Z'), eventType: 'concert' },
				{ ...agendaItem('past-m1', '2026-05-20T16:00:00.000Z'), eventType: 'meeting' }
			],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: [], seasons: []
		}));
		findMyMemberIdMock.mockResolvedValue('m-me');
		listMyAttendanceMock.mockResolvedValue(toListRead([
			{ attendanceId: 'a1', eventId: 'past-r1', status: 'present' },
			{ attendanceId: 'a2', eventId: 'past-r2', status: 'late' },
			{ attendanceId: 'a3', eventId: 'past-c1', status: 'present' },
			{ attendanceId: 'a4', eventId: 'past-m1', status: 'absent' }
		]));
		setAuthedWithOneCollective('person-p');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-season-rate"]')).not.toBeNull();
		});
		const rate = container.querySelector('[data-testid="my-season-rate"]')!;
		expect(rate.textContent).toContain('Attended 3 of 4 events');
		expect(rate.textContent).not.toContain('rehearsals');
	});
});

describe('+page — F2 fix: season roster rates error state', () => {
	it('a failed roster-rate load renders an error marker, not an empty member list', async () => {
		setConductorFixture();
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
		expect(container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});
});

describe('+page — F4 fix: summary and badges are gated on membership', () => {
	it('a non-member does NOT see the season summary or attendance badges', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			upcoming: [],
			recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z')],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: [], seasons: []
		}));
		findMyMemberIdMock.mockResolvedValue(null);
		listMyAttendanceMock.mockResolvedValue(toListRead([]));
		setAuthedWithOneCollective('person-p');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="season-summary"]')).toBeNull();
		expect(container.querySelector('[data-testid="attendance-badge-past-1"]')).toBeNull();
	});

	it('while membership is still loading, badges and summary are hidden (fail-safe)', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({
			upcoming: [],
			recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z')],
			seasonId: 's1',
			seasonConductors: [], seasonOwners: [], seasonEditors: [], seasons: []
		}));
		findMyMemberIdMock.mockReturnValue(new Promise(() => {}));
		listMyAttendanceMock.mockResolvedValue(toListRead([]));
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
