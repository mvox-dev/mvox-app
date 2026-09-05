import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { reorderSections, reparentSection } from './sectionActions';
import {
	SectionReparentPartialError,
	SECTION_REPARENT_PARTIAL,
	isSectionReparentPartial
} from './sectionErrors';

// #253 RED — a failed section reorder can leave a half-landed reparent
// reported as "did not save", with the server's WHY thrown away.
//
// Today every non-2xx in `reorderSections` (sectionActions.ts:315,330,334) and
// `reparentSection` (:462,477,481) throws a plain `Error` carrying ONLY
// `res.status` — the response body (the server's stated reason: rate limit
// text, rights refusal, validation message) is never read, so every real
// occurrence is unverifiable after the fact. PO ruling on #253: capture status
// AND body into a typed error, house-precedent shape (SeriesCascadePartialError
// carries deletedCount/totalCount + the stopping failure; ProfileSaveError
// carries createdProfileId).
//
// Contract pinned here (GREEN implements in sectionErrors.ts + sectionActions.ts):
//
//   - `SectionReparentPartialError extends Error`, name
//     'SectionReparentPartialError', `code = SECTION_REPARENT_PARTIAL`
//     ('section-reparent-partial'), duck-type helper
//     `isSectionReparentPartial(reason)` (the roster page's spec mocks the
//     write layer wholesale, so the discriminator must live in sectionErrors —
//     same reason SectionMembershipMissingError does).
//   - Fields (readable evidence, full shape):
//       step:            'reparent' | 'renumber' — WHICH write failed. The
//                        `_parent` move is 'reparent'; the destination-group
//                        display_order sweep is 'renumber'.
//       renumberedCount: sections FULLY renumbered (POST landed AND every old
//                        value deleted) before the failure. 0 for step
//                        'reparent' (the renumber never began).
//       totalCount:      size of the sibling group being renumbered; 0 for
//                        step 'reparent'.
//       status:          the non-2xx HTTP status.
//       body:            the response body TEXT, read defensively ('' when the
//                        body cannot be read).
//   - The message still names the status (existing specs pin rejects.toThrow(/500/)).
//   - NO retry: the GET→POST→DELETE choreography is NOT idempotent (POST
//     appends to implicitly multi-valued props; a blind re-run after an
//     ambiguous timeout duplicates values or deletes the wrong generation) —
//     pinned below as "requests stop AT the failure, exactly one POST per
//     section, nothing re-issued".

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

interface Call {
	url: string;
	method: string;
}

function callsOf(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(([u, init]) => ({
		url: String(u),
		method: init?.method ?? 'GET'
	}));
}

/** Run the promise, expect a SectionReparentPartialError, hand it back typed. */
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

/** The FULL evidence shape — toEqual, not objectContaining (a missing field is
 *  exactly the "evidence thrown away" defect this issue is about). */
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

// ── reorderSections — the 'renumber' step ───────────────────────────────────

describe('reorderSections — a non-2xx mid-loop throws SectionReparentPartialError carrying step/progress/status/BODY (#253)', () => {
	it('POST fails on section 2 of 3 → step "renumber", renumberedCount 1 of 3, status AND response body captured — and the loop STOPS: no DELETE for the failed section, nothing for section 3, no retry POST', async () => {
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
		// The status still travels in the message (existing /500/-style pins).
		expect(err.message).toMatch(/429/);

		// REFUSAL (PO #253): no retry/backoff — the sequence is not idempotent.
		// Requests stop AT the failure: section 3 untouched, the failed section's
		// old value NOT deleted, and the failing POST issued EXACTLY once.
		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.url.includes('sec-c'))).toEqual([]);
		expect(calls.filter((c) => c.method === 'DELETE' && c.url.includes('pv-sec-b'))).toEqual([]);
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

	it('an old-value DELETE fails on section 1 of 2 → renumberedCount 0 (the section is not FULLY renumbered — a duplicate old value survives), body captured, section 2 untouched', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const u = String(url);
			if (init?.method === 'DELETE') {
				if (u.includes('/property/pv-a1'))
					return Promise.resolve(new Response('entu exploded', { status: 500 }));
				return Promise.resolve(json({ deleted: true }));
			}
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(json({ entity: { display_order: [{ _id: 'pv-a1' }] } }));
		});

		const err = await catchPartial(reorderSections(cfg, ['sec-a', 'sec-b'], fetchImpl));

		expect(shapeOf(err)).toEqual({
			name: 'SectionReparentPartialError',
			code: 'section-reparent-partial',
			step: 'renumber',
			renumberedCount: 0,
			totalCount: 2,
			status: 500,
			body: 'entu exploded'
		});
		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.url.includes('sec-b'))).toEqual([]);
		// The failing DELETE was issued exactly once — no retry.
		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
	});
});

// ── reparentSection — the 'reparent' step ───────────────────────────────────

describe('reparentSection — a non-2xx throws SectionReparentPartialError with step "reparent" and the captured body (#253)', () => {
	it('POST fails → step "reparent", 0 of 0, status AND body captured; the old parent value is NOT deleted and the POST is issued exactly once (no retry)', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST')
				return Promise.resolve(new Response('parent reference rejected', { status: 409 }));
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

	it('an old-parent DELETE fails after the POST landed → still step "reparent", body captured, the failing DELETE issued exactly once', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE')
				return Promise.resolve(new Response('property is locked', { status: 500 }));
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(json({ entity: { _parent: [{ _id: 'pv-old-parent' }] } }));
		});

		const err = await catchPartial(reparentSection(cfg, 'sec-alto', 'sec-sop', fetchImpl));

		expect(shapeOf(err)).toEqual({
			name: 'SectionReparentPartialError',
			code: 'section-reparent-partial',
			step: 'reparent',
			renumberedCount: 0,
			totalCount: 0,
			status: 500,
			body: 'property is locked'
		});
		expect(callsOf(fetchImpl).filter((c) => c.method === 'DELETE')).toHaveLength(1);
	});
});

// ── defensive body read + the duck-type seam ────────────────────────────────

describe('SectionReparentPartialError — defensive body read and the cross-mock discriminator (#253)', () => {
	it('an UNREADABLE response body degrades to "" — the status still surfaces, the throw still types', async () => {
		const brokenRes = {
			ok: false,
			status: 502,
			text: () => Promise.reject(new Error('stream detached'))
		} as unknown as Response;
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'POST') return Promise.resolve(brokenRes);
			return Promise.resolve(json({ entity: { _parent: [] } }));
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

// (*MVOX:Tallis* — #253 RED)
