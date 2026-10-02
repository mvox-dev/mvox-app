// Reassign and unassign an event's series without touching its season _parent value.
import { describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');

type ActionsModule = {
	reassignEventSeries: (
		c: typeof cfg,
		eventId: string,
		newSeriesId: string,
		fetchImpl?: typeof fetch
	) => Promise<void>;
	unassignEventSeries: (c: typeof cfg, eventId: string, fetchImpl?: typeof fetch) => Promise<void>;
	EventSeriesMissingError: new (...args: never[]) => Error;
};

async function actions(): Promise<ActionsModule> {
	return (await import('./eventSeriesActions')) as unknown as ActionsModule;
}

const PARENTS = [
	{ _id: 'pv-org', reference: 'org1', property_type: '_parent', entity_type: 'organization' },
	{ _id: 'pv-season', reference: 'season1', property_type: '_parent', entity_type: 'season' },
	{ _id: 'pv-series', reference: 'series1', property_type: '_parent', entity_type: 'event_series' }
];
const PARENTS_STANDALONE = PARENTS.filter((p) => p.entity_type !== 'event_series');

type WireOpts = { failPosts?: boolean; failDeletes?: boolean };

function wire(parents: Array<Record<string, unknown>> = PARENTS, opts: WireOpts = {}) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (method === 'DELETE' && url.includes('/property/')) {
			return opts.failDeletes ? json({ message: 'boom' }, 403) : json({ deleted: true });
		}
		if (method === 'POST' && url.includes('/entity/ev1')) {
			return opts.failPosts ? json({ message: 'boom' }, 400) : json({ _id: 'ev1', properties: [] });
		}
		if (url.includes('/entity/ev1')) return json({ entity: { _id: 'ev1', _parent: parents } });
		return json({ entities: [] });
	});
}

function calls(stub: ReturnType<typeof vi.fn>) {
	return stub.mock.calls.map((c) => ({
		url: String(c[0]),
		method: ((c[1] as RequestInit | undefined)?.method ?? 'GET') as string,
		body: (c[1] as RequestInit | undefined)?.body
	}));
}
function postBodies(stub: ReturnType<typeof vi.fn>): Array<Array<Record<string, unknown>>> {
	return calls(stub)
		.filter((c) => c.method === 'POST')
		.map((c) => JSON.parse(String(c.body)) as Array<Record<string, unknown>>);
}
function deleteUrls(stub: ReturnType<typeof vi.fn>): string[] {
	return calls(stub)
		.filter((c) => c.method === 'DELETE')
		.map((c) => c.url);
}

