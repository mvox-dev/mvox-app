// createSection with a caller-supplied database entity as the top-level parent.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createSection } from './sectionActions';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

beforeEach(() => {
	resetTypeIdCache();
});

function makeFetchMock(
	opts: {
		typeId?: string;
		orgResponse?: { entities: Array<{ _id: string }>; count?: number };
		newId?: string;
	} = {}
) {
	const {
		typeId = 'section-type-42',
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

	it('dbEntityId present: FULL create body is exactly _type ref + _parent=dbEntityId + name, no rights fields (#699) — nothing else (#partial-assertions-hide-bugs)', async () => {
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
				{ type: 'name', string: 'Tenor' }
			].sort((a, b) => a.type.localeCompare(b.type))
		);
	});
});

// (*MVOX:Tallis* — TU.1/#109 RED, finding #10 root cause A: wrong top-level parent org)
// (*MVOX:Palestrina* — #161 GREEN: legacy no-dbEntityId multi-org fallback describe block retired)
