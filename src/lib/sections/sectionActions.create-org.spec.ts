import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createSection } from './sectionActions';

// TU.1/#109 RED — finding #10, root cause A: the TOP-LEVEL PARENT ORG.
//
// LIVE-VERIFIED (2026-08-12, polyphony): the `_type.string=organization&limit=1`
// org fallback in `createSection` rests on a FALSE premise ("polyphony's extra
// org entities are unreadable to non-admin callers"). In truth all SIX
// organization entities are `_sharing: domain` — every authenticated member
// reads all six, and `limit=1` returns the FIRST by id:
//
//     69c7f8718489bfcb0e81b05a  "Eesti Kammerkooride Liit"   ← the UMBRELLA FEDERATION
//     69c7f8718489bfcb0e81b065  "Eesti Filharmoonia Kammerkoor" ← the actual collective
//     … + 4 more (Sireen, Meeskooride Liit, RAM, TAM)
//
// So every top-level section create was parented under the umbrella federation
// — the WRONG org — and is refused outright (Entu parent-rights) for any caller
// without write rights on the umbrella. That is finding #10's "new section
// creation doesn't work in live environment".
//
// Contract under test (GREEN must implement — see CreateSectionInput.dbEntityId):
//
//   - `dbEntityId` PRESENT, no parentId → `_parent` = dbEntityId; ZERO org-lookup fetches
//     (the caller — the roster page — already knows the collective org from the
//     member's own `_parent`; the data layer must not guess).
//   - `dbEntityId` ABSENT, no parentId → the legacy sole-org resolution stays, BUT a
//     MULTI-ORG db (search response `count` > 1) FAILS LOUD naming the db and
//     creates NOTHING — never silently parents under whichever org the API
//     happened to return first.
//   - `dbEntityId` ABSENT, exactly one readable org (count 1 / count absent with one
//     entity) → that org, unchanged legacy behavior (sectionActions.create.spec.ts
//     keeps passing).
//   - parentId present → sub-section; dbEntityId is irrelevant and no org lookup
//     happens (already pinned by sectionActions.create.spec.ts).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

/** Live-shaped router: type-resolution GET, org-search GET (multi-org by
 *  default — umbrella FIRST, exactly as live polyphony returns them), and the
 *  entity-create POST. */
function makeFetchMock(
	opts: {
		typeId?: string;
		orgResponse?: { entities: Array<{ _id: string }>; count?: number };
		newId?: string;
	} = {}
) {
	const {
		typeId = 'section-type-42',
		// Live shape: limit=1 truncates the list but `count` still says 6.
		orgResponse = { entities: [{ _id: 'org-umbrella' }], count: 6 },
		newId = 'sec-new-1'
	} = opts;
	return vi.fn().mockImplementation((url: string) => {
		if (String(url).includes('_type.string=entity')) {
			return Promise.resolve(json({ entities: [{ _id: typeId }] }));
		}
		if (String(url).includes('_type.string=organization')) {
			return Promise.resolve(json(orgResponse));
		}
		return Promise.resolve(json({ _id: newId }));
	});
}

function createCalls(fetchImpl: ReturnType<typeof makeFetchMock>): Array<[string, RequestInit]> {
	const calls = fetchImpl.mock.calls as Array<[string, RequestInit]>;
	return calls.filter(([, init]) => init?.method === 'POST');
}

function orgLookupCalls(fetchImpl: ReturnType<typeof makeFetchMock>): Array<[string]> {
	return (fetchImpl.mock.calls as Array<[string]>).filter(([url]) =>
		String(url).includes('_type.string=organization')
	);
}

describe('createSection — caller-supplied dbEntityId is the top-level parent (finding #10)', () => {
	it('dbEntityId present, no parentId: `_parent` = the GIVEN org id — NOT whatever org the db lists first — and NO org-lookup GET is issued at all', async () => {
		const fetchImpl = makeFetchMock();
		await createSection(cfg, { name: 'Tenor', parentId: null, dbEntityId: 'org-efk' }, fetchImpl);

		expect(orgLookupCalls(fetchImpl)).toEqual([]);
		const creates = createCalls(fetchImpl);
		expect(creates, 'exactly one entity-create POST').toHaveLength(1);
		const body = JSON.parse(String(creates[0][1].body)) as Array<{
			type: string;
			reference?: string;
			string?: string;
		}>;
		expect(body.find((p) => p.type === '_parent')).toEqual({
			type: '_parent',
			reference: 'org-efk'
		});
	});

	it('dbEntityId present: FULL create body is exactly _type ref + _parent=dbEntityId + name + _sharing:public + _inheritrights:true (#264 item 6) — nothing else (#partial-assertions-hide-bugs)', async () => {
		const fetchImpl = makeFetchMock({ typeId: 'section-type-42' });
		const id = await createSection(cfg, { name: 'Tenor', dbEntityId: 'org-efk' }, fetchImpl);
		expect(id).toBe('sec-new-1');

		const body = JSON.parse(String(createCalls(fetchImpl)[0][1].body)) as Array<{
			type: string;
		}>;
		const sorted = [...body].sort((a, b) => a.type.localeCompare(b.type));
		expect(sorted).toEqual(
			[
				{ type: '_type', reference: 'section-type-42' },
				{ type: '_parent', reference: 'org-efk' },
				{ type: 'name', string: 'Tenor' },
				{ type: '_sharing', string: 'public' },
				{ type: '_inheritrights', boolean: true }
			].sort((a, b) => a.type.localeCompare(b.type))
		);
	});
});

// #161 (collective = database, Mihkel ruling 2026-08-16) — the no-dbEntityId
// MULTI-ORG-db legacy-fallback describe block that used to live here is
// RETIRED: `createSection`'s no-dbEntityId path no longer searches for an
// organization entity at all (organization instances no longer exist, #159) —
// it resolves the DATABASE entity instead. That behavior (including its own
// fail-loud-when-unreadable case) is pinned by
// sectionActions.create-database.spec.ts now.

// (*MVOX:Tallis* — TU.1/#109 RED, finding #10 root cause A: wrong top-level parent org)
// (*MVOX:Palestrina* — #161 GREEN: legacy no-dbEntityId multi-org fallback describe block retired)
