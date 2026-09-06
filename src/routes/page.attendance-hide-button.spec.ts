// @vitest-environment happy-dom
//
// #112/#1 RED — while the inline attendance panel is OPEN, the 'Take
// attendance' button that opened it must be HIDDEN.
//
// The bug: AgendaList renders <TakeAttendanceButton> unconditionally for every
// conducted recent row — the row whose panel is open keeps showing the button
// directly ABOVE the expanded panel. Tapping it again is a no-op that looks
// broken, and the control reads as "attendance not yet taken" while the taking
// surface sits right under it. The event detail page already got this right
// (`{#if isConductorForEvent && !attendancePanelOpen}`); the agenda did not.
//
// These are route-level integration tests on the REAL +page.svelte (the same
// composition page.attendance-inline-placement.spec.ts drives): they render
// the actual page route, click the actual button, and assert on the button's
// presence INSIDE the owning row — so an implementation that only patches a
// component unit test without re-wiring AgendaList cannot go green here.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (p: { minutes: number }) => `${p.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p: { weeks: number }) => `${p.weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		// #214 — the filter chip row renders whenever the agenda has any
		// events at all, so its message keys must exist in every mock that
		// renders the real +page.svelte with a non-empty agenda.
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		// #247 — the view toggle sits WITH the filter chips, so it renders
		// whenever the chip row does; same "every mock needs it" rule as #214.
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
		// #113 review F4 — the panel's loading state now carries an sr-only
		// role="status" saying so (focus lands in the panel while it loads).
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
	listAllRsvpsForEventMock: vi.fn(),
	createAttendanceMock: vi.fn(),
	updateAttendanceStatusMock: vi.fn(),
	deleteAttendanceMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// Same stubs page.attendance-inline-placement.spec.ts uses: the repertoire
// write layer reaches $env/dynamic/public (unavailable under happy-dom outside
// a SvelteKit request context), and the works/rights loads are not this file's
// subject.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
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
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	listMyAttendance: vi.fn().mockResolvedValue([]),
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
// #234 — importOriginal for collectSources/buildWorkRows: the panel's new
// repertoire section calls them for real (pure, no fetch); only
// loadWorksByEventId (the fetching entry point) is mocked here.
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
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

/** TWO conducted recent events — enough to prove the hide is scoped to the ONE
 *  row whose panel is open, not a page-wide blanket. Reverse-chron, as the
 *  page delivers them. */
function setTwoConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z', []),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z', [])
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], // seat inherited season-wide — both rows conducted
		seasonOwners: [],
		seasonEditors: []
	}));
	loadRosterMock.mockResolvedValue([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
	]);
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

// Safe defaults so unrelated resolve calls don't hang.
findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
	resetConductor();
});

describe("+page — the 'Take attendance' button hides while its panel is open (#112/#1)", () => {
	it('with every panel CLOSED, each conducted recent row shows its button (guard: the hide must not become a blanket removal)', async () => {
		const container = await renderPageWithRecentRows();

		// No panel open anywhere → both conducted rows carry the entry point.
		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();
		expect(container.querySelector(buttonInRow('past-2'))).not.toBeNull();
	});

	it("opening a row's panel HIDES that row's 'Take attendance' button — the panel replaces the entry point, they never render together", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		// The tapped row's button is GONE while its panel is expanded.
		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
	});

	it("the hide is scoped to the OPEN row — the other conducted row keeps its button", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
		// past-2's panel is closed → its entry point stays.
		expect(container.querySelector(panelInRow('past-2'))).toBeNull();
		expect(container.querySelector(buttonInRow('past-2'))).not.toBeNull();
	});

	it('closing the panel brings the button back; reopening hides it again — visibility tracks the panel across the full toggle cycle', async () => {
		const container = await renderPageWithRecentRows();

		// open → hidden
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();

		// close (the panel's own collapse control) → visible again
		await fireEvent.click(
			container.querySelector(
				`${rowSelector('past-1')} [data-testid="attendance-collapse-btn"]`
			)!
		);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		});
		expect(container.querySelector(buttonInRow('past-1'))).not.toBeNull();

		// reopen → hidden again (the restored button is live, not a dead clone)
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();
	});

	it("switching the panel to a DIFFERENT row restores the first row's button and hides the newly opened row's", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(buttonInRow('past-1'))).toBeNull();

		// Open the second event — one panel at a time, so past-1's panel closes.
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
