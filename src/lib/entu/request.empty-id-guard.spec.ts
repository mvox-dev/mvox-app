// entuFetch refuses an entity path with an empty id instead of hitting the list route.
import { describe, expect, it, vi } from 'vitest';
import { entuUrl, entuFetch } from './request';
import { listDeactivateBlockers } from '$lib/roster/memberLifecycle';
import { json, testCfg } from '$lib/testing/entuFetchKit';

async function captureEntuFetch(pathAndQuery: string) {
	const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
	let err: unknown = null;
	try {
		await entuFetch('sampledb', pathAndQuery, 'jwt-abc', {}, fetchImpl);
	} catch (e) {
		err = e;
	}
	return { err, fetchImpl };
}

describe('#258 part 2 — empty-id entity path is refused at the choke point', () => {
	it("entuFetch throws on terminal 'entity/' (bare) — loudly, naming the empty-id composition, with NO network call", async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/');
		expect(err).toBeInstanceOf(Error);
		expect(String((err as Error).message)).toMatch(/empty/i);
		expect(String((err as Error).message)).toMatch(/entity/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("entuFetch throws on 'entity/?props=...' (empty id + query) — same guard, NO network call", async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/?props=name,copy_number');
		expect(err).toBeInstanceOf(Error);
		expect(String((err as Error).message)).toMatch(/empty/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("entuFetch throws on '/entity/' with the tolerated leading slash too", async () => {
		const { err, fetchImpl } = await captureEntuFetch('/entity/');
		expect(err).toBeInstanceOf(Error);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("entuUrl (the composition point) never RETURNS a URL addressing 'entity/' with no id", () => {
		for (const bad of ['entity/', 'entity/?props=person', '/entity/?limit=1']) {
			let composed: string | null = null;
			try {
				composed = entuUrl('sampledb', bad);
			} catch {
				continue; // throwing is the expected shape
			}
			expect.fail(`entuUrl('sampledb', '${bad}') returned '${composed}' instead of throwing`);
		}
	});
});

describe('#258 part 2 — negative pins: legitimate paths are byte-unaffected', () => {
	it('single-entity read passes through untouched', async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/abc123');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.entu-test.invalid/sampledb/entity/abc123');
	});

	it('single-entity read with props passes through untouched', async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/abc123?props=name,copy_number');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe(
			'https://api.entu-test.invalid/sampledb/entity/abc123?props=name,copy_number'
		);
	});

	it("the INTENTIONAL list query — 'entity?...' with NO trailing slash — passes through untouched", async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity?_type.string=member&limit=1');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe(
			'https://api.entu-test.invalid/sampledb/entity?_type.string=member&limit=1'
		);
	});

	it("bare 'entity' (no query, no slash) passes through untouched — existing pin kept", () => {
		expect(entuUrl('sampledb', 'entity')).toBe('https://api.entu-test.invalid/sampledb/entity');
	});

	it('non-entity paths (property/...) pass through untouched', async () => {
		const { err, fetchImpl } = await captureEntuFetch('property/prop-1');
		expect(err).toBeNull();
		expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.entu-test.invalid/sampledb/property/prop-1');
	});
});

describe('#258 cross-check — #255 first net and #258 second net trip independently', () => {
	const cfg = testCfg('sampledb');

	it("first net: listDeactivateBlockers('' dbEntityId) still refuses outright, before any fetch (#255 r3 F1 — unchanged)", async () => {
		const fetchImpl = vi.fn();
		await expect(listDeactivateBlockers(cfg, 'person-1', '', null, fetchImpl)).rejects.toThrow(
			/no database entity id/
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('second net: even a caller that BYPASSES the #255 guard cannot reach the network with the empty-id rights path', async () => {
		const { err, fetchImpl } = await captureEntuFetch('entity/?props=_owner,_editor');
		expect(err).toBeInstanceOf(Error);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — RED spec)
