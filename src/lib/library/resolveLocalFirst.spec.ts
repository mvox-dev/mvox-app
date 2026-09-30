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
	const fetch = vi.fn(async () => new Map([['c2', 'fetched']]));
	const opts: LocalFirst<string> = {
		loans: [loan('c1'), loan('c2')],
		selected: () => ({ db: 'db1' }),
		allCopies: () => [copy('c1', 'held')],
		local: (c) => c.name,
		fetch,
		isCurrent: () => true,
		apply,
		what: 'name',
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
		resolveLocalFirst(opts);
		await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
		expect(fetch).toHaveBeenCalledWith({ db: 'db1', token: 'jwt' }, ['c2']);
		expect([...apply.mock.calls[0][0]]).toEqual([
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

	it('leaves the state alone with no token', () => {
		token.value = null;
		const { opts, apply, fetch } = setup();
		resolveLocalFirst(opts);
		expect(apply).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('drops a superseded answer, local or fetched', async () => {
		const local = setup({ loans: [loan('c1')], isCurrent: () => false });
		resolveLocalFirst(local.opts);
		expect(local.apply).not.toHaveBeenCalled();

		const fetched = setup({ isCurrent: () => false });
		resolveLocalFirst(fetched.opts);
		await vi.waitFor(() => expect(fetched.fetch).toHaveBeenCalled());
		await Promise.resolve();
		expect(fetched.apply).not.toHaveBeenCalled();
	});

	it('logs a failed read under its own label', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('boom');
		const { opts, apply } = setup({ fetch: vi.fn(async () => Promise.reject(failure)) });
		resolveLocalFirst(opts);
		await vi.waitFor(() => expect(error).toHaveBeenCalled());
		expect(error).toHaveBeenCalledWith('library: copy name resolution failed', failure);
		expect(apply).not.toHaveBeenCalled();
		error.mockRestore();
	});
});
