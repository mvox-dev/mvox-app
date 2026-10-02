// A lending row without a copy or member reference never composes an empty entity path.
import { describe, expect, it, vi } from 'vitest';
import {
	listLendings,
	resolveBorrowerNames,
	resolveCopyNames,
	resolveCopyChains,
	type Lending
} from './libraryData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

const EMPTY_ID_ENTITY_URL = /\/entity\/(\?|$)/;

function routedFetch(lendingEntities: unknown[]) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('_type.string=lending')) return json({ entities: lendingEntities });
		if (url.includes('_type.string=profile')) return json({ entities: [] });
		if (EMPTY_ID_ENTITY_URL.test(url)) return json({ entities: [] });
		if (url.includes('/entity/'))
			return json({
				entity: {
					name: [{ string: 'Resolved name' }],
					copy_number: [{ number: 3 }],
					person: [{ reference: 'person-1' }],
					_parent: [{ reference: 'edition-1', entity_type: 'edition' }]
				}
			});
		return json({ entities: [] });
	});
}

const goodRow = {
	_id: 'lending-good',
	copy: [{ reference: 'copy-1' }],
	member: [{ reference: 'member-1' }],
	assigned_at: [{ date: '2026-07-01' }],
	assigned_until: [{ date: '2026-08-01' }]
};
const rowMissingCopy = {
	_id: 'lending-bad-copy',
	member: [{ reference: 'member-2' }],
	assigned_at: [{ date: '2026-07-02' }]
};
const rowMissingMember = {
	_id: 'lending-bad-member',
	copy: [{ reference: 'copy-2' }],
	assigned_at: [{ date: '2026-07-03' }]
};

async function runListLendings(lendingEntities: unknown[]) {
	const fetchImpl = routedFetch(lendingEntities);
	let result: Lending[] | null = null;
	let err: unknown = null;
	try {
		result = (await listLendings(cfg, fetchImpl)).items;
	} catch (e) {
		err = e;
	}
	return { result, err, fetchImpl };
}

describe('#258 part 1 — a lending row with a missing reference never yields an empty id', () => {
	it("missing copy reference: the row is filtered out OR the read fails loud naming the row — never a Lending with copyId ''", async () => {
		const { result, err } = await runListLendings([goodRow, rowMissingCopy]);
		if (err !== null) {
			expect(err).toBeInstanceOf(Error);
			expect(String((err as Error).message)).toMatch(/lending-bad-copy/);
		} else {
			expect(result!.map((l) => l.id)).toEqual(['lending-good']);
		}
		for (const l of result ?? []) {
			expect(l.copyId).not.toBe('');
			expect(l.memberId).not.toBe('');
		}
	});

	it("missing member reference: same contract — never a Lending with memberId ''", async () => {
		const { result, err } = await runListLendings([goodRow, rowMissingMember]);
		if (err !== null) {
			expect(err).toBeInstanceOf(Error);
			expect(String((err as Error).message)).toMatch(/lending-bad-member/);
		} else {
			expect(result!.map((l) => l.id)).toEqual(['lending-good']);
		}
		for (const l of result ?? []) {
			expect(l.copyId).not.toBe('');
			expect(l.memberId).not.toBe('');
		}
	});

	it("SCOPE FENCE — the date defaults STAY: missing dates map to '' (dates never compose into a path)", async () => {
		const rowMissingDates = {
			_id: 'lending-no-dates',
			copy: [{ reference: 'copy-9' }],
			member: [{ reference: 'member-9' }]
		};
		const { result, err } = await runListLendings([rowMissingDates]);
		expect(err).toBeNull();
		expect(result).toEqual<Lending[] | null>([
			{
				id: 'lending-no-dates',
				copyId: 'copy-9',
				memberId: 'member-9',
				assignedAt: '',
				assignedUntil: '',
				returnedAt: ''
			}
		]);
	});
});

describe('#258 part 1 — malformed rows never compose an entity/ request with an empty id', () => {
	it('the whole lending read path (list -> copy names -> borrower names -> chains) fetches NO empty-id entity URL', async () => {
		const fetchImpl = routedFetch([goodRow, rowMissingCopy, rowMissingMember]);
		let lendings: Lending[] = [];
		try {
			lendings = (await listLendings(cfg, fetchImpl)).items;
		} catch {
		}
		await resolveCopyNames(cfg, lendings.map((l) => l.copyId), fetchImpl).catch(() => {});
		await resolveBorrowerNames(cfg, lendings.map((l) => l.memberId), fetchImpl).catch(() => {});
		await resolveCopyChains(cfg, lendings.map((l) => l.copyId), [], fetchImpl).catch(() => {});

		const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => EMPTY_ID_ENTITY_URL.test(u))).toEqual([]);
	});
});

describe('#258 second net — resolvers can no longer silently blank on an empty id', () => {
	it("resolveCopyNames with an empty id rejects — it must not resolve '' as a copy's name", async () => {
		await expect(resolveCopyNames(cfg, [''], routedFetch([]))).rejects.toThrow();
	});

	it('resolveCopyChains with an empty id rejects — it must not return a blank chain that renders as data', async () => {
		await expect(resolveCopyChains(cfg, [''], [], routedFetch([]))).rejects.toThrow();
	});

	it('resolveBorrowerNames with an empty id rejects WITHOUT the misleading "carries no readable person reference" message', async () => {
		let err: unknown = null;
		try {
			await resolveBorrowerNames(cfg, [''], routedFetch([]));
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(Error);
		expect(String((err as Error).message)).not.toMatch(/carries no readable person reference/);
	});
});

// (*MVOX:Tallis* — RED spec)
