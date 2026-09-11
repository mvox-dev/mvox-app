// #321 RED — the seasonManage panel reads, plus the pins that keep the
// already-correct machinery UNCHANGED.
//
// The issue's own exhibit is this module's admission (above
// `countSeriesOccurrences`): the panel list "derives its counts from ONE
// season-wide `limit=500` event read, so it under-reports a big season". After
// this slice the panel's list reads carry the server `count` themselves, so
// the admission narrows — GREEN updates that comment to what is still true
// (the staleness half survives; the silent under-reporting half does not).
//
// PINNED NEW (fails today):
//   - `listEventSeriesForSeason` → { items: SeriesListItem[], truncated } —
//     truncated when EITHER of its two reads (series limit=200, season-wide
//     events limit=500) reports count > RAW entities.length. No `total`: two
//     collections ride one call, and summing them would be a made-up number.
//   - `listEventsForSeason` → { items, total, truncated } — `items` stays the
//     STANDALONE-filtered list; `truncated` compares count against the RAW
//     wire array (the series-occurrence filter must never read as truncation).
//
// PINNED UNCHANGED (passes today; guards GREEN against touching them):
//   - `countSeriesOccurrences`' one-row count read stays byte-identical —
//     the confirm's number keeps its own dedicated read (#197 F2).
//   - the cascade refuse-guards (`listChildIds` + the season-level twin via
//     `countSeasonScope`): count > length → throw "nothing was deleted". They
//     already never act on a partial list — the issue's third shape, neither
//     (1) nor (2), out of scope for change by the issue's own fence.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from './entuSeasons';
import {
	listEventSeriesForSeason,
	listEventsForSeason,
	countSeriesOccurrences,
	countSeasonScope
} from './seasonManage';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** Route fetch mock by URL substring; throws on anything unrouted. */
function router(routes: Array<[match: string, body: unknown]>) {
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		if (init?.method === 'DELETE') {
			throw new Error(`unexpected DELETE during a read-only call: ${url}`);
		}
		const hit = routes.find(([match]) => String(url).includes(match));
		if (!hit) throw new Error(`unrouted url: ${url}`);
		return Promise.resolve(json(hit[1]));
	});
}

// ── listEventSeriesForSeason — panel list read carries count ────────────────

describe('listEventSeriesForSeason — truncation detection (#321)', () => {
	const seriesRoute = '_type.string=event_series&_parent.reference=season-1';
	const eventsRoute = '_type.string=event&_parent.reference=season-1';

	it('both reads complete → { items, truncated: false }, eventCount grouping unchanged', async () => {
		const fetchImpl = router([
			[seriesRoute, { count: 1, entities: [{ _id: 'series-1', name: [{ string: 'Tuesdays' }] }] }],
			[
				eventsRoute,
				{
					count: 2,
					entities: [
						{ _id: 'ev-1', _parent: [{ reference: 'series-1', entity_type: 'event_series' }] },
						{ _id: 'ev-2', _parent: [{ reference: 'series-1', entity_type: 'event_series' }] }
					]
				}
			]
		]);
		expect(await listEventSeriesForSeason(cfg, 'season-1', fetchImpl)).toEqual({
			items: [{ id: 'series-1', name: 'Tuesdays', eventCount: 2 }],
			truncated: false
		});
	});

	it('the season-wide EVENT read truncated (count > raw length) → truncated: true — the under-reporting admission, now stated', async () => {
		const fetchImpl = router([
			[seriesRoute, { count: 1, entities: [{ _id: 'series-1', name: [{ string: 'Tuesdays' }] }] }],
			[
				eventsRoute,
				{
					count: 640,
					entities: [{ _id: 'ev-1', _parent: [{ reference: 'series-1', entity_type: 'event_series' }] }]
				}
			]
		]);
		const res = (await listEventSeriesForSeason(cfg, 'season-1', fetchImpl)) as unknown as {
			items: unknown[];
			truncated: boolean;
		};
		expect(res.truncated).toBe(true);
		expect(res.items).toEqual([{ id: 'series-1', name: 'Tuesdays', eventCount: 1 }]);
	});

	it('the SERIES read truncated → truncated: true', async () => {
		const fetchImpl = router([
			[seriesRoute, { count: 210, entities: [{ _id: 'series-1', name: [{ string: 'Tuesdays' }] }] }],
			[eventsRoute, { count: 0, entities: [] }]
		]);
		const res = (await listEventSeriesForSeason(cfg, 'season-1', fetchImpl)) as unknown as {
			truncated: boolean;
		};
		expect(res.truncated).toBe(true);
	});
});

