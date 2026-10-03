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
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/mocks/events')).attendanceHandlesModule({ lists: true, writes: true, mine: 'empty' })
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import Page from './+page.svelte';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadFullAgendaMock
} from '$lib/testing/moduleHandles';
import {
	createAttendanceMock,
	deleteAttendanceMock,
	listAllRsvpsForEventMock,
	listAttendanceMock,
	updateAttendanceStatusMock
} from '$lib/testing/mocks/events';
import { loadRosterMock } from '$lib/testing/mocks/roster';

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

function setOneConductedRecentEventFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] }],
		seasonId: 's1',
		seasonConductors: ['person-p'],
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
		releaseRoster([{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: '' }]);
		await waitFor(() => {
			expect(container.querySelector(panelInRow)!.getAttribute('aria-busy')).toBeNull();
		});
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
