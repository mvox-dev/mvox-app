import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { renameSection } from './sectionActions';

// #155/S4 — the section RENAME write layer.
//
// Contract under test (see sectionActions.ts module header):
//
//   - `renameSection(cfg, sectionId, name)` replaces the section's `name`
//     property — GET `entity/{id}?props=name` FIRST (so the deletes can only
//     ever target PRE-EXISTING value ids) → POST the new value → DELETE
//     every old value id at `/property/{valueId}`. POST-BEFORE-DELETE: a
//     failed POST must leave the old name standing; a failed DELETE leaves a
//     duplicate the next rename's GET-then-delete-all sweeps.
//   - `name` sent TRIMMED; empty/whitespace-only throws WITHOUT any fetch.
//   - Never `DELETE /entity/...` — the endpoint split (property-VALUE ids go
//     to /property/{id}; an /entity DELETE would delete the section itself).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** Fetch mock: GET entity/{id}?props=name answers with the given old `name`
 *  value ids; POST and DELETE succeed. */
function makeFetchMock(oldValues: Array<{ _id: string }>) {
	return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		return Promise.resolve(json({ entity: { name: oldValues } }));
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

describe('renameSection — replaces the name property (GET old → POST new → DELETE old)', () => {
	it('GETs entity/{id} projecting name, then POSTs entity/{id} with body EXACTLY [{ type: "name", string: <trimmed> }]', async () => {
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
		expect(posts[0].body).toEqual([{ type: 'name', string: 'Alto II' }]);
	});

	it('DELETEs EVERY old name value id at /property/{valueId} — never /entity/', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'nv-old' }]);
		await renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl);

		const deleteUrls = callsOf(fetchImpl)
			.filter((c) => c.method === 'DELETE')
			.map((c) => c.url);
		expect(deleteUrls).toEqual([expect.stringContaining('/testdb/property/nv-old')]);
		for (const u of deleteUrls) expect(u).not.toContain('/entity/');
	});

	it('POST lands BEFORE the DELETE of the old value — a failed POST must leave the old name in place', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'nv-old' }]);
		await renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl);

		const calls = callsOf(fetchImpl);
		const postIdx = calls.findIndex((c) => c.method === 'POST' && c.url.includes('/entity/sec-sop2'));
		const delIdx = calls.findIndex((c) => c.method === 'DELETE' && c.url.includes('/property/nv-old'));
		expect(postIdx).toBeGreaterThanOrEqual(0);
		expect(delIdx).toBeGreaterThan(postIdx);
	});

	it('a failed POST really does leave the old value untouched — no DELETE fires, and the status surfaces', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(json({ error: 'nope' }, 500));
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(json({ entity: { name: [{ _id: 'nv-old' }] } }));
		});
		await expect(renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl)).rejects.toThrow(/500/);
		expect(callsOf(fetchImpl).filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('sweeps DUPLICATE old values — corrupted state with two name values deletes BOTH', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'nv-a' }, { _id: 'nv-b' }]);
		await renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl);

		const deleteUrls = callsOf(fetchImpl)
			.filter((c) => c.method === 'DELETE')
			.map((c) => c.url)
			.sort();
		expect(deleteUrls).toEqual([
			expect.stringContaining('/property/nv-a'),
			expect.stringContaining('/property/nv-b')
		]);
	});

	it('a section with NO existing name value (corrupted state) gets the POST only — nothing to delete', async () => {
		const fetchImpl = makeFetchMock([]);
		await renameSection(cfg, 'sec-orphan', 'Orphan', fetchImpl);

		const calls = callsOf(fetchImpl);
		expect(calls.some((c) => c.method === 'POST' && c.url.includes('/entity/sec-orphan'))).toBe(true);
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

	it('throws on a non-2xx old-value DELETE (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ error: 'nope' }, 403));
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(json({ entity: { name: [{ _id: 'nv-old' }] } }));
		});
		await expect(renameSection(cfg, 'sec-sop2', 'Soprano 2', fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Palestrina* — #155/S4)
