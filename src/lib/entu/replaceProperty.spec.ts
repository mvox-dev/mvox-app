// The shared overwrite and removal helpers: wire shape, order of writes, and failure outcomes.
import { describe, expect, it, vi } from 'vitest';
import { replaceEntityProperty, clearEntityProperty, overwriteEntityValues } from './replaceProperty';
import { json, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

const cfg = testCfg('testdb');

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

describe('replaceEntityProperty — options (#698)', () => {
	it('a string fifth argument still works as the label', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(oneExisting()).mockResolvedValueOnce(json({}, 500));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl, 'renameSection')
		).rejects.toThrow(/renameSection POST failed: 500/);
	});

	it('`fail` builds the thrown error from the failing step and response, body readable', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(oneExisting())
			.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
		const fail = vi.fn(async (step: string, res: Response) => new Error(`${step}:${res.status}:${await res.text()}`));

		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, fetchImpl, { fail })
		).rejects.toThrow('post:429:rate limited');
		expect(fail).toHaveBeenCalledTimes(1);
	});

	it('`fail` also covers the lookup and the extras sweep', async () => {
		const lookupFail = vi.fn().mockResolvedValueOnce(json({}, 404));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, lookupFail, {
				fail: (step, res) => new Error(`${step}:${res.status}`)
			})
		).rejects.toThrow('lookup:404');

		const sweepFail = vi
			.fn()
			.mockResolvedValueOnce(twoExisting())
			.mockResolvedValueOnce(json({}))
			.mockResolvedValueOnce(json({}, 403));
		await expect(
			replaceEntityProperty(cfg, 'e-1', { type: 'name', string: 'Uus' }, sweepFail, {
				fail: (step, res) => new Error(`${step}:${res.status}`)
			})
		).rejects.toThrow('delete:403');
	});
});

describe('overwriteEntityValues — several properties, caller-supplied existing values (#698)', () => {
	it('ONE POST pairs each entry with the first of its own existing ids; no lookup, no deletes on the normal path', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));

		await overwriteEntityValues(
			cfg,
			'e-1',
			[
				{ value: { type: 'status', string: 'going' }, existing: [{ _id: 's-old' }] },
				{ value: { type: 'going_ref', reference: 'ev-1' }, existing: [{ _id: 'maybe-old' }] },
				{ value: { type: 'url', string: 'x' }, existing: [] }
			],
			fetchImpl
		);

		expect(urls(fetchImpl)).toEqual(['https://api.entu-test.invalid/testdb/entity/e-1']);
		expect(postBody(fetchImpl, 0)).toEqual([
			{ _id: 's-old', type: 'status', string: 'going' },
			{ _id: 'maybe-old', type: 'going_ref', reference: 'ev-1' },
			{ type: 'url', string: 'x' }
		]);
	});

	it('extras of every entry are swept after the POST, in entry order', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));

		await overwriteEntityValues(
			cfg,
			'e-1',
			[
				{ value: { type: 'status', string: 'going' }, existing: [{ _id: 's1' }, { _id: 's2' }] },
				{ value: { type: 'going_ref', reference: 'ev-1' }, existing: [{ _id: 'r1' }, { _id: 'r2' }, { _id: 'r3' }] }
			],
			fetchImpl
		);

		expect(methods(fetchImpl)).toEqual(['POST', 'DELETE', 'DELETE', 'DELETE']);
		expect(urls(fetchImpl).slice(1)).toEqual([
			'https://api.entu-test.invalid/testdb/property/s2',
			'https://api.entu-test.invalid/testdb/property/r2',
			'https://api.entu-test.invalid/testdb/property/r3'
		]);
	});

	it('a failed POST throws with the label and deletes nothing', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({}, 500));
		await expect(
			overwriteEntityValues(
				cfg,
				'e-1',
				[{ value: { type: 'status', string: 'going' }, existing: [{ _id: 's1' }, { _id: 's2' }] }],
				fetchImpl,
				'updateRsvpStatus'
			)
		).rejects.toThrow(/updateRsvpStatus POST failed: 500/);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('`fail` builds the thrown error for a failed sweep delete', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({}, 403));
		await expect(
			overwriteEntityValues(
				cfg,
				'e-1',
				[{ value: { type: 'status', string: 'going' }, existing: [{ _id: 's1' }, { _id: 's2' }] }],
				fetchImpl,
				{ fail: (step, res) => new Error(`${step}:${res.status}`) }
			)
		).rejects.toThrow('delete:403');
	});
});

describe('clearEntityProperty — the REMOVAL path (#268 review F1)', () => {
	it('ONE existing value: GET, then DELETE /property/{id} — and NEVER a POST (an empty typed slot is not a writable value)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'e-1', birthdate: [{ _id: 'v-dob' }] } }))
			.mockResolvedValue(json({ deleted: true }));

		await clearEntityProperty(cfg, 'e-1', 'birthdate', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(urls(fetchImpl)[0]).toContain('/testdb/entity/e-1?props=birthdate');
		expect(methods(fetchImpl)[1]).toBe('DELETE');
		expect(urls(fetchImpl)[1]).toContain('/testdb/property/v-dob');
		// The whole point: no POST, so no `datetime: ""` can reach the wire.
		expect(methods(fetchImpl)).not.toContain('POST');
	});

	it('SEVERAL existing values (corrupted state): every one is removed — a clear that leaves a value behind is not a clear', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json({ entity: { _id: 'e-1', birthdate: [{ _id: 'v-a' }, { _id: 'v-b' }] } })
			)
			.mockResolvedValue(json({ deleted: true }));

		await clearEntityProperty(cfg, 'e-1', 'birthdate', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(urls(fetchImpl)[1]).toContain('/property/v-a');
		expect(urls(fetchImpl)[2]).toContain('/property/v-b');
	});

	it('nothing stored → zero deletes, zero POSTs, no throw (clearing an already-empty property is a no-op)', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ entity: { _id: 'e-1' } }));

		await clearEntityProperty(cfg, 'e-1', 'birthdate', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(methods(fetchImpl)).not.toContain('DELETE');
		expect(methods(fetchImpl)).not.toContain('POST');
	});

	it('a failed lookup throws and DELETES NOTHING', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));
		await expect(clearEntityProperty(cfg, 'e-1', 'birthdate', fetchImpl)).rejects.toThrow(/500/);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a failed DELETE throws — the old value survives, never a half-cleared property', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'e-1', birthdate: [{ _id: 'v-dob' }] } }))
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
		await expect(clearEntityProperty(cfg, 'e-1', 'birthdate', fetchImpl)).rejects.toThrow(/403/);
	});

	it("the `label` prefixes thrown messages, same as the overwrite path", async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: 'nope' }, 500));
		await expect(
			clearEntityProperty(cfg, 'e-1', 'birthdate', fetchImpl, 'updateMemberRecord')
		).rejects.toThrow(/updateMemberRecord lookup failed: 500/);
	});
});

// (*MVOX:Palestrina* — #165 review F5)
// (*MVOX:Tallis* — #264 RED: atomic overwrite, extras-only sweep)
// (*MVOX:Josquin* — #268 review F1: clearEntityProperty, the removal path)
