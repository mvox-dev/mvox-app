// @vitest-environment happy-dom
//
// #469 — the AGENDA (`src/routes/+page.svelte`) obeys `roster_show_real_names`.
//
// HISTORY, named not deleted: this file was the #269 SCOPE FENCE under Henry's
// 2026-09-06 roster-only ruling ("Every other place a member's name appears —
// pickers, chips, the agenda, event pages, the library — keeps profile names").
// Mihkel's #469 word (2026-09-23, issue body: "all places we are showing member
// names and they all must obey the admin setting") SUPERSEDES that ruling, so
// the fence FLIPS to the conditional contract. The agenda reaches the shared
// `loadRoster` through `getRoster` and feeds `rosterRows` to the attendance
// panel, the conductor chips and all three conductor pickers — one producer,
// so pinning the panel pins them all.
//
// Pinned here, on the non-vacuous wire (`_type.string=database` resolves, the
// toggle is a REAL read answer, named `admin_member_record`s are served in both
// states):
//   1. toggle ON → the attendance panel's member rows show the REAL names and
//      the profile names appear nowhere in it; ONE toggle read and ONE records
//      read for the whole load + panel open (`getRoster` is one read);
//   2. toggle OFF → the reverse: profile names, ZERO `admin_member_record`
//      requests — the off side is a read answer, never a skipped ask, so the
//      toggle itself IS read exactly once.
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
	// #372 — resolveManageRights now ALSO gates the agenda's rsvp control
	// (called as (cfg, personId, personId)): grant her editor on her OWN
	// person while every other entity (season/event/database) stays
	// 'not-editor', so this file's existing rights-suppressed assertions
	// are untouched.
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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { realNamesWire, PROFILE_NAMES, REAL_NAMES } from '$lib/testing/realNamesFence';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';

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

findMyMemberIdMock.mockResolvedValue(null);
listMyRsvpsMock.mockResolvedValue(toListRead([]));

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
});

/** One conducted recent event; the viewer (person-p) holds the season seat. */
function setConductedRecentFixture() {
	// #356 — the marking gate is now EVENT RIGHTS (canMarkAttendance), not the
	// seat: person-p gains `_editor` on the event so the panel this fence spec
	// opens stays reachable. The seat stays too.
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({
			seasons: [],
			upcoming: [],
			recent: [{ ...agendaItem('past-1', '2026-06-10T16:00:00.000Z'), editors: ['person-p'] }],
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

async function openAttendancePanel(container: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(container.querySelector('[data-testid="take-attendance-btn"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="take-attendance-btn"]')!);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="attendance-row-m1"]')).not.toBeNull();
	});
	return container.querySelector('[data-testid="attendance-panel"]') as HTMLElement;
}

describe('#469 — the AGENDA obeys roster_show_real_names (supersedes the #269 roster-only ruling)', () => {
	it('toggle ON: the attendance panel names members by their REAL names — the profile names appear nowhere in it', async () => {
		realNamesWire();
		setConductedRecentFixture();
		const { container } = render(Page);
		const panel = await openAttendancePanel(container);

		await waitFor(() => {
			const text = panel.textContent ?? '';
			expect(text).toContain(REAL_NAMES.m1);
			expect(text).toContain(REAL_NAMES.m2);
		});
		const text = panel.textContent ?? '';
		expect(text).not.toContain(PROFILE_NAMES.m1);
		expect(text).not.toContain(PROFILE_NAMES.m2);
	});

	it('toggle ON: ONE roster_show_real_names read and ONE admin_member_record read across the whole load + panel open — getRoster is one read, the overlay rides it', async () => {
		const fetchMock = realNamesWire();
		setConductedRecentFixture();
		const { container } = render(Page);
		const panel = await openAttendancePanel(container);
		await waitFor(() => {
			expect(panel.textContent ?? '').toContain(REAL_NAMES.m1);
		});

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(urls.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
	});

	it('toggle OFF: profile names everywhere, the record names appear nowhere on the agenda, ZERO admin_member_record requests — and the toggle itself IS read (once): off is an answer, not a skipped ask', async () => {
		const fetchMock = realNamesWire({ toggle: false });
		setConductedRecentFixture();
		const { container } = render(Page);
		const panel = await openAttendancePanel(container);

		const text = panel.textContent ?? '';
		expect(text).toContain(PROFILE_NAMES.m1);
		expect(text).toContain(PROFILE_NAMES.m2);
		expect(container.textContent).not.toContain(REAL_NAMES.m1);
		expect(container.textContent).not.toContain(REAL_NAMES.m2);

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
	});
});

// (*MVOX:Palestrina* — #269 review F1/F2: agenda scope fence)
// (*MVOX:Tallis* — #469 RED: fence flipped to the conditional contract)
