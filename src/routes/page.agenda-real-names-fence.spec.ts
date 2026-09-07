// @vitest-environment happy-dom
//
// #269 review F1/F2 — the SCOPE FENCE on the AGENDA (`src/routes/+page.svelte`).
//
// Henry's 2026-09-06 scope ruling: "Every other place a member's name appears —
// pickers, chips, the agenda, event pages, the library — keeps profile names,
// and this slice must not quietly extend to them." The first #269 GREEN put the
// real-names overlay inside the SHARED `loadRoster`, so the agenda — which
// reaches it through `getRoster` and then feeds `rosterRows` to the attendance
// panel, the conductor chips and all three conductor pickers, AND caches the
// resulting rows for `ROSTER_CACHE_TTL_MS` — silently inherited it. This file is
// the boundary spec that makes that leak visible.
//
// Pinned here, with the toggle ON and named `admin_member_record`s present on
// the wire (NOT a vacuous fixture: `_type.string=database` resolves, so
// `resolveDatabaseEntityId` returns an id and `readRosterNamesSetting` would
// succeed if the agenda asked):
//   1. the attendance panel's member rows show the PROFILE names;
//   2. ZERO `admin_member_record` requests are issued by an agenda load + panel
//      open — the exposure fence, checked on the network, not just the screen;
//   3. ZERO toggle reads either (`roster_show_real_names`): the agenda has no
//      business asking what the roster-names setting is.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Full-fallback paraglide mock: every key resolves to a `[key]` stub, so no
// message key can crash the mock. Assertions below match on DATA (names), never
// on copy.
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
	listAttendanceMock,
	listAllRsvpsForEventMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));

// NOTE what is deliberately NOT mocked: `$lib/roster/rosterData`. This file's
// whole subject is what the REAL roster producer does when the agenda calls it,
// so it runs for real against the stubbed wire below.
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
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: listAttendanceMock,
	listAllRsvpsForEvent: listAllRsvpsForEventMock,
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { realNamesWire, PROFILE_NAMES, REAL_NAMES } from '$lib/testing/realNamesFence';

function agendaItem(id: string, startDatetime: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [] as string[],
		owners: [] as string[],
		editors: [] as string[]
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

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue([]);

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	findMyMemberIdMock.mockReset().mockResolvedValue(null);
	listMyRsvpsMock.mockReset().mockResolvedValue([]);
	listAttendanceMock.mockReset();
	listAllRsvpsForEventMock.mockReset();
	resetTypeIdCache();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
	resetConductor();
});

/** One conducted recent event; the viewer (person-p) holds the season seat. */
function setConductedRecentFixture() {
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
	listAttendanceMock.mockResolvedValue([]);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	setAuthedWithOneCollective('person-p');
}

describe('#269 scope fence — the AGENDA keeps profile names and never reads member records', () => {
	it('with the toggle ON and named records on the wire, the attendance panel names members by their PROFILE names', async () => {
		realNamesWire();
		setConductedRecentFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
		});

		const panel = container.querySelector('[data-testid="attendance-panel"]')!;
		const text = panel.textContent ?? '';
		expect(text).toContain(PROFILE_NAMES.m1);
		expect(text).toContain(PROFILE_NAMES.m2);
		// The overlay's names must not appear ANYWHERE on the agenda.
		expect(container.textContent).not.toContain(REAL_NAMES.m1);
		expect(container.textContent).not.toContain(REAL_NAMES.m2);
	});

	it('issues ZERO admin_member_record requests and ZERO roster_show_real_names reads across the whole load + panel open', async () => {
		const fetchMock = realNamesWire();
		setConductedRecentFixture();
		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
		});

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toEqual([]);
	});
});

// (*MVOX:Palestrina* — #269 review F1/F2: agenda scope fence)
