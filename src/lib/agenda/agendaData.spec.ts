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

	it('queries every season (no end_date pre-filter) — a past season contributes 0 via the event gate', async () => {
		// season.end_date is NOT a reliable bound on event dates, so we no longer
		// pre-filter seasons by it: BOTH seasons are queried. The past season's
		// past-only events are dropped by the event-level `startDatetime >= now`
		// gate, so the net result is unchanged — just an extra query.
		listSeasonsMock.mockResolvedValue([
			{ id: 'old', name: 'Old', startDate: '2025-09-01', endDate: '2026-05-31' },
			{ id: 'cur', name: 'Cur', startDate: '2026-09-01', endDate: '2027-05-31' }
		]);
		listRehearsalsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 'old'
					? [item('old-past', '2026-05-10T18:00:00.000Z')] // before NOW → filtered out
					: [item('cur-next', '2026-09-10T18:00:00.000Z')] // after NOW → kept
			)
		);

		const result = await listAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledTimes(2);
		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'old', expect.anything());
		expect(result.map((i) => i.id)).toEqual(['cur-next']);
	});

	it('fetches a season with a PAST end_date too — its future rehearsals still appear', async () => {
		// The real bug (Pérotin): season "Fila hooaeg" has end_date 2026-07-28 (past)
		// but owns real upcoming rehearsals (Sept–Dec). end_date is not a bound on
		// event dates, so the season must NOT be pre-filtered out — its future events
		// are gated only by the event-level `startDatetime >= now` check.
		listSeasonsMock.mockResolvedValue([
			{ id: 'fila', name: 'Fila hooaeg', startDate: '2025-09-01', endDate: '2026-07-28' }
		]);
		listRehearsalsMock.mockResolvedValue([item('sept', '2026-09-15T18:00:00.000Z')]);

		const result = await listAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'fila', expect.anything());
		expect(result.map((i) => i.id)).toEqual(['sept']);
	});

	it('treats an open-ended season (empty endDate) as ongoing — its rehearsals appear', async () => {
		// The common case: the collective's CURRENT season has no end_date set yet,
		// so entuSeasons maps it to endDate: ''. Its future rehearsals must appear —
		// real EFK open-ended season, slice-1 acceptance. Now handled by fetching
		// events for ALL seasons (no end_date pre-filter), so open-ended is not special.
		listSeasonsMock.mockResolvedValue([
			{ id: 'open', name: 'Open', startDate: '2026-09-01', endDate: '' }
		]);
		listRehearsalsMock.mockResolvedValue([item('future', '2026-09-12T18:00:00.000Z')]);

		const result = await listAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'open', expect.anything());
		expect(result.map((i) => i.id)).toEqual(['future']);
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
