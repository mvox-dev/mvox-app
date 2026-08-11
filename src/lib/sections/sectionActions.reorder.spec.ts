import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { reorderSections } from './sectionActions';

// TS.4/#98 RED — the section REORDER write layer. `reorderSections` in
// `sectionActions.ts` is a stub that throws 'not implemented', so every
// assertion below FAILS until GREEN.
//
// Contract under test (see sectionActions.ts module header):
//
//   - `reorderSections(cfg, orderedIds)` renumbers `display_order` on EVERY id
//     to its 1-BASED position in the array (index 0 → 1). `orderedIds` is one
//     SIBLING GROUP in its new order — the caller (the roster page) enforces
//     the same-parent constraint; this layer just renumbers what it's given.
//   - Per section, the replace shape pinned by repertoireActions'
//     updateProgramItemOrdinal: GET `entity/{id}?props=display_order` → POST
//     the new value → DELETE every OLD value id at `/property/{valueId}`.
//     POST-BEFORE-DELETE: a failed POST must leave the old value untouched
//     (an empty display_order would sort the section to the END as Infinity —
//     see sectionData.listSections).
//   - Never `DELETE /entity/...` — the endpoint split (property-VALUE ids go
//     to /property/{id}; an /entity DELETE would delete the section itself).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/**
 * Fetch mock: GET entity/{id}?props=display_order answers from `oldValues`
 * (value ids the section currently holds); POST and DELETE succeed.
 */
function makeFetchMock(oldValues: Record<string, Array<{ _id: string }>>) {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		const id = u.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
		return Promise.resolve(json({ entity: { display_order: oldValues[id] ?? [] } }));
	});
}

interface Call {
	url: string;
	method: string;
	body: unknown;
}

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(([u, init]) => ({
		url: String(u),
		method: init?.method ?? 'GET',
		body: init?.body ? JSON.parse(String(init.body)) : undefined
	}));
}

describe('reorderSections — renumbers display_order to the 1-based array position (GET → POST new → DELETE old per section)', () => {
	it('POSTs entity/{id} with body EXACTLY [{ type: "display_order", number: <1-based position> }] for EVERY id, in the given order', async () => {
		const fetchImpl = makeFetchMock({
			'sec-alto': [{ _id: 'pv-alto' }],
			'sec-sop': [{ _id: 'pv-sop' }],
			'sec-tenor': [{ _id: 'pv-tenor' }]
		});
		await reorderSections(cfg, ['sec-alto', 'sec-sop', 'sec-tenor'], fetchImpl);

		const posts = callsOf(fetchImpl).filter((c) => c.method === 'POST');
		const bodyFor = (id: string) => posts.find((c) => c.url.includes(`/testdb/entity/${id}`))?.body;
		// FULL-shape toEqual — a stray extra prop (a `_sharing`, a name, a second
		// value) or a 0-based number is a bug this must catch.
		expect(bodyFor('sec-alto')).toEqual([{ type: 'display_order', number: 1 }]);
		expect(bodyFor('sec-sop')).toEqual([{ type: 'display_order', number: 2 }]);
		expect(bodyFor('sec-tenor')).toEqual([{ type: 'display_order', number: 3 }]);
		expect(posts).toHaveLength(3);
	});

	it('reads each section\'s OLD value ids (GET entity/{id} projecting display_order) and DELETEs each at /property/{valueId} — never /entity/', async () => {
		const fetchImpl = makeFetchMock({
			'sec-alto': [{ _id: 'pv-alto' }],
			'sec-sop': [{ _id: 'pv-sop' }]
		});
		await reorderSections(cfg, ['sec-alto', 'sec-sop'], fetchImpl);

		const calls = callsOf(fetchImpl);
		const gets = calls.filter((c) => c.method === 'GET');
		expect(gets.some((c) => c.url.includes('/testdb/entity/sec-alto') && c.url.includes('props=display_order'))).toBe(true);
		expect(gets.some((c) => c.url.includes('/testdb/entity/sec-sop') && c.url.includes('props=display_order'))).toBe(true);

		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url).sort();
		expect(deleteUrls).toEqual([
			expect.stringContaining('/testdb/property/pv-alto'),
			expect.stringContaining('/testdb/property/pv-sop')
		]);
		// The endpoint split, pinned: an /entity DELETE here would delete the
		// SECTION, not a property value.
		for (const u of deleteUrls) expect(u).not.toContain('/entity/');
	});

	it('POST lands BEFORE the DELETE of the same section\'s old value — a failed POST must leave the old value in place', async () => {
		const fetchImpl = makeFetchMock({ 'sec-sop': [{ _id: 'pv-sop' }] });
		await reorderSections(cfg, ['sec-sop'], fetchImpl);

		const calls = callsOf(fetchImpl);
		const postIdx = calls.findIndex((c) => c.method === 'POST' && c.url.includes('/entity/sec-sop'));
		const delIdx = calls.findIndex((c) => c.method === 'DELETE' && c.url.includes('/property/pv-sop'));
		expect(postIdx).toBeGreaterThanOrEqual(0);
		expect(delIdx).toBeGreaterThan(postIdx);
	});

	it('a failed POST really does leave the old value untouched — no DELETE fires for that section, and the status surfaces', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(json({ error: 'nope' }, 500));
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(json({ entity: { display_order: [{ _id: 'pv-sop' }] } }));
		});
		await expect(reorderSections(cfg, ['sec-sop'], fetchImpl)).rejects.toThrow(/500/);
		const deletes = callsOf(fetchImpl).filter((c) => c.method === 'DELETE');
		expect(deletes).toEqual([]);
	});

	it('sweeps DUPLICATE old values — corrupted state with two display_order values on one section deletes BOTH (no stray value left to fight the new one)', async () => {
		const fetchImpl = makeFetchMock({ 'sec-sop': [{ _id: 'pv-a' }, { _id: 'pv-b' }] });
		await reorderSections(cfg, ['sec-sop'], fetchImpl);

		const deleteUrls = callsOf(fetchImpl)
			.filter((c) => c.method === 'DELETE')
			.map((c) => c.url)
			.sort();
		expect(deleteUrls).toEqual([
			expect.stringContaining('/property/pv-a'),
			expect.stringContaining('/property/pv-b')
		]);
	});

	it('a section with NO existing display_order value gets the POST only — nothing to delete, no DELETE call for it', async () => {
		const fetchImpl = makeFetchMock({ 'sec-sop': [{ _id: 'pv-sop' }], 'sec-new': [] });
		await reorderSections(cfg, ['sec-sop', 'sec-new'], fetchImpl);

		const calls = callsOf(fetchImpl);
		expect(
			calls.some((c) => c.method === 'POST' && c.url.includes('/entity/sec-new'))
		).toBe(true);
		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls).toEqual([expect.stringContaining('/property/pv-sop')]);
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

	it('throws on a non-2xx old-value DELETE (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ error: 'nope' }, 403));
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(json({ entity: { display_order: [{ _id: 'pv-sop' }] } }));
		});
		await expect(reorderSections(cfg, ['sec-sop'], fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis* — TS.4/#98 RED)
