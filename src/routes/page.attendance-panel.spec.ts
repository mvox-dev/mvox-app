// @vitest-environment happy-dom
// The agenda's take-attendance panel: member list, marks and writes.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
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
		agenda_recent_show_more: () => 'Show earlier',
		agenda_switch_collective: () => 'Switch collective',
		agenda_take_attendance: () => 'Take attendance',
		agenda_take_attendance_label: (p: { event: string }) => `Take attendance for ${p.event}`,
		attendance_group_label: (p: { name: string }) => `Attendance for ${p.name}`,
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_toggle_aria_label: (p: { name: string; status: string }) => `Mark ${p.name} as ${p.status}`,
		attendance_rsvp_none: () => 'No answer',
		attendance_rsvp_aria_label: (p: { name: string; rsvp: string }) => `RSVP for ${p.name}: ${p.rsvp}`,
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
		attendance_member_rate: (p: { attended: number; total: number }) => `${p.attended} of ${p.total}`,
		attendance_all_members: () => 'All members'
	})
);

const {
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadRosterMock,
	listAttendanceMock,
	listAllRsvpsForEventMock,
	createAttendanceMock,
	updateAttendanceStatusMock,
	deleteAttendanceMock
} = vi.hoisted(() => ({
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
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
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock } from '$lib/testing/routeMocks';
import { loadFullAgendaMock } from '$lib/testing/moduleHandles';

function agendaItem(
	id: string,
	startDatetime: string,
	conductors: string[] = []
): {
	id: string;
	name: string;
	startDatetime: string;
	durationMinutes: number;
	location: string;
	conductors: string[];
	owners: string[];
	editors: string[];
} {
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
		seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] // seat inherited season-wide — both events are conducted
	}));
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
	]));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

function setConductedRecentFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z', []), editors: ['person-p'] }],
		seasonId: 's1',
		seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] // person-p inherits the seat (event list empty)
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

describe('+page — the Take attendance entry point (#84 TA.3)', () => {
	it('a conductor NOW sees the take-attendance button on their conducted recent row (TA.2 gated it behind handler presence; TA.3 wires the handler)', async () => {
		setConductedRecentFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
	});

	it('a NON-conductor sees the recent row but no take-attendance button — the panel is unreachable', async () => {
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
			upcoming: [],
			recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z', [])],
			seasonId: 's1',
			seasonConductors: ['other-person'], seasonOwners: [], seasonEditors: [] // person-p holds no seat
		}));
		setAuthedWithOneCollective('person-p');
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).toBeNull();
		expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		expect(listAttendanceMock).not.toHaveBeenCalled();
		expect(listAllRsvpsForEventMock).not.toHaveBeenCalled();
	});
});

describe('+page — tapping Take attendance expands the inline panel (#84 TA.3)', () => {
	async function renderAndOpenPanel() {
		setConductedRecentFixture();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
		});
		return container;
	}

	it('expands INLINE — the panel appears, no navigation fires', async () => {
		const container = await renderAndOpenPanel();
		expect(container.querySelector('[data-testid="attendance-panel"]')).not.toBeNull();
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('renders one row per roster member with P/A/L toggles each', async () => {
		const container = await renderAndOpenPanel();

		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="attendance-row-m2"]')).not.toBeNull();
		for (const memberId of ['m1', 'm2']) {
			for (const status of ['present', 'absent', 'late']) {
				expect(
					container.querySelector(`[data-testid="attendance-toggle-${memberId}-${status}"]`)
				).not.toBeNull();
			}
		}
	});

	it('shows the RSVP comparison per member: the domain-read answer next to the toggles, and an explicit no-answer marker for members who never answered', async () => {
		const container = await renderAndOpenPanel();

		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-rsvp-m1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="attendance-rsvp-m1"]')!.textContent).toContain(
			'Going'
		);
		expect(container.querySelector('[data-testid="attendance-rsvp-m2"]')!.textContent).toContain(
			'No answer'
		);
	});

	it('loads the comparison data for THIS event: listAttendance + listAllRsvpsForEvent both called with the event id', async () => {
		await renderAndOpenPanel();

		await waitFor(() => {
			expect(listAttendanceMock).toHaveBeenCalled();
		});
		expect(listAttendanceMock.mock.calls[0][1]).toBe('past-1');
		expect(listAllRsvpsForEventMock).toHaveBeenCalled();
		expect(listAllRsvpsForEventMock.mock.calls[0][1]).toBe('past-1');
	});

	it('tapping a P toggle fires ONE immediate createAttendance for that member — per-tap write, no batch/save button', async () => {
		const container = await renderAndOpenPanel();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});
		createAttendanceMock.mockResolvedValue('new-att-1');

		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);

		await waitFor(() => {
			expect(createAttendanceMock).toHaveBeenCalledTimes(1);
		});
		expect(createAttendanceMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ eventId: 'past-1', memberId: 'm1', status: 'present' })
		);
		expect(container.querySelector('[data-testid="attendance-save-btn"]')).toBeNull();
	});
});

