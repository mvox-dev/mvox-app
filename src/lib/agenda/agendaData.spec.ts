// @vitest-environment happy-dom
// The agenda data layer: what loadFullAgenda reads and threads through.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from './types';
import type { Season } from '$lib/seasons/types';

const { listSeasonsMock, listEventsMock, collectiveHolder } = vi.hoisted(() => ({
	listSeasonsMock: vi.fn(),
	listEventsMock: vi.fn(),
	collectiveHolder: {
		store: null as unknown as import('svelte/store').Writable<{ db: string; personId: string } | null>
	}
}));
vi.mock('$lib/seasons/entuSeasons', () => ({
	listSeasons: listSeasonsMock,
	listEvents: listEventsMock
}));
vi.mock('$lib/collectives/store', async () => {
	const { writable } = await import('svelte/store');
	collectiveHolder.store = writable<{ db: string; personId: string } | null>(null);
	return { selectedCollectiveStore: collectiveHolder.store };
});

import { listFullAgenda, loadFullAgenda } from './agendaData';
import { setToken } from '$lib/auth/storage';
import { testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');
const NOW = new Date('2026-09-05T10:00:00.000Z');

function item(id: string, startDatetime: string, conductors: string[] = []): AgendaItem {
	return {
		id,
		name: id,
		startDatetime,
		durationMinutes: 60,
		location: '',
		conductors,
		owners: [],
		editors: [],
		eventType: 'rehearsal'
	};
}

function season(id: string, startDate: string, endDate: string, conductors: string[] = []): Season {
	return { id, name: `Season ${id}`, startDate, endDate, conductors, owners: [], editors: [] };
}

beforeEach(() => {
	localStorage.clear();
	listSeasonsMock.mockReset();
	listEventsMock.mockReset();
	collectiveHolder.store.set(null);
	vi.stubGlobal(
		'fetch',
		vi.fn(() => {
			throw new Error('unexpected network fetch in agendaData spec');
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('listFullAgenda — signature', () => {
	it('takes exactly (cfg, now) as required params — no dead personId slot', () => {
		expect(listFullAgenda.length).toBe(2);
	});
});

describe('listFullAgenda — upcoming items (de-fanned to one collective)', () => {
	it('flattens ongoing seasons -> upcoming -> sorted ascending', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s1', '2026-01-01', '2027-05-31')
		]);
		listEventsMock.mockResolvedValue([
			item('late', '2026-09-20T16:00:00.000Z'),
			item('soon', '2026-09-10T16:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.upcoming.map((i) => i.id)).toEqual(['soon', 'late']);
		expect(result.upcoming[0]).toEqual(item('soon', '2026-09-10T16:00:00.000Z'));
	});

	it('keeps non-rehearsal event types in upcoming, eventType passed through', async () => {
		listSeasonsMock.mockResolvedValue([season('s1', '2026-01-01', '2027-05-31')]);
		listEventsMock.mockResolvedValue([
			{ ...item('reh', '2026-09-10T16:00:00.000Z'), eventType: 'rehearsal' },
			{ ...item('concert', '2026-09-12T16:00:00.000Z'), eventType: 'concert' },
			{ ...item('proov', '2026-09-14T16:00:00.000Z'), eventType: 'proov' }
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.upcoming.map((i) => i.id)).toEqual(['reh', 'concert', 'proov']);
		expect(result.upcoming.map((i) => i.eventType)).toEqual(['rehearsal', 'concert', 'proov']);
	});

	it('queries every season (no end_date pre-filter) -- a past season contributes 0 via the event gate', async () => {
		listSeasonsMock.mockResolvedValue([
			season('old', '2025-09-01', '2026-05-31'),
			season('cur', '2026-09-01', '2027-05-31')
		]);
		listEventsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 'old'
					? [item('old-past', '2026-05-10T18:00:00.000Z')] // before NOW -> filtered out
					: [item('cur-next', '2026-09-10T18:00:00.000Z')] // after NOW -> kept
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		expect(listEventsMock).toHaveBeenCalledTimes(2);
		expect(listEventsMock).toHaveBeenCalledWith(cfg, 'old', expect.anything(), {});
		expect(result.upcoming.map((i) => i.id)).toEqual(['cur-next']);
	});

	it('fetches a season with a PAST end_date too -- its future rehearsals still appear', async () => {
		listSeasonsMock.mockResolvedValue([
			season('fila', '2025-09-01', '2026-07-28')
		]);
		listEventsMock.mockResolvedValue([item('sept', '2026-09-15T18:00:00.000Z')]);

		const result = await listFullAgenda(cfg, NOW);

		expect(listEventsMock).toHaveBeenCalledWith(cfg, 'fila', expect.anything(), {});
		expect(result.upcoming.map((i) => i.id)).toEqual(['sept']);
	});

	it('treats an open-ended season (empty endDate) as ongoing -- its rehearsals appear', async () => {
		listSeasonsMock.mockResolvedValue([
			season('open', '2026-09-01', '')
		]);
		listEventsMock.mockResolvedValue([item('future', '2026-09-12T18:00:00.000Z')]);

		const result = await listFullAgenda(cfg, NOW);

		expect(listEventsMock).toHaveBeenCalledWith(cfg, 'open', expect.anything(), {});
		expect(result.upcoming.map((i) => i.id)).toEqual(['future']);
	});

	it('excludes rehearsals earlier than now (this-morning boundary excluded)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s', '2026-09-01', '2027-05-31')
		]);
		listEventsMock.mockResolvedValue([
			item('past', '2026-09-05T07:00:00.000Z'), // before NOW (10:00)
			item('next', '2026-09-05T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);
		expect(result.upcoming.map((i) => i.id)).toEqual(['next']);
	});

	it('returns empty upcoming when the collective has no seasons', async () => {
		listSeasonsMock.mockResolvedValue([]);
		const result = await listFullAgenda(cfg, NOW);
		expect(result.upcoming).toEqual([]);
		expect(listEventsMock).not.toHaveBeenCalled();
	});
});

describe('listFullAgenda -- recent items + current season (#83 F1+F2)', () => {
	it('returns the current season\'s PAST events as recent, reverse-chronological', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listEventsMock.mockResolvedValue([
			item('past-old', '2026-09-02T18:00:00.000Z'),
			item('past-new', '2026-09-04T18:00:00.000Z'),
			item('upcoming', '2026-09-10T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent.map((i) => i.id)).toEqual(['past-new', 'past-old']);
		expect(result.upcoming.map((i) => i.id)).toEqual(['upcoming']);
	});

	it('returns seasonId and seasonConductors from the current season', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna', 'p-bert'])
		]);
		listEventsMock.mockResolvedValue([
			item('r1', '2026-09-10T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBe('s-cur');
		expect(result.seasonConductors).toEqual(['p-anna', 'p-bert']);
	});

	it('carries the FULL season list (both past/current and future) as `seasons`', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31'),
			season('s-next', '2027-09-01', '2028-05-31')
		]);
		listEventsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasons.map((s) => s.id)).toEqual(['s-cur', 's-next']);
	});

	it('carries `seasons` even when NO season is current (all future)', async () => {
		listSeasonsMock.mockResolvedValue([season('s-future', '2027-09-01', '2028-05-31')]);
		listEventsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBeNull();
		expect(result.seasons.map((s) => s.id)).toEqual(['s-future']);
	});

	it('returns empty recent + null seasonId when no season has started (all future)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-future', '2027-09-01', '2028-05-31', ['p-anna'])
		]);
		listEventsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent).toEqual([]);
		expect(result.seasonId).toBeNull();
		expect(result.seasonConductors).toEqual([]);
	});

	it('scopes recent events to the CURRENT season only (not a past season)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-old', '2025-09-01', '2026-05-31'),
			season('s-cur', '2026-09-01', '2027-05-31')
		]);
		listEventsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 's-old'
					? [item('old-past', '2026-05-10T18:00:00.000Z')]
					: [
							item('cur-past', '2026-09-03T18:00:00.000Z'),
							item('cur-upcoming', '2026-09-10T18:00:00.000Z')
						]
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent.map((i) => i.id)).toEqual(['cur-past']);
		expect(result.seasonId).toBe('s-cur');
	});

	it('paired.find correctly matches the current season by id', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-old', '2025-09-01', '2026-05-31'),
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listEventsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 's-old'
					? [item('old-event', '2026-05-10T18:00:00.000Z')]
					: [item('cur-event', '2026-09-03T18:00:00.000Z')]
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent.map((i) => i.id)).toEqual(['cur-event']);
		expect(result.seasonConductors).toEqual(['p-anna']);
	});

	it('returns empty recent when the current season has no past events yet', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listEventsMock.mockResolvedValue([
			item('upcoming-1', '2026-09-10T18:00:00.000Z'),
			item('upcoming-2', '2026-09-17T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent).toEqual([]);
		expect(result.seasonId).toBe('s-cur');
		expect(result.seasonConductors).toEqual(['p-anna']);
	});
});

