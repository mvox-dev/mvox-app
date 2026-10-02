// Section rename: one overwrite POST carrying the old value's _id.
import { describe, expect, it, vi } from 'vitest';
import { renameSection } from './sectionActions';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

function makeFetchMock(oldValues: Array<{ _id: string }>) {
	return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		return Promise.resolve(json({ entity: { name: oldValues } }));
	});
}

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(([u, init]) => ({
		url: String(u),
		method: init?.method ?? 'GET',
		body: init?.body ? JSON.parse(String(init.body)) : undefined
	}));
}

describe('renameSection — ATOMIC overwrite of the name property (#264)', () => {
	it('GETs entity/{id} projecting name, then POSTs entity/{id} with body EXACTLY [{ _id: <old id>, type: "name", string: <trimmed> }] — and ZERO property DELETEs', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'nv-old' }]);
		await renameSection(cfg, 'sec-alto', '  Alto II  ', fetchImpl);

		const calls = callsOf(fetchImpl);
		const gets = calls.filter((c) => c.method === 'GET');
		expect(
			gets.some((c) => c.url.includes('/testdb/entity/sec-alto') && c.url.includes('props=name'))
		).toBe(true);

		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toContain('/testdb/entity/sec-alto');
		expect(posts[0].body).toEqual([{ _id: 'nv-old', type: 'name', string: 'Alto II' }]);

		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(calls).toHaveLength(2);
	});

	it('a failed POST really does leave the old value untouched — the overwrite never committed, no DELETE fires, and the status surfaces', async () => {
		const bodies: unknown[] = [];
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				bodies.push(JSON.parse(String(init.body)));
				return Promise.resolve(json({ error: 'nope' }, 500));
			}
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(json({ entity: { name: [{ _id: 'nv-old' }] } }));
		});
		await expect(renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl)).rejects.toThrow(/500/);
		expect(callsOf(fetchImpl).filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(bodies).toEqual([[{ _id: 'nv-old', type: 'name', string: 'Soprano 2' }]]);
	});

	it('CORRUPTED duplicate state (two name values): the overwrite pairs the FIRST old id; only the EXTRA is deleted, strictly AFTER the POST', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'nv-a' }, { _id: 'nv-b' }]);
		await renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl);

		const calls = callsOf(fetchImpl);
		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].body).toEqual([{ _id: 'nv-a', type: 'name', string: 'Soprano 2' }]);

		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls).toEqual([expect.stringContaining('/testdb/property/nv-b')]);
		for (const u of deleteUrls) expect(u).not.toContain('/entity/');
		expect(calls.findIndex((c) => c.method === 'DELETE')).toBeGreaterThan(
			calls.findIndex((c) => c.method === 'POST')
		);
	});

	it('a section with NO existing name value (corrupted state) gets a PLAIN POST — body EXACTLY [{ type: "name", string: <trimmed> }], nothing to overwrite, no DELETE', async () => {
		const fetchImpl = makeFetchMock([]);
		await renameSection(cfg, 'sec-orphan', 'Orphan', fetchImpl);

		const calls = callsOf(fetchImpl);
		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].body).toEqual([{ type: 'name', string: 'Orphan' }]);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('refuses an empty/whitespace-only name WITHOUT any fetch', async () => {
		const fetchImpl = vi.fn();
		await expect(renameSection(cfg, 'sec-sop', '   ', fetchImpl)).rejects.toThrow(/empty/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('throws on a non-2xx lookup GET (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'nope' }, 500));
		await expect(renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl)).rejects.toThrow(/500/);
	});

	it('a failed EXTRA-stale-value DELETE (corrupted state only) throws — the attempted delete targeted the extra id, never the replaced one', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ error: 'nope' }, 403));
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(json({ entity: { name: [{ _id: 'nv-a' }, { _id: 'nv-b' }] } }));
		});
		await expect(renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl)).rejects.toThrow(/403/);
		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
			expect.stringContaining('/property/nv-b')
		]);
	});
});

// (*MVOX:Palestrina*)
// (*MVOX:Tallis*)
