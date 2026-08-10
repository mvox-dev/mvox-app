// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from './types';
import type { Season } from '$lib/seasons/types';

// Mock the read helpers (orchestration is tested independently of the queries) and
// T4's selectedDbStore (so loadFullAgenda's db-threading is observable). Mocking both
// also severs the transitive entu-config -> $env import under happy-dom.
const { listSeasonsMock, listRehearsalsMock, dbHolder } = vi.hoisted(() => ({
	listSeasonsMock: vi.fn(),
	listRehearsalsMock: vi.fn(),
	dbHolder: { store: null as unknown as import('svelte/store').Writable<string | null> }
}));
vi.mock('$lib/seasons/entuSeasons', () => ({
	listSeasons: listSeasonsMock,
	listRehearsals: listRehearsalsMock
}));
vi.mock('$lib/collectives/store', async () => {
	const { writable } = await import('svelte/store');
	dbHolder.store = writable<string | null>(null);
	return { selectedDbStore: dbHolder.store };
});

import { listFullAgenda, loadFullAgenda } from './agendaData';
import { setToken } from '$lib/auth/storage';

const cfg = { db: 'polyphony', token: 'jwt' };
const NOW = new Date('2026-09-05T10:00:00.000Z');

function item(id: string, startDatetime: string, conductors: string[] = []): AgendaItem {
	return { id, name: id, startDatetime, durationMinutes: 60, location: '', conductors, owners: [], editors: [] };
}

function season(id: string, startDate: string, endDate: string, conductors: string[] = []): Season {
	return { id, name: `Season ${id}`, startDate, endDate, conductors, owners: [], editors: [] };
}

beforeEach(() => {
	localStorage.clear();
	listSeasonsMock.mockReset();
	listRehearsalsMock.mockReset();
	dbHolder.store.set(null);
});

afterEach(() => vi.restoreAllMocks());

// ---- listFullAgenda: upcoming items (same contract as the old listAgenda) ----

describe('listFullAgenda — upcoming items (de-fanned to one collective)', () => {
	it('flattens ongoing seasons -> upcoming -> sorted ascending', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s1', '2026-01-01', '2027-05-31')
		]);
		listRehearsalsMock.mockResolvedValue([
			item('late', '2026-09-20T16:00:00.000Z'),
			item('soon', '2026-09-10T16:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.upcoming.map((i) => i.id)).toEqual(['soon', 'late']);
		expect(result.upcoming[0]).toEqual(item('soon', '2026-09-10T16:00:00.000Z'));
	});

	it('queries every season (no end_date pre-filter) -- a past season contributes 0 via the event gate', async () => {
		listSeasonsMock.mockResolvedValue([
			season('old', '2025-09-01', '2026-05-31'),
			season('cur', '2026-09-01', '2027-05-31')
		]);
		listRehearsalsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 'old'
					? [item('old-past', '2026-05-10T18:00:00.000Z')] // before NOW -> filtered out
					: [item('cur-next', '2026-09-10T18:00:00.000Z')] // after NOW -> kept
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledTimes(2);
		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'old', expect.anything());
		expect(result.upcoming.map((i) => i.id)).toEqual(['cur-next']);
	});

	it('fetches a season with a PAST end_date too -- its future rehearsals still appear', async () => {
		listSeasonsMock.mockResolvedValue([
			season('fila', '2025-09-01', '2026-07-28')
		]);
		listRehearsalsMock.mockResolvedValue([item('sept', '2026-09-15T18:00:00.000Z')]);

		const result = await listFullAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'fila', expect.anything());
		expect(result.upcoming.map((i) => i.id)).toEqual(['sept']);
	});

	it('treats an open-ended season (empty endDate) as ongoing -- its rehearsals appear', async () => {
		listSeasonsMock.mockResolvedValue([
			season('open', '2026-09-01', '')
		]);
		listRehearsalsMock.mockResolvedValue([item('future', '2026-09-12T18:00:00.000Z')]);

		const result = await listFullAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'open', expect.anything());
		expect(result.upcoming.map((i) => i.id)).toEqual(['future']);
	});

	it('excludes rehearsals earlier than now (this-morning boundary excluded)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s', '2026-09-01', '2027-05-31')
		]);
		listRehearsalsMock.mockResolvedValue([
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
		expect(listRehearsalsMock).not.toHaveBeenCalled();
	});
});

// ---- listFullAgenda: recent items + season data (the #83 addition) ----

describe('listFullAgenda -- recent items + current season (#83 F1+F2)', () => {
	it('returns the current season\'s PAST events as recent, reverse-chronological', async () => {
		// Season started 2026-09-01, NOW is 2026-09-05T10:00Z -> season is current
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockResolvedValue([
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
		listRehearsalsMock.mockResolvedValue([
			item('r1', '2026-09-10T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBe('s-cur');
		expect(result.seasonConductors).toEqual(['p-anna', 'p-bert']);
	});

	it('returns empty recent + null seasonId when no season has started (all future)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-future', '2027-09-01', '2028-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockResolvedValue([]);

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
		listRehearsalsMock.mockImplementation((_cfg: unknown, id: string) =>
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

		// Only the current season's past events appear in recent
		expect(result.recent.map((i) => i.id)).toEqual(['cur-past']);
		expect(result.seasonId).toBe('s-cur');
	});

	it('paired.find correctly matches the current season by id', async () => {
		// Two started seasons — currentSeason picks the latest start
		listSeasonsMock.mockResolvedValue([
			season('s-old', '2025-09-01', '2026-05-31'),
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 's-old'
					? [item('old-event', '2026-05-10T18:00:00.000Z')]
					: [item('cur-event', '2026-09-03T18:00:00.000Z')]
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		// recent must contain only the current season's events, not the old season's
		expect(result.recent.map((i) => i.id)).toEqual(['cur-event']);
		expect(result.seasonConductors).toEqual(['p-anna']);
	});

	it('returns empty recent when the current season has no past events yet', async () => {
		// Season just started, all events are upcoming
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockResolvedValue([
			item('upcoming-1', '2026-09-10T18:00:00.000Z'),
			item('upcoming-2', '2026-09-17T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent).toEqual([]);
		expect(result.seasonId).toBe('s-cur');
		expect(result.seasonConductors).toEqual(['p-anna']);
	});
});

// ---- loadFullAgenda (threads the T4 selected db + token) ----

describe('loadFullAgenda (threads the T4 selected db + token)', () => {
	it('resolves db from selectedDbStore and token from storage', async () => {
		dbHolder.store.set('polyphony');
		setToken('jwt-live');
		listSeasonsMock.mockResolvedValue([]);

		await loadFullAgenda(NOW);

		expect(listSeasonsMock).toHaveBeenCalledWith(
			{ db: 'polyphony', token: 'jwt-live' },
			expect.anything()
		);
	});

	it('returns empty result without reading when no collective is selected', async () => {
		setToken('jwt-live'); // token present, but db null
		const result = await loadFullAgenda(NOW);
		expect(result).toEqual({
			upcoming: [],
			recent: [],
			seasonId: null,
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: []
		});
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});

	it('returns empty result without reading when there is no token', async () => {
		dbHolder.store.set('polyphony'); // db present, but no token
		const result = await loadFullAgenda(NOW);
		expect(result).toEqual({
			upcoming: [],
			recent: [],
			seasonId: null,
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: []
		});
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
