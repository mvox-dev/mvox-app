// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare', {
		picker_partial_members_notice: () => 'Not every member is listed here',
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
		attendance_group_label: (p: { name: string }) => `Attendance for ${p.name}`,
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_toggle_aria_label: (p: { name: string; status: string }) =>
			`Mark ${p.name} as ${p.status}`,
		attendance_rsvp_none: () => 'No answer',
		attendance_rsvp_aria_label: (p: { name: string; rsvp: string }) =>
			`RSVP for ${p.name}: ${p.rsvp}`,
		attendance_load_error: () => "Couldn't load attendance.",
		attendance_loading: () => 'Loading attendance…',
		attendance_ready: (p: { count: number }) => `Attendance loaded, ${p.count} members`,
		attendance_save_failed: () => 'Could not save attendance.',
		attendance_saved: () => 'Saved.',
		attendance_tally: (p: { present: number; absent: number; late: number }) =>
			`${p.present} present · ${p.absent} absent · ${p.late} late`,
		attendance_tally_unconfirmed: () => 'Counts include unconfirmed changes.',
		attendance_close: () => 'Close',
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_season_summary: () => 'This season',
		attendance_season_rate: (p: { attended: number; total: number }) =>
			`Attended ${p.attended} of ${p.total} events`,
		attendance_member_rate: (p: { attended: number; total: number }) =>
			`${p.attended} of ${p.total}`,
		attendance_all_members: () => 'All members'
	})
);

const {
	loadRosterMock,
	listAttendanceMock,
	listAllRsvpsForEventMock,
	createAttendanceMock,
	updateAttendanceStatusMock,
	deleteAttendanceMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	createAttendanceMock: vi.fn(),
	updateAttendanceStatusMock: vi.fn(),
	deleteAttendanceMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('records')
);
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: loadRosterMock
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: listAttendanceMock,
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
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';

function agendaItem(
	id: string,
	startDatetime: string,
	over: Partial<{ conductors: string[]; owners: string[]; editors: string[] }> = {}
) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		...over
	};
}

function setAuthedWithOneCollective(personId = 'person-p') {
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId }] });
	completionGateStore.set('complete');
}

function setRecentFixture(
	item: ReturnType<typeof agendaItem>,
	seasonConductors: string[],
	season: Partial<{ seasonOwners: string[]; seasonEditors: string[] }> = {}
) {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [item],
			seasonId: 's1',
			seasonConductors,
			seasonOwners: season.seasonOwners ?? [],
			seasonEditors: season.seasonEditors ?? []
		})
	);
	loadRosterMock.mockResolvedValue(
		toListRead([
			{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
			{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
		])
	);
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	createAttendanceMock.mockReset();
	updateAttendanceStatusMock.mockReset();
	deleteAttendanceMock.mockReset();
	resetAppState();
	resetGate();
});

const ROW = '[data-testid="agenda-recent-row-past-1"]';
const BTN = `${ROW} [data-testid="take-attendance-btn"]`;

describe('+page — the recent row marking gate is EVENT RIGHTS, not the seat (#356)', () => {
	it('an event EDITOR with NO conductor seat sees Take attendance, opens the panel, and records', async () => {
		setRecentFixture(
			agendaItem('past-1', '2026-06-10T16:00:00.000Z', { editors: ['person-p'] }),
			['other-person']
		);
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector(ROW)).not.toBeNull();
		});
		expect(container.querySelector(BTN)).not.toBeNull();

		await fireEvent.click(container.querySelector(BTN)!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
		});
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
		});

		createAttendanceMock.mockResolvedValue('new-att-1');
		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		await waitFor(() => {
			expect(createAttendanceMock).toHaveBeenCalledTimes(1);
		});
		expect(createAttendanceMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ eventId: 'past-1', memberId: 'm1', status: 'present' })
		);
	});

	it('an event OWNER with no seat sees the button too — ownership subsumes editing', async () => {
		setRecentFixture(
			agendaItem('past-1', '2026-06-10T16:00:00.000Z', { owners: ['person-p'] }),
			['other-person']
		);
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector(ROW)).not.toBeNull();
		});
		expect(container.querySelector(BTN)).not.toBeNull();
	});

	it('the conductor SEAT alone shows NOTHING — no button, no empty panel, no attendance reads (#356 retires the seat as a gate)', async () => {
		setRecentFixture(agendaItem('past-1', '2026-06-10T16:00:00.000Z'), ['person-p']);
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector(ROW)).not.toBeNull();
		});
		expect(container.querySelector(BTN)).toBeNull();
		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		expect(listAttendanceMock).not.toHaveBeenCalled();
		expect(listAllRsvpsForEventMock).not.toHaveBeenCalled();
	});

	it('SEASON `_editor` without rights on the EVENT shows nothing — so this surface answers what /event/[id] answers', async () => {
		setRecentFixture(agendaItem('past-1', '2026-06-10T16:00:00.000Z'), [], {
			seasonEditors: ['person-p']
		});
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector(ROW)).not.toBeNull();
		});
		expect(container.querySelector(BTN)).toBeNull();
		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		expect(listAttendanceMock).not.toHaveBeenCalled();
		expect(listAllRsvpsForEventMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — #356 RED)
