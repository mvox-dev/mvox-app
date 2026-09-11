// @vitest-environment happy-dom
//
// #326 RED (agenda-page integration) — the saved cue on the WRITE path.
//
// Renders the real +page -> AgendaList -> RsvpControl chain and drives real
// taps through the real rsvpChangeQueue (only the write dispatch
// applyRsvpChange and the data reads are mocked). Pins:
//
//   1. SAVED CUE ON RECONCILE — when a write settles successfully, the
//      per-row saved announcement fires on the reconciled event's row.
//   2. PER-EVENT GRANULARITY — the cue never claims more than the key that
//      reconciled: the OTHER row shows nothing.
//   3. THE DANGEROUS PAIR — an optimistic value never sits on screen
//      unconfirmed without the state saying so: while a write is in flight
//      the row is aria-busy (the PO-ruled SILENT disable, byte-preserved —
//      no saved text, no new text); once reconciled, the saved cue says so.
//      A NEW tap clears the previous saved cue the moment the next write
//      starts.
//   4. FAILURE PATH BYTE-PRESERVED — a rejected write still reverts the
//      value and raises the role=alert error; no saved cue appears, and a
//      failure AFTER an earlier saved clears that stale cue.
//   5. A successfully CLEARED answer announces too — reconciled-null renders
//      identically to never-answered, so the cue is the only distinguisher.
//   6. MULTI-COLLECTIVE — the cue does not leak across a collective switch,
//      even onto an event with the SAME id in the next collective.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import type { AgendaItem } from '$lib/agenda/types';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_group_label: () => 'RSVP',
		rsvp_non_member_hint: () => 'Only members can RSVP.',
		rsvp_save_failed: () => 'Could not save your answer.',
		rsvp_saved: () => 'Saved.'
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
	applyRsvpChangeMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	applyRsvpChangeMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: loadFullAgendaMock
}));
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
// The write dispatch — mocked so a "write" can be resolved/held/rejected on
// demand; the queue orchestration around it stays real.
vi.mock('$lib/rsvp/rsvpOptimistic', () => ({ applyRsvpChange: applyRsvpChangeMock }));

vi.mock('$lib/roster/rosterData', () => ({ loadRoster: vi.fn() }));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn(),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn(),
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
import { toListRead } from '$lib/testing/listReadFixtures.js';

function agendaEvent(id: string, startDatetime: string) {
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

const E1 = agendaEvent('e1', '2026-06-15T09:00:00.000Z');
const E2 = agendaEvent('e2', '2026-06-16T09:00:00.000Z');

function agendaWith(events: AgendaItem[]) {
	return fullAgendaResult({
		seasons: [],
		upcoming: events,
		recent: [],
		seasonId: null,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: []
	});
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

function setAuthed(dbs: Array<{ db: string; name: string }>) {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((d) => [d.db, 'person-p'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((d) => ({ db: d.db, name: d.name, personId: 'person-p' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0].db);
	completionGateStore.set('complete');
}

function row(container: HTMLElement, id: string): HTMLElement | null {
	return container.querySelector(`[data-testid="agenda-row-${id}"]`);
}

function rowSavedText(container: HTMLElement, id: string): string {
	return (
		row(container, id)
			?.querySelector('[data-testid="rsvp-saved-status"]')
			?.textContent?.trim() ?? ''
	);
}

async function waitForEnabledButton(container: HTMLElement, eventId: string, status: string) {
	return waitFor(() => {
		const btn = row(container, eventId)?.querySelector(
			`[data-testid="rsvp-btn-${status}"]`
		) as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn!.disabled).toBe(false);
		return btn!;
	});
}

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	applyRsvpChangeMock.mockReset();
	discoverMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetGate();
});

describe('+page — the saved cue fires on reconcile, per event (#326)', () => {
	it("a successful write puts the saved announcement on THAT row — and the reconciled value stays pressed", async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1, E2]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: 'rsvp-new-1' });
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});
		// The reconciled value renders — pressed, and the state SAYS saved.
		expect(
			row(container, 'e1')
				?.querySelector('[data-testid="rsvp-btn-going"]')
				?.getAttribute('aria-pressed')
		).toBe('true');
	});

	it('per-event granularity: the OTHER row shows no saved cue — a cue never claims more than the key that reconciled', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1, E2]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: 'rsvp-new-1' });
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		expect(rowSavedText(container, 'e2')).toBe('');
		expect(row(container, 'e2')?.textContent).not.toContain('Saved.');
	});

	it('a successfully CLEARED answer announces saved too — reconciled-null looks exactly like never-answered, the cue is the only distinguisher', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		// She already answered e1 "going" — tapping the ACTIVE status clears it.
		listMyRsvpsMock.mockResolvedValue(
			toListRead([{ rsvpId: 'rsvp-77', eventId: 'e1', status: 'going' }])
		);
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: null });
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');
		await waitFor(() => {
			expect(goingBtn.getAttribute('aria-pressed')).toBe('true');
		});

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});
		// The reconciled state is UNANSWERED — all four unpressed…
		for (const status of ['going', 'not_going', 'maybe', 'late']) {
			expect(
				row(container, 'e1')
					?.querySelector(`[data-testid="rsvp-btn-${status}"]`)
					?.getAttribute('aria-pressed'),
				`rsvp-btn-${status}`
			).toBe('false');
		}
	});
});

