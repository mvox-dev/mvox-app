import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { createLink, deleteLink, reorderLinks, updateLink } from './linkActions';

// #256 RED — Lingikogu (link collection) WRITE layer, modeled on
// sectionActions.ts (the verified closest pattern):
//
// CREATE (mirrors createSection, adapted to the #256 ruling):
//   - `_type` sent as a resolved REFERENCE via resolveTypeId(cfg, 'link')
//     (#10 pinned wire-shape — never `{ string: 'link' }`).
//   - `_parent` = the collective's DATABASE entity (#161): `dbEntityId` given →
//     used VERBATIM, ZERO lookup fetches; absent → resolveDatabaseEntityId
//     (`_type.string=database&limit=1`), none readable → fail loud naming db.
//   - `name` trimmed, required non-empty (throws WITHOUT any fetch).
//   - `url` required non-empty (a non-whitespace char), otherwise sent
//     VERBATIM — no trim, no normalising, NO scheme-guessing (#256 ruling:
//     "URLs are stored as given. No normalising, no scheme-guessing, no
//     validation beyond non-empty").
//   - `description` written only when it is a non-empty string — an absent or
//     empty description writes NO description property at all.
//   - `display_order` written when `displayOrder` is a number (the page passes
//     max existing + 1 so a new link lands at the end of the stable order).
//   - `_sharing: 'domain'` EXPLICIT at create time — every entity owns its
//     `_sharing` at create; the type-def's `domain` does NOT propagate. Unlike
//     createSection's deliberate widen to 'public' (federation
//     discoverability), the #256 ruling is members-only visibility, which IS
//     the parent database's domain tier — so 'domain', stated explicitly.
//   - `_inheritrights: true` EXPLICIT (same #264-item-6 discipline as
//     createSection; the type-def is live with _inheritrights: true).
//   - Full create body is EXACTLY: _type + _parent + name + url
//     (+ description) (+ display_order) + _sharing + _inheritrights, in that
//     order. Throws on non-2xx; 2xx without _id is the apparent-success trap.
//
// UPDATE (whole-field edit — mirrors renameSection's atomic overwrite):
//   - `updateLink(cfg, linkId, { name, url, description })`:
//     GET `entity/{linkId}?props=name,url,description` → ONE POST
//     `entity/{linkId}` whose entries pair each field's FIRST existing value
//     `_id` with the new value (bare entry when the field had no value).
//   - `description: null` with an existing value → the description value id
//     goes to `DELETE /property/{id}` strictly AFTER the POST (the documented
//     user-facing removal — property-VALUE endpoint, never /entity/). The
//     POST then carries NO description entry. `description: null` with no
//     existing value → no delete, no entry.
//   - name/url validation identical to create (name trimmed non-empty, url
//     non-empty verbatim); violations throw WITHOUT any fetch.
//
// REORDER (exactly reorderSections' atomic-overwrite renumber):
//   - `reorderLinks(cfg, orderedIds)` renumbers display_order on EVERY id to
//     its 1-BASED position: per link GET `entity/{id}?props=display_order` →
//     ONE POST `[{ _id: <old value id>, type: 'display_order', number: n }]`
//     (bare entry when no existing value); EXTRA stale ids (corrupted 2+
//     state only) deleted at `/property/{id}` strictly AFTER the POST. NO
//     DELETE on the clean path. `orderedIds: []` → zero fetches. Non-2xx
//     throws with the status surfaced and the loop STOPS.
//
// DELETE:
//   - `deleteLink(cfg, linkId)` issues exactly ONE `DELETE entity/{linkId}` —
//     the ENTITY side of the endpoint split (a /property/ DELETE here would
//     404 and leave the link standing). Throws on non-2xx.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };
const TYPE_ID = 'type-link-1';
const DB_ENTITY = 'db-ent-1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
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

beforeEach(() => {
	resetTypeIdCache();
});

// ── CREATE ──────────────────────────────────────────────────────────────────

