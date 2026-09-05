// @vitest-environment happy-dom
//
// #255 (D) RED — the going-tally fold-in, DATE-GATED (Gama's pre-build
// question, refined 15:31; folds under done-when 2). `loadTally` today counts
// a raw filter over ALL rsvp rows for the event — not roster-joined — and
// feeds the capacity line, so a deactivated member's old "yes" inflates a
// count the conductor plans around. Pinned here, BOTH directions:
//
//   (i)  FUTURE event — counts join against the ACTIVE roster: her 'going'
//        drops out (attendanceSummary precedent; join is CLIENT-side — a
//        two-hop server join is impossible on Entu single-hop reads).
//   (ii) PAST event — the tally stays AS RECORDED, raw and unjoined: she said
//        yes, she very likely sang; dropping her would rewrite a historical
//        number on the basis of present membership (the same wrong as showing
//        a rate). BOUNDARY, deliberate: pastness is event START (startAt <
//        now, the page's own :669 rule) — an event in progress counts as past
//        and keeps the raw tally.
//
// STALE-CLOSURE PIN (Bentham pre-branch finding): the gate must be evaluated
// for THE EVENT THE TALLY WAS REQUESTED FOR, at request time — the page's
// per-event form (isPastDetail / a value captured at call time), NEVER the
// live `isPast` $derived read inside an async continuation. The capture test
// below moves the CLOCK past the event's start while the tally read is in
// flight: a resolution-time pastness read sees "past" and serves the raw
// count; a call-time capture sees "future" and joins. Only the join passes.
//
// Her rsvp ROW is never deleted either way (deleteRsvp must stay uncalled).
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-08-20T10:00:00.000Z');
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
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
	findMyMemberIdMock,
	listMyRsvpsMock,
	deleteRsvpMock,
	listAllRsvpsForEventMock,
	listAttendanceMock,
	loadRosterMock,
	listActiveMembersMock
} = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	discoverMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	deleteRsvpMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listActiveMembersMock: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/rsvp/rsvpData', async (importActual) => ({
	...(await importActual<typeof import('$lib/rsvp/rsvpData')>()),
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: deleteRsvpMock
}));
// Whichever active-members read GREEN joins through — the ids-only query or
// the name-resolving roster — both answer the same active set here.
vi.mock('$lib/roster/rosterData', async (importActual) => ({
	...(await importActual<typeof import('$lib/roster/rosterData')>()),
	loadRoster: loadRosterMock,
	listActiveMembers: listActiveMembersMock
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	listAttendance: listAttendanceMock
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));

import Page from './+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── wire fixtures (the event read stays REAL — only rsvp/roster/attendance
//    module reads are mocked) ─────────────────────────────────────────────────

function eventEntity(startDatetime: string, over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'ev1',
		name: [{ _id: 'val-name-1', string: 'Tuesday Rehearsal' }],
		event_type: [{ _id: 'val-type-1', string: 'rehearsal' }],
		start_datetime: [{ _id: 'val-start-1', datetime: startDatetime }],
		duration_minutes: [{ _id: 'val-dur-1', number: 180 }],
		location: [{ _id: 'val-loc-1', string: 'Rehearsal Hall' }],
		capacity: [{ _id: 'val-cap-1', number: 20 }],
		// The viewer holds `_editor` — canSeeTally passes, the tally renders.
		_editor: [{ reference: 'p-viewer' }],
		_parent: [{ reference: 'org1', entity_type: 'organization' }],
		...over
	};
}

function readWireStub(event: Record<string, unknown>) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/entity/ev1')) return json({ entity: event });
		return json({ entities: [] });
	});
}

// Active roster: the viewer (m-viewer) and one other singer (m-active).
// m-gone is DEACTIVATED — present only in the rsvp rows.
const ACTIVE_ROSTER = [
	{ memberId: 'm-viewer', personId: 'p-viewer', name: 'Vera Viewer', email: 'v@example.com' },
	{ memberId: 'm-active', personId: 'p-active', name: 'Alice Alto', email: 'a@example.com' }
];
const ACTIVE_MEMBERS = ACTIVE_ROSTER.map((r) => ({
	memberId: r.memberId,
	personId: r.personId,
	sectionIds: [],
	dbEntityId: 'db-1'
}));

const RSVP_ROWS = [
	{ rsvpId: 'r1', memberId: 'm-active', status: 'going' },
	{ rsvpId: 'r2', memberId: 'm-gone', status: 'going' }, // the deactivated member's recorded yes
	{ rsvpId: 'r3', memberId: 'm-viewer', status: 'maybe' }
];

