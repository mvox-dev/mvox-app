// Section reparent: one overwrite POST; damaged _parent data is refused.
import { describe, expect, it, vi } from 'vitest';
import { reparentSection } from './sectionActions';
import { SectionParentDamagedError, isSectionParentDamaged } from './sectionErrors';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

function makeFetchMock(oldValues: Array<{ _id: string; reference?: string; entity_type?: string }>) {
	return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		return Promise.resolve(json({ entity: { _parent: oldValues } }));
	});
}

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(([u, init]) => ({
		url: String(u),
		method: init?.method ?? 'GET',
		body: init?.body ? JSON.parse(String(init.body)) : undefined
	}));
}

describe('reparentSection — ATOMIC overwrite-POST (#264): the old value id rides the POST, no DELETE exists', () => {
	it('exactly one existing _parent value → GET then ONE POST with body EXACTLY [{ _id: <old id>, type: "_parent", reference: <newParentId> }] — two requests total, ZERO property DELETEs', async () => {
		const fetchImpl = makeFetchMock([
			{ _id: 'pv-old', reference: 'sec-parent-old', entity_type: 'section' }
		]);
		await reparentSection(cfg, 'sec-alto', 'sec-sop', fetchImpl);

		const calls = callsOf(fetchImpl);
		const gets = calls.filter((c) => c.method === 'GET');
		expect(
			gets.some((c) => c.url.includes('/testdb/entity/sec-alto') && c.url.includes('props=_parent'))
		).toBe(true);

		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toContain('/testdb/entity/sec-alto');
		expect(posts[0].body).toEqual([{ _id: 'pv-old', type: '_parent', reference: 'sec-sop' }]);

		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(calls).toHaveLength(2);
	});

	it('a REJECTED POST leaves exactly the old state — the overwrite entry never committed, no DELETE ever went out, and the #253 evidence shape still surfaces (step "reparent", status + body)', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST')
				return Promise.resolve(new Response('forbidden by rights', { status: 403 }));
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(
				json({ entity: { _parent: [{ _id: 'pv-old', reference: 'sec-sop', entity_type: 'section' }] } })
			);
		});

		let caught: unknown;
		try {
			await reparentSection(cfg, 'sec-sop2', 'org-1', fetchImpl);
		} catch (e) {
			caught = e;
		}
		expect((caught as { code?: unknown })?.code).toBe('section-reparent-partial');
		expect((caught as { step?: unknown })?.step).toBe('reparent');
		expect((caught as { status?: unknown })?.status).toBe(403);
		expect((caught as { body?: unknown })?.body).toBe('forbidden by rights');

		const calls = callsOf(fetchImpl);
		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].body).toEqual([{ _id: 'pv-old', type: '_parent', reference: 'org-1' }]);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('ZERO existing _parent values → SectionParentDamagedError, and the GET is the ONLY request (no POST, no DELETE — never write over damaged data)', async () => {
		const fetchImpl = makeFetchMock([]);

		let caught: unknown;
		try {
			await reparentSection(cfg, 'sec-orphan', 'sec-sop', fetchImpl);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(SectionParentDamagedError);
		expect(isSectionParentDamaged(caught)).toBe(true);
		expect((caught as SectionParentDamagedError).code).toBe('section-parent-damaged');
		expect((caught as SectionParentDamagedError).sectionId).toBe('sec-orphan');
		expect((caught as SectionParentDamagedError).valueCount).toBe(0);

		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it('TWO existing _parent values (the live Soprano II duplicate) → SectionParentDamagedError with valueCount 2, and NOTHING is written — no POST, no DELETE, no silent pick-one', async () => {
		const fetchImpl = makeFetchMock([
			{ _id: 'pv-a', reference: 'db-1', entity_type: 'database' },
			{ _id: 'pv-b', reference: 'db-1', entity_type: 'database' }
		]);

		let caught: unknown;
		try {
			await reparentSection(cfg, 'sec-sop2', 'sec-sop', fetchImpl);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(SectionParentDamagedError);
		expect((caught as SectionParentDamagedError).sectionId).toBe('sec-sop2');
		expect((caught as SectionParentDamagedError).valueCount).toBe(2);
		expect((caught as Error).message).toContain('sec-sop2');

		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it('refuses newParentId === sectionId WITHOUT any fetch — a section can never be its own parent', async () => {
		const fetchImpl = vi.fn();
		await expect(reparentSection(cfg, 'sec-sop', 'sec-sop', fetchImpl)).rejects.toThrow(/own parent|itself|self/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('throws on a non-2xx lookup GET (status surfaced), and nothing is written', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'nope' }, 500));
		await expect(reparentSection(cfg, 'sec-sop2', 'org-1', fetchImpl)).rejects.toThrow(/500/);
		expect(callsOf(fetchImpl).filter((c) => c.method !== 'GET')).toEqual([]);
	});
});

// (*MVOX:Tallis*)
