import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Copy, Lending } from '$lib/library/libraryData';

const token = vi.hoisted(() => ({ value: 'jwt' as string | null }));
vi.mock('$lib/auth/storage', () => ({ getToken: () => token.value }));

import { resolveLocalFirst, type LocalFirst } from './resolveLocalFirst';

const loan = (copyId: string): Lending => ({
	id: `l-${copyId}`,
	copyId,
	memberId: 'm1',
	assignedAt: '2026-09-01',
	assignedUntil: '',
	returnedAt: ''
});
const copy = (id: string, name: string): Copy => ({ id, name, copyNumber: 1, editionId: 'e1' });

function setup(over: Partial<LocalFirst<string>> = {}) {
	const apply = vi.fn();
	const fetch = vi.fn(async () => ({ resolved: new Map([['c2', 'fetched']]), failed: [] as unknown[] }));
	const opts: LocalFirst<string> = {
		loans: [loan('c1'), loan('c2')],
		selected: () => ({ db: 'db1' }),
		allCopies: () => [copy('c1', 'held')],
		local: (c) => c.name,
		fetch,
		isCurrent: () => true,
		apply,
		what: 'name',
		known: new Map(),
		...over
	};
	return { opts, apply, fetch };
}

beforeEach(() => {
	token.value = 'jwt';
});

describe('resolveLocalFirst', () => {
	it('resolves held copies locally and reads only the rest, merged', async () => {
		const { opts, apply, fetch } = setup();
		await resolveLocalFirst(opts);
		expect(fetch).toHaveBeenCalledWith({ db: 'db1', token: 'jwt' }, ['c2']);
		expect([...apply.mock.lastCall![0]]).toEqual([
			['c2', 'fetched'],
			['c1', 'held']
		]);
	});

	it('applies the local map without a read when every copy is held', () => {
		const { opts, apply, fetch } = setup({ loans: [loan('c1')] });
		resolveLocalFirst(opts);
		expect(fetch).not.toHaveBeenCalled();
		expect([...apply.mock.calls[0][0]]).toEqual([['c1', 'held']]);
	});

	it('clears on no loans or no selection, without reading copies', () => {
		const allCopies = vi.fn(() => [copy('c1', 'held')]);
		for (const over of [{ loans: [] }, { selected: () => null }]) {
			const { opts, apply } = setup({ ...over, allCopies });
			resolveLocalFirst(opts);
			expect([...apply.mock.calls[0][0]]).toEqual([]);
		}
		expect(allCopies).not.toHaveBeenCalled();
	});

	it('#978 with no token, clears the labels and what was read, without a read', () => {
		token.value = null;
		const known = new Map([['db1', new Map([['c2', 'fetched']])]]);
		const { opts, apply, fetch } = setup({ known });
		resolveLocalFirst(opts);
		expect([...apply.mock.calls[0][0]]).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
		expect(known.size).toBe(0);
	});

	it('#978 shows only this db\'s known labels while the read is out', () => {
		const known = new Map([['db0', new Map([['c2', 'other db']])]]);
		const { opts, apply } = setup({ known, fetch: vi.fn(() => new Promise<never>(() => {})) });
		resolveLocalFirst(opts);
		expect([...apply.mock.calls[0][0]]).toEqual([['c1', 'held']]);
	});

	it('#984 reads only copies this db has not answered, and keeps each answer', async () => {
		const known = new Map([['db1', new Map([['c2', 'fetched']])]]);
		const { opts, apply, fetch } = setup({ known, loans: [loan('c1'), loan('c2'), loan('c3')] });
		fetch.mockResolvedValueOnce({ resolved: new Map([['c3', 'new']]), failed: [] });
		await resolveLocalFirst(opts);
		expect(fetch).toHaveBeenCalledWith({ db: 'db1', token: 'jwt' }, ['c3']);
		expect(new Map(apply.mock.lastCall![0])).toEqual(
			new Map([['c1', 'held'], ['c2', 'fetched'], ['c3', 'new']])
		);
		expect([...known.get('db1')!.keys()]).toEqual(['c2', 'c3']);
	});

	it('a superseded answer is still kept for the next run', async () => {
		const known = new Map<string, Map<string, string>>();
		const { opts } = setup({ known, isCurrent: () => false });
		await resolveLocalFirst(opts);
		expect([...known.get('db1')!]).toEqual([['c2', 'fetched']]);
	});

	it('drops a superseded fetched answer', async () => {
		const fetched = setup({ isCurrent: () => false });
		await resolveLocalFirst(fetched.opts);
		expect(fetched.fetch).toHaveBeenCalled();
		expect(fetched.apply).toHaveBeenCalledTimes(1);
		expect([...fetched.apply.mock.calls[0][0]]).toEqual([['c1', 'held']]);
	});

	it('#979 a partly failed read applies what resolved and reports once', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failed = [new Error('c3: 404'), new Error('c4: 403')];
		const { opts, apply } = setup({
			loans: [loan('c1'), loan('c2'), loan('c3'), loan('c4')],
			fetch: vi.fn(async () => ({ resolved: new Map([['c2', 'fetched']]), failed }))
		});
		await resolveLocalFirst(opts);
		expect([...apply.mock.lastCall![0]]).toEqual([
			['c2', 'fetched'],
			['c1', 'held']
		]);
		expect(error).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledWith(
			'library: resolving the copy name failed',
			expect.objectContaining({ errors: failed })
		);
		error.mockRestore();
	});

	it('a read that fails outright reports under its own label', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('boom');
		const { opts, apply } = setup({ fetch: vi.fn(async () => Promise.reject(failure)) });
		await resolveLocalFirst(opts);
		expect(error).toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith('library: resolving the copy name failed', failure);
		expect(apply).toHaveBeenCalledTimes(1);
		expect([...apply.mock.calls[0][0]]).toEqual([['c1', 'held']]);
		error.mockRestore();
	});

	it('a failed read for a superseded selection is not logged (#756)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetch = vi.fn(async () => Promise.reject(new Error('boom')));
		const { opts } = setup({ fetch, isCurrent: () => false });
		await resolveLocalFirst(opts);
		expect(fetch).toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
		error.mockRestore();
	});
});
