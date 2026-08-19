import { describe, expect, it, vi } from 'vitest';
import { resolveAdmin } from './adminStore';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// #161 RED — collective = database: admin rights are checked on the DATABASE
// entity's `_owner`/`_editor`, never on an Organization entity and never via the
// person → member → `_parent[entity_type=organization]` chain (#159 deleted every
// organization instance, so that chain answers nothing).
//
// New resolution shape (pinned here):
//   1. resolve the database entity (`_type.string=database&limit=1` — the
//      $lib/collective/databaseEntity contract)
//   2. read `entity/{dbEntityId}?props=_owner,_editor` and answer per-person
//
// Signature stays `resolveAdmin(cfg, personId, fetchImpl?)` — personId is still
// what the rights lists are matched against.

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const PERSON = 'person-ada';
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/**
 * URL router standing in for the live API: answers the database-entity discovery
 * and the by-id rights read; RECORDS every url so the spec can assert the
 * retired queries (member walk, organization anything) never fire.
 */
function makeRouter(opts: {
	owners?: string[];
	editors?: string[];
	databaseVisible?: boolean;
}): { fetchImpl: typeof fetch; urls: string[] } {
	const { owners = [], editors = [], databaseVisible = true } = opts;
	const urls: string[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		urls.push(url);
		if (url.includes('_type.string=database')) {
			return json(
				databaseVisible ? { entities: [{ _id: DB_ENTITY }], count: 1 } : { entities: [], count: 0 }
			);
		}
		if (url.includes(`entity/${DB_ENTITY}`)) {
			return json({
				entity: {
					_id: DB_ENTITY,
					_owner: owners.map((reference) => ({ reference })),
					_editor: editors.map((reference) => ({ reference }))
				}
			});
		}
		// Any other query is a wrong turn (the retired member/organization chain) —
		// answer empty so the wrong turn cannot accidentally succeed.
		return json({ entities: [], count: 0 });
	}) as unknown as typeof fetch;
	return { fetchImpl, urls };
}

describe('resolveAdmin — rights on the DATABASE entity (#161)', () => {
	it("person in the database entity's _owner → 'admin'; the resolution is database-discovery + by-id rights read, with NO member walk and NO organization query", async () => {
		const { fetchImpl, urls } = makeRouter({ owners: [PERSON] });
		expect(await resolveAdmin(cfg, PERSON, fetchImpl)).toBe('admin');

		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(true);
		expect(urls.some((u) => u.includes(`entity/${DB_ENTITY}`))).toBe(true);
		expect(urls.some((u) => u.includes('_type.string=member'))).toBe(false);
		expect(urls.some((u) => u.includes('organization'))).toBe(false);
	});

	it("person in the database entity's _editor → 'admin'", async () => {
		const { fetchImpl } = makeRouter({ editors: [PERSON] });
		expect(await resolveAdmin(cfg, PERSON, fetchImpl)).toBe('admin');
	});

	it("person in NEITHER list → 'not-admin' (a rights ANSWER: the database entity itself was read fine)", async () => {
		const { fetchImpl } = makeRouter({ owners: ['person-else'], editors: [] });
		expect(await resolveAdmin(cfg, PERSON, fetchImpl)).toBe('not-admin');
	});

	it("no database entity readable → 'error' (an unresolvable prerequisite is never presented as 'not admin' — house rule)", async () => {
		const { fetchImpl } = makeRouter({ databaseVisible: false });
		expect(await resolveAdmin(cfg, PERSON, fetchImpl)).toBe('error');
	});
});

// (*MVOX:Tallis* — #161 RED)
