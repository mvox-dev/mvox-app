// @vitest-environment happy-dom
//
// #84 TA.3 RED — route-level test for the record-attendance composition:
// conductor taps 'Take attendance' on a recent event row → the member list
// expands INLINE (no navigation) with per-member P/A/L toggles and the RSVP
// comparison column; a non-conductor never sees the entry point at all.
//
// This picks up exactly where page.conductor-wiring.spec.ts stopped: TA.2
// deliberately did NOT wire `ontakeattendance` (the button was gated behind
// handler presence and asserted ABSENT). TA.3 wires it — the same conductor
// fixture that previously asserted `take-attendance-btn` null now asserts it
// present, and drives the full expand flow.
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
		attendance_toggle_aria_label: (p: { name: string; status: string }) => `Mark ${p.name} as ${p.status}`,
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
		// #85 TA.4 — the recent-row attendance badge + season summary render
		// unconditionally whenever the Recent section renders, so this file's
		// conductor fixtures (which populate `recent`) need these keys too.
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_season_summary: () => 'This season',
		attendance_season_rate: (p: { attended: number; total: number }) =>
			`Attended ${p.attended} of ${p.total} rehearsals`,
		attendance_member_rate: (p: { attended: number; total: number }) => `${p.attended} of ${p.total}`,
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
// #91 TR.3 — +page.svelte now imports the repertoire WRITE layer (and the
// library reads that feed its pickers), which reaches entuFetch ->
// $lib/entu-config -> $env/dynamic/public: unavailable outside a SvelteKit
// request context under happy-dom. Same one-line fix the library/profile specs
// already use; the real modules keep running, only the base url is stubbed.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
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

// #90 TR.2 — the page now resolves each row's Works element and signs PDFs on
// click. Mocked here for the same reason agendaData/rsvpData are: both modules
// pull in $lib/entu/request -> $env/dynamic/public, which is unavailable
// outside a SvelteKit request context under happy-dom (and neither belongs in
// these specs' subject).
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

/** A promise the test controls the settlement of — simulates "the write is still in flight". */
function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

/** TWO conducted recent events sharing the same roster — for cross-event bleed regressions. */
function setTwoConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z', []),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z', [])
		],
		seasonId: 's1',
		seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] // seat inherited season-wide — both events are conducted
	}));
	loadRosterMock.mockResolvedValue([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
		{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
	]);
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

/** One conducted recent event + a two-member roster; m1 answered 'going', m2 never answered. */
function setConductedRecentFixture() {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [],
		upcoming: [],
		recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z', [])],
		seasonId: 's1',
		seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] // person-p inherits the seat (event list empty)
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
		// And no attendance/rsvp comparison reads fired — the gate is upstream of IO.
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
		// m1 answered 'going' — the comparison column carries it.
		expect(container.querySelector('[data-testid="attendance-rsvp-m1"]')!.textContent).toContain(
			'Going'
		);
		// m2 never answered — explicit marker, never a defaulted status.
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
		// No batch shape anywhere: nothing waits for a save/submit — the write already fired.
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

		// Open event A (past-1), tap m1 present — the write fires and hangs (deferred).
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

		// Close the panel, then open event B (past-2) — a DIFFERENT event, same member ids.
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
		// Fresh panel for event B: m1 has no attendance yet, and nothing is pending.
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.getAttribute('aria-pressed')
		).toBe('false');
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.hasAttribute('disabled')
		).toBe(false);

		// NOW event A's write resolves — it must NOT bleed into event B's currently-open panel.
		d.resolve('new-att-1');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.getAttribute('aria-pressed')
		).toBe('false');
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.hasAttribute('disabled')
		).toBe(false);
		// Only the ONE write (event A) ever fired — event B was never touched.
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

		// Close and reopen the SAME event (past-1) while the first write is still in flight.
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

		// A second tap for the SAME member on the SAME (reopened) event must NOT fire a
		// duplicate write — the queue's internal eventId:memberId pending key still guards it.
		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-present"]')!);
		await new Promise((r) => setTimeout(r, 0));

		expect(createAttendanceMock).toHaveBeenCalledTimes(1); // still just the one write
	});
	it('a stale list response does NOT overwrite a write that reconciled between request-issue and list-resolve (Finding 2)', async () => {
		// Sequence: tap m1 present on event A -> write in flight -> close -> reopen A
		// (listAttendance fires but server has not yet indexed the new record) -> the
		// in-flight write settles (reconcile sets attendanceMap.m1) -> the stale list
		// resolves with an empty result. The reconciled value must survive.
		setTwoConductedRecentEventsFixture();
		const writeDeferred = deferred<string>();
		createAttendanceMock.mockReturnValueOnce(writeDeferred.promise);
		// On reopen, listAttendance returns stale (empty) — the server hasn't indexed
		// the new attendance yet.
		const listDeferred = deferred<Array<{ attendanceId: string; memberId: string; status: string }>>();

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="agenda-recent-row-past-1"]')).not.toBeNull();
		});

		// Step 1: open event A (past-1), tap m1 present — write fires, hangs on deferred.
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

		// Step 2: close panel, then reopen same event. On reopen, make listAttendance
		// return the controlled deferred (stale data).
		await fireEvent.click(container.querySelector('[data-testid="attendance-collapse-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-panel"]')).toBeNull();
		});
		listAttendanceMock.mockReturnValueOnce(listDeferred.promise);
		await fireEvent.click(
			container.querySelector('[data-testid="agenda-recent-row-past-1"] [data-testid="take-attendance-btn"]')!
		);
		// Panel opens with loading state; listAttendance is in flight (deferred).

		// Step 3: the write settles FIRST (before the stale list resolves).
		writeDeferred.resolve('new-att-1');
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		// Step 4: NOW the stale list resolves — server returned empty (hasn't indexed yet).
		listDeferred.resolve([]);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-toggle-m1-present"]')).not.toBeNull();
		});

		// The reconciled m1 must still show as present — the stale list must NOT
		// have overwritten it.
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.getAttribute('aria-pressed')
		).toBe('true');
		// And only one write ever fired.
		expect(createAttendanceMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis*)
