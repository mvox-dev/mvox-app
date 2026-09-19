// #400 RED — the series list read carries each series' OWN `_owner` grant.
//
// WHY (issue #400, epic #362 rules 1-2): the series-delete button used to
// render behind the SEASON's rights gate while Entu's entity DELETE checks
// `_owner` on the TARGET — the series itself ("Only _owner users can delete an
// entity", entu-www overview/entities). The mismatch produced a foreseeable
// sometimes-403 the app already carried a `forbidden` fallback for. The fix
// starts on the wire: `listEventSeriesForSeason` asks Entu for the series'
// `_owner` alongside `name`, and `SeriesListItem` carries the refs as
// `ownerIds` so the panel can render the delete trigger only when the grant on
// the entity the write targets is in hand.
//
// Pinned contract (GREEN must implement):
//   - the series-list query asks props=name,_owner (optionally `_editor` too —
//     it rides the same read for free; nothing beyond that) on the EXACT URL
//     the function always used;
//   - `SeriesListItem` gains `ownerIds: string[]` — the series' `_owner`
//     values' `.reference` ONLY. NEVER `.string` (ER-26: reference strings
//     bake PII; ids-only extraction strips them);
//   - `_owner` ABSENT (the private bucket withheld — caller holds no grant on
//     that series) → `ownerIds: []`, the same shape as "no owners": both mean
//     "grant not in hand" and must fail closed;
//   - a malformed `_owner` value without `reference` contributes nothing.
//
// Same `fetchImpl`-seam harness family as seasonManage.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { listEventSeriesForSeason } from './seasonManage';
import type { EntuCfg } from './entuSeasons';

const cfg: EntuCfg = { db: 'sampledb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

type Call = { url: string; method: string };

function recordingFetch(route: (url: string) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const u = String(url);
		calls.push({ url: u, method: init?.method ?? 'GET' });
		return route(u);
	});
	return { impl: impl as unknown as typeof fetch, calls };
}

// Series as Entu returns them WITH the private-bucket rights props in view:
//   - s1: the caller sees two owners (refs + the denormalized display strings
//     Entu always sends — the strings must NOT survive extraction, ER-26);
//   - s2: `_owner` absent — private bucket withheld, caller holds no grant;
//   - s3: one well-formed owner plus one malformed value with no reference.
const seriesEntities = [
	{
		_id: 's1',
		name: [{ string: 'Monday rehearsals' }],
		_owner: [
			{ reference: 'person-a', string: 'Alice Owner' },
			{ reference: 'person-b', string: 'Bob Owner' }
		]
	},
	{ _id: 's2', name: [{ string: 'Sectionals' }] },
	{
		_id: 's3',
		name: [{ string: 'Concert week' }],
		_owner: [{ reference: 'person-c', string: 'Carol Owner' }, { string: 'no-ref junk' }]
	}
];

const seasonEvents = [
	{
		_id: 'e1',
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 's1', entity_type: 'event_series' }
		]
	}
];

function route(url: string): Response {
	if (url.includes('_type.string=event_series')) return json({ entities: seriesEntities });
	return json({ entities: seasonEvents });
}

describe('#400 — listEventSeriesForSeason reads each series’ own _owner', () => {
	it('asks Entu for the series’ _owner alongside name — the FULL series-list URL, pinned', async () => {
		const { impl, calls } = recordingFetch(route);
		await listEventSeriesForSeason(cfg, 'season1', impl);

		const seriesCall = calls.find((c) => c.url.includes('_type.string=event_series'));
		expect(seriesCall).toBeDefined();
		// The exact URL, whole: same query as ever, widened by `_owner` (with
		// `_editor` allowed to ride along — same read, zero extra cost; nothing
		// else may creep in).
		expect(seriesCall!.url).toMatch(
			/^https:\/\/api\.entu-test\.invalid\/sampledb\/entity\?_type\.string=event_series&_parent\.reference=season1&props=name,_owner(,_editor)?&limit=200$/
		);
	});

	it('SeriesListItem carries ownerIds — ids only from _owner[].reference, never the .string (ER-26); absent _owner → [], a no-reference value contributes nothing', async () => {
		const { impl } = recordingFetch(route);
		const result = await listEventSeriesForSeason(cfg, 'season1', impl);

		const byId = [...result.items].sort((a, b) => a.id.localeCompare(b.id));
		// FULL shape (partial assertions hide bugs — house rule): `toEqual`
		// guarantees no ownerNames / baked `.string` field rides along.
		expect(byId).toEqual([
			{ id: 's1', name: 'Monday rehearsals', eventCount: 1, ownerIds: ['person-a', 'person-b'] },
			{ id: 's2', name: 'Sectionals', eventCount: 0, ownerIds: [] },
			{ id: 's3', name: 'Concert week', eventCount: 0, ownerIds: ['person-c'] }
		]);
		// Belt and braces on ER-26: the denormalized display strings appear
		// NOWHERE in the returned structure.
		const flat = JSON.stringify(result);
		expect(flat).not.toContain('Alice Owner');
		expect(flat).not.toContain('Bob Owner');
		expect(flat).not.toContain('Carol Owner');
	});
});

// (*MVOX:Tallis* — #400 RED)
