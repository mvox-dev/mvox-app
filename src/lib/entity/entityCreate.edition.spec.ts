import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createEdition } from './entityCreate';

// #271 — the librarian adds an edition to a work (#198 one level down).
// `createEdition` joins the shared entity CREATE write layer (entityCreate.ts)
// alongside createSeason / createEventSeries / createEvent / createWork, and
// follows the SAME module contract (see entityCreate.ts header):
//
//   - EXACTLY TWO fetches: the resolveTypeId GET (cached per db:typeName) +
//     ONE `POST entity` to the COLLECTION endpoint (never entity/{id}).
//   - `_type` sent as a resolved REFERENCE via resolveTypeId(cfg, 'edition')
//     (#10 pinned wire-shape — never `{ string: 'edition' }`).
//   - THE PARENT IS THE WORK, NOT THE LIBRARY ENTITY. The model is
//     work → edition → copy, and `listEditions` reads
//     `_parent.reference=<workId>` with NO ancestor expansion — an edition
//     parented on the library entity would be invisible to every edition read.
//     createWork's `libraryEntityId` parent is the WRONG template one level
//     down: the required parent field here is `workId`, a ONE-element
//     `_parent` array `[workId]`, one `{ type: '_parent', reference }` prop,
//     zero lookup fetches. The caller (the /library page) holds the work id
//     from its own #each loop — this module never looks it up or guesses it.
//   - #132 critical decision applies here too (issue body: "Per #132 as it
//     applies there"): NO `_sharing`, NO inherit-rights flag in the create
//     body — ONLY `_type` + `_parent` + domain props. Rights propagate from
//     the library entity down through work → edition (per-type policy; do NOT
//     copy the roster-record explicit-`_sharing` idiom here).
//   - `name` is REQUIRED (validated BEFORE any fetch — Entu `mandatory` is a
//     soft UI hint that rejects nothing server-side, this module is the ONLY
//     enforcement point per its own contract header; a nameless edition
//     renders as a blank row in the browse tree).
//   - `publisher` is OPTIONAL — absent OR blank/whitespace-only → the prop is
//     OMITTED entirely via the optional() helper semantics (the inline form
//     binds it to $state(''), and the tree already has a publisher-unknown
//     fallback label; an own '' would be junk on the wire — NEVER send '').
//     Trimmed when present.
//   - `edition_type` is DELIBERATELY NOT on this create. v4E marks it
//     required:true, but Entu 'mandatory' is soft (not server-enforced — team
//     memory project_entu_mandatory_soft, PO-confirmed on the issue), so the
//     issue's Shape-section conditional resolves in the NEGATIVE and the field
//     stays with the out-of-scope private set (edition_type/license/year/cost).
//     The full-shape body assertions below therefore FAIL if it ever appears.
//   - Resolves to the NEW entity's `_id`; non-2xx create POST throws with the
//     status surfaced; a 2xx WITHOUT `_id` throws (apparent-success trap); a
//     resolveTypeId failure propagates and NO create POST is issued.
//
// INTEGRATION NOTE: the fetchImpl seam sits BELOW `entuFetch`/`entuUrl`, so
// the "transport integration" block exercises the real request layer (URL
// composition + Authorization header), not a mock of it. The page-route
// wiring is pinned separately in page.library-create-edition.spec.ts.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

/**
 * Routes the two shapes createEdition may issue: the type-resolution GET
 * (`_type.string=entity&name.string=edition`) → the type-def id, anything else
 * → the entity-create POST → `createBody` at `createStatus`.
 */
function makeFetchMock(
	opts: {
		typeIds?: Record<string, string>;
		typeEntitiesEmpty?: boolean;
		createBody?: unknown;
		createStatus?: number;
	} = {}
) {
	const { typeIds = {}, typeEntitiesEmpty = false, createBody, createStatus = 200 } = opts;
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=entity')) {
			if (typeEntitiesEmpty) return Promise.resolve(json({ entities: [] }));
			const name = /name\.string=([^&]+)/.exec(u)?.[1] ?? '';
			return Promise.resolve(json({ entities: [{ _id: typeIds[name] ?? `type-${name}` }] }));
		}
		return Promise.resolve(json(createBody ?? { _id: 'edition-new-1' }, createStatus));
	});
}

type WireProp = {
	type: string;
	reference?: string;
	string?: string;
	number?: number;
	date?: string;
	datetime?: string;
};

/** The one call that is not type-resolution: the create POST. */
function createCall(fetchImpl: ReturnType<typeof makeFetchMock>): [string, RequestInit] {
	const calls = fetchImpl.mock.calls as Array<[string, RequestInit]>;
	const found = calls.filter(([url]) => !String(url).includes('_type.string=entity'));
	expect(found, 'exactly one entity-create call').toHaveLength(1);
	return found[0];
}

