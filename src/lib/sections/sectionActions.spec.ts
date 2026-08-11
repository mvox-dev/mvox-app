import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { assignMemberSection, unassignMemberSection } from './sectionActions';
import {
	SECTION_PARENT_MISSING,
	SectionMembershipMissingError,
	isSectionMembershipMissing
} from './sectionErrors';

// TS.2/#96 RED — the section ASSIGNMENT write layer. `sectionActions.ts`'s
// exports are stubs that throw 'not implemented', so every assertion below
// FAILS until GREEN.
//
// Contract under test (see sectionActions.ts module header):
//
// PO ruling 2026-08-11 (#95/#80): section membership lives SOLELY in the
// member's `_parent` references (`entity_type: 'section'`) — NOT a
// `current_section` property (the #96 issue body predates the ruling). Members
// can be in MULTIPLE sections, so:
//   - assign = APPEND one `_parent` reference (Entu POST appends to
//     multi-valued props — one POST, no read-modify-write, nothing deleted).
//   - unassign = remove THE ONE SPECIFIC section's `_parent` value(s) by
//     property-value id (`DELETE /property/{valueId}`) — never the org parent,
//     never other sections, and NEVER `DELETE /entity/{memberId}` (the
//     endpoint split: conflating property-value and entity DELETE would
//     delete the member herself).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// ── assignMemberSection — one appending POST ────────────────────────────────────

describe('assignMemberSection — appends ONE `_parent` reference to the member (POST appends; nothing read, nothing deleted)', () => {
	it('POSTs to entity/{memberId} with body EXACTLY [{ type: "_parent", reference: sectionId }] — no _type, no _sharing, no entity_type (server-derived on read)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await assignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/testdb/entity/m-1');
		expect(init.method).toBe('POST');
		// FULL-shape toEqual, not arrayContaining — an extra stray prop (a second
		// `_parent`, a `_sharing`, a `current_section`) is a bug this must catch.
		expect(JSON.parse(String(init.body))).toEqual([{ type: '_parent', reference: 'sec-sop' }]);
	});

	it('is a SINGLE round-trip — POST appends, so there is no GET-then-modify and no DELETE of existing parent values', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await assignMemberSection(cfg, 'm-1', 'sec-alto', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(init.method).toBe('POST');
	});

	it('throws on a non-2xx response (status surfaced), never resolves silently', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'forbidden' }, 403));
		await expect(assignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl)).rejects.toThrow(/403/);
	});
});

// ── unassignMemberSection — targeted property-value DELETE ──────────────────────

