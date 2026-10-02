// The link collection read layer.
import { describe, expect, it, vi } from 'vitest';
import { listLinks, type LinkRow } from './linkData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');
const DB_ENTITY = 'db-ent-1';

interface RawLink {
	_id: string;
	name?: Array<{ string?: string }>;
	url?: Array<{ string?: string }>;
	description?: Array<{ string?: string }>;
	display_order?: Array<{ number?: number }>;
}

function makeFetchMock(entities: RawLink[]) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
		}
		if (u.includes('_type.string=link')) {
			return Promise.resolve(json({ entities }));
		}
		return Promise.resolve(json({ entities: [] }));
	});
}

describe('listLinks — collective-root scoped read (#256)', () => {
	it('queries links as children of the DATABASE entity — _type.string=link + _parent.reference=<dbEntityId>, projecting exactly name,url,description,display_order', async () => {
		const fetchImpl = makeFetchMock([]);
		await listLinks(cfg, fetchImpl);

		const urls = (fetchImpl.mock.calls as Array<[string]>).map(([u]) => String(u));
		const linkQuery = urls.find((u) => u.includes('_type.string=link'));
		expect(linkQuery).toBeDefined();
		expect(linkQuery).toContain(`_parent.reference=${DB_ENTITY}`);
		expect(linkQuery).toContain('props=name,url,description,display_order');
		const dbQueryIdx = urls.findIndex((u) => u.includes('_type.string=database'));
		const linkQueryIdx = urls.findIndex((u) => u.includes('_type.string=link'));
		expect(dbQueryIdx).toBeGreaterThanOrEqual(0);
		expect(linkQueryIdx).toBeGreaterThan(dbQueryIdx);
	});

	it('no readable database entity → [] with NO link query fired (an answer, not an error)', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=database')) {
				return Promise.resolve(json({ entities: [] }));
			}
			return Promise.resolve(json({ entities: [] }));
		});
		const rows = await listLinks(cfg, fetchImpl);
		expect(rows).toEqual([]);
		const urls = (fetchImpl.mock.calls as Array<[string]>).map(([u]) => String(u));
		expect(urls.some((u) => u.includes('_type.string=link'))).toBe(false);
	});

	it('maps rows FULL-shape — url VERBATIM (schemeless stays schemeless), absent description → null, absent display_order → null', async () => {
		const fetchImpl = makeFetchMock([
			{
				_id: 'l-rec',
				name: [{ string: 'Salvestused' }],
				url: [{ string: 'https://f.io/GCkGMr5J' }],
				description: [{ string: 'Crede recordings archive' }],
				display_order: [{ number: 1 }]
			},
			{
				_id: 'l-scores',
				name: [{ string: 'Scores' }],
				url: [{ string: 'example.com/x' }],
				display_order: [{ number: 2 }]
			},
			{
				_id: 'l-bare',
				name: [{ string: 'Bare' }],
				url: [{ string: 'crede.ee/salvestused' }]
			}
		]);
		const rows = await listLinks(cfg, fetchImpl);
		expect(rows).toEqual([
			{
				id: 'l-rec',
				name: 'Salvestused',
				url: 'https://f.io/GCkGMr5J',
				description: 'Crede recordings archive',
				displayOrder: 1
			},
			{
				id: 'l-scores',
				name: 'Scores',
				url: 'example.com/x',
				description: null,
				displayOrder: 2
			},
			{
				id: 'l-bare',
				name: 'Bare',
				url: 'crede.ee/salvestused',
				description: null,
				displayOrder: null
			}
		] satisfies LinkRow[]);
	});

	it('an EMPTY-STRING description property maps to null too — the page must be able to render NO description node (#256 done-when 3)', async () => {
		const fetchImpl = makeFetchMock([
			{
				_id: 'l-1',
				name: [{ string: 'A' }],
				url: [{ string: 'https://a.example' }],
				description: [{ string: '' }],
				display_order: [{ number: 1 }]
			}
		]);
		const rows = await listLinks(cfg, fetchImpl);
		expect(rows).toEqual([
			{ id: 'l-1', name: 'A', url: 'https://a.example', description: null, displayOrder: 1 }
		]);
	});

	it('STABLE ORDER — sorted by displayOrder ascending regardless of wire order; missing displayOrder last; ties by name', async () => {
		const fetchImpl = makeFetchMock([
			{ _id: 'l-none-b', name: [{ string: 'Zeta' }], url: [{ string: 'z' }] },
			{ _id: 'l-3', name: [{ string: 'Third' }], url: [{ string: 't3' }], display_order: [{ number: 3 }] },
			{ _id: 'l-1', name: [{ string: 'First' }], url: [{ string: 't1' }], display_order: [{ number: 1 }] },
			{ _id: 'l-none-a', name: [{ string: 'Alpha' }], url: [{ string: 'a' }] },
			{ _id: 'l-2', name: [{ string: 'Second' }], url: [{ string: 't2' }], display_order: [{ number: 2 }] }
		]);
		const rows = await listLinks(cfg, fetchImpl);
		expect(rows.map((r) => r.id)).toEqual(['l-1', 'l-2', 'l-3', 'l-none-a', 'l-none-b']);
	});

	it('throws on a non-2xx link query with the status surfaced', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=database')) {
				return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
			}
			return Promise.resolve(json({ error: 'nope' }, 500));
		});
		await expect(listLinks(cfg, fetchImpl)).rejects.toThrow(/500/);
	});
});

// (*MVOX:Tallis* — #256 RED)
