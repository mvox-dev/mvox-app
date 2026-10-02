// Library reads say when a list is partial, from the server count.
import { describe, expect, it, vi } from 'vitest';
import {
	listWorks,
	listEditions,
	listAllEditions,
	listCopies,
	listAllCopies,
	listLendings
} from './libraryData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

type ListRead<T> = { items: T[]; total: number; truncated: boolean };

describe('listWorks — count-based truncation detection (#321)', () => {
	it('a response with count > entities.length is truncated: { items, total, truncated: true }', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 612,
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }], composer: [{ string: 'Thomas Tallis' }] },
					{ _id: 'work-2', name: [{ string: 'Ave verum corpus' }] }
				]
			})
		);
		const res = await listWorks(cfg, fetchImpl);
		expect(res).toEqual<ListRead<{ id: string; name: string; composer: string }>>({
			items: [
				{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
				{ id: 'work-2', name: 'Ave verum corpus', composer: '' }
			],
			total: 612,
			truncated: true
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=work');
		expect(url).toContain('limit=500');
		expect(url).not.toContain('skip=');
	});

	it('count === entities.length is complete: truncated false, total = count', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 2,
				entities: [
					{ _id: 'work-1', name: [{ string: 'Spem in alium' }], composer: [{ string: 'Thomas Tallis' }] },
					{ _id: 'work-2', name: [{ string: 'Ave verum corpus' }] }
				]
			})
		);
		expect(await listWorks(cfg, fetchImpl)).toEqual({
			items: [
				{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
				{ id: 'work-2', name: 'Ave verum corpus', composer: '' }
			],
			total: 2,
			truncated: false
		});
	});

	it('THE FALSE-POSITIVE PIN: count === entities.length === limit (500) is NOT truncated', async () => {
		const entities = Array.from({ length: 500 }, (_, i) => ({
			_id: `w-${i}`,
			name: [{ string: `Work ${i}` }]
		}));
		const fetchImpl = vi.fn().mockResolvedValue(json({ count: 500, entities }));
		const res = (await listWorks(cfg, fetchImpl)) as unknown as ListRead<unknown>;
		expect(res.truncated).toBe(false);
		expect(res.total).toBe(500);
		expect(res.items).toHaveLength(500);
	});

	it('a body WITHOUT count (legacy mock shape) reads as complete: total = entities.length, truncated false', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ _id: 'work-1', name: [{ string: 'Spem in alium' }] }] })
		);
		expect(await listWorks(cfg, fetchImpl)).toEqual({
			items: [{ id: 'work-1', name: 'Spem in alium', composer: '' }],
			total: 1,
			truncated: false
		});
	});
});

describe('listEditions — truncation detection (#321)', () => {
	it('truncated per-work edition read: full shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 501,
				entities: [
					{ _id: 'edition-1', name: [{ string: '40-part original' }], publisher: [{ string: 'Bärenreiter' }] }
				]
			})
		);
		expect(await listEditions(cfg, 'work-1', fetchImpl)).toEqual({
			items: [
				{ id: 'edition-1', name: '40-part original', publisher: 'Bärenreiter', externalLinks: [], files: [] }
			],
			total: 501,
			truncated: true
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('complete read: truncated false', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ count: 1, entities: [{ _id: 'edition-1', name: [{ string: '40-part original' }] }] })
		);
		expect(await listEditions(cfg, 'work-1', fetchImpl)).toEqual({
			items: [{ id: 'edition-1', name: '40-part original', publisher: '', externalLinks: [], files: [] }],
			total: 1,
			truncated: false
		});
	});
});

describe('listAllEditions — truncation detection (#321)', () => {
	it('truncated flat edition read: full shape, workId mapping intact', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 640,
				entities: [
					{
						_id: 'edition-1',
						name: [{ string: '40-part original' }],
						publisher: [{ string: 'Bärenreiter' }],
						_parent: [{ reference: 'work-1', entity_type: 'work' }]
					}
				]
			})
		);
		expect(await listAllEditions(cfg, fetchImpl)).toEqual({
			items: [
				{
					id: 'edition-1',
					name: '40-part original',
					publisher: 'Bärenreiter',
					workId: 'work-1',
					externalLinks: [],
					files: []
				}
			],
			total: 640,
			truncated: true
		});
	});

	it('complete read: truncated false', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ count: 0, entities: [] }));
		expect(await listAllEditions(cfg, fetchImpl)).toEqual({ items: [], total: 0, truncated: false });
	});
});

describe('listCopies — truncation detection (#321)', () => {
	it('truncated per-edition copy read: full shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 812,
				entities: [{ _id: 'copy-1', name: [{ string: 'Copy #1' }], copy_number: [{ number: 1 }] }]
			})
		);
		expect(await listCopies(cfg, 'edition-1', fetchImpl)).toEqual({
			items: [{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }],
			total: 812,
			truncated: true
		});
	});

	it('complete read: truncated false', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ count: 1, entities: [{ _id: 'copy-1', name: [{ string: 'Copy #1' }], copy_number: [{ number: 1 }] }] })
		);
		expect(await listCopies(cfg, 'edition-1', fetchImpl)).toEqual({
			items: [{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }],
			total: 1,
			truncated: false
		});
	});
});

describe('listAllCopies — truncation detection (#321)', () => {
	it('truncated flat copy read: full shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 900,
				entities: [
					{
						_id: 'copy-1',
						name: [{ string: 'Copy #1' }],
						copy_number: [{ number: 1 }],
						_parent: [{ reference: 'edition-1', entity_type: 'edition' }]
					}
				]
			})
		);
		expect(await listAllCopies(cfg, fetchImpl)).toEqual({
			items: [{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }],
			total: 900,
			truncated: true
		});
	});
});

describe('listLendings — truncation detection (#321)', () => {
	it('truncated lending read: full shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 730,
				entities: [
					{
						_id: 'lending-1',
						copy: [{ reference: 'copy-1' }],
						member: [{ reference: 'member-1' }],
						assigned_at: [{ date: '2026-07-01' }],
						assigned_until: [{ date: '2026-08-01' }]
					}
				]
			})
		);
		expect(await listLendings(cfg, fetchImpl)).toEqual({
			items: [
				{
					id: 'lending-1',
					copyId: 'copy-1',
					memberId: 'member-1',
					assignedAt: '2026-07-01',
					assignedUntil: '2026-08-01',
					returnedAt: ''
				}
			],
			total: 730,
			truncated: true
		});
	});

	it('a #258-malformed row dropped client-side does NOT fabricate a truncation: count compares against the RAW wire array', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 2,
				entities: [
					{
						_id: 'lending-1',
						copy: [{ reference: 'copy-1' }],
						member: [{ reference: 'member-1' }],
						assigned_at: [{ date: '2026-07-01' }]
					},
					{ _id: 'lending-corrupt', copy: [{ reference: 'copy-2' }] } // no member — dropped (#258)
				]
			})
		);
		expect(await listLendings(cfg, fetchImpl)).toEqual({
			items: [
				{
					id: 'lending-1',
					copyId: 'copy-1',
					memberId: 'member-1',
					assignedAt: '2026-07-01',
					assignedUntil: '',
					returnedAt: ''
				}
			],
			total: 2,
			truncated: false
		});
		warnSpy.mockRestore();
	});
});

// (*MVOX:Tallis* — RED spec, #321)
