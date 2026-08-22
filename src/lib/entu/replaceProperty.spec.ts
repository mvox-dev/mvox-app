// #165 review F5 — the shared "replace a single-valued Entu property"
// choreography, extracted from eventFieldEdit.ts / collectiveName.ts (which had
// two verbatim copies of it). Both callers keep their own specs pinning the
// wire shape AT the caller boundary; this file pins the rule itself, once, at
// the place it now lives.
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

/** An aggregated read carrying TWO pre-existing values — "delete only the
 *  first" must fail visibly. */
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

describe('replaceEntityProperty', () => {
	it('GETs the property named by value.type, POSTs exactly one value, then DELETEs every pre-existing id', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(twoExisting()).mockResolvedValue(json({}));

		await replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(4);
		// The GET's `props=` is derived from the value being written — a
		// GET/POST property mismatch is unrepresentable.
		expect(urls(fetchImpl)[0]).toContain('/testdb/entity/e-1?props=name');
		expect(methods(fetchImpl)[1]).toBe('POST');
		expect(JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body))).toEqual([
			{ type: 'name', string: 'Uus' }
		]);
		// POST BEFORE DELETE, and EVERY stale id dies (property endpoint).
		expect(methods(fetchImpl).indexOf('POST')).toBeLessThan(methods(fetchImpl).indexOf('DELETE'));
		expect(urls(fetchImpl)[2]).toContain('/testdb/property/v-old');
		expect(urls(fetchImpl)[3]).toContain('/testdb/property/v-phantom');
	});

	it('passes non-string typed slots through untouched (datetime / number)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'e-1' } }))
			.mockResolvedValue(json({}));

		await replaceEntityProperty(
			cfg,
			'e-1',
			{ type: 'start_datetime', datetime: '2026-09-01T16:00:00.000Z' },
			fetchImpl
		);

		expect(urls(fetchImpl)[0]).toContain('props=start_datetime');
		expect(JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body))).toEqual([
			{ type: 'start_datetime', datetime: '2026-09-01T16:00:00.000Z' }
		]);
	});

	it('no pre-existing value → POST only, no deletes', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'e-1' } }))
			.mockResolvedValue(json({}));

		await replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(methods(fetchImpl)).not.toContain('DELETE');
	});

	it('a failed lookup throws and POSTS NOTHING (writing blind guarantees a phantom double-value)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl)
		).rejects.toThrow(/500/);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a failed POST throws and DELETES NOTHING — the old value must survive a failed write', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(twoExisting())
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl)
		).rejects.toThrow(/403/);
		expect(methods(fetchImpl)).not.toContain('DELETE');
	});

	it('a failed DELETE throws (the caller must know the replace only half-landed)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(twoExisting())
			.mockResolvedValueOnce(json({}))
			.mockResolvedValueOnce(json({ error: 'gone wrong' }, 500));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl)
		).rejects.toThrow(/500/);
	});

	it("the `label` prefixes thrown messages so a caller's failures stay identifiable", async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl, 'updateCollectiveName')
		).rejects.toThrow(/updateCollectiveName lookup failed: 500/);
	});
});

// (*MVOX:Palestrina* — #165 review F5)