function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>): WireProp[] {
	const [, init] = createCall(fetchImpl);
	return JSON.parse(String(init.body)) as WireProp[];
}

const byType = (a: WireProp, b: WireProp) =>
	a.type.localeCompare(b.type) || JSON.stringify(a).localeCompare(JSON.stringify(b));

/** The type-resolution GETs issued (URL strings). */
function typeResolutionCalls(fetchImpl: ReturnType<typeof makeFetchMock>): string[] {
	return (fetchImpl.mock.calls as Array<[string]>)
		.map(([url]) => String(url))
		.filter((u) => u.includes('_type.string=entity'));
}

// Minimal VALID input — every required field present, nothing optional.
const minimalEdition = {
	name: 'Vocal score (SATB)',
	workId: 'work-1'
};

describe('#271 createEdition — wire shape', () => {
	it('resolves the `edition` type (ONE resolution GET carrying name.string=edition) and POSTs `_type` as that REFERENCE — never a string', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { edition: 'edition-type-4' } });
		await createEdition(cfg, { ...minimalEdition }, fetchImpl);

		const resolutions = typeResolutionCalls(fetchImpl);
		expect(resolutions).toHaveLength(1);
		expect(resolutions[0]).toContain('name.string=edition');

		const typeProp = createCallBody(fetchImpl).find((p) => p.type === '_type');
		expect(typeProp).toEqual({ type: '_type', reference: 'edition-type-4' });
	});

	it('POST body FULL SHAPE without publisher: _type ref + _parent=THE WORK id + name string — and NOTHING else (no _sharing, no inherit-rights, no publisher, no edition_type, and NEVER the library entity as parent)', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { edition: 'edition-type-4' } });
		await createEdition(cfg, { ...minimalEdition }, fetchImpl);

		// FULL SET check (toEqual on the sorted list, not arrayContaining) — a body
		// smuggling an extra prop must fail HERE, not ship silently
		// (#partial-assertions-hide-bugs).
		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'edition-type-4' },
				{ type: '_parent', reference: 'work-1' },
				{ type: 'name', string: 'Vocal score (SATB)' }
			].sort(byType)
		);
	});

	it('the `_parent` list is ONE element — the work id, exactly once (listEditions selects on _parent.reference=<workId>; a second parent is not in the contract)', async () => {
		const fetchImpl = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition }, fetchImpl);
		expect(createCallBody(fetchImpl).filter((p) => p.type === '_parent')).toEqual([
			{ type: '_parent', reference: 'work-1' }
		]);
	});

	it('publisher present → ONE `{ type: publisher, string }` prop — full-shape checked', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { edition: 'edition-type-4' } });
		await createEdition(cfg, { ...minimalEdition, publisher: 'Carus-Verlag' }, fetchImpl);

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'edition-type-4' },
				{ type: '_parent', reference: 'work-1' },
				{ type: 'name', string: 'Vocal score (SATB)' },
				{ type: 'publisher', string: 'Carus-Verlag' }
			].sort(byType)
		);
	});

	it('BLANK publisher ("" / whitespace) is omitted exactly like an absent one — the inline form binds an untouched input to $state(""), and an own "" must never reach the wire', async () => {
		const empty = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition, publisher: '' }, empty);
		expect(createCallBody(empty).filter((p) => p.type === 'publisher')).toEqual([]);

		const blank = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition, publisher: '   ' }, blank);
		expect(createCallBody(blank).filter((p) => p.type === 'publisher')).toEqual([]);
	});

	it('a trimmable publisher is stored TRIMMED, not verbatim', async () => {
		const fetchImpl = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition, publisher: '  Bärenreiter  ' }, fetchImpl);
		expect(createCallBody(fetchImpl).filter((p) => p.type === 'publisher')).toEqual([
			{ type: 'publisher', string: 'Bärenreiter' }
		]);
	});

	it('a trimmable name is stored TRIMMED, not verbatim', async () => {
		const fetchImpl = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition, name: '  Urtext edition  ' }, fetchImpl);
		expect(createCallBody(fetchImpl).find((p) => p.type === 'name')).toEqual({
			type: 'name',
			string: 'Urtext edition'
		});
	});

	it('the create is a POST to the COLLECTION endpoint `entity` — never entity/{id} (that appends onto an EXISTING entity) — and issues EXACTLY two fetches (resolution + create), zero work/library lookups', async () => {
		const fetchImpl = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition }, fetchImpl);
		const [url, init] = createCall(fetchImpl);
		expect(init.method).toBe('POST');
		expect(String(url)).toContain('/testdb/entity');
		// No id path segment after `entity` (query-string is allowed, a path is not).
		expect(String(url)).not.toMatch(/\/entity\/[^?]/);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('resolves to the NEW entity `_id` from the create response', async () => {
		const fetchImpl = makeFetchMock({ createBody: { _id: 'edition-created-9' } });
		await expect(createEdition(cfg, { ...minimalEdition }, fetchImpl)).resolves.toBe(
			'edition-created-9'
		);
	});
});