describe('listFullAgenda — manageable season (#167)', () => {
	function seasonWithRights(
		id: string,
		startDate: string,
		owners: string[],
		editors: string[]
	): Season {
		return { id, name: `Season ${id}`, startDate, endDate: '', conductors: [], owners, editors };
	}

	it('a current season exists → manageable* mirrors the current season fields', async () => {
		listSeasonsMock.mockResolvedValue([
			seasonWithRights('s-cur', '2026-09-01', ['p-owner'], ['p-editor']),
			seasonWithRights('s-next', '2027-09-01', [], [])
		]);
		listEventsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBe('s-cur');
		expect(result.manageableSeasonId).toBe('s-cur');
		expect(result.manageableSeasonOwners).toEqual(['p-owner']);
		expect(result.manageableSeasonEditors).toEqual(['p-editor']);
	});

	it('FUTURE-only season: seasonId stays null (viewer semantics) but manageable* carries the future season', async () => {
		listSeasonsMock.mockResolvedValue([
			seasonWithRights('s-future', '2027-09-01', ['p-owner'], ['p-editor'])
		]);
		listEventsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBeNull();
		expect(result.recent).toEqual([]);
		expect(result.manageableSeasonId).toBe('s-future');
		expect(result.manageableSeasonOwners).toEqual(['p-owner']);
		expect(result.manageableSeasonEditors).toEqual(['p-editor']);
	});

	it('several future seasons, none started → the SOONEST-starting one is manageable', async () => {
		listSeasonsMock.mockResolvedValue([
			seasonWithRights('s-2028', '2028-09-01', [], []),
			seasonWithRights('s-2027', '2027-09-01', ['p-owner'], []),
			seasonWithRights('s-2029', '2029-09-01', [], [])
		]);
		listEventsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.manageableSeasonId).toBe('s-2027');
		expect(result.manageableSeasonOwners).toEqual(['p-owner']);
	});

	it('no seasons at all → manageableSeasonId null, rights lists empty', async () => {
		listSeasonsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.manageableSeasonId).toBeNull();
		expect(result.manageableSeasonOwners).toEqual([]);
		expect(result.manageableSeasonEditors).toEqual([]);
	});
});

