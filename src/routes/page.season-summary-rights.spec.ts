// @vitest-environment happy-dom
//
// #365 (epic #362) RED — the season-summary comparison opens on RIGHTS, not on
// the conductor list.
//
// `canExpand` (the SeasonSummary expand affordance + the full-roster
// member-rate comparison behind it) currently reads `isConductor` from
// conductorStore.ts — a seat computed from the season's `conductor` refs. The
// paradigm (#362, ratified): Entu's grants are the only authority; a control
// renders only when the grant on the entity the write/read targets is in hand.
// The expand must derive from the CURRENT season's `_owner`/`_editor` refs —
// the page's existing `seasonManageRights` signal, set from
// `manageRightsFrom(seasonOwners, seasonEditors, personId)` on data the agenda
// load already carries. No new IO.
//
// With #356 having taken the marking side, the expand was `isConductor`'s LAST
// gate consumer, so `isConductor` and conductorStore.ts go entirely (issue
// done-when 2) — the fence describe at the bottom pins the deletion.
//
// Done-when 3 (conductor NAMES still render where they did) is pinned by
// existing specs that drive the display path (conductorLogic.resolveConductors
// + roster data, never conductorStore):
//   - event detail conductor line: src/routes/event/[id]/page.spec.ts
//     ("renders conductor names comma-separated, in resolved order" —
//     event-detail-conductors, name fixture 'Mihkel Putrinš, Alice Smith')
//   - season-manage conductor chips: src/routes/page.season-manage.spec.ts
//     (season-manage-conductor-p-grace, name fixture 'Grace Hopper')
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
	loadActiveAndArchivedRostersMock,
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
	loadActiveAndArchivedRostersMock: vi.fn(),
	listAttendanceMock: vi.fn(),
	listMyAttendanceMock: vi.fn(),
	listAllRsvpsForEventMock: vi.fn()
}));
vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	// #372 — resolveManageRights gates the agenda's rsvp control (called as
	// (cfg, personId, personId)): grant her editor on her OWN person while
	// every other entity stays 'not-editor'. The season-rights gate under test
	// here must NOT route through this call — it derives from the
	// seasonOwners/seasonEditors the agenda read already carried.
	resolveManageRights: vi.fn((..._args: unknown[]) => {
		const [, entityId, personId] = _args as [unknown, string, string];
		return Promise.resolve(entityId === personId ? 'editor' : 'not-editor');
	})
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
	loadInactiveRoster: vi.fn(),
	// #469 review F1 — the season panel reads both halves through ONE producer.
	loadActiveAndArchivedRosters: loadActiveAndArchivedRostersMock,
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

/**
 * Two past events in the current season; who may expand is driven ONLY by the
 * season-rights overrides. The conductor list is a separate axis (display
 * data), overridden independently to prove the seat does not count.
 */
function agendaFixture(overrides: {
	seasonOwners?: string[];
	seasonEditors?: string[];
	seasonConductors?: string[];
}) {
	return fullAgendaResult({
		seasons: [],
		upcoming: [],
		recent: [
			agendaItem('past-1', '2026-06-10T16:00:00.000Z'),
			agendaItem('past-2', '2026-06-03T16:00:00.000Z')
		],
		seasonId: 's1',
		seasonConductors: overrides.seasonConductors ?? [],
		seasonOwners: overrides.seasonOwners ?? [],
		seasonEditors: overrides.seasonEditors ?? []
	});
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
	findMyMemberIdMock.mockResolvedValue('m1');
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listMyAttendanceMock.mockResolvedValue(
		toListRead([{ attendanceId: 'a1', eventId: 'past-1', status: 'present' }])
	);
	listAllRsvpsForEventMock.mockResolvedValue([]);
	loadRosterMock.mockResolvedValue(
		toListRead([{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }])
	);
	loadActiveAndArchivedRostersMock.mockResolvedValue({
		active: toListRead([
			{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
		]),
		inactive: toListRead([])
	});
	listAttendanceMock.mockResolvedValue([{ attendanceId: 'x1', memberId: 'm1', status: 'present' }]);
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
});

