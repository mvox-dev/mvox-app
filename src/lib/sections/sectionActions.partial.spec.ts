// A failed reorder reports a half-landed reparent with the server's reason.
import { describe, expect, it, vi } from 'vitest';
import { reorderSections, reparentSection } from './sectionActions';
import {
	SectionReparentPartialError,
	SECTION_REPARENT_PARTIAL,
	isSectionReparentPartial
} from './sectionErrors';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(([u, init]) => ({
		url: String(u),
		method: init?.method ?? 'GET'
	}));
}

async function catchPartial(p: Promise<unknown>): Promise<SectionReparentPartialError> {
	let caught: unknown;
	try {
		await p;
	} catch (e) {
		caught = e;
	}
	expect(caught).toBeInstanceOf(SectionReparentPartialError);
	return caught as SectionReparentPartialError;
}

function shapeOf(err: SectionReparentPartialError) {
	return {
		name: err.name,
		code: err.code,
		step: err.step,
		renumberedCount: err.renumberedCount,
		totalCount: err.totalCount,
		status: err.status,
		body: err.body
	};
}

describe('reorderSections — a non-2xx mid-loop throws SectionReparentPartialError carrying step/progress/status/BODY (#253)', () => {
	it('POST fails on section 2 of 3 → step "renumber", renumberedCount 1 of 3, status AND response body captured — and the loop STOPS: NO DELETE anywhere (atomic overwrite, #264), nothing for section 3, no retry POST', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const u = String(url);
			if (init?.method === 'POST') {
				if (u.includes('/entity/sec-b'))
					return Promise.resolve(new Response('rate limit exceeded for testdb', { status: 429 }));
				return Promise.resolve(json({}));
			}
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			const id = u.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			return Promise.resolve(json({ entity: { display_order: [{ _id: `pv-${id}` }] } }));
		});

		const err = await catchPartial(reorderSections(cfg, ['sec-a', 'sec-b', 'sec-c'], fetchImpl));

		expect(shapeOf(err)).toEqual({
			name: 'SectionReparentPartialError',
			code: 'section-reparent-partial',
			step: 'renumber',
			renumberedCount: 1,
			totalCount: 3,
			status: 429,
			body: 'rate limit exceeded for testdb'
		});
		expect(err.message).toMatch(/429/);

		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.url.includes('sec-c'))).toEqual([]);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(calls.filter((c) => c.method === 'POST' && c.url.includes('/entity/sec-b'))).toHaveLength(1);
	});

	it('the lookup GET fails on section 1 of 2 → renumberedCount 0 of 2, status and body captured, NOTHING written (no POST, no DELETE, no second attempt)', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST' || init?.method === 'DELETE')
				return Promise.resolve(json({}));
			return Promise.resolve(new Response('rights: display_order not readable', { status: 403 }));
		});

		const err = await catchPartial(reorderSections(cfg, ['sec-a', 'sec-b'], fetchImpl));

		expect(shapeOf(err)).toEqual({
			name: 'SectionReparentPartialError',
			code: 'section-reparent-partial',
			step: 'renumber',
			renumberedCount: 0,
			totalCount: 2,
			status: 403,
			body: 'rights: display_order not readable'
		});
		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
		expect(calls).toHaveLength(1);
	});

});

describe('reparentSection — a non-2xx throws SectionReparentPartialError with step "reparent" and the captured body (#253)', () => {
	it('POST fails → step "reparent", 0 of 0, status AND body captured; the rejected POST was the ATOMIC overwrite (old value id in the body, #264), so nothing landed and no DELETE ever went out', async () => {
		const bodies: unknown[] = [];
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') {
				bodies.push(JSON.parse(String(init.body)));
				return Promise.resolve(new Response('parent reference rejected', { status: 409 }));
			}
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(json({ entity: { _parent: [{ _id: 'pv-old-parent' }] } }));
		});

		const err = await catchPartial(reparentSection(cfg, 'sec-alto', 'sec-sop', fetchImpl));

		expect(shapeOf(err)).toEqual({
			name: 'SectionReparentPartialError',
			code: 'section-reparent-partial',
			step: 'reparent',
			renumberedCount: 0,
			totalCount: 0,
			status: 409,
			body: 'parent reference rejected'
		});
		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
		expect(bodies).toEqual([[{ _id: 'pv-old-parent', type: '_parent', reference: 'sec-sop' }]]);
	});

	it('the lookup GET fails → step "reparent", status and body captured, nothing written at all', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response('forbidden by rights', { status: 403 }));

		const err = await catchPartial(reparentSection(cfg, 'sec-alto', 'sec-sop', fetchImpl));

		expect(shapeOf(err)).toEqual({
			name: 'SectionReparentPartialError',
			code: 'section-reparent-partial',
			step: 'reparent',
			renumberedCount: 0,
			totalCount: 0,
			status: 403,
			body: 'forbidden by rights'
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

});

describe('SectionReparentPartialError — defensive body read and the cross-mock discriminator (#253)', () => {
	it('an UNREADABLE response body degrades to "" — the status still surfaces, the throw still types', async () => {
		const brokenRes = {
			ok: false,
			status: 502,
			text: () => Promise.reject(new Error('stream detached'))
		} as unknown as Response;
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(brokenRes);
			return Promise.resolve(json({ entity: { _parent: [{ _id: 'pv-old' }] } }));
		});

		const err = await catchPartial(reparentSection(cfg, 'sec-alto', 'sec-sop', fetchImpl));

		expect(shapeOf(err)).toEqual({
			name: 'SectionReparentPartialError',
			code: 'section-reparent-partial',
			step: 'reparent',
			renumberedCount: 0,
			totalCount: 0,
			status: 502,
			body: ''
		});
	});

	it('isSectionReparentPartial duck-types on `code` (mock rejections cross the page boundary as plain tagged objects, same as the other sectionErrors helpers)', async () => {
		expect(SECTION_REPARENT_PARTIAL).toBe('section-reparent-partial');
		expect(isSectionReparentPartial({ code: 'section-reparent-partial' })).toBe(true);
		expect(isSectionReparentPartial(new Error('plain'))).toBe(false);
		expect(isSectionReparentPartial(null)).toBe(false);
		expect(isSectionReparentPartial(undefined)).toBe(false);

		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response('nope', { status: 500 }));
		const err = await catchPartial(reparentSection(cfg, 'sec-alto', 'sec-sop', fetchImpl));
		expect(isSectionReparentPartial(err)).toBe(true);
	});
});

// (*MVOX:Tallis*)
