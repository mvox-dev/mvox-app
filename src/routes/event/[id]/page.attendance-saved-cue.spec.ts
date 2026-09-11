// @vitest-environment happy-dom
//
// #327 RED (event-page integration) — the attendance saved cue on the WRITE
// path, host page 2 of 2 (the event-detail page's own "Take attendance"
// panel — the SAME AttendanceSurface the agenda mounts, fed by this page's
// own attendanceQueue instance).
//
// INTEGRATION posture: the REAL +page.svelte, the REAL attendanceChangeQueue,
// the REAL AttendanceSurface; the load-bearing reads (loadEventDetail /
// loadRoster / listAttendance / listAllRsvpsForEvent) and the write dispatch
// (applyAttendanceChange) are module-mocked — the same seam family as
// page.attendance-panel.spec.ts on the agenda side, so the queue orchestration
// and the page's isCurrentAttendanceWrite/generation discipline stay real.
// A catch-all fetch stub keeps stray platform reads harmless.
//
// Pins (the #326 event-page sibling's, per-(event,member)):
//   1. READ PATH SILENT — loading a panel over records saved earlier
//      announces nothing; the persistent per-row role="status" region
//      pre-exists the announcement (the #267 rule).
//   2. A settled write announces saved on THIS page's panel, on the row that
//      reconciled and no other.
//   3. PENDING BYTE-PRESERVED — the PO-ruled silent disable stays (aria-busy
//      + aria-disabled, no saved text), and the tally line carries the
//      visible unconfirmed marking while the write is in flight (the RED
//      stated choice, see AttendanceSurface.saved-cue.spec.ts).
//   4. FAILURE BYTE-PRESERVED — revert + per-row role=alert, no saved cue.
//   5. HOLD → SWITCH → SETTLE — a write that settles after a collective
//      switch never paints the cue onto the reloaded page: the page's
//      existing generation discipline extends to the cue.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — every key renders `[key]`/`[key {params}]`;
// assertions pin KEYS, the copy is Comenius's (locale-file pins live in
// src/lib/i18n/attendanceSavedKeys.spec.ts).
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const pageStub = vi.hoisted(() => ({
	params: { id: 'ev1' } as Record<string, string>,
	url: new URL('http://localhost/event/ev1')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

const {
	gotoMock,
	discoverMock,
	loadEventDetailMock,
	loadRosterMock,
	listAttendanceMock,
	listAllRsvpsForEventMock,
	applyAttendanceChangeMock
} = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	loadEventDetailMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	applyAttendanceChangeMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/events/eventDetail', async (importActual) => ({
	...(await importActual<typeof import('$lib/events/eventDetail')>()),
	loadEventDetail: loadEventDetailMock,
	listEventLocations: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/roster/rosterData', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/rosterData')>()),
	loadRoster: loadRosterMock
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock
}));
// The write dispatch — the queue around it stays REAL (same seam as the
// agenda-side sibling spec).
vi.mock('$lib/attendance/attendanceOptimistic', () => ({
	applyAttendanceChange: applyAttendanceChangeMock
}));
vi.mock('$lib/rsvp/rsvpData', async (importActual) => ({
	...(await importActual<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: vi.fn().mockResolvedValue('member-viewer'),
	findMyRsvpForEvent: vi.fn().mockResolvedValue(null)
}));
vi.mock('$lib/repertoire/workRows', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/collective/databaseEntity', async (importActual) => ({
	...(await importActual<typeof import('$lib/collective/databaseEntity')>()),
	resolveDatabaseEntityId: vi.fn().mockResolvedValue(null)
}));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import type { EventDetail } from '$lib/events/eventDetail';

/** ISO instant `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoAt(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString();
}

/** A PAST event the viewer conducts — the attendance section renders and the
 *  Take-attendance button is hers. */
function pastConductedDetail(): EventDetail {
	return {
		id: 'ev1',
		name: 'Tuesday Rehearsal',
		eventType: 'rehearsal',
		startDatetime: isoAt(-1),
		durationMinutes: 90,
		location: '',
		description: '',
		conductorIds: ['person-p'],
		conductorNames: ['Vera Viewer'],
		capacity: null,
		ownerIds: [],
		editorIds: [],
		seasonId: 'season1',
		seasonOwnerIds: [],
		seasonEditorIds: [],
		seriesId: null,
		inheritedFields: []
	};
}

const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

