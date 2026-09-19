// @vitest-environment happy-dom
//
// #356 RED (event-page integration) — 'Take attendance' on the event view is
// gated on EVENT RIGHTS (canMarkAttendance: manageRightsFrom(detail.ownerIds,
// detail.editorIds, personId) === 'editor'), NOT on the conductor seat.
//
// Before #356 the page's gate was `detail.conductorIds.includes(personId)`
// (isConductorForEvent) — it decided the button, the panel-open guard AND
// whether the attendance section renders at all on a record-less past event.
// All three now follow the rights rule:
//   • an event EDITOR with NO seat sees the button, opens the panel, records;
//   • an event OWNER with no seat sees it too (ownership subsumes editing);
//   • a SEAT-ONLY conductor on a record-less past event gets NO section, no
//     button, no empty panel — the seat is display data (conductor names),
//     not a write grant.
//
// INTEGRATION posture: the REAL +page.svelte; the load-bearing reads
// (loadEventDetail / loadRoster / listAttendance / listAllRsvpsForEvent) and
// the write dispatch (applyAttendanceChange) are module-mocked — the same seam
// family as page.attendance-saved-cue.spec.ts on this route. loadEventDetail's
// producer contract (event `_owner`/`_editor` → ownerIds/editorIds) is pinned
// in eventDetail's own specs and driven over the wire in page.spec.ts.
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

/** A PAST event; the caller pins exactly who holds what on it. */
function pastDetail(over: Partial<EventDetail> = {}): EventDetail {
	return {
		id: 'ev1',
		name: 'Tuesday Rehearsal',
		eventType: 'rehearsal',
		startDatetime: isoAt(-1),
		durationMinutes: 90,
		location: '',
		description: '',
		conductorIds: [],
		conductorNames: [],
		capacity: null,
		ownerIds: [],
		editorIds: [],
		seasonId: 'season1',
		seasonOwnerIds: [],
		seasonEditorIds: [],
		seriesId: null,
		inheritedFields: [],
		...over
	};
}

const ROSTER = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

function setAuthed() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function setFixtures(
	detail: EventDetail,
	existing: Array<{ attendanceId: string; memberId: string; status: string }> = []
) {
	loadEventDetailMock.mockResolvedValue(detail);
	loadRosterMock.mockResolvedValue({ items: ROSTER, total: ROSTER.length, truncated: false });
	listAttendanceMock.mockResolvedValue(existing);
	listAllRsvpsForEventMock.mockResolvedValue([]);
}

function renderPage() {
	// Stray platform reads (type-id resolution, series options, …) land here
	// and resolve harmlessly empty — the load-bearing reads are module-mocked.
	vi.stubGlobal('fetch', vi.fn(async () => json({ entities: [] })));
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthed();
	return render(Page);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
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

describe('/event/[id] — the marking gate is EVENT RIGHTS, not the seat (#356)', () => {
	it('an event EDITOR with NO conductor seat sees Take attendance, opens the panel, and records', async () => {
		// person-p holds `_editor` on the event; the seat belongs to someone
		// else entirely. Before #356 she had no affordance here at all.
		setFixtures(
			pastDetail({
				editorIds: ['person-p'],
				conductorIds: ['person-someone-else'],
				conductorNames: ['Sofia Someone']
			})
		);
		const { container } = renderPage();

		await waitFor(() => {
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'take-attendance-btn')!);
		await waitFor(() => {
			expect(q(container, 'attendance-panel')).not.toBeNull();
			expect(q(container, 'attendance-row-m1')).not.toBeNull();
		});

		// …and she can RECORD: the write dispatch fires for this event.
		applyAttendanceChangeMock.mockResolvedValue({ attendanceId: 'att-new-1' });
		await fireEvent.click(q(container, 'attendance-toggle-m1-present')!);
		await waitFor(() => {
			expect(applyAttendanceChangeMock).toHaveBeenCalledWith(
				expect.objectContaining({ eventId: 'ev1', memberId: 'm1', newStatus: 'present' })
			);
		});
	});

	it('an event OWNER with no seat sees the button too — ownership subsumes editing', async () => {
		setFixtures(pastDetail({ ownerIds: ['person-p'] }));
		const { container } = renderPage();

		await waitFor(() => {
			expect(q(container, 'take-attendance-btn')).not.toBeNull();
		});
	});

	it('a SEAT-ONLY conductor on a record-less past event gets NO section, no button, no empty panel (#356 retires the seat as a gate)', async () => {
		// The exact fixture that used to admit her: the seat, nothing recorded,
		// no rights. The section only existed to give HER button somewhere to
		// live — without the write grant there is nothing to show.
		setFixtures(
			pastDetail({ conductorIds: ['person-p'], conductorNames: ['Vera Viewer'] }),
			[]
		);
		const { container } = renderPage();

		// Settle: the detail rendered before the absences are asserted.
		await waitFor(() => {
			expect(q(container, 'event-detail-name')?.textContent).toContain('Tuesday Rehearsal');
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(q(container, 'event-detail-attendance')).toBeNull();
		expect(q(container, 'take-attendance-btn')).toBeNull();
		expect(q(container, 'attendance-panel')).toBeNull();
	});

	it('neither rights nor seat, records present: the tally stays (domain data) but no affordance and no panel', async () => {
		setFixtures(pastDetail(), [
			{ attendanceId: 'att-1', memberId: 'm1', status: 'present' }
		]);
		const { container } = renderPage();

		await waitFor(() => {
			expect(q(container, 'event-detail-attendance')).not.toBeNull();
		});
		expect(q(container, 'take-attendance-btn')).toBeNull();
		expect(q(container, 'attendance-panel')).toBeNull();
	});
});

// (*MVOX:Tallis* — #356 RED)
