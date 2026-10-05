// The section delete write layer, refused while the section is not empty.
import { describe, expect, it, vi } from 'vitest';
import { deleteSection } from './sectionActions';
import { isSectionNotEmpty } from './sectionErrors';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(([u, init]) => ({
		url: String(u),
		method: init?.method ?? 'GET'
	}));
}

function emptyChecksThen(memberCount: number, childCount: number, deleteStatus = 200) {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		if ((init?.method ?? 'GET') === 'DELETE') {
			return Promise.resolve(json({ deleted: true }, deleteStatus));
		}
		if (u.includes('_type.string=member')) {
			return Promise.resolve(json({ count: memberCount, entities: [] }));
		}
		if (u.includes('_type.string=section')) {
			return Promise.resolve(json({ count: childCount, entities: [] }));
		}
		throw new Error(`unexpected fetch: ${u}`);
	});
}

describe('deleteSection — verifies emptiness server-side, then deletes the section ENTITY', () => {
	it('is exported from sectionActions', () => {
		expect(typeof deleteSection).toBe('function');
	});

	it('an EMPTY section: two scoped counting GETs, then exactly ONE DELETE …/testdb/entity/{sectionId} — no /property/ call', async () => {
		const fetchImpl = emptyChecksThen(0, 0);
		await deleteSection(cfg, 'sec-bass', fetchImpl);

		const calls = callsOf(fetchImpl);
		expect(calls).toHaveLength(3);

		const gets = calls.filter((c) => c.method === 'GET');
		expect(gets).toHaveLength(2);
		expect(
			gets.some(
				(c) =>
					c.url.includes('_type.string=member') && c.url.includes('_parent.reference=sec-bass')
			)
		).toBe(true);
		expect(
			gets.some(
				(c) =>
					c.url.includes('_type.string=section') && c.url.includes('_parent.reference=sec-bass')
			)
		).toBe(true);

		const deletes = calls.filter((c) => c.method === 'DELETE');
		expect(deletes).toHaveLength(1);
		expect(deletes[0].url).toContain('/testdb/entity/sec-bass');
		expect(deletes[0].url).not.toContain('/property/');
	});

	it('sends the auth token on every request (nothing is anonymous)', async () => {
		const fetchImpl = emptyChecksThen(0, 0);
		await deleteSection(cfg, 'sec-bass', fetchImpl);

		for (const [, init] of fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>) {
			expect(JSON.stringify(init?.headers ?? {})).toContain('jwt');
		}
	});

	it('a section that still has MEMBERS is REFUSED: tagged section-not-empty, and NO DELETE is issued', async () => {
		const fetchImpl = emptyChecksThen(3, 0);
		const reason = await deleteSection(cfg, 'sec-alto', fetchImpl).catch((e: unknown) => e);

		expect(isSectionNotEmpty(reason)).toBe(true);
		expect(String(reason)).toContain('sec-alto');
		expect(callsOf(fetchImpl).some((c) => c.method === 'DELETE')).toBe(false);
	});

	it('a section that still has SUB-SECTIONS is REFUSED too — deleting it would orphan them', async () => {
		const fetchImpl = emptyChecksThen(0, 2);
		const reason = await deleteSection(cfg, 'sec-men', fetchImpl).catch((e: unknown) => e);

		expect(isSectionNotEmpty(reason)).toBe(true);
		expect(callsOf(fetchImpl).some((c) => c.method === 'DELETE')).toBe(false);
	});

	it('reads the server COUNT, not the (limit-capped) entities array — limit=1 must not make a 40-member section look like a 1-member one', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const u = String(url);
			if ((init?.method ?? 'GET') === 'DELETE') return Promise.resolve(json({ deleted: true }));
			if (u.includes('_type.string=member')) {
				return Promise.resolve(json({ count: 40, entities: [{ _id: 'm-1' }] }));
			}
			return Promise.resolve(json({ count: 0, entities: [] }));
		});
		const reason = await deleteSection(cfg, 'sec-alto', fetchImpl).catch((e: unknown) => e);

		expect(isSectionNotEmpty(reason)).toBe(true);
		expect(String(reason)).toContain('40');
	});

	it('a FAILED lookup throws with the status surfaced and issues no DELETE — an unreadable count is never read as "empty"', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			if ((init?.method ?? 'GET') === 'DELETE') return Promise.resolve(json({ deleted: true }));
			if (String(url).includes('_type.string=member')) {
				return Promise.resolve(json({ error: 'nope' }, 500));
			}
			return Promise.resolve(json({ count: 0, entities: [] }));
		});

		await expect(deleteSection(cfg, 'sec-bass', fetchImpl)).rejects.toThrow(/500/);
		expect(callsOf(fetchImpl).some((c) => c.method === 'DELETE')).toBe(false);
	});

	it('throws on a non-2xx DELETE with the status surfaced — a refused delete must never be silent', async () => {
		const fetchImpl = emptyChecksThen(0, 0, 403);
		await expect(deleteSection(cfg, 'sec-bass', fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina*)
