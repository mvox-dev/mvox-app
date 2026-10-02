// Seasons are read as children of the database entity.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSeasons } from './entuSeasons';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';

function makeRouter(): { fetchImpl: typeof fetch; urls: string[] } {
	const urls: string[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		urls.push(url);
		if (url.includes('_type.string=database')) {
			return json({ entities: [{ _id: DB_ENTITY }], count: 1 });
		}
		if (url.includes('_type.string=season')) {
			if (!url.includes(`_parent.reference=${DB_ENTITY}`)) {
				return json({ entities: [], count: 0 });
			}
			return json({
				entities: [
					{
						_id: 'season-1',
						name: [{ string: 'Season 2026/27' }],
						start_date: [{ date: '2026-09-01' }],
						end_date: [{ date: '2027-06-30' }]
					}
				],
				count: 1
			});
		}
		return json({ entities: [], count: 0 });
	}) as unknown as typeof fetch;
	return { fetchImpl, urls };
}

describe('listSeasons — scoped to the DATABASE entity (#161)', () => {
	it('resolves the database entity and lists seasons via `_parent.reference=<databaseEntityId>` — no member walk, no organization query', async () => {
		const { fetchImpl, urls } = makeRouter();
		const seasons = await listSeasons(cfg, fetchImpl);

		expect(seasons).toHaveLength(1);
		expect(seasons[0]).toMatchObject({
			id: 'season-1',
			name: 'Season 2026/27',
			startDate: '2026-09-01',
			endDate: '2027-06-30'
		});

		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(true);
		expect(
			urls.some(
				(u) => u.includes('_type.string=season') && u.includes(`_parent.reference=${DB_ENTITY}`)
			)
		).toBe(true);
		expect(urls.some((u) => u.includes('_type.string=member'))).toBe(false);
		expect(urls.some((u) => u.includes('organization'))).toBe(false);
	});
});

describe('listSeasons — no personId parameter (#161 review fix)', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('global fetch must not be used — pass fetchImpl explicitly');
			})
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('listSeasons(cfg, fetchImpl) — fetchImpl in the SECOND slot — resolves the database entity and lists its seasons', async () => {
		const { fetchImpl, urls } = makeRouter();

		const seasons = await listSeasons(cfg, fetchImpl);

		expect(seasons).toHaveLength(1);
		expect(seasons[0]).toMatchObject({ id: 'season-1', name: 'Season 2026/27' });
		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(true);
		expect(
			urls.some(
				(u) => u.includes('_type.string=season') && u.includes(`_parent.reference=${DB_ENTITY}`)
			)
		).toBe(true);
	});

	it('declares exactly ONE required parameter (cfg) — personId is gone from the signature', () => {
		expect(listSeasons.length).toBe(1);
	});
});

// (*MVOX:Tallis*)
