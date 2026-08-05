// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from './types';

// Mock the read helpers (orchestration is tested independently of the queries) and
// T4's selectedDbStore (so loadAgenda's db-threading is observable). Mocking both
// also severs the transitive entu-config → $env import under happy-dom.
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

import { listAgenda, loadAgenda } from './agendaData';
import { setToken } from '$lib/auth/storage';

const cfg = { db: 'polyphony', token: 'jwt' };
const NOW = new Date('2026-09-05T10:00:00.000Z');

function item(id: string, startDatetime: string): AgendaItem {
	return { id, name: id, startDatetime, durationMinutes: 60, location: '' };
}

beforeEach(() => {
	localStorage.clear();
	listSeasonsMock.mockReset();
	listRehearsalsMock.mockReset();
	dbHolder.store.set(null);
});

afterEach(() => vi.restoreAllMocks());

describe('listAgenda (de-fanned to one collective)', () => {
	it('flattens ongoing seasons → upcoming → sorted ascending (no org stamping)', async () => {
		listSeasonsMock.mockResolvedValue([
			{ id: 's1', name: 'S1', startDate: '2026-01-01', endDate: '2027-05-31' }
		]);
		listRehearsalsMock.mockResolvedValue([
			item('late', '2026-09-20T16:00:00.000Z'),
			item('soon', '2026-09-10T16:00:00.000Z')
		]);

		const result = await listAgenda(cfg, NOW);

		expect(result.map((i) => i.id)).toEqual(['soon', 'late']);
		// plain AgendaItem[] — no orgId/orgLabel, no {items,errors} wrapper
		expect(result[0]).toEqual(item('soon', '2026-09-10T16:00:00.000Z'));
	});

	it('skips seasons that ended before today (no rehearsal fetch for them)', async () => {
		listSeasonsMock.mockResolvedValue([
			{ id: 'old', name: 'Old', startDate: '2025-09-01', endDate: '2026-05-31' },
			{ id: 'cur', name: 'Cur', startDate: '2026-09-01', endDate: '2027-05-31' }
		]);
		listRehearsalsMock.mockResolvedValue([]);

		await listAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledTimes(1);
		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'cur', expect.anything());
	});

	it('excludes rehearsals earlier than now (this-morning boundary excluded)', async () => {
		listSeasonsMock.mockResolvedValue([
			{ id: 's', name: 'S', startDate: '2026-09-01', endDate: '2027-05-31' }
		]);
		listRehearsalsMock.mockResolvedValue([
			item('past', '2026-09-05T07:00:00.000Z'), // before NOW (10:00)
			item('next', '2026-09-05T18:00:00.000Z')
		]);

		const result = await listAgenda(cfg, NOW);
		expect(result.map((i) => i.id)).toEqual(['next']);
	});

	it('returns [] when the collective has no seasons', async () => {
		listSeasonsMock.mockResolvedValue([]);
		const result = await listAgenda(cfg, NOW);
		expect(result).toEqual([]);
		expect(listRehearsalsMock).not.toHaveBeenCalled();
	});
});

describe('loadAgenda (threads the T4 selected db + token)', () => {
	it('resolves db from selectedDbStore and token from storage', async () => {
		dbHolder.store.set('polyphony');
		setToken('jwt-live');
		listSeasonsMock.mockResolvedValue([]);

		await loadAgenda(NOW);

		expect(listSeasonsMock).toHaveBeenCalledWith(
			{ db: 'polyphony', token: 'jwt-live' },
			expect.anything()
		);
	});

	it('returns [] without reading when no collective is selected', async () => {
		setToken('jwt-live'); // token present, but db null
		const result = await loadAgenda(NOW);
		expect(result).toEqual([]);
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});

	it('returns [] without reading when there is no token', async () => {
		dbHolder.store.set('polyphony'); // db present, but no token
		const result = await loadAgenda(NOW);
		expect(result).toEqual([]);
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});
});