// ── listEventsForSeason — standalone filter never reads as truncation ───────

describe('listEventsForSeason — truncation detection (#321)', () => {
	const route = '_type.string=event&_parent.reference=season-1';

	it('complete read: occurrences filtered OUT of items, but count vs RAW length says complete', async () => {
		const fetchImpl = router([
			[
				route,
				{
					count: 3,
					entities: [
						{
							_id: 'ev-1',
							name: [{ string: 'Concert' }],
							start_datetime: [{ datetime: '2026-10-01T19:00' }],
							_parent: [{ reference: 'season-1', entity_type: 'season' }]
						},
						{ _id: 'ev-2', _parent: [{ reference: 'series-1', entity_type: 'event_series' }] },
						{ _id: 'ev-3', _parent: [{ reference: 'series-1', entity_type: 'event_series' }] }
					]
				}
			]
		]);
		expect(await listEventsForSeason(cfg, 'season-1', fetchImpl)).toEqual({
			items: [{ id: 'ev-1', name: 'Concert', startDatetime: '2026-10-01T19:00' }],
			total: 3,
			truncated: false
		});
	});

	it('count > RAW length → truncated: true', async () => {
		const fetchImpl = router([
			[
				route,
				{
					count: 612,
					entities: [
						{
							_id: 'ev-1',
							name: [{ string: 'Concert' }],
							start_datetime: [{ datetime: '2026-10-01T19:00' }],
							_parent: [{ reference: 'season-1', entity_type: 'season' }]
						}
					]
				}
			]
		]);
		expect(await listEventsForSeason(cfg, 'season-1', fetchImpl)).toEqual({
			items: [{ id: 'ev-1', name: 'Concert', startDatetime: '2026-10-01T19:00' }],
			total: 612,
			truncated: true
		});
	});
});

// ── PINS: the already-correct machinery stays byte-identical ────────────────

describe('countSeriesOccurrences — the confirm keeps its OWN one-row count read (#197 F2, pinned by #321)', () => {
	it('issues exactly the dedicated count query and returns the server count', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ count: 613, entities: [{ _id: 'ev-1' }] }));
		expect(await countSeriesOccurrences(cfg, 'series-1', fetchImpl)).toBe(613);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		// Byte-identical query: _id-only projection, limit=1, server count consumed.
		expect(url).toContain('entity?_type.string=event&_parent.reference=series-1&props=_id&limit=1');
	});

	it('falls back to entities.length when count is absent (unchanged)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'ev-1' }] }));
		expect(await countSeriesOccurrences(cfg, 'series-1', fetchImpl)).toBe(1);
	});
});

describe('cascade refuse-guards — count > length still THROWS, nothing deleted (pinned UNCHANGED)', () => {
	it('countSeasonScope refuses when a child read reports more rows than the capped read carried', async () => {
		const fetchImpl = router([
			[
				'_type.string=event_series&_parent.reference=season-1',
				{ count: 600, entities: [{ _id: 'series-1' }, { _id: 'series-2' }] }
			],
			['_type.string=event&_parent.reference=season-1', { count: 0, entities: [] }],
			['_type.string=repertoire_item&_parent.reference=season-1', { count: 0, entities: [] }]
		]);
		await expect(countSeasonScope(cfg, 'season-1', fetchImpl)).rejects.toThrow(
			/more than the 500-row cascade read can carry — nothing was deleted/
		);
	});

	it('countSeasonScope with complete reads still answers the three counts (happy path unchanged)', async () => {
		const fetchImpl = router([
			[
				'_type.string=event_series&_parent.reference=season-1',
				{ count: 1, entities: [{ _id: 'series-1' }] }
			],
			[
				'_type.string=event&_parent.reference=season-1',
				{
					count: 2,
					entities: [
						{ _id: 'ev-1', _parent: [{ reference: 'series-1', entity_type: 'event_series' }] },
						{ _id: 'ev-2', _parent: [{ reference: 'season-1', entity_type: 'season' }] }
					]
				}
			],
			[
				'_type.string=repertoire_item&_parent.reference=season-1',
				{ count: 1, entities: [{ _id: 'rep-1' }] }
			]
		]);
		expect(await countSeasonScope(cfg, 'season-1', fetchImpl)).toEqual({
			series: 1,
			events: 2,
			repertoireItems: 1
		});
	});
});

// (*MVOX:Tallis* — RED spec, #321)
