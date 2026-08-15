// @vitest-environment happy-dom
//
// #113 TU.5 RED — focus order around TU.4/#112's hide-while-open attendance
// entry point, on the REAL agenda route (./+page.svelte).
//
// TU.4 made the 'Take attendance' button UNMOUNT while its panel is open. That
// fixed the visual defect (#112/#1) but introduced the focus one: the click
// that opens the panel destroys the very button that held focus, and the
// browser drops focus to <body> — a keyboard user's next Tab restarts at the
// top of the document (WCAG 2.4.3 Focus Order). Closing the panel does the
// same in reverse: the panel's own Close button unmounts itself.
//
// This is the exact defect class the section picker already fixed (#99 F1 —
// `closeMenu` in src/lib/sections/SectionPicker.svelte, which puts focus back
// on the trigger instead of letting it drop to <body>): when an activation
// unmounts its own control, the handler must place focus explicitly. The
// roster's `handleRemoveSection` follows the same discipline. The pinned
// contract:
//   - opening a row's panel moves focus INTO that panel (its close control is
//     the natural landing — first focusable, and the symmetric undo);
//   - closing the panel returns focus to that row's restored 'Take
//     attendance' button.
//
// Guard tests pin the labels TU.4 kept: the entry point's contextual
// event-named aria-label, and the panel close control's m.* label.
//
// Route-level integration on the real +page.svelte — same mock composition as
// page.attendance-hide-button.spec.ts, so a fix that only patches a component
// unit test cannot go green here.
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
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

function setOneConductedRecentEventFixture() {
	loadFullAgendaMock.mockResolvedValue({ seasons: [],
		upcoming: [],
		recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z', [])],
		seasonId: 's1',
		seasonConductors: ['person-p'],
		seasonOwners: [],
		seasonEditors: []
	});
	loadRosterMock.mockResolvedValue([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
	]);
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

const rowSelector = `[data-testid="agenda-recent-row-past-1"]`;
const buttonInRow = `${rowSelector} [data-testid="take-attendance-btn"]`;
const panelInRow = `${rowSelector} [data-testid="attendance-panel"]`;
const closeInRow = `${rowSelector} [data-testid="attendance-collapse-btn"]`;

async function renderPageWithRecentRow() {
	setOneConductedRecentEventFixture();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector(rowSelector)).not.toBeNull();
	});
	return container;
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

describe("+page — focus order around the hide-while-open 'Take attendance' button (#113, on #112/#1)", () => {
	it('guard: the entry point is a native <button> with a contextual aria-label naming its event', async () => {
		const container = await renderPageWithRecentRow();
		const btn = container.querySelector(buttonInRow) as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.tagName).toBe('BUTTON');
		expect(btn.getAttribute('aria-label')).toBe('Take attendance for Rehearsal past-1');
	});

	it("RED: opening the panel moves focus INTO it — the click unmounts the focused button, so without explicit placement focus drops to <body> (WCAG 2.4.3)", async () => {
		const container = await renderPageWithRecentRow();
		const btn = container.querySelector(buttonInRow) as HTMLElement;
		btn.focus();
		expect(document.activeElement).toBe(btn); // precondition, not the assertion
		await fireEvent.click(btn);
		const panel = await waitFor(() => {
			const el = container.querySelector(panelInRow);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		// The button is gone (the #112/#1 hide) — focus must now be somewhere
		// INSIDE the panel that replaced it, never on <body>.
		expect(container.querySelector(buttonInRow)).toBeNull();
		expect(
			panel.contains(document.activeElement),
			`focus must land inside the attendance panel, was on <${document.activeElement?.tagName}>`
		).toBe(true);
	});

	it("RED: closing the panel returns focus to the restored 'Take attendance' button — Close unmounts itself with the panel", async () => {
		const container = await renderPageWithRecentRow();
		const btn = container.querySelector(buttonInRow) as HTMLElement;
		btn.focus();
		await fireEvent.click(btn);
		const close = await waitFor(() => {
			const el = container.querySelector(closeInRow);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		close.focus();
		await fireEvent.click(close);
		const restored = await waitFor(() => {
			expect(container.querySelector(panelInRow)).toBeNull();
			const el = container.querySelector(buttonInRow);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(
			document.activeElement,
			"focus must return to the row's restored entry point"
		).toBe(restored);
	});

	// #113 review F4 — focus now LANDS in the panel while its roster is still
	// loading, so the busy state is no longer cosmetic: without it a
	// screen-reader user hears "Close, button" and then silence. Review F1
	// extended the tail: aria-busy clearing is not itself an announcement, so
	// the live region must outlive the load and change its text.
	it('the panel reports aria-busy="true" while it loads, with an sr-only role="status" saying so — focus lands here before the rows exist', async () => {
		setOneConductedRecentEventFixture();
		let releaseRoster: (rows: unknown[]) => void = () => {};
		loadRosterMock.mockReturnValue(
			new Promise<unknown[]>((resolve) => {
				releaseRoster = resolve;
			})
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector(rowSelector)).not.toBeNull();
		});
		await fireEvent.click(container.querySelector(buttonInRow)!);
		const panel = await waitFor(() => {
			const el = container.querySelector(panelInRow);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(panel.querySelector('[data-testid="attendance-panel-loading"]')).not.toBeNull();
		expect(panel.contains(document.activeElement), 'focus is inside the loading panel').toBe(true);
		expect(panel.getAttribute('aria-busy'), 'the container the focused control lives in').toBe(
			'true'
		);
		const status = panel.querySelector('[data-testid="attendance-panel-status"]');
		expect(status, 'a live region must say a load is in progress').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		const loadingText = status!.textContent?.trim();
		expect(loadingText).not.toBe('');
		// …and the busy state clears when the rows arrive.
		releaseRoster([{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: '' }]);
		await waitFor(() => {
			expect(container.querySelector(panelInRow)!.getAttribute('aria-busy')).toBeNull();
		});
		// #113 review F1 — the region must be the SAME node it was during the
		// load, now carrying DIFFERENT text. A region that mounts together with
		// its text announces nothing (a live region speaks changes to contents,
		// not its own insertion), and one that unmounts on completion leaves the
		// user with no cue that the wait ended — aria-busy dropping off a
		// non-live container is silent. Node identity is what separates
		// "always mounted, text swapped" from "mounted with text", which the
		// during-load assertions above cannot tell apart on their own.
		const loaded = container.querySelector(panelInRow)!.querySelector(
			'[data-testid="attendance-panel-status"]'
		);
		expect(loaded, 'the live region must survive the load, not unmount with the skeleton').toBe(
			status
		);
		const readyText = loaded!.textContent?.trim();
		expect(readyText, 'a completion cue must replace the loading text').not.toBe('');
		expect(readyText, 'the text must CHANGE — an unchanged region announces nothing').not.toBe(
			loadingText
		);
	});

	it("guard: the panel's close control is a native <button> with an m.* aria-label", async () => {
		const container = await renderPageWithRecentRow();
		await fireEvent.click(container.querySelector(buttonInRow)!);
		const close = await waitFor(() => {
			const el = container.querySelector(closeInRow);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(close.tagName).toBe('BUTTON');
		expect(close.getAttribute('aria-label')).toBe('Close');
	});
});

// (*MVOX:Tallis*)
