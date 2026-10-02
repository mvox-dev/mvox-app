// Section reorder: one overwrite POST per section, extras swept after.
import { describe, expect, it, vi } from 'vitest';
import { reorderSections } from './sectionActions';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

function makeFetchMock(oldValues: Record<string, Array<{ _id: string }>>) {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		const id = u.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
		return Promise.resolve(json({ entity: { display_order: oldValues[id] ?? [] } }));
	});
}

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(([u, init]) => ({
		url: String(u),
		method: init?.method ?? 'GET',
		body: init?.body ? JSON.parse(String(init.body)) : undefined
	}));
}

describe('reorderSections — ATOMIC overwrite per section (#264): GET old id → ONE POST carrying it, no DELETE round-trip', () => {
	it('POSTs entity/{id} with body EXACTLY [{ _id: <old value id>, type: "display_order", number: <1-based position> }] for EVERY id, and the call log holds ZERO property DELETEs', async () => {
		const fetchImpl = makeFetchMock({
			'sec-alto': [{ _id: 'pv-alto' }],
			'sec-sop': [{ _id: 'pv-sop' }],
			'sec-tenor': [{ _id: 'pv-tenor' }]
		});
		await reorderSections(cfg, ['sec-alto', 'sec-sop', 'sec-tenor'], fetchImpl);

		const calls = callsOf(fetchImpl);
		const posts = calls.filter((c) => c.method === 'POST');
		const bodyFor = (id: string) => posts.find((c) => c.url.includes(`/testdb/entity/${id}`))?.body;
		expect(bodyFor('sec-alto')).toEqual([{ _id: 'pv-alto', type: 'display_order', number: 1 }]);
		expect(bodyFor('sec-sop')).toEqual([{ _id: 'pv-sop', type: 'display_order', number: 2 }]);
		expect(bodyFor('sec-tenor')).toEqual([{ _id: 'pv-tenor', type: 'display_order', number: 3 }]);
		expect(posts).toHaveLength(3);

		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('reads each section\'s old value ids first (GET entity/{id} projecting display_order) — the overwrite entry cannot be built blind', async () => {
		const fetchImpl = makeFetchMock({
			'sec-alto': [{ _id: 'pv-alto' }],
			'sec-sop': [{ _id: 'pv-sop' }]
		});
		await reorderSections(cfg, ['sec-alto', 'sec-sop'], fetchImpl);

		const calls = callsOf(fetchImpl);
		const gets = calls.filter((c) => c.method === 'GET');
		expect(gets.some((c) => c.url.includes('/testdb/entity/sec-alto') && c.url.includes('props=display_order'))).toBe(true);
		expect(gets.some((c) => c.url.includes('/testdb/entity/sec-sop') && c.url.includes('props=display_order'))).toBe(true);
		const getIdx = calls.findIndex((c) => c.method === 'GET' && c.url.includes('sec-alto'));
		const postIdx = calls.findIndex((c) => c.method === 'POST' && c.url.includes('sec-alto'));
		expect(getIdx).toBeGreaterThanOrEqual(0);
		expect(postIdx).toBeGreaterThan(getIdx);
	});

	it('a failed POST leaves the old value untouched — the overwrite never committed, and NO delete of any kind fires', async () => {
		const bodies: unknown[] = [];
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				bodies.push(JSON.parse(String(init.body)));
				return Promise.resolve(json({ error: 'nope' }, 500));
			}
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(json({ entity: { display_order: [{ _id: 'pv-sop' }] } }));
		});
		await expect(reorderSections(cfg, ['sec-sop'], fetchImpl)).rejects.toThrow(/500/);
		expect(callsOf(fetchImpl).filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(bodies).toEqual([[{ _id: 'pv-sop', type: 'display_order', number: 1 }]]);
	});

	it('CORRUPTED duplicate state (two existing values): the overwrite pairs the FIRST old id; the EXTRA stale id is deleted at /property/{id} strictly AFTER the POST', async () => {
		const fetchImpl = makeFetchMock({ 'sec-sop': [{ _id: 'pv-a' }, { _id: 'pv-b' }] });
		await reorderSections(cfg, ['sec-sop'], fetchImpl);

		const calls = callsOf(fetchImpl);
		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].body).toEqual([{ _id: 'pv-a', type: 'display_order', number: 1 }]);

		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls).toEqual([expect.stringContaining('/testdb/property/pv-b')]);
		for (const u of deleteUrls) expect(u).not.toContain('/entity/');
		const postIdx = calls.findIndex((c) => c.method === 'POST');
		const delIdx = calls.findIndex((c) => c.method === 'DELETE');
		expect(delIdx).toBeGreaterThan(postIdx);
	});

	it('a section with NO existing display_order value gets a PLAIN POST — body EXACTLY [{ type: "display_order", number: n }], and no DELETE anywhere in the run', async () => {
		const fetchImpl = makeFetchMock({ 'sec-sop': [{ _id: 'pv-sop' }], 'sec-new': [] });
		await reorderSections(cfg, ['sec-sop', 'sec-new'], fetchImpl);

		const calls = callsOf(fetchImpl);
		const newPost = calls.find((c) => c.method === 'POST' && c.url.includes('/entity/sec-new'));
		expect(newPost?.body).toEqual([{ type: 'display_order', number: 2 }]);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('orderedIds: [] resolves WITHOUT any fetch — nothing to renumber is not an error and not a stray write', async () => {
		const fetchImpl = vi.fn();
		await reorderSections(cfg, [], fetchImpl);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('throws on a non-2xx lookup GET (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'nope' }, 500));
		await expect(reorderSections(cfg, ['sec-sop'], fetchImpl)).rejects.toThrow(/500/);
	});

	it('a failed EXTRA-stale-value DELETE (corrupted state only) throws — and it fired AFTER the POST, against the extra id only, never the replaced one', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ error: 'nope' }, 403));
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(json({ entity: { display_order: [{ _id: 'pv-a' }, { _id: 'pv-b' }] } }));
		});
		await expect(reorderSections(cfg, ['sec-sop'], fetchImpl)).rejects.toThrow(/403/);
		const calls = callsOf(fetchImpl);
		const deletes = calls.filter((c) => c.method === 'DELETE');
		expect(deletes.map((c) => c.url)).toEqual([expect.stringContaining('/property/pv-b')]);
		expect(calls.findIndex((c) => c.method === 'DELETE')).toBeGreaterThan(
			calls.findIndex((c) => c.method === 'POST')
		);
	});
});

// (*MVOX:Tallis*)
