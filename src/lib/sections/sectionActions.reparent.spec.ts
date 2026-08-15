import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { reparentSection } from './sectionActions';

// #155/S3 RED — the section REPARENT write layer (indent/unindent).
// `reparentSection` in `sectionActions.ts` is a stub that throws
// 'not implemented', so every assertion below FAILS until GREEN.
//
// Contract under test (see sectionActions.ts module header):
//
//   - `reparentSection(cfg, sectionId, newParentId)` re-points the section's
//     `_parent` reference — INDENT hands it the previous sibling's id,
//     UNINDENT hands it the grandparent's (a section id, or the ORG id when
//     promoting to top level). This layer doesn't know which move it is; it
//     just replaces the reference. v4E `parentConstraint: 'exactly_one_of'`:
//     a section always has EXACTLY ONE parent, so replace — never append.
//   - The replace shape pinned by eventFieldEdit/reorderSections: GET
//     `entity/{id}?props=_parent` FIRST (so the deletes can only ever target
//     PRE-EXISTING value ids) → POST the new reference → DELETE every old
//     value id at `/property/{valueId}`. POST-BEFORE-DELETE: a failed POST
//     must leave the old parent standing (a section must never dangle
//     parentless); a failed DELETE leaves a duplicate the next sweep cleans.
//   - Never `DELETE /entity/...` — the endpoint split (property-VALUE ids go
//     to /property/{id}; an /entity DELETE would delete the section itself).
//   - `newParentId === sectionId` throws WITHOUT any fetch (self-parent).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/**
 * Fetch mock: GET entity/{id}?props=_parent answers with the given old
 * `_parent` value ids; POST and DELETE succeed.
 */
function makeFetchMock(oldValues: Array<{ _id: string; reference?: string; entity_type?: string }>) {
	return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		return Promise.resolve(json({ entity: { _parent: oldValues } }));
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

describe('reparentSection — replaces the _parent reference (GET old → POST new → DELETE old)', () => {
	it('GETs entity/{id} projecting _parent, then POSTs entity/{id} with body EXACTLY [{ type: "_parent", reference: newParentId }]', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'pv-old', reference: 'sec-parent-old', entity_type: 'section' }]);
		await reparentSection(cfg, 'sec-alto', 'sec-sop', fetchImpl);

		const calls = callsOf(fetchImpl);
		const gets = calls.filter((c) => c.method === 'GET');
		expect(
			gets.some((c) => c.url.includes('/testdb/entity/sec-alto') && c.url.includes('props=_parent'))
		).toBe(true);

		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toContain('/testdb/entity/sec-alto');
		// FULL-shape toEqual — a stray extra prop (a `_sharing`, a `_type`, a
		// second value) or a `{ string: ... }` instead of a reference is a bug
		// this must catch (the #10 pinned wire-shape: references go as
		// `reference`, never `string`).
		expect(posts[0].body).toEqual([{ type: '_parent', reference: 'sec-sop' }]);
	});

	it('DELETEs EVERY old _parent value id at /property/{valueId} — never /entity/', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'pv-old', reference: 'org-1', entity_type: 'organization' }]);
		await reparentSection(cfg, 'sec-sop2', 'org-1x', fetchImpl);

		const deleteUrls = callsOf(fetchImpl)
			.filter((c) => c.method === 'DELETE')
			.map((c) => c.url);
		expect(deleteUrls).toEqual([expect.stringContaining('/testdb/property/pv-old')]);
		// The endpoint split, pinned: an /entity DELETE here would delete the
		// SECTION (or its parent), not the reference between them.
		for (const u of deleteUrls) expect(u).not.toContain('/entity/');
	});

	it('POST lands BEFORE the DELETE of the old value — a failed POST must leave the old parent in place', async () => {
		const fetchImpl = makeFetchMock([{ _id: 'pv-old', reference: 'sec-sop', entity_type: 'section' }]);
		await reparentSection(cfg, 'sec-sop2', 'org-1', fetchImpl);

		const calls = callsOf(fetchImpl);
		const postIdx = calls.findIndex((c) => c.method === 'POST' && c.url.includes('/entity/sec-sop2'));
		const delIdx = calls.findIndex((c) => c.method === 'DELETE' && c.url.includes('/property/pv-old'));
		expect(postIdx).toBeGreaterThanOrEqual(0);
		expect(delIdx).toBeGreaterThan(postIdx);
	});

	it('a failed POST really does leave the old value untouched — no DELETE fires, and the status surfaces', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(json({ error: 'nope' }, 500));
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(
				json({ entity: { _parent: [{ _id: 'pv-old', reference: 'sec-sop', entity_type: 'section' }] } })
			);
		});
		await expect(reparentSection(cfg, 'sec-sop2', 'org-1', fetchImpl)).rejects.toThrow(/500/);
		expect(callsOf(fetchImpl).filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('sweeps DUPLICATE old values — corrupted state with two _parent values deletes BOTH (exactly_one_of must not survive as a phantom second parent)', async () => {
		const fetchImpl = makeFetchMock([
			{ _id: 'pv-a', reference: 'sec-sop', entity_type: 'section' },
			{ _id: 'pv-b', reference: 'sec-sop', entity_type: 'section' }
		]);
		await reparentSection(cfg, 'sec-sop2', 'org-1', fetchImpl);

		const deleteUrls = callsOf(fetchImpl)
			.filter((c) => c.method === 'DELETE')
			.map((c) => c.url)
			.sort();
		expect(deleteUrls).toEqual([
			expect.stringContaining('/property/pv-a'),
			expect.stringContaining('/property/pv-b')
		]);
	});

	it('a section with NO existing _parent value (corrupted state) gets the POST only — nothing to delete', async () => {
		const fetchImpl = makeFetchMock([]);
		await reparentSection(cfg, 'sec-orphan', 'sec-sop', fetchImpl);

		const calls = callsOf(fetchImpl);
		expect(calls.some((c) => c.method === 'POST' && c.url.includes('/entity/sec-orphan'))).toBe(true);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('refuses newParentId === sectionId WITHOUT any fetch — a section can never be its own parent', async () => {
		const fetchImpl = vi.fn();
		await expect(reparentSection(cfg, 'sec-sop', 'sec-sop', fetchImpl)).rejects.toThrow(/own parent|itself|self/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('throws on a non-2xx lookup GET (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'nope' }, 500));
		await expect(reparentSection(cfg, 'sec-sop2', 'org-1', fetchImpl)).rejects.toThrow(/500/);
	});

	it('throws on a non-2xx old-value DELETE (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ error: 'nope' }, 403));
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(
				json({ entity: { _parent: [{ _id: 'pv-old', reference: 'sec-sop', entity_type: 'section' }] } })
			);
		});
		await expect(reparentSection(cfg, 'sec-sop2', 'org-1', fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis* — #155/S3 RED)
