// createSection: one create POST, top-level under the database entity or under a section.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createSection } from './sectionActions';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

beforeEach(() => {
	resetTypeIdCache();
});

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
	it('POST body FULL SHAPE: _type ref (resolved) + _parent=org + name string — and NOTHING else (no rights fields #699, no display_order, no voice, no current_section)', async () => {
		const fetchImpl = makeFetchMock({ typeId: 'section-type-42' });
		await createSection(cfg, { name: 'Tenor' }, fetchImpl);

		const sorted = [...createCallBody(fetchImpl)].sort((a, b) => a.type.localeCompare(b.type));
		expect(sorted).toEqual(
			[
				{ type: '_type', reference: 'section-type-42' },
				{ type: '_parent', reference: 'org-1' },
				{ type: 'name', string: 'Tenor' }
			].sort((a, b) => a.type.localeCompare(b.type))
		);
	});

	it('the create is a POST to the COLLECTION endpoint `entity` — never entity/{id} (that appends onto an EXISTING entity)', async () => {
		const fetchImpl = makeFetchMock();
		await createSection(cfg, { name: 'Tenor' }, fetchImpl);
		const [url, init] = createCall(fetchImpl);
		expect(init.method).toBe('POST');
		expect(String(url)).toContain('/testdb/entity');
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
	it('FULL body: `_parent` = the given SECTION id, no rights fields, and NO database-resolution GET', async () => {
		const fetchImpl = makeFetchMock({ typeId: 'section-type-42' });
		await createSection(cfg, { name: 'Soprano 2', parentId: 'sec-sop' }, fetchImpl);

		expect(createCallBody(fetchImpl)).toEqual([
			{ type: '_type', reference: 'section-type-42' },
			{ type: '_parent', reference: 'sec-sop' },
			{ type: 'name', string: 'Soprano 2' }
		]);
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
