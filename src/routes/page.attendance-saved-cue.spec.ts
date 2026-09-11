// @vitest-environment happy-dom
//
// #327 RED (agenda-page integration) — the attendance saved cue on the WRITE
// path, host page 1 of 2 (the conductor's inline "Take attendance" panel on a
// recent agenda row).
//
// Renders the real +page → AgendaList → AttendanceSurface chain and drives
// real taps through the real attendanceChangeQueue — only the write dispatch
// (applyAttendanceChange) and the data reads are mocked, the same seam as its
// #326 sibling (page.rsvp-saved-cue.spec.ts) and the same read-mock harness as
// page.attendance-panel.spec.ts. This is what forces GREEN to thread
// savedMemberIds through the page's queue callbacks, the AttendancePanel
// bundle (attendance/types.ts) AND AgendaList's explicit prop pass-through —
// not merely into an isolated component. Pins (mirroring #326's, per-member
// instead of per-event):
//
//   1. SAVED CUE ON RECONCILE — a settled write puts the per-row saved
//      announcement on the member row that reconciled.
//   2. PER-(EVENT,MEMBER) GRANULARITY — the cue never claims more than the
//      row that reconciled: the OTHER member's row stays blank, and a cue
//      earned on event A never shows in event B's panel (same member id).
//   3. THE TALLY — while a write is in flight the tally line carries the
//      visible unconfirmed marking (the RED stated choice, see
//      AttendanceSurface.saved-cue.spec.ts); once every write settles the
//      marking is gone and the counts are server-confirmed.
//   4. PENDING BYTE-PRESERVED — the PO-ruled silent disable stays: aria-busy
//      + aria-disabled, no saved text on the row; a NEW write clears the
//      previous saved cue the moment it starts.
//   5. FAILURE BYTE-PRESERVED — a rejected write still reverts the value and
//      raises the per-row role=alert; no saved cue appears, and a failure
//      AFTER an earlier saved clears that stale cue.
//   6. A successfully CLEARED record announces too — reconciled-null renders
//      identically to never-marked; the cue is the only distinguisher.
//   7. READ PATH SILENT — opening a panel over records saved earlier
//      announces nothing: the cue reports a write, never a read.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_empty_no_events: () => 'No upcoming events.',
		agenda_duration_min: (p) => `${(p as { minutes: number }).minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p) => `${(p as { weeks: number }).weeks} weeks later`,
		agenda_load_error: () => "Couldn't load the agenda.",
		agenda_retry: () => 'Retry',
		agenda_filter_all: () => 'All',
		agenda_filter_group_label: () => 'Filter by event type',
		agenda_view_toggle_label: () => 'Agenda view',
		agenda_view_list: () => 'List',
		agenda_view_month: () => 'Month',
		agenda_filter_empty: () => 'No events match this filter.',
		agenda_row_link_label: (p) => `View details for ${(p as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details',
		agenda_recent: () => 'Recent',
		agenda_take_attendance: () => 'Take attendance',
		agenda_take_attendance_label: (p) => `Take attendance for ${(p as { event: string }).event}`,
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'Only members can RSVP.',
		rsvp_save_failed: () => 'Could not save your answer.',
		attendance_group_label: (p) => `Attendance for ${(p as { name: string }).name}`,
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_toggle_aria_label: (p) =>
			`Mark ${(p as { name: string }).name} as ${(p as { status: string }).status}`,
		attendance_rsvp_none: () => 'No answer',
		attendance_rsvp_aria_label: (p) =>
			`RSVP for ${(p as { name: string }).name}: ${(p as { rsvp: string }).rsvp}`,
		attendance_load_error: () => "Couldn't load attendance.",
		attendance_loading: () => 'Loading attendance…',
		attendance_ready: (p) => `Attendance loaded, ${(p as { count: number }).count} members`,
		attendance_save_failed: () => 'Could not save attendance.',
		attendance_saved: () => 'Saved.',
		attendance_tally: (p) => {
			const t = p as { present: number; absent: number; late: number };
			return `${t.present} present · ${t.absent} absent · ${t.late} late`;
		},
		attendance_tally_unconfirmed: () => 'Counts include unconfirmed changes.',
		attendance_close: () => 'Close',
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_season_summary: () => 'This season',
		attendance_season_rate: (p) => {
			const r = p as { attended: number; total: number };
			return `Attended ${r.attended} of ${r.total} events`;
		},
		attendance_member_rate: (p) => {
			const r = p as { attended: number; total: number };
			return `${r.attended} of ${r.total}`;
		},
		attendance_all_members: () => 'All members',
		picker_partial_members_notice: () => 'Not every member is listed here'
	};
	return {
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadRosterMock,
	listAttendanceMock,
	listAllRsvpsForEventMock,
	applyAttendanceChangeMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	applyAttendanceChangeMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn().mockResolvedValue('not-editor')
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: listAttendanceMock,
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: (
		records: Array<{ attendanceId: string; memberId: string; status: string }>
	) => {
		const map: Record<string, { attendanceId: string; status: string }> = {};
		for (const r of records) map[r.memberId] = { attendanceId: r.attendanceId, status: r.status };
		return map;
	}
}));
// The write dispatch — mocked so a "write" can be resolved/held/rejected on
// demand; the queue orchestration around it (attendanceChangeQueue) stays
// REAL, exactly the applyRsvpChange seam of the #326 sibling spec.
vi.mock('$lib/attendance/attendanceOptimistic', () => ({
	applyAttendanceChange: applyAttendanceChangeMock
}));
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
import { toListRead } from '$lib/testing/listReadFixtures.js';

