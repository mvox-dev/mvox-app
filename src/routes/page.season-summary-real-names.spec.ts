// @vitest-environment happy-dom
//
// #469 review F1 — the agenda's SEASON-RATE TABLE obeys `roster_show_real_names`,
// and pays for it ONCE.
//
// The panel is the app's only surface that needs the active and the archived
// rows separately (active members get a rate, a deactivated member a count-only
// row — #255 done-when 3), and it used to get them by calling `loadRoster` +
// `loadInactiveRoster` side by side. Each of those overlays real names itself,
// so one panel open spent TWO database resolves, TWO `roster_show_real_names`
// reads and TWO `admin_member_record?limit=500` reads (the PII-bearing bulk
// read) for one table — and the two overlays could degrade independently, into a
// table mixing real names for active members with profile names for archived
// ones, which is byte-indistinguishable from "she has no record".
//
// Pinned here, on the shared non-vacuous wire (the database entity resolves, the
// toggle is a REAL read answer, named records are served in both states, and the
// archived half is its own member list):
//   1. toggle ON  → every row, ACTIVE AND ARCHIVED, shows the real name;
//   2. toggle OFF → every row shows the profile name, ZERO record reads;
//   3. opening the panel costs exactly ONE toggle read and ONE records read —
//      measured as the DELTA across the click, so whatever the page load itself
//      spent cannot hide a doubled panel read.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Full-fallback paraglide mock: every key resolves to a `[key]` stub. Assertions
// below match on DATA (names), never on copy.
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
	listMyAttendanceMock,
	listAllRsvpsForEventMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));

// NOTE what is deliberately NOT mocked: `$lib/roster/rosterData` and
// `$lib/roster/memberLifecycle`. This file's whole subject is what the REAL
// membership producers do when the season panel calls them, so they run for real
// against the stubbed wire below.
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { realNamesWire, PROFILE_NAMES, REAL_NAMES } from '$lib/testing/realNamesFence';
import { toListRead } from '$lib/testing/listReadFixtures.js';

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
		personIdByDb: { sampledb: personId },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
	completionGateStore.set('complete');
}

beforeEach(() => {
	// #365 — the expand affordance opens on SEASON RIGHTS; person-p holds `_owner`.
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [
				agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
				agendaItem('past-2', '2026-06-03T16:00:00.000Z')
			],
			seasonId: 's1',
			seasonConductors: [],
			seasonOwners: ['person-p'],
			seasonEditors: []
		})
	);
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(toListRead([]));
	listAllRsvpsForEventMock.mockResolvedValue([]);
	// m1/m2 are active (the fence's roster), m9 archived — all three carry records.
	listAttendanceMock.mockResolvedValue([
		{ attendanceId: 'a1', memberId: 'm1', status: 'present' },
		{ attendanceId: 'a2', memberId: 'm9', status: 'present' }
	]);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetTypeIdCache();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

/** Render, expand the season summary, return the members region + the url delta
 *  the expansion itself spent. */
async function openSeasonSummary(fetchMock: ReturnType<typeof vi.fn>) {
	const utils = render(Page);
	setAuthedWithOneCollective();
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="season-summary-expand"]')).not.toBeNull()
	);
	const before = fetchMock.mock.calls.length;
	await fireEvent.click(utils.container.querySelector('[data-testid="season-summary-expand"]')!);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull()
	);
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="member-rate-inactive-m9"]')).not.toBeNull()
	);
	const panelUrls = (fetchMock.mock.calls as Array<[unknown]>)
		.slice(before)
		.map((c) => String(c[0]));
	const region = utils.container.querySelector(
		'[data-testid="season-summary-members"]'
	) as HTMLElement;
	return { ...utils, region, panelUrls };
}

describe('#469 review F1 — the season-rate table obeys the toggle, in ONE overlay pass', () => {
	it('toggle ON: active AND archived rows show REAL names — no profile name survives in the table', async () => {
		const fetchMock = realNamesWire();
		const { region } = await openSeasonSummary(fetchMock);

		const text = region.textContent ?? '';
		expect(text).toContain(REAL_NAMES.m1);
		expect(text).toContain(REAL_NAMES.m2);
		// The archived half is the half the old shape could silently leave on
		// profile names while the active half showed real ones.
		expect(text).toContain(REAL_NAMES.m9);
		expect(text).not.toContain(PROFILE_NAMES.m1);
		expect(text).not.toContain(PROFILE_NAMES.m2);
		expect(text).not.toContain(PROFILE_NAMES.m9);
	});

	it('toggle OFF: every row shows the profile name, ZERO admin_member_record reads — and the toggle IS read (once)', async () => {
		const fetchMock = realNamesWire({ toggle: false });
		const { region, panelUrls } = await openSeasonSummary(fetchMock);

		const text = region.textContent ?? '';
		expect(text).toContain(PROFILE_NAMES.m1);
		expect(text).toContain(PROFILE_NAMES.m2);
		expect(text).toContain(PROFILE_NAMES.m9);
		expect(text).not.toContain(REAL_NAMES.m1);
		expect(text).not.toContain(REAL_NAMES.m9);

		expect(panelUrls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(panelUrls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
	});

	it('opening the panel costs ONE toggle read and ONE admin_member_record read for the WHOLE table, both halves', async () => {
		const fetchMock = realNamesWire();
		const { panelUrls } = await openSeasonSummary(fetchMock);

		expect(panelUrls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(panelUrls.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
		// The two member reads are still both made — one active, one archived.
		expect(
			panelUrls.filter((u) => u.includes('_type.string=member') && u.includes('status.string=archived'))
		).toHaveLength(1);
	});
});

// (*MVOX:Palestrina* — #469 review F1: the season-rate table's real-names contract)
