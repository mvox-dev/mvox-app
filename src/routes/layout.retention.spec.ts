// @vitest-environment happy-dom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';

const { listFullAgendaMock, loadWorksByEventIdMock } = vi.hoisted(() => ({
	listFullAgendaMock: vi.fn(),
	loadWorksByEventIdMock: vi.fn()
}));

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/agenda/agendaData', () => ({
	loadFullAgenda: vi.fn(),
	listFullAgenda: listFullAgendaMock
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: loadWorksByEventIdMock
}));
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({ putLabel: async () => {}, labelsFor: async () => new Map(), remove: async () => {} })
}));

import Layout from './+layout.svelte';
import { authStore } from '$lib/auth/session';
import { setToken } from '$lib/auth/storage';
import { collectiveState } from '$lib/collectives/store';
import { resetRetentionForTests } from '$lib/files/retention';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';

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
	resetAppState();
});

function setAuthedWithTwoJoinedAndOneForeignDb() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p', crede: 'person-c', 'some-other-entu-app': 'person-x' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
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
		const handed = fakeByteStore.protectedLog.at(-1)!;
		expect([...handed].sort()).toEqual(
			[pkey('crede', 'person-c', 'file-c1'), pkey('sampledb', 'person-p', 'file-p1')].sort()
		);
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
		expect([...dbs].sort()).toEqual(['crede', 'sampledb']);
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
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'sampledb', name: 'Sampledb renamed', personId: 'person-p' },
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
			pkey('sampledb', 'person-p', 'file-p1')
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