describe('+page — the dangerous pair: pending stays SILENT (byte-preserved), and a new write clears the stale saved cue', () => {
	it('while the write is in flight: aria-busy silent disable, NO saved text, NO other new text (PO ruling byte-preserved)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const held = deferred<{ rsvpId: string }>();
		applyRsvpChangeMock.mockReturnValue(held.promise);
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(
				row(container, 'e1')
					?.querySelector('[data-testid="rsvp-control"]')
					?.getAttribute('aria-busy')
			).toBe('true');
		});
		expect(rowSavedText(container, 'e1')).toBe('');
		expect(
			row(container, 'e1')
				?.querySelector('[data-testid="rsvp-msg-line"]')
				?.textContent?.trim()
		).toBe('');
		// Settle so teardown never leaks a pending write into the next test.
		held.resolve({ rsvpId: 'rsvp-new-1' });
	});

	it('after a saved cue, STARTING the next write removes it — the cue always describes the LATEST write, never a stale one', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		const held = deferred<{ rsvpId: string }>();
		applyRsvpChangeMock
			.mockResolvedValueOnce({ rsvpId: 'rsvp-new-1' })
			.mockReturnValueOnce(held.promise);
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		// Second tap — a NEW write starts (held in flight): the stale cue must go.
		const maybeBtn = await waitForEnabledButton(container, 'e1', 'maybe');
		await fireEvent.click(maybeBtn);

		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toBe('');
		});
		expect(row(container, 'e1')?.textContent).not.toContain('Saved.');
		held.resolve({ rsvpId: 'rsvp-new-1' });
	});
});

describe('+page — the failure path is byte-preserved, and failure never announces saved', () => {
	it('a rejected write: value reverts + role=alert error, NO saved cue', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockRejectedValue(new Error('save failed'));
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);

		await waitFor(() => {
			expect(row(container, 'e1')?.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(row(container, 'e1')?.textContent).toContain('Could not save your answer.');
		expect(
			row(container, 'e1')
				?.querySelector('[data-testid="rsvp-btn-going"]')
				?.getAttribute('aria-pressed')
		).toBe('false');
		expect(rowSavedText(container, 'e1')).toBe('');
		expect(row(container, 'e1')?.textContent).not.toContain('Saved.');
	});

	it('a failure AFTER an earlier saved clears the stale cue — error and saved never show together', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaWith([E1]));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock
			.mockResolvedValueOnce({ rsvpId: 'rsvp-new-1' })
			.mockRejectedValueOnce(new Error('save failed'));
		setAuthed([{ db: 'polyphony', name: 'Polyphony' }]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		const maybeBtn = await waitForEnabledButton(container, 'e1', 'maybe');
		await fireEvent.click(maybeBtn);

		await waitFor(() => {
			expect(row(container, 'e1')?.querySelector('[data-testid="rsvp-save-failed"]')).not.toBeNull();
		});
		expect(rowSavedText(container, 'e1')).toBe('');
		expect(row(container, 'e1')?.textContent).not.toContain('Saved.');
	});
});

describe('+page — the saved cue does not leak across a collective switch (#326 pin 7)', () => {
	it("a cue earned in collective A is GONE after switching to B — even on an event with the SAME id", async () => {
		// Collective B deliberately reuses the id 'e1': if savedEventIds survives
		// the switch, B's unrelated event would claim "Saved." for a write it
		// never saw — the exact leak under test. (loadFullAgenda takes no args —
		// the served agenda is flipped via this variable at the switch.)
		let servedAgenda = agendaWith([E1]);
		loadFullAgendaMock.mockImplementation(() => Promise.resolve(servedAgenda));
		findMyMemberIdMock.mockResolvedValue('member-1');
		listMyRsvpsMock.mockResolvedValue(toListRead([]));
		applyRsvpChangeMock.mockResolvedValue({ rsvpId: 'rsvp-new-1' });
		setAuthed([
			{ db: 'polyphony', name: 'Polyphony' },
			{ db: 'other-choir', name: 'Other Choir' }
		]);

		const { container } = render(Page);
		const goingBtn = await waitForEnabledButton(container, 'e1', 'going');

		await fireEvent.click(goingBtn);
		await waitFor(() => {
			expect(rowSavedText(container, 'e1')).toContain('Saved.');
		});

		// Switch to B.
		const callsBefore = loadFullAgendaMock.mock.calls.length;
		servedAgenda = agendaWith([agendaEvent('e1', '2026-07-01T09:00:00.000Z')]);
		selectedCollectiveDbStore.set('other-choir');

		// B's agenda renders (same event id), with NO saved cue anywhere.
		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThan(callsBefore);
			expect(row(container, 'e1')).not.toBeNull();
			expect(rowSavedText(container, 'e1')).toBe('');
		});
		expect(container.textContent).not.toContain('Saved.');
	});
});

// (*MVOX:Tallis* — #326 RED)