describe('+page — attendance queue cross-event bleed + duplicate-write regressions (#77 fix-forward)', () => {
	it('a write started on event A that resolves AFTER the panel reopens on event B does not bleed into B\'s panel', async () => {
		setTwoConductedRecentEventsFixture();
		const d = deferred<string>();
		createAttendanceMock.mockReturnValueOnce(d.promise); // event A's write never settles in this test — until we say so

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});

		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-row-past-1"] [data-testid="take-attendance-btn"]')!
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		await waitFor(() => {
			expect(createAttendanceMock).toHaveBeenCalledTimes(1);
		});
		expect(createAttendanceMock.mock.calls[0][1]).toEqual(
			expect.objectContaining({ eventId: 'past-1', memberId: 'm1', status: 'present' })
		);

		await fireEvent.click(container.querySelector('[data-testid="attendance-collapse-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-row-past-2"] [data-testid="take-attendance-btn"]')!
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.getAttribute('aria-pressed')
		).toBe('false');
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.hasAttribute('disabled')
		).toBe(false);

		d.resolve('new-att-1');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.getAttribute('aria-pressed')
		).toBe('false');
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.hasAttribute('disabled')
		).toBe(false);
		expect(createAttendanceMock).toHaveBeenCalledTimes(1);
	});

	it('reopening the SAME event while a write is still in flight does not allow a duplicate createAttendance for the same member', async () => {
		setTwoConductedRecentEventsFixture();
		const d = deferred<string>();
		createAttendanceMock.mockReturnValueOnce(d.promise); // first tap's write never settles in this test

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-row-past-1"] [data-testid="take-attendance-btn"]')!
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		await waitFor(() => {
			expect(createAttendanceMock).toHaveBeenCalledTimes(1);
		});

		await fireEvent.click(container.querySelector('[data-testid="attendance-collapse-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-row-past-1"] [data-testid="take-attendance-btn"]')!
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});

		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		await new Promise((r) => setTimeout(r, 0));

		expect(createAttendanceMock).toHaveBeenCalledTimes(1); // still just the one write
	});
	it('a stale list response does NOT overwrite a write that reconciled between request-issue and list-resolve (Finding 2)', async () => {
		setTwoConductedRecentEventsFixture();
		const writeDeferred = deferred<string>();
		createAttendanceMock.mockReturnValueOnce(writeDeferred.promise);
		const listDeferred = deferred<Array<{ attendanceId: string; memberId: string; status: string }>>();

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});

		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-row-past-1"] [data-testid="take-attendance-btn"]')!
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		await waitFor(() => {
			expect(createAttendanceMock).toHaveBeenCalledTimes(1);
		});

		await fireEvent.click(container.querySelector('[data-testid="attendance-collapse-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		});
		listAttendanceMock.mockReturnValueOnce(listDeferred.promise);
		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-row-past-1"] [data-testid="take-attendance-btn"]')!
		);

		writeDeferred.resolve('new-att-1');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		listDeferred.resolve([]);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});

		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.getAttribute('aria-pressed')
		).toBe('true');
		expect(createAttendanceMock).toHaveBeenCalledTimes(1);
	});
});

describe('+page — the attendance panel states a truncated roster (#321 review F2)', () => {
	async function openPanelWithRoster(truncated: boolean) {
		setConductedRecentFixture();
		if (truncated) {
			loadRosterMock.mockResolvedValue({
				items: [
					{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
				],
				total: 500,
				truncated: true
			});
		}
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
		});
		return container;
	}

	const NOTICE = '[data-testid="attendance-panel-partial-notice"]';

	it('a truncated member read renders the shared VISIBLE role="status" notice inside the panel', async () => {
		const container = await openPanelWithRoster(true);

		await waitFor(() => {
			expect(container.querySelector(NOTICE)).not.toBeNull();
		});
		const notice = container.querySelector(NOTICE)!;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
		expect(
			container.querySelector(`[data-testid="attendance-panel"] ${NOTICE}`)
		).not.toBeNull();
	});

	it('a complete read leaves it ABSENT from the DOM', async () => {
		const container = await openPanelWithRoster(false);
		expect(container.querySelector('[data-testid="attendance-row-m2"]')).not.toBeNull();

		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

describe('#471 — a collective switch resets Recent to one card ({#key current?.db})', () => {
	function setTwoCollectivesFixture() {
		setTwoConductedRecentEventsFixture();
		signIn({
			collectives: [
				{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
				{ db: 'otherdb', name: 'Otherdb', personId: 'person-p' }
			]
		});
	}

	it('after pressing show-more, switching the selected collective renders one card again with the button back', async () => {
		setTwoCollectivesFixture();
		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});

		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471: show-more on the one visible recent card').not.toBeNull();
		await fireEvent.click(showMore!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-2"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="agenda-recent-show-more"]')).toBeNull();

		selectedCollectiveDbStore.set('otherdb');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-show-more"]')).not.toBeNull();
		});
		const rows = [...container.querySelectorAll('[data-testid^="agenda-recent-row-"]')].map(
			(el) => el.getAttribute('data-testid')
		);
		expect(rows).toEqual(['agenda-recent-row-past-1']);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
