import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createSection } from './sectionActions';

// TS.3/#97 RED — `createSection`, the section CREATE write layer. The export is
// a STUB that throws 'not implemented', so every assertion below FAILS until
// GREEN.
//
// Contract under test (see sectionActions.ts module header):
//
//   - ONE entity create: `POST entity` (the COLLECTION endpoint, never
//     entity/{id} — that would append props onto an existing entity).
//   - `_type` resolved to a REFERENCE via resolveTypeId(cfg, 'section') (#10
//     pinned wire-shape; the resolution GET is `_type.string=entity&
//     name.string=section`, cached per db).
//   - parentId present → `_parent` = that section id; NO lookup happens.
//   - parentId absent/null → "(top level)": `_parent` = the DATABASE entity
//     (`entity?_type.string=database&limit=1` — #161, collective = database);
//     FAILS LOUD naming the db when no database entity is readable — v4E pins
//     `parentConstraint: 'exactly_one_of'`, a parentless section is not a
//     thing.
//   - `_sharing: 'public'` explicit at create (v4E section sharing — federation
//     discoverability; never rely on inherit).
//   - name trimmed; empty/whitespace name throws with ZERO fetches.
//   - resolves to the NEW section's `_id` from the create response.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

/**
 * Routes the three GET/POST shapes createSection may issue:
 *   type-resolution GET (`_type.string=entity`) → the section type-def id,
 *   database-resolution GET (`_type.string=database`) → the sole database entity,
 *   anything else → the entity-create POST → `{ _id: newId }`.
 */
function makeFetchMock(
	opts: { typeId?: string; dbEntities?: Array<{ _id: string }>; newId?: string; createStatus?: number } = {}
) {
	const {
		typeId = 'section-type-42',
		dbEntities = [{ _id: 'org-1' }],
		newId = 'sec-new-1',
		createStatus = 200
	} = opts;
	return vi.fn().mockImplementation((url: string) => {
		if (String(url).includes('_type.string=entity')) {
			return Promise.resolve(json({ entities: [{ _id: typeId }] }));
		}
		if (String(url).includes('_type.string=database')) {
			return Promise.resolve(json({ entities: dbEntities }));
		}
		return Promise.resolve(json({ _id: newId }, createStatus));
	});
}

/** The one call that is neither type- nor database-resolution: the create POST. */
function createCall(fetchImpl: ReturnType<typeof makeFetchMock>): [string, RequestInit] {
	const calls = fetchImpl.mock.calls as Array<[string, RequestInit]>;
	const found = calls.filter(
		([url]) =>
			!String(url).includes('_type.string=entity') && !String(url).includes('_type.string=database')
	);
	expect(found, 'exactly one entity-create call').toHaveLength(1);
	return found[0];
}

function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
	const [, init] = createCall(fetchImpl);
	return JSON.parse(String(init.body)) as Array<{ type: string; reference?: string; string?: string }>;
}

describe('createSection — top level (parentId absent): child of the resolved database entity', () => {
	it('POST body FULL SHAPE: _type ref (resolved) + _parent=org + name string + _sharing:public + _inheritrights:true (#264 item 6) — and NOTHING else (no display_order, no voice, no current_section)', async () => {
		const fetchImpl = makeFetchMock({ typeId: 'section-type-42' });
		await createSection(cfg, { name: 'Tenor' }, fetchImpl);

		// FULL SET check (toEqual on the sorted list, not arrayContaining) — a body
		// smuggling an extra prop must fail HERE, not ship silently
		// (#partial-assertions-hide-bugs).
		const sorted = [...createCallBody(fetchImpl)].sort((a, b) => a.type.localeCompare(b.type));
		expect(sorted).toEqual(
			[
				{ type: '_type', reference: 'section-type-42' },
				{ type: '_parent', reference: 'org-1' },
				{ type: 'name', string: 'Tenor' },
				{ type: '_sharing', string: 'public' },
				{ type: '_inheritrights', boolean: true }
			].sort((a, b) => a.type.localeCompare(b.type))
		);
	});

	it('the create is a POST to the COLLECTION endpoint `entity` — never entity/{id} (that appends onto an EXISTING entity)', async () => {
		const fetchImpl = makeFetchMock();
		await createSection(cfg, { name: 'Tenor' }, fetchImpl);
		const [url, init] = createCall(fetchImpl);
		expect(init.method).toBe('POST');
		expect(String(url)).toContain('/testdb/entity');
		// No id path segment after `entity` (query-string is allowed, a path is not).
		expect(String(url)).not.toMatch(/\/entity\/[^?]/);
	});

	it('resolves the database entity via `_type.string=database&limit=1` (#161) and RETURNS the new section id from the create response', async () => {
		const fetchImpl = makeFetchMock({ newId: 'sec-created-7' });
		const id = await createSection(cfg, { name: 'Tenor', parentId: null }, fetchImpl);
		expect(id).toBe('sec-created-7');
		const dbCalls = (fetchImpl.mock.calls as Array<[string]>).filter(([url]) =>
			String(url).includes('_type.string=database')
		);
		expect(dbCalls).toHaveLength(1);
		expect(String(dbCalls[0][0])).toContain('limit=1');
	});

	it('FAILS LOUD naming the db when NO database entity is readable (a section REQUIRES a parent — exactly_one_of), and nothing is created', async () => {
		const fetchImpl = makeFetchMock({ dbEntities: [] });
		await expect(createSection(cfg, { name: 'Tenor' }, fetchImpl)).rejects.toThrow(/testdb/);
		const creates = (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).filter(
			([, init]) => init?.method === 'POST'
		);
		expect(creates).toEqual([]);
	});
});

describe('createSection — parentId present: sub-section, no database-entity lookup involved', () => {
	it('`_parent` = the given SECTION id, and NO database-resolution GET is issued at all', async () => {
		const fetchImpl = makeFetchMock();
		await createSection(cfg, { name: 'Soprano 2', parentId: 'sec-sop' }, fetchImpl);

		const body = createCallBody(fetchImpl);
		expect(body.find((p) => p.type === '_parent')).toEqual({ type: '_parent', reference: 'sec-sop' });
		const dbCalls = (fetchImpl.mock.calls as Array<[string]>).filter(([url]) =>
			String(url).includes('_type.string=database')
		);
		expect(dbCalls).toEqual([]);
	});
});

describe('createSection — name hygiene and failure surfacing', () => {
	it('name is TRIMMED before sending', async () => {
		const fetchImpl = makeFetchMock();
		await createSection(cfg, { name: '  Tenor  ', parentId: 'sec-sop' }, fetchImpl);
		expect(createCallBody(fetchImpl).find((p) => p.type === 'name')).toEqual({
			type: 'name',
			string: 'Tenor'
		});
	});

	it.each(['', '   ', '\t\n'])(
		'empty/whitespace-only name (%j) throws NAMING the problem, WITHOUT any fetch — the data layer must never create a nameless section',
		async (name) => {
			const fetchImpl = makeFetchMock();
			// The message must say what is wrong (a bare throw would also let the
			// RED stub pass) — pin that it mentions the name.
			await expect(createSection(cfg, { name }, fetchImpl)).rejects.toThrow(/name/i);
			expect(fetchImpl).not.toHaveBeenCalled();
		}
	);

	it('throws on a non-2xx create POST (status surfaced), never resolves silently', async () => {
		const fetchImpl = makeFetchMock({ createStatus: 403 });
		await expect(createSection(cfg, { name: 'Tenor', parentId: 'sec-sop' }, fetchImpl)).rejects.toThrow(
			/403/
		);
	});
});

// (*MVOX:Tallis* — TS.3/#97 RED)
