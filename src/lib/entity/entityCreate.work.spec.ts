// createWork: one type lookup plus one POST entity to the collection endpoint.
// The shared POST, its failures and the transport are proved once, in entityCreate.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { createWork } from './entityCreate';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

beforeEach(() => {
	resetTypeIdCache();
});

function makeFetchMock(
	opts: { typeIds?: Record<string, string> } = {}
) {
	const { typeIds = {} } = opts;
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=entity')) {
			const name = /name\.string=([^&]+)/.exec(u)?.[1] ?? '';
			return Promise.resolve(json({ entities: [{ _id: typeIds[name] ?? `type-${name}` }] }));
		}
		return Promise.resolve(json({ _id: 'work-new-1' }));
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

function typeResolutionCalls(fetchImpl: ReturnType<typeof makeFetchMock>): string[] {
	return (fetchImpl.mock.calls as Array<[string]>)
		.map(([url]) => String(url))
		.filter((u) => u.includes('_type.string=entity'));
}

const minimalWork = {
	name: 'Spem in alium',
	libraryEntityId: 'lib-1'
};

describe('#198 createWork — wire shape', () => {
	it('resolves the `work` type (ONE resolution GET carrying name.string=work) and POSTs `_type` as that REFERENCE — never a string', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { work: 'work-type-7' } });
		await createWork(cfg, { ...minimalWork }, fetchImpl);

		const resolutions = typeResolutionCalls(fetchImpl);
		expect(resolutions).toHaveLength(1);
		expect(resolutions[0]).toContain('name.string=work');

		const typeProp = createCallBody(fetchImpl).find((p) => p.type === '_type');
		expect(typeProp).toEqual({ type: '_type', reference: 'work-type-7' });
	});

	it('POST body FULL SHAPE without composer: _type ref + _parent=LIBRARY entity id + name string — and NOTHING else (no _sharing, no inherit-rights, no composer, and NEVER the database entity as parent)', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { work: 'work-type-7' } });
		await createWork(cfg, { ...minimalWork }, fetchImpl);

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'work-type-7' },
				{ type: '_parent', reference: 'lib-1' },
				{ type: 'name', string: 'Spem in alium' }
			].sort(byType)
		);
	});

	it('composer present → ONE `{ type: composer, string }` prop — full-shape checked', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { work: 'work-type-7' } });
		await createWork(
			cfg,
			{ ...minimalWork, composer: 'Thomas Tallis' },
			fetchImpl
		);

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'work-type-7' },
				{ type: '_parent', reference: 'lib-1' },
				{ type: 'name', string: 'Spem in alium' },
				{ type: 'composer', string: 'Thomas Tallis' }
			].sort(byType)
		);
	});

	it('BLANK composer ("" / whitespace) is omitted exactly like an absent one — the inline form binds an untouched input to $state("")', async () => {
		const empty = makeFetchMock();
		await createWork(cfg, { ...minimalWork, composer: '' }, empty);
		expect(createCallBody(empty).filter((p) => p.type === 'composer')).toEqual([]);

		const blank = makeFetchMock();
		await createWork(cfg, { ...minimalWork, composer: '   ' }, blank);
		expect(createCallBody(blank).filter((p) => p.type === 'composer')).toEqual([]);
	});

	it('a trimmable composer is stored TRIMMED, not verbatim', async () => {
		const fetchImpl = makeFetchMock();
		await createWork(cfg, { ...minimalWork, composer: '  Arvo Pärt  ' }, fetchImpl);
		expect(createCallBody(fetchImpl).filter((p) => p.type === 'composer')).toEqual([
			{ type: 'composer', string: 'Arvo Pärt' }
		]);
	});

	it('a trimmable name is stored TRIMMED, not verbatim', async () => {
		const fetchImpl = makeFetchMock();
		await createWork(cfg, { ...minimalWork, name: '  Ave verum corpus  ' }, fetchImpl);
		expect(createCallBody(fetchImpl).find((p) => p.type === 'name')).toEqual({
			type: 'name',
			string: 'Ave verum corpus'
		});
	});
});

describe('#198 createWork — input hygiene: rejected BEFORE any fetch', () => {
	async function expectRejectedWithoutFetch(
		run: (f: typeof fetch) => Promise<string>,
		message: RegExp
	) {
		const fetchImpl = makeFetchMock();
		await expect(run(fetchImpl as unknown as typeof fetch)).rejects.toThrow(message);
		expect(fetchImpl).not.toHaveBeenCalled();
	}

	it('a blank/whitespace/missing name throws — v4E-required, Entu `mandatory` enforces nothing, and a nameless work renders as a blank browse-tree row', async () => {
		await expectRejectedWithoutFetch(
			(f) => createWork(cfg, { ...minimalWork, name: '' }, f),
			/name must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createWork(cfg, { ...minimalWork, name: '   ' }, f),
			/name must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createWork(cfg, { ...minimalWork, name: undefined as unknown as string }, f),
			/name must not be empty/
		);
	});

	it('a blank/missing libraryEntityId throws — the work parent is the LIBRARY entity (librarian-rights scope), and a parentless work would be orphaned outside every library read', async () => {
		await expectRejectedWithoutFetch(
			(f) => createWork(cfg, { ...minimalWork, libraryEntityId: '' }, f),
			/libraryEntityId must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createWork(cfg, { ...minimalWork, libraryEntityId: '   ' }, f),
			/libraryEntityId must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createWork(cfg, { ...minimalWork, libraryEntityId: undefined as unknown as string }, f),
			/libraryEntityId must not be empty/
		);
	});
});

// (*MVOX:Tallis* — #198 RED)
// (*MVOX:Josquin*)
