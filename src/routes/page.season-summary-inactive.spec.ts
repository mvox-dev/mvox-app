// @vitest-environment happy-dom
//
// #255 done-when 3 RED — the season summary CALL SITE keeps a deactivated
// member's history. deriveAllMemberRates' row set comes from `loadRoster`
// (active-only) at +page.svelte's expand handler, so today her rows VANISH
// (row-drop, census read 6) — silently violating "past attendance keeps its
// subject", the reason deactivate beat delete. This spec forces the page to
// ALSO read the inactive roster (memberLifecycle.loadInactiveRoster) and to
// render her as a marked, count-only, rate-free row. The derive mechanics are
// pinned in attendanceSummary.inactive.spec.ts; this file pins the wiring.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	loadRosterMock,
	loadInactiveRosterMock,
	listAttendanceMock,
	listMyAttendanceMock,
	listAllRsvpsForEventMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	loadRosterMock: vi.fn(),
	loadInactiveRosterMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
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
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/roster/memberLifecycle', () => ({
	deactivateMember: vi.fn(),
	reinstateMember: vi.fn(),
	loadInactiveRoster: loadInactiveRosterMock,
	listInactiveMembers: vi.fn(),
	listDeactivateBlockers: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', async (importActual) => ({
	...(await importActual<typeof import('$lib/attendance/attendanceData')>()),
	listAttendance: listAttendanceMock,
	listMyAttendance: listMyAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn()
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
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';

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

beforeEach(() => {
	// Conductor seat inherited season-wide — the expand affordance renders.
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
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(toListRead([]));
	listAllRsvpsForEventMock.mockResolvedValue([]);
	// ACTIVE roster: Alice only. Gone Girl (m9) is deactivated — she exists only
	// in the inactive read and in the attendance records.
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
	]));
	loadInactiveRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm9', personId: 'pp-9', name: 'Gone Girl', email: '', sectionIds: ['sec-alto'] }
	]));
	listAttendanceMock.mockImplementation((_cfg: unknown, eventId: string) => {
		if (eventId === 'past-1') {
			return Promise.resolve([
				{ attendanceId: 'a1', memberId: 'm1', status: 'present' },
				{ attendanceId: 'a2', memberId: 'm9', status: 'present' }
			]);
		}
		return Promise.resolve([{ attendanceId: 'a3', memberId: 'm9', status: 'late' }]);
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
	resetConductor();
});

async function renderExpandedSummary() {
	const utils = render(Page);
	setAuthedWithOneCollective();
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull()
	);
	await fireEvent.click(utils.container.querySelector('[data-testid="season-summary-expand"]')!);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull()
	);
	return utils;
}

describe('season summary — a deactivated member keeps her rows (done-when 3, in-slice)', () => {
	it('the expanded view unions active AND inactive members: her row renders, marked inactive, with the attended COUNT', async () => {
		const { container } = await renderExpandedSummary();
		const row = container.querySelector('[data-testid="member-rate-inactive-m9"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain('Gone Girl');
		expect(row?.textContent).toContain('2'); // present@past-1 + late@past-2
	});

	it('her row shows NO rate — no attendance_member_rate message, no total, no percent (there is no honest denominator)', async () => {
		const { container } = await renderExpandedSummary();
		const row = container.querySelector('[data-testid="member-rate-inactive-m9"]');
		const text = row?.textContent ?? '';
		expect(text).not.toContain('[attendance_member_rate ');
		expect(text).not.toContain('%');
		expect(text).not.toContain('total');
	});

	it('the active member is untouched: full rate row with attended AND total over ALL season events', async () => {
		const { container } = await renderExpandedSummary();
		const row = container.querySelector('[data-testid="member-rate-m1"]');
		expect(row?.textContent).toContain('[attendance_member_rate {"attended":1,"total":2}]');
	});

	it('the inactive read failing does not silently drop her: the surface reports the load error instead of rendering a roster-only list as if complete', async () => {
		loadInactiveRosterMock.mockRejectedValue(new Error('boom'));
		const utils = render(Page);
		setAuthedWithOneCollective();
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull()
		);
		await fireEvent.click(utils.container.querySelector('[data-testid="season-summary-expand"]')!);
		await waitFor(() =>
			expect(utils.container.querySelector('[data-testid="season-rates-error"]')).not.toBeNull()
		);
		expect(utils.container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});
});

// ── #321 review F2, second pass: the rate table says when rows are missing ──────
//
// The PO's correction (2026-09-11): the reachability test EXTENDED the
// display-list criterion to option-lists, it did not replace it, so "nothing is
// picked in a roll-up" does not exempt this surface — a read that silently drops
// singers is the defect the issue was filed about. And this table is a
// particularly bad place for it: it invites comparison between named people, so a
// dropped singer is absent from a comparison the others are being judged in.
//
// EITHER member read raises it (active roster or archived), because the reader
// needs the same thing to know either way.
//
// NO collective-switch pin here, deliberately, and for TWO reasons — the order
// matters, because the second one is contingent and the first is not:
//
//   1. PRIMARY — `seasonRatesPartial` is cleared in BOTH switch teardowns, right
//      beside the `seasonMemberRates` it describes. The claim therefore cannot
//      outlive the rows under any render state, which is the property that makes
//      a leak impossible rather than merely unobservable.
//   2. SECONDARY — those teardowns also collapse the surface
//      (`seasonSummaryExpanded = false`), so today the notice unmounts with the
//      rows and no DOM-level leak is reachable for a spec to catch.
//
// Reason 2 alone would be a stale premise the day this summary defaults to
// expanded (or any surface keeps it mounted across a switch): the notice would
// then still be on screen after the switch, and only reason 1 keeps it honest.
// So the absent pin rests on the flag-clear, not on the unmount — and if that
// default ever changes, the pin becomes writable and worth adding, without this
// argument having to be re-derived.

describe('season summary — the rate table states a truncated member read (#321 review F2)', () => {
	const NOTICE = '[data-testid="season-summary-partial-notice"]';

	it('a truncated ACTIVE roster read renders the shared visible role="status" notice above the rows', async () => {
		loadRosterMock.mockResolvedValue({
			items: [{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }],
			total: 500,
			truncated: true
		});
		const { container } = await renderExpandedSummary();

		await waitFor(() => expect(container.querySelector(NOTICE)).not.toBeNull());
		const notice = container.querySelector(NOTICE)!;
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
		// Inside the members region, ahead of the rows it is about.
		const region = container.querySelector('[data-testid="season-summary-members"]')!;
		expect(region.querySelector(NOTICE)).not.toBeNull();
		const row = container.querySelector('[data-testid="member-rate-m1"]')!;
		expect(notice.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('a truncated ARCHIVED read raises the same notice — the history half drops singers too', async () => {
		loadInactiveRosterMock.mockResolvedValue({
			items: [{ memberId: 'm9', personId: 'pp-9', name: 'Gone Girl', email: '', sectionIds: [] }],
			total: 812,
			truncated: true
		});
		const { container } = await renderExpandedSummary();

		await waitFor(() => expect(container.querySelector(NOTICE)).not.toBeNull());
		// ONE notice for the table, not one per read.
		expect(container.querySelectorAll(NOTICE).length).toBe(1);
	});

	it('with both reads complete the notice is ABSENT from the DOM (not hidden — absent)', async () => {
		const { container } = await renderExpandedSummary();
		expect(container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull();

		expect(container.querySelector(NOTICE)).toBeNull();
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin* — #321 review F2 second pass: the rate table's partial notice)
