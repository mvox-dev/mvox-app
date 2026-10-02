// The roster_show_real_names toggle on the database entity: read and admin write.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { json, testCfg } from '$lib/testing/entuFetchKit';
import { readRosterNamesSetting, updateRosterShowRealNames } from './rosterNames';

const cfg = testCfg('testdb');

function callUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0]));
}

function callMethods(fetchImpl: ReturnType<typeof vi.fn>): Array<string | undefined> {
	return fetchImpl.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
}

describe('readRosterNamesSetting', () => {
	it('resolves the database entity id, then GETs roster_show_real_names off it — two GETs, no writes', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(
				json({
					entity: {
						_id: 'db-entity-1',
						roster_show_real_names: [{ _id: 'bv-1', boolean: true }]
					}
				})
			);

		const result = await readRosterNamesSetting(cfg, fetchImpl);
		expect(result).toEqual({ dbEntityId: 'db-entity-1', showRealNames: true });

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const urls = callUrls(fetchImpl);
		expect(urls[0]).toContain('/testdb/entity?');
		expect(urls[0]).toContain('_type.string=database');
		expect(urls[0]).toContain('props=_id');
		expect(urls[0]).toContain('limit=1');
		expect(urls[1]).toContain('/testdb/entity/db-entity-1?props=roster_show_real_names');
		for (const method of callMethods(fetchImpl)) {
			expect(method === undefined || method === 'GET').toBe(true);
		}
	});

	it('explicit boolean false → showRealNames false', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(
				json({
					entity: {
						_id: 'db-entity-1',
						roster_show_real_names: [{ _id: 'bv-1', boolean: false }]
					}
				})
			);

		await expect(readRosterNamesSetting(cfg, fetchImpl)).resolves.toEqual({
			dbEntityId: 'db-entity-1',
			showRealNames: false
		});
	});

	it('the key is entirely ABSENT when unset (platform wire shape) → false — never a throw, never true', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(json({ entity: { _id: 'db-entity-1' } }));

		await expect(readRosterNamesSetting(cfg, fetchImpl)).resolves.toEqual({
			dbEntityId: 'db-entity-1',
			showRealNames: false
		});
	});

	it('no visible database entity → throws (fail loud — a broken read must never render as "profile names")', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ entities: [] }));
		await expect(readRosterNamesSetting(cfg, fetchImpl)).rejects.toThrow();
	});

	it('non-2xx on the value read → throws with the status', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entities: [{ _id: 'db-entity-1' }] }))
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
		await expect(readRosterNamesSetting(cfg, fetchImpl)).rejects.toThrow(/403/);
	});

	it('non-2xx on the id resolve → throws with the status', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'down' }, 500));
		await expect(readRosterNamesSetting(cfg, fetchImpl)).rejects.toThrow(/500/);
	});
});

function entityWithValue(): Response {
	return json({
		entity: {
			_id: 'db-entity-1',
			roster_show_real_names: [{ _id: 'bv-old', boolean: false }]
		}
	});
}

describe('updateRosterShowRealNames', () => {
	it('#264 atomic overwrite: GET the existing value id → ONE POST pairing it with the new boolean; FULL wire shape, zero deletes on the normal path', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(entityWithValue())
			.mockResolvedValue(json({}));

		await updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const urls = callUrls(fetchImpl);
		const methods = callMethods(fetchImpl);

		expect(urls[0]).toContain('/testdb/entity/db-entity-1?props=roster_show_real_names');
		expect(methods[0] === undefined || methods[0] === 'GET').toBe(true);

		expect(urls[1]).toContain('/testdb/entity/db-entity-1');
		expect(methods[1]).toBe('POST');
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ _id: 'bv-old', type: 'roster_show_real_names', boolean: true }]);
	});

	it('no existing value (never toggled) → the POST goes BARE: no `_id`, exactly one entry', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'db-entity-1' } }))
			.mockResolvedValue(json({}));

		await updateRosterShowRealNames(cfg, 'db-entity-1', false, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(callMethods(fetchImpl)[1]).toBe('POST');
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ type: 'roster_show_real_names', boolean: false }]);
	});

	it('corrupted multi-value state: the FIRST id rides the POST; only the phantom EXTRA dies, via the property endpoint, strictly AFTER the POST', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json({
					entity: {
						_id: 'db-entity-1',
						roster_show_real_names: [
							{ _id: 'bv-old', boolean: false },
							{ _id: 'bv-phantom', boolean: true }
						]
					}
				})
			)
			.mockResolvedValue(json({}));

		await updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		const urls = callUrls(fetchImpl);
		const methods = callMethods(fetchImpl);
		const postBody = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(postBody).toEqual([{ _id: 'bv-old', type: 'roster_show_real_names', boolean: true }]);
		expect(urls[2]).toContain('/testdb/property/bv-phantom');
		expect(methods[2]).toBe('DELETE');
	});

	it('a failed POST throws and DELETES NOTHING — the old value must survive a failed write (the page then tells the truth)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(entityWithValue())
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));

		await expect(updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl)).rejects.toThrow(
			/403/
		);
		expect(callMethods(fetchImpl)).not.toContain('DELETE');
	});

	it('a failed lookup throws and POSTS NOTHING (writing blind would guarantee a phantom double-value)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));

		await expect(updateRosterShowRealNames(cfg, 'db-entity-1', true, fetchImpl)).rejects.toThrow(
			/500/
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — #267 RED)
