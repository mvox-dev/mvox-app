import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listSeasons } from './entuSeasons';
import type { EntuCfg } from './entuSeasons';

// #161 RED — collective = database: seasons are children of the DATABASE entity,
// so `listSeasons` scopes its read by resolving the database entity
// (`_type.string=database&limit=1`) and filtering `_parent.reference` by ITS id —
// never by walking person → member → organization (`resolveMyOrgId` is retired;
// #159 deleted every organization instance, so the old chain returns null and
// the agenda would render seasonless for everyone).
//
// Signature is `listSeasons(cfg, fetchImpl?)` — no personId parameter, see the
// review-fix describe block below.

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function makeRouter(): { fetchImpl: typeof fetch; urls: string[] } {
	const urls: string[] = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		urls.push(url);
		if (url.includes('_type.string=database')) {
			return json({ entities: [{ _id: DB_ENTITY }], count: 1 });
		}
		if (url.includes('_type.string=season')) {
			// Only answer the season list when it is scoped to the DATABASE entity —
			// an unscoped or org-scoped read gets nothing.
			if (!url.includes(`_parent.reference=${DB_ENTITY}`)) {
				return json({ entities: [], count: 0 });
			}
			return json({
				entities: [
					{
						_id: 'season-1',
						name: [{ string: 'Season 2026/27' }],
						start_date: [{ date: '2026-09-01' }],
						end_date: [{ date: '2027-06-30' }]
					}
				],
				count: 1
			});
		}
		// The retired member/organization walk lands here — empty, never useful.
		return json({ entities: [], count: 0 });
	}) as unknown as typeof fetch;
	return { fetchImpl, urls };
}

describe('listSeasons — scoped to the DATABASE entity (#161)', () => {
	it('resolves the database entity and lists seasons via `_parent.reference=<databaseEntityId>` — no member walk, no organization query', async () => {
		const { fetchImpl, urls } = makeRouter();
		const seasons = await listSeasons(cfg, fetchImpl);

		expect(seasons).toHaveLength(1);
		expect(seasons[0]).toMatchObject({
			id: 'season-1',
			name: 'Season 2026/27',
			startDate: '2026-09-01',
			endDate: '2027-06-30'
		});

		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(true);
		expect(
			urls.some(
				(u) => u.includes('_type.string=season') && u.includes(`_parent.reference=${DB_ENTITY}`)
			)
		).toBe(true);
		expect(urls.some((u) => u.includes('_type.string=member'))).toBe(false);
		expect(urls.some((u) => u.includes('organization'))).toBe(false);
	});
});

// ── #161 review fix round 2 — the dead personId parameter is DELETED ───────────
//
// Not merely renamed/shadowed: the call contract is `listSeasons(cfg,
// fetchImpl?)`, full stop. The behavioral test calls it with fetchImpl in the
// SECOND slot; global fetch is stubbed to throw so a regression back to a
// 3-arg shape (which would shift fetchImpl out of position and fall back to
// global fetch) fails loudly instead of hitting the network.

describe('listSeasons — no personId parameter (#161 review fix)', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('global fetch must not be used — pass fetchImpl explicitly');
			})
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('listSeasons(cfg, fetchImpl) — fetchImpl in the SECOND slot — resolves the database entity and lists its seasons', async () => {
		const { fetchImpl, urls } = makeRouter();

		const seasons = await listSeasons(cfg, fetchImpl);

		expect(seasons).toHaveLength(1);
		expect(seasons[0]).toMatchObject({ id: 'season-1', name: 'Season 2026/27' });
		expect(urls.some((u) => u.includes('_type.string=database'))).toBe(true);
		expect(
			urls.some(
				(u) => u.includes('_type.string=season') && u.includes(`_parent.reference=${DB_ENTITY}`)
			)
		).toBe(true);
	});

	it('declares exactly ONE required parameter (cfg) — personId is gone from the signature', () => {
		// Function.length counts parameters before the first default — the target
		// signature `(cfg, fetchImpl = fetch)` has length 1.
		expect(listSeasons.length).toBe(1);
	});
});

// (*MVOX:Tallis* — #161 RED)
// (*MVOX:Tallis* — #161 review-fix RED: dead personId removed)
