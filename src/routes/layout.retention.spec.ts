// @vitest-environment happy-dom
//
// #410 review F1 — the retention set is a SESSION duty, not the agenda page's.
//
// The byte store is a module singleton and FOUR routes put bytes through it:
// the agenda (`+page.svelte`), `/event/[id]`, `/library` and `/downloads` all
// call `openFileBytes(..., getAppByteStore())`, whose `store.put` fires the
// after-every-put pressure sweep. While the protected-set build lived inside
// `+page.svelte`, a cold boot straight into any of the other three never
// mounted that component: `setProtectedKeys` was never called, the store kept
// its default-EMPTY protected set for the whole session, and the sweep evicted
// the next event's parts — the one thing #410's done-when forbids.
//
// This suite renders the ROOT LAYOUT and nothing else (no agenda page, no
// route component at all) and holds it to the whole app-open duty: build the
// set from every collective she has JOINED, hand it over, relieve.
//
// review F2 — "joined" means the hydrated, marker-filtered `collectiveState`
// list (what `discoverCollectives` resolved), NOT `auth.personIdByDb`: that
// map is every Entu db in her JWT, her non-mvox apps included, and reading
// their agendas is a fan-out this app has no business issuing.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';

const { discoverMock, gotoMock, listFullAgendaMock, loadWorksByEventIdMock } = vi.hoisted(() => ({
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	listFullAgendaMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn()
}));

// The same boundary the sibling layout specs use: discover.ts and goto can't
// run under happy-dom outside an app, and entu-config reads $env/dynamic/public.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: vi.fn(),
	listFullAgenda: listFullAgendaMock
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
// The byte-store seam: the retention module reaches persistence only through
// getAppByteStore(), so the in-memory fake stands in for IndexedDB.
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({ putLabel: async () => {}, labelsFor: async () => new Map(), remove: async () => {} })
}));

import Layout from './+layout.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState } from '$lib/collectives/store';
import { resetRetentionForTests } from '$lib/files/retention';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

let fakeByteStore: FakeByteStore;

const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

function event(id: string) {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime: soon,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: []
	};
}

function workRow(fileId: string) {
	return {
		id: `ri-${fileId}`,
		kind: 'repertoire' as const,
		workId: 'work-1',
		editionId: 'ed-1',
		workName: 'Spem in alium',
		composer: 'Thomas Tallis',
		status: 'active' as const,
		editionName: '40-part original',
		ordinal: null,
		fileId,
		externalLinks: [],
		canBorrow: false,
		notes: ''
	};
}

function pkey(db: string, personId: string, fileId: string): string {
	return JSON.stringify([db, personId, fileId]);
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	resetRetentionForTests();
	// The layout's completion-gate / admin / membership effects fire entuFetch
	// the moment auth resolves; pin them to a benign 200 (same arrangement as
	// layout.reactive-auth.spec.ts).
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ entities: [] }), { status: 200 }))
	);
	discoverMock.mockResolvedValue({ collectives: [], erroredDbs: [] });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	discoverMock.mockReset();
	gotoMock.mockReset();
	listFullAgendaMock.mockReset();
	loadWorksByEventIdMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

/** Authenticated, with TWO joined collectives and a THIRD Entu db in the token
 *  that is not an mvox collective at all (review F2's scope claim). */
function setAuthedWithTwoJoinedAndOneForeignDb() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p', crede: 'person-c', 'some-other-entu-app': 'person-x' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
			{ db: 'crede', name: 'Crede', personId: 'person-c' }
		],
		erroredDbs: []
	});
}

