// #258 RED — PART 1, the root cause. libraryData.ts:210-212 defaults a lending
// row's missing copy/member reference to '' (`raw.copy?.[0]?.reference ?? ''`),
// and that '' later composes `entity/` — entu-api's LIST route, which answers
// 200 with a plausible body. The result is a silent wrong answer, not a
// failure: resolveCopyName returns '' as a copy name (indistinguishable from a
// genuinely unnamed copy), resolveCopyChains returns a blank chain, and
// resolveBorrowerName throws a message that misleads about the root cause.
//
// GREEN picks FILTER (drop the malformed row at parse time) or ASSERT (loud
// error on it) and states which + why (Gama binding). These specs pin the
// OUTCOME for either choice without hardcoding it:
//   - a Lending with an empty copyId/memberId never escapes listLendings;
//   - no entity/-composed request with an empty id is ever fetched;
//   - the malformed row's handling is OBSERVABLE — absent from the list, or a
//     loud error naming the row — never a silent blank rendered as data.
// The DATE defaults beside the refs STAY (dates never compose into a path) —
// pinned by a scope-fence test below (that one passes on current main).
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import {
	listLendings,
	resolveBorrowerNames,
	resolveCopyNames,
	resolveCopyChains,
	type Lending
} from './libraryData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** Matches an entity path composed with an EMPTY id: '.../entity/' terminal or '.../entity/?query'. */
const EMPTY_ID_ENTITY_URL = /\/entity\/(\?|$)/;

/**
 * URL-routed fetch mock mimicking real entu-api shapes: list queries (and the
 * empty-id 'entity/' path — which entu-api resolves to the LIST route, the
 * whole bug) answer `{ entities }`; single-entity reads answer `{ entity }`.
 */
function routedFetch(lendingEntities: unknown[]) {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('_type.string=lending')) return json({ entities: lendingEntities });
		if (url.includes('_type.string=profile')) return json({ entities: [] });
		// The trap this issue is about: an empty id resolves to the LIST route,
		// which answers 200 with `entities` and NO `entity` key.
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

/**
 * Choice-agnostic harness: FILTER resolves with the malformed row absent;
 * ASSERT rejects with an error naming the row. Current main does NEITHER — it
 * resolves with the malformed row carrying '' ids, which is what must die.
 */
async function runListLendings(lendingEntities: unknown[]) {
	const fetchImpl = routedFetch(lendingEntities);
	let result: Lending[] | null = null;
	let err: unknown = null;
	try {
		result = await listLendings(cfg, fetchImpl);
	} catch (e) {
		err = e;
	}
	return { result, err, fetchImpl };
}

describe('#258 part 1 — a lending row with a missing reference never yields an empty id', () => {
	it("missing copy reference: the row is filtered out OR the read fails loud naming the row — never a Lending with copyId ''", async () => {
		const { result, err } = await runListLendings([goodRow, rowMissingCopy]);
		if (err !== null) {
			// ASSERT choice — the loud error must name the malformed row so the
			// data-integrity problem is actionable, not generic.
			expect(err).toBeInstanceOf(Error);
			expect(String((err as Error).message)).toMatch(/lending-bad-copy/);
		} else {
			// FILTER choice — the malformed row is absent, the good row intact.
			expect(result!.map((l) => l.id)).toEqual(['lending-good']);
		}
		// Either way, no empty id ever escapes the parse.
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
			// all three dates absent — returned_at '' is load-bearing ("still out")
		};
		const { result, err } = await runListLendings([rowMissingDates]);
		expect(err).toBeNull();
		expect(result).toEqual<Lending[]>([
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
			lendings = await listLendings(cfg, fetchImpl);
		} catch {
			// ASSERT choice: failing loud before any resolution is equally closed.
		}
		// Feed whatever escaped the parse into every downstream resolver, exactly
		// as the /library page does. Rejections are fine (loud is the point) —
		// what is NOT fine is any of them reaching the wire with an empty id.
		await resolveCopyNames(cfg, lendings.map((l) => l.copyId), fetchImpl).catch(() => {});
		await resolveBorrowerNames(cfg, lendings.map((l) => l.memberId), fetchImpl).catch(() => {});
		await resolveCopyChains(cfg, lendings.map((l) => l.copyId), [], fetchImpl).catch(() => {});

		const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => EMPTY_ID_ENTITY_URL.test(u))).toEqual([]);
	});
});

describe('#258 second net — resolvers can no longer silently blank on an empty id', () => {
	// GREEN's part 1 makes empty ids unreachable from lending rows; part 2's
	// choke-point guard covers DIRECT misuse. These pin that misuse is loud —
	// on current main all three are silent (or silently misleading) instead.
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
		// Loud (it already was) ...
		expect(err).toBeInstanceOf(Error);
		// ... but honest about the cause: the member is not "missing a person
		// reference" — the id was empty and the read hit the wrong route.
		expect(String((err as Error).message)).not.toMatch(/carries no readable person reference/);
	});
});

// (*MVOX:Tallis* — RED spec)