describe('#271 createEdition — input hygiene: rejected BEFORE any fetch', () => {
	/** Every case: run the create, expect the message, expect ZERO fetches. */
	async function expectRejectedWithoutFetch(
		run: (f: typeof fetch) => Promise<string>,
		message: RegExp
	) {
		const fetchImpl = makeFetchMock();
		await expect(run(fetchImpl as unknown as typeof fetch)).rejects.toThrow(message);
		expect(fetchImpl).not.toHaveBeenCalled();
	}

	it('a blank/whitespace/missing name throws — v4E-required, Entu `mandatory` enforces nothing (this module is the only enforcement point), and a nameless edition renders as a blank tree row', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEdition(cfg, { ...minimalEdition, name: '' }, f),
			/name must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEdition(cfg, { ...minimalEdition, name: '   ' }, f),
			/name must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEdition(cfg, { ...minimalEdition, name: undefined as unknown as string }, f),
			/name must not be empty/
		);
	});

	it('a blank/missing workId throws — the edition parent is the WORK, and a parentless edition would be invisible to listEditions (which selects on _parent.reference=<workId>)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEdition(cfg, { ...minimalEdition, workId: '' }, f),
			/workId must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEdition(cfg, { ...minimalEdition, workId: '   ' }, f),
			/workId must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEdition(cfg, { ...minimalEdition, workId: undefined as unknown as string }, f),
			/workId must not be empty/
		);
	});
});

describe('#271 critical: NO _sharing and NO inherit-rights flag on the edition create — rights are trusted to propagation from the library entity through the work (#132 decision, reused per #198)', () => {
	it('createEdition sends NEITHER, even with every optional present — the only system props are _type and _parent', async () => {
		const fetchImpl = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition, publisher: 'Carus-Verlag' }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body.filter((p) => p.type === '_sharing')).toEqual([]);
		expect(body.filter((p) => p.type === '_inheritrights')).toEqual([]);
		const systemProps = new Set(body.filter((p) => p.type.startsWith('_')).map((p) => p.type));
		expect([...systemProps].sort()).toEqual(['_parent', '_type']);
	});
});

describe('#271 createEdition — failure surfacing', () => {
	it('resolveTypeId finding NO `edition` type definition propagates the failure and NO create POST is issued', async () => {
		const fetchImpl = makeFetchMock({ typeEntitiesEmpty: true });
		await expect(
			createEdition(cfg, { ...minimalEdition }, fetchImpl as unknown as typeof fetch)
		).rejects.toThrow(/edition|not found/);
		const posts = (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).filter(
			([, init]) => init?.method === 'POST'
		);
		expect(posts).toEqual([]);
	});

	it('a non-2xx create POST throws with the STATUS surfaced, never resolves silently', async () => {
		const fetchImpl = makeFetchMock({ createStatus: 403 });
		await expect(
			createEdition(cfg, { ...minimalEdition }, fetchImpl as unknown as typeof fetch)
		).rejects.toThrow(/403/);
	});

	it('a 2xx create response WITHOUT `_id` throws (the apparent-success trap) — a silent non-create must not resolve', async () => {
		const fetchImpl = makeFetchMock({ createBody: {} });
		await expect(
			createEdition(cfg, { ...minimalEdition }, fetchImpl as unknown as typeof fetch)
		).rejects.toThrow(/_id/);
	});
});

describe('#271 createEdition — transport integration (real entuFetch/entuUrl underneath the seam)', () => {
	it('the create POST goes through entuUrl (base + db segment) and entuFetch attaches the Bearer token + JSON content type', async () => {
		const fetchImpl = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition }, fetchImpl);
		const [url, init] = createCall(fetchImpl);
		expect(String(url)).toBe('https://api.entu-test.invalid/testdb/entity');
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer jwt');
		expect(headers['Content-Type']).toBe('application/json');
	});

	it('resolveTypeId results are CACHED per db:typeName — two creates issue ONE resolution GET total', async () => {
		const fetchImpl = makeFetchMock();
		await createEdition(cfg, { ...minimalEdition, name: 'E1' }, fetchImpl);
		await createEdition(cfg, { ...minimalEdition, name: 'E2' }, fetchImpl);
		expect(typeResolutionCalls(fetchImpl)).toHaveLength(1);
		// 1 resolution + 2 creates:
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});
});

// (*MVOX:Tallis* — #271 RED)