function agendaItem(id: string, startDatetime: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

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

/** ONE conducted recent event; `existing` seeds listAttendance for it. */
function setConductedRecentFixture(
	existing: Array<{ attendanceId: string; memberId: string; status: string }> = []
) {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [agendaItem('past-1', '2026-06-10T16:00:00.000Z')],
			seasonId: 's1',
			seasonConductors: ['person-p'],
			seasonOwners: [],
			seasonEditors: []
		})
	);
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listAttendanceMock.mockResolvedValue(existing);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

/** TWO conducted recent events sharing the same roster — the cross-event pins. */
function setTwoConductedRecentEventsFixture() {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [
				agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
				agendaItem('past-2', '2026-06-03T16:00:00.000Z')
			],
			seasonId: 's1',
			seasonConductors: ['person-p'],
			seasonOwners: [],
			seasonEditors: []
		})
	);
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function rowSavedText(container: HTMLElement, memberId: string): string {
	return q(container, `attendance-saved-status-${memberId}`)?.textContent?.trim() ?? '';
}

async function openPanel(container: HTMLElement, eventId = 'past-1') {
	await waitFor(() => {
		expect(
			container.querySelector(
				`[data-testid="agenda-recent-row-${eventId}"] [data-testid="take-attendance-btn"]`
			)
		).not.toBeNull();
	});
	await fireEvent.click(
		container.querySelector(
			`[data-testid="agenda-recent-row-${eventId}"] [data-testid="take-attendance-btn"]`
		)!
	);
	await waitFor(() => {
		expect(q(container, 'attendance-row-m1')).not.toBeNull();
	});
}

async function closePanel(container: HTMLElement) {
	await fireEvent.click(q(container, 'attendance-collapse-btn')!);
	await waitFor(() => {
		expect(q(container, 'attendance-panel')).toBeNull();
	});
}

// Safe defaults so unrelated resolve calls don't hang.
findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue(toListRead([]));
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	applyAttendanceChangeMock.mockReset();
	discoverMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
	resetConductor();
});

describe('+page — the saved cue fires on reconcile, per (event, member) (#327)', () => {
	it("a successful write puts the saved announcement on THAT member's row — and the reconciled value stays pressed", async () => {
		setConductedRecentFixture();
		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
		const { container } = render(Page);
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('Saved.');
		});
		expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({ eventId: 'past-1', memberId: 'm1', newStatus: 'present' })
		);
		expect(
			q(container, 'attendance-toggle-m1-present')?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it("per-member granularity: the OTHER member's row shows no saved cue — a cue never claims more than the row that reconciled", async () => {
		setConductedRecentFixture();
		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
		const { container } = render(Page);
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('Saved.');
		});

		expect(rowSavedText(container, 'm2')).toBe('');
		expect(q(container, 'attendance-row-m2')?.textContent).not.toContain('Saved.');
	});

	it('a successfully CLEARED record announces saved too — tapping the ACTIVE status clears it, reconciled-null looks exactly like never-marked', async () => {
		// m1 is already marked present on the server — tapping Present clears her.
		setConductedRecentFixture([{ attendanceId: 'att-1', memberId: 'm1', status: 'present' }]);
		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: null });
		const { container } = render(Page);
		await openPanel(container);
		await waitFor(() => {
			expect(
				q(container, 'attendance-toggle-m1-present')?.getAttribute('aria-pressed')
			).toBe('true');
		});

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('Saved.');
		});
		expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({ eventId: 'past-1', memberId: 'm1', newStatus: null })
		);
		for (const status of ['present', 'absent', 'late']) {
			expect(
				q(container, `attendance-toggle-m1-${status}`)?.getAttribute('aria-pressed'),
				`attendance-toggle-m1-${status}`
			).toBe('false');
		}
	});

	it('READ PATH SILENT: opening a panel over records saved earlier announces nothing — the cue reports a write, never a read', async () => {
		setConductedRecentFixture([
			{ attendanceId: 'att-1', memberId: 'm1', status: 'present' },
			{ attendanceId: 'att-2', memberId: 'm2', status: 'late' }
		]);
		const { container } = render(Page);
		await openPanel(container);

		expect(rowSavedText(container, 'm1')).toBe('');
		expect(rowSavedText(container, 'm2')).toBe('');
		expect(q(container, 'attendance-panel')?.textContent).not.toContain('Saved.');
	});
});

