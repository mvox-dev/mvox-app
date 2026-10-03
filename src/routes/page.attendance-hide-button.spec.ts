// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
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
		agenda_recent_show_more: () => 'Show earlier',
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
		attendance_tally: (p: { present: number; absent: number; late: number }) =>
			`${p.present} present · ${p.absent} absent · ${p.late} late`,
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
	loadFullAgendaMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadRosterMock,
	listAttendanceMock,
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
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
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
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
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

import Page from './+page.svelte';
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

function setTwoConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [
			{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] },
			{ ...agendaItem('past-2', '2026-06-03T16:00:00.000Z', []), editors: ['person-p'] }
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], // seat inherited season-wide — both rows conducted
		seasonOwners: [],
		seasonEditors: []
	}));
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
	]));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

const rowSelector = (eventId: string) => `[data-testid="agenda-recent-row-${eventId}"]`;
const buttonInRow = (eventId: string) =>
	`${rowSelector(eventId)} [data-testid="take-attendance-btn"]`;
const panelInRow = (eventId: string) => `${rowSelector(eventId)} [data-testid="attendance-panel"]`;

async function renderPageWithRecentRows() {
	setTwoConductedRecentEventsFixture();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector(rowSelector('past-1'))).not.toBeNull();
	});
	return container;
}

async function openPanelOnRow(container: HTMLElement, eventId: string) {
	const btn = container.querySelector(buttonInRow(eventId));
	expect(btn).not.toBeNull();
	await fireEvent.click(btn!);
	await waitFor(() => {
		expect(container.querySelector(panelInRow(eventId))).not.toBeNull();
	});
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

describe("+page — the 'Take attendance' button hides while its panel is open (#112/#1)", () => {
	it('with every panel CLOSED, each conducted recent row shows its button (guard: the hide must not become a blanket removal)', async () => {
		const container = await renderPageWithRecentRows();

		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);

		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();
		expect(container.querySelector(buttonInRow('past-2'))).not.toBeNull();
	});

	it("opening a row's panel HIDES that row's 'Take attendance' button — the panel replaces the entry point, they never render together", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
	});

	it("the hide is scoped to the OPEN row — the other conducted row keeps its button", async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-1');

		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
		expect(container.querySelector(panelInRow('past-2'))).toBeNull();
		expect(container.querySelector(buttonInRow('past-2'))).not.toBeNull();
	});

	it('closing the panel brings the button back; reopening hides it again — visibility tracks the panel across the full toggle cycle', async () => {
		const container = await renderPageWithRecentRows();

		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();

		await fireEvent.click(
			container.querySelector(
				`${rowSelector('past-1')} [data-testid="attendance-collapse-btn"]`
			)!
		);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		});
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();

		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
	});

	it("switching the panel to a DIFFERENT row restores the first row's button and hides the newly opened row's", async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();

		await fireEvent.click(container.querySelector(buttonInRow('past-2'))!);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-2'))).not.toBeNull();
		});

		expect(container.querySelector(buttonInRow('past-2'))).toBeNull();
		expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();
	});
});

// (*MVOX:Tallis*)