async function renderWithSummary() {
	const utils = render(Page);
	setAuthedWithOneCollective();
	await waitFor(() =>
		expect(utils.container.querySelector('[data-testid="season-summary"]')).not.toBeNull()
	);
	return utils;
}

const EXPAND = '[data-testid="season-summary-expand"]';

describe('#365 — the season-summary comparison opens on season rights', () => {
	it('a season OWNER gets the expand affordance, and the comparison opens on click', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaFixture({ seasonOwners: ['person-p'] }));
		const { container } = await renderWithSummary();
		await waitFor(() => expect(container.querySelector(EXPAND)).not.toBeNull());
		await fireEvent.click(container.querySelector(EXPAND)!);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="member-rate-m1"]')).not.toBeNull()
		);
	});

	it('a season EDITOR gets the expand affordance', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaFixture({ seasonEditors: ['person-p'] }));
		const { container } = await renderWithSummary();
		await waitFor(() => expect(container.querySelector(EXPAND)).not.toBeNull());
	});

	it('a member with NEITHER grant gets no affordance — the roster comparison is unreachable', async () => {
		loadFullAgendaMock.mockResolvedValue(
			agendaFixture({ seasonOwners: ['someone-else'], seasonEditors: ['other-person'] })
		);
		const { container } = await renderWithSummary();
		expect(container.querySelector(EXPAND)).toBeNull();
		expect(container.querySelector('[data-testid="member-rate-m1"]')).toBeNull();
	});

	it('the conductor SEAT does not count: on the conductor list but holding no grant → NO expand', async () => {
		// The exact divergence #365 exists for — the seat without the grant.
		loadFullAgendaMock.mockResolvedValue(
			agendaFixture({ seasonConductors: ['person-p'], seasonOwners: [], seasonEditors: [] })
		);
		const { container } = await renderWithSummary();
		expect(container.querySelector(EXPAND)).toBeNull();
	});

	it('no affordance while the agenda (and with it the rights answer) is still loading', async () => {
		// The load never resolves: rights are unknown, so the gate is closed.
		loadFullAgendaMock.mockReturnValue(new Promise(() => {}));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		await waitFor(() => expect(loadFullAgendaMock).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector(EXPAND)).toBeNull();
	});
});

// ── the deletion fence (issue done-when 2) ─────────────────────────────────
//
// Same shape as src/no-collectives-route.spec.ts: the dead module must be
// GONE, and no live source may keep reaching for it. `isConductor` had one
// gate consumer left (this expand); with it moved to rights, the store — and
// with it the last "membership-list stands in for a grant" signal — has no
// reason to exist (#362 paradigm).

const SRC_ROOT = resolve(__dirname, '..');

function sourceFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter(
			(d) =>
				d.isFile() &&
				(d.name.endsWith('.svelte') || d.name.endsWith('.ts')) &&
				!d.name.endsWith('.spec.ts')
		)
		.map((d) => join(d.parentPath, d.name))
		.filter((f) => !relative(SRC_ROOT, f).startsWith(join('lib', 'paraglide')));
}

describe('#365 — conductorStore is dead (done-when 2)', () => {
	it('src/lib/attendance/conductorStore.ts no longer exists', () => {
		expect(
			existsSync(join(SRC_ROOT, 'lib', 'attendance', 'conductorStore.ts')),
			'conductorStore.ts must be deleted — the expand gate was its last consumer (#365)'
		).toBe(false);
	});

	it('no non-spec source references attendance/conductorStore', () => {
		const needle = 'attendance/conductorStore';
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			const source = readFileSync(file, 'utf-8');
			let idx = source.indexOf(needle);
			while (idx !== -1) {
				const line = source.slice(0, idx).split('\n').length;
				offenders.push(`${relative(SRC_ROOT, file)}:${line}`);
				idx = source.indexOf(needle, idx + 1);
			}
		}
		expect(
			offenders,
			`live references to the deleted conductorStore:\n${offenders.join('\n')}`
		).toEqual([]);
	});
});

// (*MVOX:Tallis*)