function makeCreateFetchMock() {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		if (init?.method === 'POST') return Promise.resolve(json({ _id: 'l-new' }));
		if (u.includes('_type.string=entity') && u.includes('name.string=link')) {
			return Promise.resolve(json({ entities: [{ _id: TYPE_ID }] }));
		}
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
		}
		return Promise.resolve(json({ entities: [] }));
	});
}

describe('createLink — reference-typed create under the DATABASE entity, explicit _sharing (#256 pin 5)', () => {
	it('POSTs entity with body EXACTLY [_type ref, _parent ref, name, url, description, display_order, _sharing domain, _inheritrights true] and resolves to the new id', async () => {
		const fetchImpl = makeCreateFetchMock();
		const id = await createLink(
			cfg,
			{
				name: 'Salvestused',
				url: 'https://f.io/GCkGMr5J',
				description: 'Crede recordings',
				displayOrder: 3,
				dbEntityId: DB_ENTITY
			},
			fetchImpl
		);
		expect(id).toBe('l-new');

		const calls = callsOf(fetchImpl);
		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toContain('/testdb/entity');
		// FULL-shape toEqual — `_type` as REFERENCE (never string), `_parent` the
		// database entity, `_sharing: domain` explicit (type-def does NOT
		// propagate), `_inheritrights: true` explicit.
		expect(posts[0].body).toEqual([
			{ type: '_type', reference: TYPE_ID },
			{ type: '_parent', reference: DB_ENTITY },
			{ type: 'name', string: 'Salvestused' },
			{ type: 'url', string: 'https://f.io/GCkGMr5J' },
			{ type: 'description', string: 'Crede recordings' },
			{ type: 'display_order', number: 3 },
			{ type: '_sharing', string: 'domain' },
			{ type: '_inheritrights', boolean: true }
		]);
	});

	it('dbEntityId given → used VERBATIM with ZERO database lookups; the type is still resolved by reference', async () => {
		const fetchImpl = makeCreateFetchMock();
		await createLink(cfg, { name: 'A', url: 'https://a.example', dbEntityId: DB_ENTITY }, fetchImpl);
		const urls = callsOf(fetchImpl).map((c) => c.url);
		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(false);
		expect(
			urls.some((u) => u.includes('_type.string=entity') && u.includes('name.string=link'))
		).toBe(true);
	});

	it('dbEntityId absent → resolves the database entity and parents the link under it', async () => {
		const fetchImpl = makeCreateFetchMock();
		await createLink(cfg, { name: 'A', url: 'https://a.example' }, fetchImpl);
		const calls = callsOf(fetchImpl);
		expect(calls.some((c) => c.url.includes('_type.string=database'))).toBe(true);
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toEqual([
			{ type: '_type', reference: TYPE_ID },
			{ type: '_parent', reference: DB_ENTITY },
			{ type: 'name', string: 'A' },
			{ type: 'url', string: 'https://a.example' },
			{ type: '_sharing', string: 'domain' },
			{ type: '_inheritrights', boolean: true }
		]);
	});

	it('URL VERBATIM (#256 pin 4) — a schemeless url is sent EXACTLY as given, no https:// prepended, no trim-normalising of its inner shape', async () => {
		const fetchImpl = makeCreateFetchMock();
		await createLink(cfg, { name: 'Scores', url: 'example.com/x', dbEntityId: DB_ENTITY }, fetchImpl);
		const post = callsOf(fetchImpl).find((c) => c.method === 'POST');
		const urlEntry = (post?.body as Array<{ type: string; string?: string }>).find(
			(e) => e.type === 'url'
		);
		expect(urlEntry).toEqual({ type: 'url', string: 'example.com/x' });
	});

	it('description absent OR empty → NO description property in the body (a no-description link never carries an empty string)', async () => {
		for (const description of [undefined, null, '']) {
			const fetchImpl = makeCreateFetchMock();
			await createLink(
				cfg,
				{ name: 'A', url: 'https://a.example', description, dbEntityId: DB_ENTITY },
				fetchImpl
			);
			const post = callsOf(fetchImpl).find((c) => c.method === 'POST');
			const types = (post?.body as Array<{ type: string }>).map((e) => e.type);
			expect(types, `description=${JSON.stringify(description)}`).toEqual([
				'_type',
				'_parent',
				'name',
				'url',
				'_sharing',
				'_inheritrights'
			]);
		}
	});

	it('empty/whitespace-only name throws WITHOUT any fetch; empty/whitespace-only url throws WITHOUT any fetch (the ONLY url validation there is)', async () => {
		for (const input of [
			{ name: '', url: 'https://a.example' },
			{ name: '   ', url: 'https://a.example' },
			{ name: 'A', url: '' },
			{ name: 'A', url: '   ' }
		]) {
			const fetchImpl = makeCreateFetchMock();
			await expect(
				createLink(cfg, { ...input, dbEntityId: DB_ENTITY }, fetchImpl),
				JSON.stringify(input)
			).rejects.toThrow();
			expect(fetchImpl, JSON.stringify(input)).not.toHaveBeenCalled();
		}
	});

	it('no readable database entity (dbEntityId absent) → fails loud naming the db, nothing created', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const u = String(url);
			if (init?.method === 'POST') return Promise.resolve(json({ _id: 'l-should-not-exist' }));
			if (u.includes('_type.string=entity') && u.includes('name.string=link')) {
				return Promise.resolve(json({ entities: [{ _id: TYPE_ID }] }));
			}
			return Promise.resolve(json({ entities: [] }));
		});
		await expect(createLink(cfg, { name: 'A', url: 'x' }, fetchImpl)).rejects.toThrow(/testdb/);
		expect(callsOf(fetchImpl).filter((c) => c.method === 'POST')).toEqual([]);
	});

	it('throws on a non-2xx create (status surfaced) and on 2xx without _id (apparent-success trap)', async () => {
		const failing = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(json({ error: 'nope' }, 500));
			return Promise.resolve(json({ entities: [{ _id: TYPE_ID }] }));
		});
		await expect(
			createLink(cfg, { name: 'A', url: 'x', dbEntityId: DB_ENTITY }, failing)
		).rejects.toThrow(/500/);

		resetTypeIdCache();
		const idless = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(json({ entities: [{ _id: TYPE_ID }] }));
		});
		await expect(
			createLink(cfg, { name: 'A', url: 'x', dbEntityId: DB_ENTITY }, idless)
		).rejects.toThrow();
	});
});

