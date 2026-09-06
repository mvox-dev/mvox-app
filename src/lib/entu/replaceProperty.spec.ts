// #165 review F5 — the shared "replace a single-valued Entu property"
// choreography, extracted from eventFieldEdit.ts / collectiveName.ts. Both
// callers keep their own specs pinning the wire shape AT the caller boundary;
// this file pins the rule itself, once, at the place it now lives.
//
// #264 RED — the rule goes ATOMIC (PO ruling, branch (i)). Entu's native
// overwrite: a POST entry carrying the OLD property value's `_id` alongside
// the new value fields replaces that exact value in the SAME setEntity call
// (entu-www docs, "Overwriting a Property Value"; entu-api entity.js —
// `_id` → oldPIds → soft-deleted). The old GET → POST-new → DELETE-old
// choreography left a half-landing window (POST lands, DELETE fails →
// phantom duplicate); the atomic overwrite closes it, and every caller of
// this helper inherits the fix.
//
// The pinned choreography is now:
//   1. GET entity/{entityId}?props={prop} — the existing value id(s). Still
//      first: the overwrite entry cannot be built blind.
//   2. POST entity/{entityId}:
//      - ≥1 existing → body EXACTLY [{ _id: <first existing id>, ...value }]
//      - none existing → body EXACTLY [value]
//   3. EXTRA stale ids (corrupted multi-value state only) → DELETE
//      /property/{id} each, strictly AFTER the POST — a failure leaves a
//      recoverable duplicate, never an empty property. The NORMAL path
//      (zero or one existing value) issues ZERO deletes.
import { describe, expect, it, vi } from 'vitest';
import { replaceEntityProperty } from './replaceProperty';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const cfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function urls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0]));
}

function methods(fetchImpl: ReturnType<typeof vi.fn>): Array<string | undefined> {
	return fetchImpl.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
}

function postBody(fetchImpl: ReturnType<typeof vi.fn>, index = 1): unknown {
	return JSON.parse(String((fetchImpl.mock.calls[index][1] as RequestInit).body));
}

/** An aggregated read carrying ONE pre-existing value — the normal case. */
function oneExisting() {
	return json({
		entity: {
			_id: 'e-1',
			name: [{ _id: 'v-old', string: 'Vana' }]
		}
	});
}

/** An aggregated read carrying TWO pre-existing values — corrupted state. */
function twoExisting() {
	return json({
		entity: {
			_id: 'e-1',
			name: [
				{ _id: 'v-old', string: 'Vana' },
				{ _id: 'v-phantom', string: 'Phantom' }
			]
		}
	});
}

describe('replaceEntityProperty — atomic overwrite (#264)', () => {
	it('ONE existing value: GET, then ONE POST with body EXACTLY [{ _id: <old id>, type, string }] — no DELETE round-trip remains', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(oneExisting()).mockResolvedValue(json({}));

		await replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		// The GET's `props=` is derived from the value being written — a
		// GET/POST property mismatch is unrepresentable.
		expect(urls(fetchImpl)[0]).toContain('/testdb/entity/e-1?props=name');
		expect(methods(fetchImpl)[1]).toBe('POST');
		expect(postBody(fetchImpl)).toEqual([{ _id: 'v-old', type: 'name', string: 'Uus' }]);
		expect(methods(fetchImpl)).not.toContain('DELETE');
	});

	it('TWO existing values (corrupted): the overwrite pairs the FIRST id; ONLY the phantom is deleted, strictly AFTER the POST', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(twoExisting()).mockResolvedValue(json({}));

		await replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(postBody(fetchImpl)).toEqual([{ _id: 'v-old', type: 'name', string: 'Uus' }]);
		// POST BEFORE the extra sweep, and only the phantom dies — v-old was
		// replaced by the overwrite itself (property endpoint, never entity).
		expect(methods(fetchImpl).indexOf('POST')).toBeLessThan(methods(fetchImpl).indexOf('DELETE'));
		expect(urls(fetchImpl)[2]).toContain('/testdb/property/v-phantom');
		expect(methods(fetchImpl).filter((m) => m === 'DELETE')).toHaveLength(1);
	});

	it('passes non-string typed slots through untouched (datetime / number) — the old id still rides along', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json({ entity: { _id: 'e-1', start_datetime: [{ _id: 'v-dt-old' }] } })
			)
			.mockResolvedValue(json({}));

		await replaceEntityProperty(
			cfg,
			'e-1',
			{ type: 'start_datetime', datetime: '2026-09-01T16:00:00.000Z' },
			fetchImpl
		);

		expect(urls(fetchImpl)[0]).toContain('props=start_datetime');
		expect(postBody(fetchImpl)).toEqual([
			{ _id: 'v-dt-old', type: 'start_datetime', datetime: '2026-09-01T16:00:00.000Z' }
		]);
		expect(methods(fetchImpl)).not.toContain('DELETE');
	});

	it('no pre-existing value → plain POST of exactly [value], no deletes', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'e-1' } }))
			.mockResolvedValue(json({}));

		await replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(postBody(fetchImpl)).toEqual([{ type: 'name', string: 'Uus' }]);
		expect(methods(fetchImpl)).not.toContain('DELETE');
	});

	it('a failed lookup throws and POSTS NOTHING (writing blind guarantees a phantom double-value)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl)
		).rejects.toThrow(/500/);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a failed POST throws and DELETES NOTHING — the rejected overwrite carried the old id, so the old value survives untouched (empty-property half-landing impossible)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(twoExisting())
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl)
		).rejects.toThrow(/403/);
		expect(methods(fetchImpl)).not.toContain('DELETE');
		expect(postBody(fetchImpl)).toEqual([{ _id: 'v-old', type: 'name', string: 'Uus' }]);
	});

	it('a failed EXTRA-sweep DELETE (corrupted state only) throws — and the attempted delete was the phantom, never the replaced value', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(twoExisting())
			.mockResolvedValueOnce(json({}))
			.mockResolvedValueOnce(json({ error: 'gone wrong' }, 500));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl)
		).rejects.toThrow(/500/);
		expect(urls(fetchImpl)[2]).toContain('/property/v-phantom');
	});

	it("the `label` prefixes thrown messages so a caller's failures stay identifiable", async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl, 'updateCollectiveName')
		).rejects.toThrow(/updateCollectiveName lookup failed: 500/);
	});
});

// (*MVOX:Palestrina* — #165 review F5)
// (*MVOX:Tallis* — #264 RED: atomic overwrite, extras-only sweep)