describe('#304 reassignEventSeries — the atomic overwrite targets the SERIES value id', () => {
	it('one POST whose entry pairs the OLD SERIES value id with the new reference — full-shape body, zero DELETEs', async () => {
		const { reassignEventSeries } = await actions();
		const stub = wire();
		await reassignEventSeries(cfg, 'ev1', 'series2', stub as unknown as typeof fetch);

		const bodies = postBodies(stub);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toEqual([{ _id: 'pv-series', type: '_parent', reference: 'series2' }]);
		expect(deleteUrls(stub)).toEqual([]);
	});

	it('reads `_parent` BEFORE writing (the overwrite entry cannot be built blind)', async () => {
		const { reassignEventSeries } = await actions();
		const stub = wire();
		await reassignEventSeries(cfg, 'ev1', 'series2', stub as unknown as typeof fetch);
		const seq = calls(stub);
		const getIdx = seq.findIndex((c) => c.method === 'GET' && c.url.includes('/entity/ev1'));
		const postIdx = seq.findIndex((c) => c.method === 'POST' && c.url.includes('/entity/ev1'));
		expect(getIdx).toBeGreaterThanOrEqual(0);
		expect(postIdx).toBeGreaterThan(getIdx);
		expect(seq[getIdx].url).toContain('_parent');
	});

	it('a STANDALONE event (no series value) gets a plain append — no `_id` key at all, zero DELETEs', async () => {
		const { reassignEventSeries } = await actions();
		const stub = wire(PARENTS_STANDALONE);
		await reassignEventSeries(cfg, 'ev1', 'series2', stub as unknown as typeof fetch);
		const bodies = postBodies(stub);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toEqual([{ type: '_parent', reference: 'series2' }]);
		expect(deleteUrls(stub)).toEqual([]);
	});

	it('the SEASON `_parent` value id never appears in any write — either direction', async () => {
		const { reassignEventSeries, unassignEventSeries } = await actions();
		const reassignStub = wire();
		await reassignEventSeries(cfg, 'ev1', 'series2', reassignStub as unknown as typeof fetch);
		const unassignStub = wire();
		await unassignEventSeries(cfg, 'ev1', unassignStub as unknown as typeof fetch);

		for (const stub of [reassignStub, unassignStub]) {
			const writes = calls(stub).filter((c) => c.method !== 'GET');
			expect(writes.some((c) => c.url.includes('pv-season'))).toBe(false);
			expect(writes.some((c) => String(c.body ?? '').includes('pv-season'))).toBe(false);
			expect(writes.some((c) => c.url.includes('pv-org'))).toBe(false);
			expect(writes.some((c) => String(c.body ?? '').includes('pv-org'))).toBe(false);
		}
	});

	it('a non-2xx POST rejects — fail loud, no silent success', async () => {
		const { reassignEventSeries } = await actions();
		const stub = wire(PARENTS, { failPosts: true });
		await expect(
			reassignEventSeries(cfg, 'ev1', 'series2', stub as unknown as typeof fetch)
		).rejects.toThrow();
	});
});

describe('#304 unassignEventSeries — DELETE of the series value id alone (the owner-gated half)', () => {
	it('one DELETE /property/{series value id}; no POST; season value untouched', async () => {
		const { unassignEventSeries } = await actions();
		const stub = wire();
		await unassignEventSeries(cfg, 'ev1', stub as unknown as typeof fetch);

		const dels = deleteUrls(stub);
		expect(dels).toHaveLength(1);
		expect(dels[0]).toContain('/property/pv-series');
		expect(postBodies(stub)).toEqual([]);
	});

	it('no series parent → throws EventSeriesMissingError (stale picker), ZERO writes', async () => {
		const { unassignEventSeries } = await actions();
		const stub = wire(PARENTS_STANDALONE);
		await expect(
			unassignEventSeries(cfg, 'ev1', stub as unknown as typeof fetch)
		).rejects.toMatchObject({ name: 'EventSeriesMissingError' });
		expect(calls(stub).filter((c) => c.method !== 'GET')).toEqual([]);
	});

	it('a non-2xx DELETE rejects — the 403 an owner-gated refusal answers must surface, never read as success', async () => {
		const { unassignEventSeries } = await actions();
		const stub = wire(PARENTS, { failDeletes: true });
		await expect(unassignEventSeries(cfg, 'ev1', stub as unknown as typeof fetch)).rejects.toThrow();
	});
});

describe('#304 — no silent copying of series values onto the event', () => {
	it('neither direction ever writes name / duration_minutes / location / description — `_parent` is the ONLY prop on the wire', async () => {
		const { reassignEventSeries, unassignEventSeries } = await actions();
		const reassignStub = wire();
		await reassignEventSeries(cfg, 'ev1', 'series2', reassignStub as unknown as typeof fetch);
		const unassignStub = wire();
		await unassignEventSeries(cfg, 'ev1', unassignStub as unknown as typeof fetch);

		const allEntries = [...postBodies(reassignStub), ...postBodies(unassignStub)].flat();
		expect(allEntries.length).toBeGreaterThan(0);
		for (const entry of allEntries) {
			expect(entry.type).toBe('_parent');
		}
	});
});

// (*MVOX:Tallis* — #304 RED: event↔series write layer)
