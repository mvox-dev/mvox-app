// The collective display name lives on the mvox_collective marker entity, not the database.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { json, testCfg } from '$lib/testing/entuFetchKit';
import { resolveCollectiveNameMarker, updateCollectiveName } from './collectiveName';

const cfg = testCfg('testdb');

function callUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0]));
}

function callMethods(fetchImpl: ReturnType<typeof vi.fn>): Array<string | undefined> {
	return fetchImpl.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
}

describe('resolveCollectiveNameMarker', () => {
	it('queries the marker type scoped to cfg.db and answers { markerId, name } off the first hit', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 1,
				entities: [{ _id: 'marker-1', name: [{ _id: 'nv-1', string: '  Koor Sampledb  ' }] }]
			})
		);

		const result = await resolveCollectiveNameMarker(cfg, fetchImpl);

		expect(result).toEqual({ markerId: 'marker-1', name: 'Koor Sampledb' });

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = callUrls(fetchImpl)[0];
		expect(url).toContain('/testdb/entity?');
		expect(url).toContain('_type.string=mvox_collective');
		expect(url).toContain('props=name');
		expect(url).toContain('limit=1');
		const method = (fetchImpl.mock.calls[0][1] as RequestInit | undefined)?.method;
		expect(method === undefined || method === 'GET').toBe(true);
	});

	it("a marker WITHOUT a name property answers name: '' (the page can still SET it) — never the db slug", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ count: 1, entities: [{ _id: 'marker-1' }] }));

		const result = await resolveCollectiveNameMarker(cfg, fetchImpl);
		expect(result).toEqual({ markerId: 'marker-1', name: '' });
	});

	it('no marker in the db → null', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ count: 0, entities: [] }));
		await expect(resolveCollectiveNameMarker(cfg, fetchImpl)).resolves.toBeNull();
	});

	it('non-2xx → throws (a broken read must never render as "no marker")', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'forbidden' }, 403));
		await expect(resolveCollectiveNameMarker(cfg, fetchImpl)).rejects.toThrow(/403/);
	});
});

function markerWithNames(): Response {
	return json({
		entity: {
			_id: 'marker-1',
			name: [
				{ _id: 'nv-old', string: 'Vana Nimi' },
				{ _id: 'nv-phantom', string: 'Phantom' }
			]
		}
	});
}

describe('updateCollectiveName', () => {
	it('#264 atomic overwrite: GET existing ids → ONE POST carrying the first old id; only the corrupted phantom is deleted, strictly after the POST', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(markerWithNames())
			.mockResolvedValue(json({}));

		await updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const urls = callUrls(fetchImpl);
		const methods = callMethods(fetchImpl);

		expect(urls[0]).toContain('/testdb/entity/marker-1?props=name');
		expect(methods[0] === undefined || methods[0] === 'GET').toBe(true);

		expect(urls[1]).toContain('/testdb/entity/marker-1');
		expect(methods[1]).toBe('POST');
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ _id: 'nv-old', type: 'name', string: 'Uus Nimi' }]);

		expect(urls[2]).toContain('/testdb/property/nv-phantom');
		expect(methods[2]).toBe('DELETE');
	});

	it('a failed POST throws and DELETES NOTHING — the old name must survive a failed write', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(markerWithNames())
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));

		await expect(updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl)).rejects.toThrow(
			/403/
		);
		expect(callMethods(fetchImpl)).not.toContain('DELETE');
	});

	it('a failed lookup throws and POSTS NOTHING (writing blind would guarantee a phantom double-value)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));

		await expect(updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl)).rejects.toThrow(
			/500/
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a failed DELETE throws (the caller must know the replace only half-landed)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(markerWithNames())
			.mockResolvedValueOnce(json({})) // POST ok
			.mockResolvedValueOnce(json({ error: 'gone wrong' }, 500));

		await expect(updateCollectiveName(cfg, 'marker-1', 'Uus Nimi', fetchImpl)).rejects.toThrow(
			/500/
		);
	});
});

// (*MVOX:Tallis* — #165 RED)
