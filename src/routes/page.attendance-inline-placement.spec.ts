// @vitest-environment happy-dom
//
// #87 RED — the inline attendance panel must render INSIDE the recent-event
// row it was opened from, not at the bottom of the page.
//
// The bug: +page.svelte renders <AttendanceSurface> OUTSIDE <AgendaList>,
// below every event. A conductor tapping 'Take attendance' on a row near the
// top of a long Recent section gets a panel that opens off-screen at the
// bottom — she sees no visible change and taps again, concluding the button
// is broken.
//
// These are route-level integration tests on the REAL +page.svelte (the same
// composition page.attendance-panel.spec.ts drives): they render the actual
// page route, click the actual button, and assert on where the panel lands in
// the DOM — so an implementation that merely makes some component unit test
// pass without re-wiring the page cannot go green here.
//
// Every query for the panel is SCOPED TO THE EVENT ROW element
// (`[data-testid="agenda-recent-row-<id>"] [data-testid="attendance-panel"]`).
// That scoping is the whole point: the current bottom-of-page panel exists in
// the document but is NOT a descendant of any row, so these fail RED today.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
			`Attended ${p.attended} of ${p.total} rehearsals`,
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
// Same stubs page.attendance-panel.spec.ts uses: the repertoire write layer
// reaches $env/dynamic/public (unavailable under happy-dom outside a SvelteKit
// request context), and the works/rights loads are not this file's subject.
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
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
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

/**
 * THREE conducted recent events — enough rows that the top row's panel opening
 * at the very bottom of the page is a real off-screen bug, and enough distinct
 * ids to pin WHICH row the panel belongs to. Reverse-chron, as the page
 * delivers them: past-1 is the MOST RECENT (top) row.
 */
function setThreeConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z', []),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z', []),
			agendaItem('past-3', '2026-05-27T16:00:00.000Z', [])
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], // seat inherited season-wide — all three rows conducted
		seasonOwners: [],
		seasonEditors: []
	}));
	loadRosterMock.mockResolvedValue([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
	]);
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

describe('+page — the attendance panel opens INSIDE the tapped event row (#87)', () => {
	it("tapping 'Take attendance' on the TOP recent row renders the panel inside THAT row — not below the whole agenda", async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');

		// The panel is a DESCENDANT of the tapped row's element.
		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();

		// And it does NOT float outside every row (the current bug: a panel that
		// exists in the document but belongs to no row — i.e., bottom of the page).
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
		// #112/#1 — the entry point and the panel never render together.
		expect(btn).toBeNull();
		expect(panel).not.toBeNull();
	});

	it('opening a SECOND event closes the first panel — exactly one panel, inside the newly tapped row', async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-1');
		expect(container.querySelector(panelInRow('past-1'))).not.toBeNull();

		// Now tap 'Take attendance' on a DIFFERENT event (the third row).
		await fireEvent.click(
			container.querySelector(`${rowSelector('past-3')} [data-testid="take-attendance-btn"]`)!
		);
		await waitFor(() => {
			expect(container.querySelector(panelInRow('past-3'))).not.toBeNull();
		});

		// The previous row's panel is GONE — one panel at a time.
		expect(container.querySelector(panelInRow('past-1'))).toBeNull();
		expect(container.querySelectorAll('[data-testid="attendance-panel"]')).toHaveLength(1);
	});

	it('the relocated panel still renders the member list with P/A/L toggles and the RSVP comparison — scoped INSIDE the row', async () => {
		const container = await renderPageWithRecentRows();
		await openPanelOnRow(container, 'past-2');

		// One row per roster member, INSIDE the event row's panel.
		await waitFor(() => {
			expect(
				container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-row-m1"]`)
			).not.toBeNull();
		});
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-row-m2"]`)
		).not.toBeNull();
		// P/A/L toggles per member, all within the row-scoped panel.
		for (const memberId of ['m1', 'm2']) {
			for (const status of ['present', 'absent', 'late']) {
				expect(
					container.querySelector(
						`${panelInRow('past-2')} [data-testid="attendance-toggle-${memberId}-${status}"]`
					)
				).not.toBeNull();
			}
		}
		// The RSVP comparison column survived the relocation too.
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-rsvp-m1"]`)!
				.textContent
		).toContain('Going');
		expect(
			container.querySelector(`${panelInRow('past-2')} [data-testid="attendance-rsvp-m2"]`)!
				.textContent
		).toContain('No answer');

		// And a toggle tap still fires the write for THIS event — the relocation
		// must not have severed the page-owned queue wiring.
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