// ── UPDATE (whole-field edit) ───────────────────────────────────────────────

function makeUpdateFetchMock(existing: {
	name?: Array<{ _id: string }>;
	url?: Array<{ _id: string }>;
	description?: Array<{ _id: string }>;
}) {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		if (init?.method === 'POST') return Promise.resolve(json({}));
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		return Promise.resolve(json({ entity: existing }));
	});
}

describe('updateLink — whole-field edit via the atomic overwrite (#256 done-when 2)', () => {
	it('GETs the existing value ids (props=name,url,description) then POSTs ONE atomic body pairing each field — url replaced VERBATIM, schemeless allowed', async () => {
		const fetchImpl = makeUpdateFetchMock({
			name: [{ _id: 'pv-name' }],
			url: [{ _id: 'pv-url' }],
			description: [{ _id: 'pv-desc' }]
		});
		await updateLink(
			cfg,
			'l-1',
			{ name: 'Renamed', url: 'f.io/abc', description: 'New note' },
			fetchImpl
		);

		const calls = callsOf(fetchImpl);
		const getIdx = calls.findIndex(
			(c) =>
				c.method === 'GET' &&
				c.url.includes('/testdb/entity/l-1') &&
				c.url.includes('props=name,url,description')
		);
		const postIdx = calls.findIndex((c) => c.method === 'POST');
		expect(getIdx).toBeGreaterThanOrEqual(0);
		expect(postIdx).toBeGreaterThan(getIdx);

		const post = calls[postIdx];
		expect(post.url).toContain('/testdb/entity/l-1');
		expect(post.body).toEqual([
			{ _id: 'pv-name', type: 'name', string: 'Renamed' },
			{ _id: 'pv-url', type: 'url', string: 'f.io/abc' },
			{ _id: 'pv-desc', type: 'description', string: 'New note' }
		]);
		// Clean path: the overwrite IS the replace — no DELETE round-trip.
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('adding a description to a link that had none → bare description entry (nothing to overwrite), still one POST', async () => {
		const fetchImpl = makeUpdateFetchMock({
			name: [{ _id: 'pv-name' }],
			url: [{ _id: 'pv-url' }]
		});
		await updateLink(cfg, 'l-1', { name: 'A', url: 'x', description: 'Now described' }, fetchImpl);
		const post = callsOf(fetchImpl).find((c) => c.method === 'POST');
		expect(post?.body).toEqual([
			{ _id: 'pv-name', type: 'name', string: 'A' },
			{ _id: 'pv-url', type: 'url', string: 'x' },
			{ type: 'description', string: 'Now described' }
		]);
	});

	it('description: null with an existing value → DELETE /property/{descriptionValueId} strictly AFTER a POST that carries NO description entry', async () => {
		const fetchImpl = makeUpdateFetchMock({
			name: [{ _id: 'pv-name' }],
			url: [{ _id: 'pv-url' }],
			description: [{ _id: 'pv-desc' }]
		});
		await updateLink(cfg, 'l-1', { name: 'A', url: 'x', description: null }, fetchImpl);

		const calls = callsOf(fetchImpl);
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toEqual([
			{ _id: 'pv-name', type: 'name', string: 'A' },
			{ _id: 'pv-url', type: 'url', string: 'x' }
		]);
		const deletes = calls.filter((c) => c.method === 'DELETE');
		// Property-VALUE endpoint — never /entity/ (that would delete the link).
		expect(deletes.map((c) => c.url.includes('/testdb/property/pv-desc'))).toEqual([true]);
		expect(calls.findIndex((c) => c.method === 'DELETE')).toBeGreaterThan(
			calls.findIndex((c) => c.method === 'POST')
		);
	});

	it('description: null with NO existing value → no delete, no description entry', async () => {
		const fetchImpl = makeUpdateFetchMock({
			name: [{ _id: 'pv-name' }],
			url: [{ _id: 'pv-url' }]
		});
		await updateLink(cfg, 'l-1', { name: 'A', url: 'x', description: null }, fetchImpl);
		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toEqual([
			{ _id: 'pv-name', type: 'name', string: 'A' },
			{ _id: 'pv-url', type: 'url', string: 'x' }
		]);
	});

	it('empty name or empty url throws WITHOUT any fetch', async () => {
		for (const fields of [
			{ name: '', url: 'x', description: null },
			{ name: '  ', url: 'x', description: null },
			{ name: 'A', url: '', description: null },
			{ name: 'A', url: '  ', description: null }
		]) {
			const fetchImpl = makeUpdateFetchMock({});
			await expect(updateLink(cfg, 'l-1', fields, fetchImpl)).rejects.toThrow();
			expect(fetchImpl).not.toHaveBeenCalled();
		}
	});
});

// ── REORDER ─────────────────────────────────────────────────────────────────

function makeReorderFetchMock(oldValues: Record<string, Array<{ _id: string }>>) {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		const id = u.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
		return Promise.resolve(json({ entity: { display_order: oldValues[id] ?? [] } }));
	});
}