describe('+page — pending stays SILENT (byte-preserved) and the tally says unconfirmed while a write is in flight (#327)', () => {
	it('in flight: aria-busy silent disable + NO saved text on the row, and the tally line carries the visible unconfirmed marking; settled: marking gone, cue on', async () => {
		// m2 present is server-settled; m1's write is held in flight.
		setConductedRecentFixture([{ attendanceId: 'att-2', memberId: 'm2', status: 'present' }]);
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValue(held.promise);
		const { container } = render(Page);
		await openPanel(container);

		// Before any tap: settled counts, NO unconfirmed marking.
		expect(q(container, 'attendance-tally-unconfirmed')).toBeNull();

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(
				q(container, 'attendance-status-group-m1')?.getAttribute('aria-busy')
			).toBe('true');
		});
		for (const status of ['present', 'absent', 'late']) {
			expect(
				q(container, `attendance-toggle-m1-${status}`)?.getAttribute('aria-disabled'),
				`attendance-toggle-m1-${status}`
			).toBe('true');
		}
		expect(rowSavedText(container, 'm1')).toBe('');
		expect(q(container, 'attendance-row-m1')?.textContent).not.toContain('Saved.');
		// The tally now counts m1's OPTIMISTIC present (2 present) — so it says so.
		const marker = container.querySelector(
			'[data-testid="attendance-tally"] [data-testid="attendance-tally-unconfirmed"]'
		);
		expect(marker).not.toBeNull();
		expect(marker?.textContent).toContain('Counts include unconfirmed changes.');

		held.resolve({ attendanceId: 'att-new-1' });
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('Saved.');
		});
		// Every write settled — the counts are server-confirmed, the marking goes.
		expect(q(container, 'attendance-tally-unconfirmed')).toBeNull();
	});

	it('after a saved cue, STARTING the next write for that member removes it — the cue always describes the LATEST write', async () => {
		setConductedRecentFixture();
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock
			.mockResolvedValueOnce({ attendanceId: 'att-new-1' })
			.mockReturnValueOnce(held.promise);
		const { container } = render(Page);
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('Saved.');
		});

		// Second tap — a NEW write starts (held in flight): the stale cue must go.
		await fireEvent.click(q(container, 'attendance-toggle-m1-late')!);
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toBe('');
		});
		expect(q(container, 'attendance-row-m1')?.textContent).not.toContain('Saved.');
		held.resolve({ attendanceId: 'att-new-1' });
	});
});

describe('+page — the failure path is byte-preserved, and failure never announces saved (#327)', () => {
	it('a rejected write: value reverts + per-row role=alert, NO saved cue', async () => {
		setConductedRecentFixture();
		applyAttendanceChangeMock.mockRejectedValue(new Error('save failed'));
		const { container } = render(Page);
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(q(container, 'attendance-save-failed-m1')).not.toBeNull();
		});
		expect(q(container, 'attendance-save-failed-m1')?.getAttribute('role')).toBe('alert');
		expect(
			q(container, 'attendance-toggle-m1-present')?.getAttribute('aria-pressed')
		).toBe('false');
		expect(rowSavedText(container, 'm1')).toBe('');
		expect(q(container, 'attendance-row-m1')?.textContent).not.toContain('Saved.');
	});

	it('a failure AFTER an earlier saved clears the stale cue — error and saved never show together on a row', async () => {
		setConductedRecentFixture();
		applyAttendanceChangeMock
			.mockResolvedValueOnce({ attendanceId: 'att-new-1' })
			.mockRejectedValueOnce(new Error('save failed'));
		const { container } = render(Page);
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('Saved.');
		});

		await fireEvent.click(q(container, 'attendance-toggle-m1-late')!);
		await waitFor(() => {
			expect(q(container, 'attendance-save-failed-m1')).not.toBeNull();
		});
		expect(rowSavedText(container, 'm1')).toBe('');
		expect(q(container, 'attendance-row-m1')?.textContent).not.toContain('Saved.');
	});
});

describe("+page — the cue never leaks across events (#327 per-(event,member) granularity)", () => {
	it("a cue earned on event A's row is NOT shown when the panel opens on event B — same member id, different event", async () => {
		setTwoConductedRecentEventsFixture();
		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
		const { container } = render(Page);

		await openPanel(container, 'past-1');
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('Saved.');
		});

		await closePanel(container);
		await openPanel(container, 'past-2');

		expect(rowSavedText(container, 'm1')).toBe('');
		expect(q(container, 'attendance-panel')?.textContent).not.toContain('Saved.');
	});

	it("a write for event A that settles while event B's panel is open never paints B's rows (stale settle)", async () => {
		setTwoConductedRecentEventsFixture();
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValueOnce(held.promise);
		const { container } = render(Page);

		await openPanel(container, 'past-1');
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(applyAttendanceChangeMock).toHaveBeenCalledTimes(1);
		});

		await closePanel(container);
		await openPanel(container, 'past-2');

		// NOW event A's write settles — it must not claim a row in B's panel.
		held.resolve({ attendanceId: 'att-new-1' });
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));

		expect(rowSavedText(container, 'm1')).toBe('');
		expect(q(container, 'attendance-panel')?.textContent).not.toContain('Saved.');
	});
});

// (*MVOX:Tallis* — #327 RED)
