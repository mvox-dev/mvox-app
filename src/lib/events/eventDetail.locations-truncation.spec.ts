// #321 RED — truncation detection for `listEventLocations`, the
// collective-LIFETIME location-suggestion corpus (`_type.string=event&
// props=location&limit=1000`, no season/date scope — grows with every event
// ever created, research-321 inv finding).
//
// This read renders NO list: its class-(2) surface treatment (what the
// autocomplete's completeness claim becomes once the corpus is known partial)
// is a design decision the GREEN change states at the call site — NOT pinned
// here. What IS pinned is the detection fact the decision needs:
//
//   { items: string[]; total: number; truncated: boolean }
//
//   - `items` stays the deduplicated, blank-dropped suggestion corpus;
//   - `truncated` = server `count` > RAW entities.length — RAW, because
//     dedup/blank-dropping shrink `items` without any row being missing from
//     the wire (the false-positive this file exists to forbid);
//   - one request, query string unchanged.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listEventLocations } from './eventDetail';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('listEventLocations — count-based truncation detection (#321)', () => {
	it('dedup + blank-dropping do NOT fabricate a truncation: count compares against RAW entities.length', async () => {
		// 4 wire rows, count 4 — complete. Two share a location and one is blank,
		// so items has 2. Comparing count against items.length would lie.
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 4,
				entities: [
					{ location: [{ string: 'St Mary’s Church' }] },
					{ location: [{ string: 'St Mary’s Church' }] },
					{ location: [{ string: 'Town Hall' }] },
					{ location: [] }
				]
			})
		);
		expect(await listEventLocations(cfg, fetchImpl)).toEqual({
			items: ['St Mary’s Church', 'Town Hall'],
			total: 4,
			truncated: false
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=event');
		expect(url).toContain('props=location');
		expect(url).toContain('limit=1000');
		expect(url).not.toContain('skip=');
	});

	it('count > entities.length → the corpus is a partial sample: truncated true', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 1500,
				entities: [{ location: [{ string: 'Town Hall' }] }, { location: [{ string: 'Rehearsal room' }] }]
			})
		);
		expect(await listEventLocations(cfg, fetchImpl)).toEqual({
			items: ['Town Hall', 'Rehearsal room'],
			total: 1500,
			truncated: true
		});
	});

	it('a body without count reads as complete', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ location: [{ string: 'Town Hall' }] }] })
		);
		expect(await listEventLocations(cfg, fetchImpl)).toEqual({
			items: ['Town Hall'],
			total: 1,
			truncated: false
		});
	});
});

// (*MVOX:Tallis* — RED spec, #321)
