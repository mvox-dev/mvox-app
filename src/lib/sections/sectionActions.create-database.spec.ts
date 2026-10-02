// A top-level section is created as a direct child of the database entity.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSection } from './sectionActions';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';
const TYPE_SECTION = 'type-section-1';

type Recorded = { url: string; init?: RequestInit };

function makeRouter(): { fetchImpl: typeof fetch; calls: Recorded[] } {
	const calls: Recorded[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		if (url.includes('name.string=section')) {
			return json({ entities: [{ _id: TYPE_SECTION }], count: 1 });
		}
		if (url.includes('_type.string=database')) {
			return json({ entities: [{ _id: DB_ENTITY }], count: 1 });
		}
		if (url.includes('_type.string=organization')) {
			return json({ entities: [{ _id: 'org-umbrella' }], count: 1 });
		}
		if (init?.method === 'POST') {
			return json({ _id: 'sec-new-1' });
		}
		return json({ entities: [], count: 0 });
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

beforeEach(() => {
	resetTypeIdCache();
});

afterEach(() => {
	resetTypeIdCache();
});

describe('createSection — top-level fallback resolves the DATABASE entity (#161)', () => {
	it('no parentId + no explicit collective id: `_parent` = the database entity, resolved via `_type.string=database&limit=1` — the organization query NEVER fires', async () => {
		const { fetchImpl, calls } = makeRouter();
		const id = await createSection(cfg, { name: 'Tenor' }, fetchImpl);
		expect(id).toBe('sec-new-1');

		expect(calls.some((c) => c.url.includes('_type.string=organization'))).toBe(false);
		expect(calls.some((c) => c.url.includes('_type.string=database'))).toBe(true);

		const post = calls.find((c) => c.init?.method === 'POST');
		expect(post).toBeDefined();
		const props = JSON.parse(String(post?.init?.body)) as Array<{
			type: string;
			reference?: string;
		}>;
		const parent = props.find((p) => p.type === '_parent');
		expect(parent?.reference).toBe(DB_ENTITY);
	});

	it('explicit collective id (the database entity id, threaded by the caller): verbatim `_parent`, and NEITHER the organization query NOR the database discovery fires', async () => {
		const { fetchImpl, calls } = makeRouter();
		await createSection(cfg, { name: 'Tenor', dbEntityId: DB_ENTITY }, fetchImpl);

		expect(calls.some((c) => c.url.includes('_type.string=organization'))).toBe(false);
		expect(calls.some((c) => c.url.includes('_type.string=database'))).toBe(false);

		const post = calls.find((c) => c.init?.method === 'POST');
		const props = JSON.parse(String(post?.init?.body)) as Array<{
			type: string;
			reference?: string;
		}>;
		expect(props.find((p) => p.type === '_parent')?.reference).toBe(DB_ENTITY);
	});
});

// (*MVOX:Tallis*)
