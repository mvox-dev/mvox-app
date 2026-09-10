// #304 RED — the event ↔ series reassign/unassign write layer, at the
// `fetchImpl` seam (same harness family as seasonManage.delete.spec.ts /
// sectionActions' unassign tests).
//
// THE WIRE HAZARD THIS FILE EXISTS FOR: an event's `_parent` holds BOTH its
// season and its series under ONE property name, told apart only by each
// value's `entity_type`. Any helper that blanket-replaces `_parent` or pairs
// "the first existing value" with the new reference (replaceEntityProperty's
// idiom — written for single-purpose props, its own module doc says so) can
// overwrite the SEASON: ordering on the wire is not guaranteed. Both writes
// here must target the SERIES `_parent` VALUE ID exactly, and the season's
// value id must never appear in any write, either direction.
//
// RIGHTS (settled live on polyphony, #304 SPIKE — seed-results ledger
// probe-304-parent-rights-gate-live-2026-09-10T05-11-52-413Z.json):
//   - REASSIGN — the house atomic-overwrite primitive (#264: ONE POST whose
//     entry carries the old series value's `_id` + the new reference) is
//     EDITOR-reachable (editor POST with rights on the referenced series
//     → 200, step B2).
//   - UNASSIGN — DELETE of the `_parent` value id is OWNER-gated (editor
//     DELETE → 403 "User not in _owner property", step A; the same editor
//     deleted a PLAIN property value fine, step A2; the owner deleted the
//     `_parent` value fine, step A3). The UI half of that asymmetry (option
//     absent below owner tier + rights-note, per Gama's ruling comment
//     5613471404) is pinned in page.series-picker.spec.ts; THIS file pins
//     only the wire shapes.
//
// CONTRACT under test (defined HERE, implemented in GREEN):
//
//   src/lib/events/eventSeriesActions.ts (new)
//     export class EventSeriesMissingError extends Error   // name pinned below
//     export async function reassignEventSeries(
//       cfg: { db: string; token: string },
//       eventId: string,
//       newSeriesId: string,
//       fetchImpl?: typeof fetch
//     ): Promise<void>;
//       GET entity/{eventId}?props=_parent → find the value with
//       entity_type === 'event_series' →
//         - one exists → POST entity/{eventId}, body EXACTLY
//           [{ _id: <that value's id>, type: '_parent', reference: newSeriesId }]
//           (the atomic overwrite — reparentSection's pairing idiom, FILTERED
//           by entity_type first, never "first value" blind);
//         - none exists (standalone event) → POST body EXACTLY
//           [{ type: '_parent', reference: newSeriesId }] (plain append — the
//           verified link-event shape, eventConvert.ts:310-329).
//       ZERO property DELETEs on either path.
//     export async function unassignEventSeries(
//       cfg: { db: string; token: string },
//       eventId: string,
//       fetchImpl?: typeof fetch
//     ): Promise<void>;
//       GET entity/{eventId}?props=_parent → the event_series value(s) →
//       DELETE /property/{valueId} for each (unassignMemberSection's idiom);
//       ZERO matches → throw EventSeriesMissingError, ZERO writes. No POST.
//   Non-2xx anywhere → throw (fail loud, no silent success).
//
// NO SILENT COPYING (#304 "What not to do"): neither function ever writes
// name / duration_minutes / location / description — the parent reference is
// the ONLY thing on the wire. Pinned explicitly below.
//
// Namespace dynamic import + runtime lookup so each test fails readably while
// the module is absent (seasonManage.delete.spec.ts's posture).
import { describe, expect, it, vi } from 'vitest';

const cfg = { db: 'polyphony', token: 'jwt' };

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

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

// The exact live wire shape the SPIKE's fixture read back: season and series
// side by side under `_parent`, each value carrying its own `_id`.
const PARENTS = [
	{ _id: 'pv-org', reference: 'org1', property_type: '_parent', entity_type: 'organization' },
	{ _id: 'pv-season', reference: 'season1', property_type: '_parent', entity_type: 'season' },
	{ _id: 'pv-series', reference: 'series1', property_type: '_parent', entity_type: 'event_series' }
];
/** A standalone event: season parent only, no series value. */
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
		// Full-shape toEqual: exactly ONE entry, pairing pv-series (never
		// pv-season, never "the first _parent value") with the new reference.
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
		// toEqual pins the ABSENCE of `_id`: an append that carried a stale or
		// season `_id` would be an overwrite of the wrong value.
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
			// The org parent is equally untouchable.
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
		// PROPERTY endpoint with the VALUE id — never `entity/` (endpoint-split
		// discipline), never the season's value id.
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