describe('reorderLinks — the atomic-overwrite renumber, exactly reorderSections (#256 pin 2)', () => {
	it('renumbers EVERY id to its 1-based position: GET entity/{id}?props=display_order → ONE POST [{ _id: <old>, type: "display_order", number: n }], ZERO DELETEs on clean data', async () => {
		const fetchImpl = makeReorderFetchMock({
			'l-b': [{ _id: 'pv-b' }],
			'l-a': [{ _id: 'pv-a' }],
			'l-c': [{ _id: 'pv-c' }]
		});
		await reorderLinks(cfg, ['l-b', 'l-a', 'l-c'], fetchImpl);

		const calls = callsOf(fetchImpl);
		const posts = calls.filter((c) => c.method === 'POST');
		const bodyFor = (id: string) => posts.find((c) => c.url.includes(`/testdb/entity/${id}`))?.body;
		expect(bodyFor('l-b')).toEqual([{ _id: 'pv-b', type: 'display_order', number: 1 }]);
		expect(bodyFor('l-a')).toEqual([{ _id: 'pv-a', type: 'display_order', number: 2 }]);
		expect(bodyFor('l-c')).toEqual([{ _id: 'pv-c', type: 'display_order', number: 3 }]);
		expect(posts).toHaveLength(3);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		// Per link the GET precedes its POST — the overwrite entry is never blind.
		const getIdx = calls.findIndex(
			(c) => c.method === 'GET' && c.url.includes('l-b') && c.url.includes('props=display_order')
		);
		const postIdx = calls.findIndex((c) => c.method === 'POST' && c.url.includes('l-b'));
		expect(getIdx).toBeGreaterThanOrEqual(0);
		expect(postIdx).toBeGreaterThan(getIdx);
	});

	it('a link with NO existing display_order value → bare POST [{ type: "display_order", number: n }]', async () => {
		const fetchImpl = makeReorderFetchMock({ 'l-a': [{ _id: 'pv-a' }], 'l-new': [] });
		await reorderLinks(cfg, ['l-new', 'l-a'], fetchImpl);
		const posts = callsOf(fetchImpl).filter((c) => c.method === 'POST');
		expect(posts.find((c) => c.url.includes('l-new'))?.body).toEqual([
			{ type: 'display_order', number: 1 }
		]);
		expect(posts.find((c) => c.url.includes('l-a'))?.body).toEqual([
			{ _id: 'pv-a', type: 'display_order', number: 2 }
		]);
	});

	it('corrupted 2+-value state: the overwrite pairs the FIRST old id, every EXTRA id is deleted at /property/{id} strictly AFTER the POST', async () => {
		const fetchImpl = makeReorderFetchMock({
			'l-a': [{ _id: 'pv-first' }, { _id: 'pv-stale-1' }, { _id: 'pv-stale-2' }]
		});
		await reorderLinks(cfg, ['l-a'], fetchImpl);
		const calls = callsOf(fetchImpl);
		const post = calls.find((c) => c.method === 'POST');
		expect(post?.body).toEqual([{ _id: 'pv-first', type: 'display_order', number: 1 }]);
		const deletes = calls.filter((c) => c.method === 'DELETE');
		expect(deletes.map((c) => c.url)).toEqual([
			expect.stringContaining('/testdb/property/pv-stale-1'),
			expect.stringContaining('/testdb/property/pv-stale-2')
		]);
		expect(calls.findIndex((c) => c.method === 'DELETE')).toBeGreaterThan(
			calls.findIndex((c) => c.method === 'POST')
		);
	});

	it('orderedIds: [] resolves without any fetch', async () => {
		const fetchImpl = makeReorderFetchMock({});
		await reorderLinks(cfg, [], fetchImpl);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('a non-2xx POST throws with the status surfaced and the loop STOPS — later links are never touched', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const u = String(url);
			if (init?.method === 'POST') return Promise.resolve(json({ error: 'nope' }, 500));
			const id = u.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			return Promise.resolve(json({ entity: { display_order: [{ _id: `pv-${id}` }] } }));
		});
		await expect(reorderLinks(cfg, ['l-a', 'l-b'], fetchImpl)).rejects.toThrow(/500/);
		const calls = callsOf(fetchImpl);
		expect(calls.some((c) => c.url.includes('l-b'))).toBe(false);
	});
});

// ── DELETE ──────────────────────────────────────────────────────────────────

describe('deleteLink — DELETE /entity/{id}, the entity side of the endpoint split', () => {
	it('issues exactly ONE request: DELETE entity/{linkId} — never a /property/ delete', async () => {
		const fetchImpl = vi
			.fn()
			.mockImplementation(() => Promise.resolve(json({ deleted: true })));
		await deleteLink(cfg, 'l-1', fetchImpl);
		const calls = callsOf(fetchImpl);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('DELETE');
		expect(calls[0].url).toContain('/testdb/entity/l-1');
		expect(calls[0].url).not.toContain('/property/');
	});

	it('throws on non-2xx with the status surfaced', async () => {
		const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(json({ error: 'x' }, 403)));
		await expect(deleteLink(cfg, 'l-1', fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis* — #256 RED)
