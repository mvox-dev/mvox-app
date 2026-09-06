import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { reparentSection } from './sectionActions';
import { SectionParentDamagedError, isSectionParentDamaged } from './sectionErrors';

// #264 RED — the section REPARENT write goes ATOMIC (PO ruling, branch (i)).
//
// Platform facts (stage-1 report on mvox-app#264, source-verified):
//   - `POST entity/{id}` writing `_parent` is EDITOR-gated (entu-api's POST
//     rightTypes list excludes `_parent` — entity.js:21-29).
//   - `DELETE property/{id}` on a `_parent` value is OWNER-gated (the delete
//     route's rightTypes list includes `_parent`).
//   - Entu's native atomic overwrite: POST an array whose entry carries the
//     OLD property value's `_id` alongside the new value fields — `setEntity`
//     soft-deletes the old value in the SAME call, entirely under the editor
//     gate (entu-www docs, "Overwriting a Property Value").
//
// The old GET → POST-new → DELETE-old choreography therefore HALF-LANDS for an
// editor-tier user: the POST commits, the owner-only DELETE 403s, and the
// section ends up with TWO parents (live-confirmed on mvox_crede: Soprano II).
// The atomic overwrite makes that half-landing structurally impossible.
//
// Contract pinned here (GREEN implements in sectionActions.ts):
//
//   - GET `entity/{sectionId}?props=_parent` FIRST — the existing value id(s).
//   - EXACTLY ONE existing value → ONE `POST entity/{sectionId}` with body
//     EXACTLY `[{ "_id": "<old value id>", "type": "_parent", "reference":
//     "<newParentId>" }]`. NO `DELETE /property/{id}` request exists anywhere
//     in the reparent path, in any scenario.
//   - ZERO or MORE-THAN-ONE existing values → NO writes at all (the GET is the
//     only request), throw `SectionParentDamagedError` (code
//     'section-parent-damaged', sectionId + valueCount carried) — v4E
//     `parentConstraint: 'exactly_one_of'` means ≠1 values is DAMAGED DATA;
//     writing over a state we cannot atomically express would be a guess
//     (ruling item 5 — the #258 fail-open class).
//   - A REJECTED POST leaves exactly the old state — nothing landed is now
//     TRUE (the old value survives untouched server-side because the same
//     call that would have soft-deleted it never committed). Still throws
//     `SectionReparentPartialError` (step 'reparent', status + body captured,
//     #253 evidence shape unchanged).
//   - `newParentId === sectionId` still throws WITHOUT any fetch (self-parent).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/**
 * Fetch mock: GET entity/{id}?props=_parent answers with the given old
 * `_parent` value ids; POST and DELETE succeed (a DELETE answering success is
 * deliberate — the contract is that no DELETE is ever SENT, not that one
 * would fail).
 */
function makeFetchMock(oldValues: Array<{ _id: string; reference?: string; entity_type?: string }>) {
	return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
		if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
		if (init?.method === 'POST') return Promise.resolve(json({}));
		return Promise.resolve(json({ entity: { _parent: oldValues } }));
	});
}

interface Call {
	url: string;
	method: string;
	body: unknown;
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
		// FULL-shape toEqual — the `_id` alongside the new reference IS the
		// atomic overwrite; without it the POST appends a SECOND parent (the
		// exact half-landing #264 documents live). A `{ string: ... }` slot or a
		// stray extra prop is equally a bug this must catch.
		expect(posts[0].body).toEqual([{ _id: 'pv-old', type: '_parent', reference: 'sec-sop' }]);

		// The owner-gated DELETE route is never touched — that is what makes an
		// editor-tier reparent legal and the half-landing unrepresentable.
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
		// The failing POST carried the atomic shape (old id + new reference) —
		// so its rejection means the server changed NOTHING: old parent intact,
		// no second value, nothing to clean up. "Nothing landed" is now TRUE.
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
		// The message names the section — the refusal must be actionable.
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

// (*MVOX:Tallis* — #155/S3 RED)
// (*MVOX:Tallis* — #264 RED: atomic overwrite-POST, damaged-data refusal)
