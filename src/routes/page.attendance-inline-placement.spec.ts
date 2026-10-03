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
vi.mock('$lib/repertoire/repertoireActions', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).repertoireActionsModule(await importOriginal())
);
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
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
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

function setThreeConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [
			{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] },
			{ ...agendaItem('past-2', '2026-06-03T16:00:00.000Z', []), editors: ['person-p'] },
			{ ...agendaItem('past-3', '2026-05-27T16:00:00.000Z', []), editors: ['person-p'] }
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], // seat inherited season-wide — all three rows conducted
		seasonOwners: [],
		seasonEditors: []
	}));
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
	]));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([
		{ rsvpId: 'r1', memberId: 'm1', status: 'going' } // m2 deliberately absent — no answer
	]);
	setAuthedWithOneCollective('person-p');
}

const rowSelector = (eventId: string) => `[data-testid="agenda-recent-row-${eventId}"]`;
const panelInRow = (eventId: string) =>
	`${rowSelector(eventId)} [data-testid="attendance-panel"]`;

async function renderPageWithRecentRows() {
	setThreeConductedRecentEventsFixture();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector(rowSelector('past-1'))).not.toBeNull();
	});
	return container;
}

async function openPanelOnRow(container: HTMLElement, eventId: string) {
	const btn = container.querySelector(
		`${rowSelector(eventId)} [data-testid="take-attendance-btn"]`
	);
	expect(btn).not.toBeNull();
	await fireEvent.click(btn!);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
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

describe('+page — the attendance panel opens INSIDE the tapped event row (#87)', () => {
	it("tapping 'Take attendance' on the TOP recent row renders the panel inside THAT row — not below the whole agenda", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();

		const panel = container.querySelector('[data-testid="attendance-panel"]')!;
		const owningRow = panel.closest('[data-testid^="agenda-recent-row-"]');
		expect(owningRow).not.toBeNull();
		expect(owningRow!.getAttribute('data-testid')).toBe('agenda-recent-row-past-1');
	});

	it("the panel renders where the 'Take attendance' button was, in the same row — #112/#1 hides that button while its own panel is open, so the panel is what the conductor now sees in its place", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		const row = container.querySelector(rowSelector('past-1'))!;
		const btn = row.querySelector('[data-testid="take-attendance-btn"]');
		const panel = row.querySelector('[data-testid="attendance-panel"]');
		expect(btn).toBeNull();
		expect(panel).not.toBeNull();
	});

	it('opening a SECOND event closes the first panel — exactly one panel, inside the newly tapped row', async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();

		await fireEvent.click(
			container.querySelector(`${rowSelector('past-3')} [data-testid="take-attendance-btn"]`)!
		);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-3'))).not.toBeNull();
		});

		expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		expect(container.querySelectorAll('[data-testid="attendance-panel"]')).toHaveLength(1);
	});

	it('the relocated panel still renders the member list with P/A/L toggles and the RSVP comparison — scoped INSIDE the row', async () => {
		const container = await renderPageWithRecentRows();
		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);
		await openPanelOnRow(container, 'past-2');

		await waitFor(() => {
			expect(
				container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-row-m1"]`)
			).not.toBeNull();
		});
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-row-m2"]`)
		).not.toBeNull();
		for (const memberId of ['m1', 'm2']) {
			for (const status of ['present', 'absent', 'late']) {
				expect(
					container.querySelector(
						`${panelInRow('past-2')} [data-testid="attendance-toggle-${memberId}-${status}"]`
					)
				).not.toBeNull();
			}
		}
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-rsvp-m1"]`)!
				.textContent
		).toContain('Going');
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-rsvp-m2"]`)!
				.textContent
		).toContain('No answer');

		createAttendanceMock.mockResolvedValue('new-att-1');
		await fireEvent.click(
			container.querySelector(
				`${panelInRow('past-2')} [data-testid="attendance-toggle-m1-present"]`
			)!
		);
		await waitFor(() => {
			expect(createAttendanceMock).toHaveBeenCalledTimes(1);
		});
		expect(createAttendanceMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ eventId: 'past-2', memberId: 'm1', status: 'present' })
		);
	});
});

// (*MVOX:Tallis*)