describe('#410 — the retention set is built by the ROOT LAYOUT, so it covers every entry point', () => {
	it('the layout alone — no agenda page mounted — protects every joined collective’s next-event parts and relieves', async () => {
		listFullAgendaMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'crede'
				? fullAgendaResult({ upcoming: [event('ev-c1')], seasonId: 'season-c' })
				: fullAgendaResult({ upcoming: [event('ev-p1')], seasonId: 'season-p' })
		);
		loadWorksByEventIdMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'crede'
				? { 'ev-c1': [workRow('file-c1')] }
				: { 'ev-p1': [workRow('file-p1')] }
		);
		const relieveSpy = vi.spyOn(fakeByteStore, 'relieve');

		render(Layout);
		setAuthedWithTwoJoinedAndOneForeignDb();

		await vi.waitFor(() => {
			expect(relieveSpy).toHaveBeenCalled();
		});
		// This is the F1 bug in one assertion: with the build on +page.svelte,
		// nothing here would have handed the store anything at all.
		const handed = fakeByteStore.protectedLog.at(-1)!;
		expect([...handed].sort()).toEqual(
			[pkey('crede', 'person-c', 'file-c1'), pkey('polyphony', 'person-p', 'file-p1')].sort()
		);
		// ...and the set exists BEFORE the sweep runs on it.
		expect(fakeByteStore.protectedLog.length).toBe(1);
	});

	it('scope is the JOINED collectives, not every db in the token: the non-mvox db is never read', async () => {
		listFullAgendaMock.mockResolvedValue(fullAgendaResult());
		loadWorksByEventIdMock.mockResolvedValue({});
		const relieveSpy = vi.spyOn(fakeByteStore, 'relieve');

		render(Layout);
		setAuthedWithTwoJoinedAndOneForeignDb();

		await vi.waitFor(() => {
			expect(relieveSpy).toHaveBeenCalled();
		});
		const dbs = listFullAgendaMock.mock.calls.map((c) => (c[0] as { db: string }).db);
		expect([...dbs].sort()).toEqual(['crede', 'polyphony']);
		for (const call of listFullAgendaMock.mock.calls) {
			expect((call[0] as { token: string }).token).toBe('jwt-abc');
		}
	});

	it('ONE agenda read per joined db, and ONE works read for that agenda’s FIRST item only — however often the effect re-runs', async () => {
		listFullAgendaMock.mockImplementation(async (cfg: { db: string }) =>
			cfg.db === 'crede'
				? fullAgendaResult({ upcoming: [event('ev-c1'), event('ev-c2')], seasonId: 'season-c' })
				: fullAgendaResult({ upcoming: [event('ev-p1')], seasonId: 'season-p' })
		);
		loadWorksByEventIdMock.mockResolvedValue({});
		const relieveSpy = vi.spyOn(fakeByteStore, 'relieve');

		render(Layout);
		setAuthedWithTwoJoinedAndOneForeignDb();

		await vi.waitFor(() => {
			expect(relieveSpy).toHaveBeenCalled();
		});
		// A collective re-selection (or any other re-run of the layout effect)
		// must not re-pay the fan-out: the build is latched per session.
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony renamed', personId: 'person-p' },
				{ db: 'crede', name: 'Crede', personId: 'person-c' }
			],
			erroredDbs: []
		});
		await Promise.resolve();

		expect(listFullAgendaMock.mock.calls.length).toBe(2);
		expect(relieveSpy).toHaveBeenCalledTimes(1);
		const credeWorkCalls = loadWorksByEventIdMock.mock.calls.filter(
			(c) => (c[0] as { db: string }).db === 'crede'
		);
		expect(credeWorkCalls.length).toBe(1);
		expect(credeWorkCalls[0][1]).toEqual(['ev-c1']);
		expect(credeWorkCalls[0][2]).toBe('season-c');
	});

	it('a joined db whose agenda read FAILS protects nothing for itself and costs the others nothing', async () => {
		listFullAgendaMock.mockImplementation(async (cfg: { db: string }) => {
			if (cfg.db === 'crede') throw new Error('entu is down for crede');
			return fullAgendaResult({ upcoming: [event('ev-p1')], seasonId: 'season-p' });
		});
		loadWorksByEventIdMock.mockResolvedValue({ 'ev-p1': [workRow('file-p1')] });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const relieveSpy = vi.spyOn(fakeByteStore, 'relieve');

		render(Layout);
		setAuthedWithTwoJoinedAndOneForeignDb();

		await vi.waitFor(() => {
			expect(relieveSpy).toHaveBeenCalled();
		});
		expect([...fakeByteStore.protectedLog.at(-1)!]).toEqual([
			pkey('polyphony', 'person-p', 'file-p1')
		]);
		errorSpy.mockRestore();
	});

	it('anonymous: nothing is built and nothing is handed to the store', async () => {
		render(Layout);
		authStore.set({ status: 'anonymous' });

		await vi.waitFor(() => {
			expect(discoverMock).not.toHaveBeenCalled();
		});
		await Promise.resolve();
		expect(listFullAgendaMock).not.toHaveBeenCalled();
		expect(fakeByteStore.protectedLog).toEqual([]);
	});
});

// (*MVOX:Josquin*)