describe('loadFullAgenda (threads the T4 selected db + token)', () => {
	it('resolves db from selectedCollectiveStore and token from storage — personId is never threaded', async () => {
		collectiveHolder.store.set({ db: 'sampledb', personId: 'person-123' });
		setToken('jwt-live');
		listSeasonsMock.mockResolvedValue([]);

		await loadFullAgenda(NOW);

		expect(listSeasonsMock).toHaveBeenCalledWith(
			{ db: 'sampledb', token: 'jwt-live' },
			expect.anything(),
			{ cache: true }
		);
	});

	it('threads the read-cache opt-in onto the EVENT read as well (#434 slice 2)', async () => {
		collectiveHolder.store.set({ db: 'sampledb', personId: 'person-123' });
		setToken('jwt-live');
		listSeasonsMock.mockResolvedValue([season('cur', '2026-09-01', '2027-06-30')]);
		listEventsMock.mockResolvedValue([]);

		await loadFullAgenda(NOW);

		expect(listEventsMock).toHaveBeenCalledWith(
			{ db: 'sampledb', token: 'jwt-live' },
			'cur',
			expect.anything(),
			{ cache: true }
		);
	});

	it('a DIRECT listFullAgenda call is uncached — retention.ts runs from the root layout on every route', async () => {
		listSeasonsMock.mockResolvedValue([season('cur', '2026-09-01', '2027-06-30')]);
		listEventsMock.mockResolvedValue([]);

		await listFullAgenda(cfg, NOW);

		expect(listSeasonsMock).toHaveBeenCalledWith(cfg, expect.anything(), {});
		expect(listEventsMock).toHaveBeenCalledWith(cfg, 'cur', expect.anything(), {});
	});

	it('returns empty result without reading when no collective is selected', async () => {
		setToken('jwt-live'); // token present, but no collective
		const result = await loadFullAgenda(NOW);
		expect(result).toEqual({
			upcoming: [],
			recent: [],
			seasons: [],
			seasonId: null,
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: [],
			manageableSeasonId: null,
			manageableSeasonOwners: [],
			manageableSeasonEditors: []
		});
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});

	it('returns empty result without reading when there is no token', async () => {
		collectiveHolder.store.set({ db: 'sampledb', personId: 'person-123' }); // collective present, but no token
		const result = await loadFullAgenda(NOW);
		expect(result).toEqual({
			upcoming: [],
			recent: [],
			seasons: [],
			seasonId: null,
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: [],
			manageableSeasonId: null,
			manageableSeasonOwners: [],
			manageableSeasonEditors: []
		});
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