describe('unassignMemberSection — removes the ONE matching section `_parent` value(s), nothing else', () => {
	/**
	 * Member `m-1`'s `_parent` on the wire: the ORG parent plus two section
	 * parents. Unassigning `sec-sop` must delete pv-sop ONLY.
	 */
	function memberParents() {
		return {
			entity: {
				_parent: [
					{ _id: 'pv-org', reference: 'org-1', entity_type: 'organization' },
					{ _id: 'pv-sop', reference: 'sec-sop', entity_type: 'section' },
					{ _id: 'pv-alto', reference: 'sec-alto', entity_type: 'section' }
				]
			}
		};
	}

	function makeFetchMock(getBody: unknown = memberParents()) {
		return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ deleted: true }));
			return Promise.resolve(json(getBody));
		});
	}

	it('GETs entity/{memberId} projecting _parent, then DELETEs property/{valueId} of the matching section value ONLY — org parent and other sections untouched', async () => {
		const fetchImpl = makeFetchMock();
		await unassignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl);

		const calls = fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>;
		const getCall = calls.find(([, init]) => init?.method !== 'DELETE')!;
		expect(String(getCall[0])).toContain('/testdb/entity/m-1');
		expect(String(getCall[0])).toContain('props=_parent');

		const deleteUrls = calls.filter(([, init]) => init?.method === 'DELETE').map(([u]) => String(u));
		expect(deleteUrls).toEqual([expect.stringContaining('/testdb/property/pv-sop')]);
		// The endpoint split, pinned: property-VALUE ids go to /property/{id};
		// `DELETE /entity/...` anywhere here would delete the member entity.
		for (const u of deleteUrls) expect(u).not.toContain('/entity/');
	});

	it('generic delete — corrupted state with the SAME section duplicated deletes EVERY matching value (no orphan phantom membership survives)', async () => {
		const fetchImpl = makeFetchMock({
			entity: {
				_parent: [
					{ _id: 'pv-org', reference: 'org-1', entity_type: 'organization' },
					{ _id: 'pv-sop-a', reference: 'sec-sop', entity_type: 'section' },
					{ _id: 'pv-sop-b', reference: 'sec-sop', entity_type: 'section' }
				]
			}
		});
		await unassignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl);
		const deleteUrls = (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>)
			.filter(([, init]) => init?.method === 'DELETE')
			.map(([u]) => String(u))
			.sort();
		expect(deleteUrls).toEqual([
			expect.stringContaining('/property/pv-sop-a'),
			expect.stringContaining('/property/pv-sop-b')
		]);
	});

	it('a non-section `_parent` value with a coincidentally matching reference is NOT deleted (entity_type gate, not reference alone)', async () => {
		const fetchImpl = makeFetchMock({
			entity: {
				_parent: [
					{ _id: 'pv-weird', reference: 'sec-sop', entity_type: 'organization' },
					{ _id: 'pv-sop', reference: 'sec-sop', entity_type: 'section' }
				]
			}
		});
		await unassignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl);
		const deleteUrls = (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>)
			.filter(([, init]) => init?.method === 'DELETE')
			.map(([u]) => String(u));
		expect(deleteUrls).toEqual([expect.stringContaining('/property/pv-sop')]);
	});

	it('FAILS LOUD when the member has NO matching section `_parent` value — names both member and section (stale picker; caller reconciles)', async () => {
		const fetchImpl = makeFetchMock();
		await expect(unassignMemberSection(cfg, 'm-1', 'sec-tenor', fetchImpl)).rejects.toThrow(
			/m-1.*sec-tenor|sec-tenor.*m-1/
		);
		// And nothing was deleted on the way to the throw.
		const deletes = (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).filter(
			([, init]) => init?.method === 'DELETE'
		);
		expect(deletes).toEqual([]);
	});

	it('F1 code-review fix: that fail-loud throw is TAGGED `section-parent-missing` — the caller must tell "server already converged" apart from "the write failed"', async () => {
		const fetchImpl = makeFetchMock();
		await expect(
			unassignMemberSection(cfg, 'm-1', 'sec-tenor', fetchImpl)
		).rejects.toBeInstanceOf(SectionMembershipMissingError);

		const reason = await unassignMemberSection(cfg, 'm-1', 'sec-tenor', fetchImpl).catch(
			(e: unknown) => e
		);
		expect(isSectionMembershipMissing(reason)).toBe(true);
		// The tag rides ON the error, and the loud message is untouched.
		expect((reason as { code?: string }).code).toBe(SECTION_PARENT_MISSING);
		expect(String((reason as Error).message)).toContain('m-1');
		expect(String((reason as Error).message)).toContain('sec-tenor');
	});

	it('a REAL write failure is NOT tagged — a 403 on the property DELETE must still revert at the caller', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ error: 'nope' }, 403));
			return Promise.resolve(json(memberParents()));
		});
		const reason = await unassignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl).catch(
			(e: unknown) => e
		);
		expect(isSectionMembershipMissing(reason)).toBe(false);
	});

	it('throws on a non-2xx lookup GET (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'nope' }, 500));
		await expect(unassignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl)).rejects.toThrow(/500/);
	});

	it('throws on a non-2xx property DELETE (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({ error: 'nope' }, 403));
			return Promise.resolve(json(memberParents()));
		});
		await expect(unassignMemberSection(cfg, 'm-1', 'sec-sop', fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis* — TS.2/#96 RED)
