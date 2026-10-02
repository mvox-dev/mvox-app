// Admin rights are read from the database entity's _owner and _editor.
import { describe, expect, it, vi } from 'vitest';
import { resolveAdmin } from './adminStore';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');
const PERSON = 'person-ada';
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';

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