function setAuthed(dbs: string[] = ['polyphony']) {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((db) => [db, 'person-p'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'person-p' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0]);
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
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

function setFixtures(
	existing: Array<{ attendanceId: string; memberId: string; status: string }> = []
) {
	loadEventDetailMock.mockResolvedValue(pastConductedDetail());
	loadRosterMock.mockResolvedValue({ items: ROSTER, total: ROSTER.length, truncated: false });
	listAttendanceMock.mockResolvedValue(existing);
	listAllRsvpsForEventMock.mockResolvedValue([]);
}

function renderPage(dbs?: string[]) {
	// Stray platform reads (type-id resolution, series options, …) land here
	// and resolve harmlessly empty — the load-bearing reads are module-mocked.
	vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed(dbs);
	return render(Page);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function rowSavedText(container: HTMLElement, memberId: string): string {
	return q(container, `attendance-saved-status-${memberId}`)?.textContent?.trim() ?? '';
}

async function openPanel(container: HTMLElement) {
	await waitFor(() => {
		expect(q(container, 'take-attendance-btn')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'take-attendance-btn')!);
	await waitFor(() => {
		expect(q(container, 'attendance-row-m1')).not.toBeNull();
	});
}

async function flushMicrotasks(times = 6) {
	for (let i = 0; i < times; i++) await Promise.resolve();
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadEventDetailMock.mockReset();
	loadRosterMock.mockReset();
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	applyAttendanceChangeMock.mockReset();
	discoverMock.mockReset();
	resetTypeIdCache();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

describe('/event/[id] — the saved cue fires when the WRITE reconciles (#327)', () => {
	it('merely LOADING recorded attendance announces nothing — the region pre-exists, blank, role="status" aria-live="polite"', async () => {
		setFixtures([{ attendanceId: 'att-1', memberId: 'm1', status: 'present' }]);
		const { container } = renderPage();
		await openPanel(container);

		// The per-row region pre-exists the announcement (a live region must be
		// mounted BEFORE its text changes to be announced) …
		const region = q(container, 'attendance-saved-status-m1');
		expect(region).not.toBeNull();
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.getAttribute('aria-live')).toBe('polite');
		// …and a read never fills it: this record was saved long before this
		// panel opened.
		expect(rowSavedText(container, 'm1')).toBe('');
		expect(container.textContent).not.toContain('[attendance_saved]');
	});

	it("a settled write announces saved on THIS page's panel — on the reconciled member's row and no other", async () => {
		setFixtures();
		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
		const { container } = renderPage();
		await openPanel(container);

		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);

		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('[attendance_saved]');
		});
		expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
			expect.objectContaining({ eventId: 'ev1', memberId: 'm1', newStatus: 'present' })
		);
		expect(
			q(container, 'attendance-toggle-m1-present')?.getAttribute('aria-pressed')
		).toBe('true');
		expect(rowSavedText(container, 'm2')).toBe('');
	});

	it('in flight: the PO-ruled SILENT disable is byte-preserved AND the tally line says its counts are unconfirmed', async () => {
		setFixtures([{ attendanceId: 'att-2', memberId: 'm2', status: 'present' }]);
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValue(held.promise);
		const { container } = renderPage();
		await openPanel(container);

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
		expect(container.textContent).not.toContain('[attendance_saved]');
		// The panel's tally now counts m1's optimistic present — and says so,
		// visibly, on the tally line itself.
		const marker = container.querySelector(
			'[data-testid="attendance-tally"] [data-testid="attendance-tally-unconfirmed"]'
		);
		expect(marker).not.toBeNull();
		expect(marker?.textContent).toContain('[attendance_tally_unconfirmed]');

		held.resolve({ attendanceId: 'att-new-1' });
		await waitFor(() => {
			expect(rowSavedText(container, 'm1')).toContain('[attendance_saved]');
		});
		expect(q(container, 'attendance-tally-unconfirmed')).toBeNull();
	});

	it('failure path byte-preserved: revert + per-row role=alert — and NO saved cue', async () => {
		setFixtures();
		applyAttendanceChangeMock.mockRejectedValue(new Error('save failed'));
		const { container } = renderPage();
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
		expect(container.textContent).not.toContain('[attendance_saved]');
	});
});

describe('/event/[id] — the cue does not leak across a collective switch (#327, hold → switch → settle)', () => {
	it('a write that settles AFTER the switch never paints the saved cue onto the reloaded page', async () => {
		setFixtures();
		const held = deferred<{ attendanceId: string | null }>();
		applyAttendanceChangeMock.mockReturnValueOnce(held.promise);
		const { container } = renderPage(['polyphony', 'other-choir']);
		await openPanel(container);

		// The write starts under polyphony…
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(
				q(container, 'attendance-status-group-m1')?.getAttribute('aria-busy')
			).toBe('true');
		});

		// …the conductor switches collectives (the page reloads ev1 under the
		// new db — the mocks serve the same fixtures for both)…
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
		// …and reopens the panel there.
		await openPanel(container);

		// Only NOW the old write settles successfully. The saved cue must not
		// appear: it would describe a write from the collective she left.
		held.resolve({ attendanceId: 'att-new-1' });
		await flushMicrotasks();

		expect(rowSavedText(container, 'm1')).toBe('');
		expect(container.textContent).not.toContain('[attendance_saved]');
	});
});

// (*MVOX:Tallis* — #327 RED)