function setAuthedWithPolyphony() {
	setToken('jwt-token');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p-viewer' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p-viewer' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	findMyMemberIdMock.mockResolvedValue('m-viewer');
	listMyRsvpsMock.mockResolvedValue([]);
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue(RSVP_ROWS);
	loadRosterMock.mockResolvedValue(ACTIVE_ROSTER);
	listActiveMembersMock.mockResolvedValue(ACTIVE_MEMBERS);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.clearAllMocks();
	localStorage.clear();
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

function renderPage(event: Record<string, unknown>) {
	const stub = readWireStub(event);
	vi.stubGlobal('fetch', stub);
	pageStub.params = { id: 'ev1' };
	pageStub.url = new URL('http://localhost/event/ev1');
	setAuthedWithPolyphony();
	return render(Page);
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function tallyGoing(container: HTMLElement): Promise<string> {
	const el = await waitFor(() => {
		const node = q(container, 'event-detail-tally-going');
		expect(node, 'tally not rendered').not.toBeNull();
		return node!;
	});
	return el.textContent ?? '';
}

describe('(D) going-tally — FUTURE event joins against the active roster', () => {
	it("a deactivated member's 'going' no longer inflates a future event's count: going=1, not 2", async () => {
		const { container } = renderPage(eventEntity('2026-09-01T16:00:00.000Z')); // 12 days out
		expect(await tallyGoing(container)).toContain('"count":1');
	});

	it('the other counts are joined the same way (full-shape: maybe keeps the active viewer, nothing invents rows)', async () => {
		const { container } = renderPage(eventEntity('2026-09-01T16:00:00.000Z'));
		await tallyGoing(container);
		expect(q(container, 'event-detail-tally-maybe')?.textContent).toContain('"count":1');
		expect(q(container, 'event-detail-tally-not_going')?.textContent).toContain('"count":0');
		expect(q(container, 'event-detail-tally-late')?.textContent).toContain('"count":0');
	});

	it('her rsvp ROW is untouched — the join is a read-side filter, never a delete', async () => {
		const { container } = renderPage(eventEntity('2026-09-01T16:00:00.000Z'));
		await tallyGoing(container);
		expect(deleteRsvpMock).not.toHaveBeenCalled();
	});
});

describe('(D) going-tally — PAST event keeps the recorded raw tally', () => {
	it('an event whose START has passed (even one still in progress — the stated boundary) counts her recorded yes: going=2', async () => {
		// Started 30 minutes ago, runs 180 — in progress RIGHT NOW, past by the
		// page's own start-instant rule (:669). Raw tally, as recorded.
		const { container } = renderPage(eventEntity('2026-08-20T09:30:00.000Z'));
		expect(await tallyGoing(container)).toContain('"count":2');
		expect(deleteRsvpMock).not.toHaveBeenCalled();
	});
});

describe('(D) stale-closure pin — the gate is captured for the REQUESTED event at request time', () => {
	it('an event that is FUTURE at tally-request time but PAST by resolution time still gets the JOINED count (resolution-time pastness reads are the trap)', async () => {
		// Event starts 60s from "now".
		let resolveRows!: (rows: typeof RSVP_ROWS) => void;
		listAllRsvpsForEventMock.mockReturnValue(
			new Promise((res) => {
				resolveRows = res;
			})
		);
		const { container } = renderPage(eventEntity('2026-08-20T10:01:00.000Z'));
		await waitFor(() => expect(listAllRsvpsForEventMock).toHaveBeenCalled());
		// The clock passes the event's start WHILE the read is in flight.
		vi.setSystemTime(new Date('2026-08-20T10:10:00.000Z'));
		resolveRows(RSVP_ROWS);
		// Call-time capture → still treated as future → joined. A live/late
		// pastness read would serve the raw 2 here.
		expect(await tallyGoing(container)).toContain('"count":1');
	});
});

describe('(E adjacent, unchanged) a deactivated viewer keeps her own prior answer, visible but disabled', () => {
	it('future event: her recorded going answer renders pressed, the control is disabled, the existing non-member hint shows', async () => {
		findMyMemberIdMock.mockResolvedValue(null); // status-scoped read drops her
		listMyRsvpsMock.mockResolvedValue([{ rsvpId: 'r-my', eventId: 'ev1', status: 'going' }]);
		// Plain-member view: no _editor list — no tally, just her own control.
		const { container } = renderPage(
			eventEntity('2026-09-01T16:00:00.000Z', { _editor: undefined })
		);
		const goingBtn = await waitFor(() => {
			const el = q(container, 'rsvp-btn-going');
			expect(el).not.toBeNull();
			return el as HTMLButtonElement;
		});
		await waitFor(() => expect(q(container, 'rsvp-non-member-hint')).not.toBeNull());
		expect(goingBtn.getAttribute('aria-pressed')).toBe('true');
		expect((goingBtn as HTMLButtonElement).disabled).toBe(true);
	});
});

// (*MVOX:Tallis*)
