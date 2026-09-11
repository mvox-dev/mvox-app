// #321 RED — truncation detection for `listMyRsvps`, the person-LIFETIME rsvp
// read (`_parent.reference={personId}&limit=500`, no season boundary). A
// weekly-rehearsal member of ten years reaches 500 real rows (research-321
// inv finding: 50/yr × 10yr) — this is a class-(2) reachable bound.
//
// Same contract as libraryData.truncation.spec.ts (the module-level pin):
// `{ items, total, truncated }`, `truncated` = server `count` > RAW
// entities.length on the SAME single request; `entities.length === limit` is
// probe-proven unusable and never consulted. Query string unchanged (no cap
// raise, no skip=).
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyRsvps } from './rsvpData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('listMyRsvps — count-based truncation detection (#321)', () => {
	it('count > entities.length → truncated, full shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 503,
				entities: [
					{ _id: 'rsvp-1', event: [{ reference: 'event-1' }], status: [{ string: 'going' }] },
					{ _id: 'rsvp-2', event: [{ reference: 'event-2' }], status: [{ string: 'maybe' }] }
				]
			})
		);
		expect(await listMyRsvps(cfg, 'person-1', fetchImpl)).toEqual({
			items: [
				{ rsvpId: 'rsvp-1', eventId: 'event-1', status: 'going' },
				{ rsvpId: 'rsvp-2', eventId: 'event-2', status: 'maybe' }
			],
			total: 503,
			truncated: true
		});
		// One request, unchanged query — detection never costs a second read.
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=rsvp');
		expect(url).toContain('_parent.reference=person-1');
		expect(url).toContain('limit=500');
		expect(url).not.toContain('skip=');
	});

	it('count === entities.length → complete', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				count: 1,
				entities: [{ _id: 'rsvp-1', event: [{ reference: 'event-1' }], status: [{ string: 'going' }] }]
			})
		);
		expect(await listMyRsvps(cfg, 'person-1', fetchImpl)).toEqual({
			items: [{ rsvpId: 'rsvp-1', eventId: 'event-1', status: 'going' }],
			total: 1,
			truncated: false
		});
	});

	it('FALSE-POSITIVE PIN: exactly 500 rows with count 500 is NOT truncated (at-cap ≠ beyond-cap)', async () => {
		const entities = Array.from({ length: 500 }, (_, i) => ({
			_id: `rsvp-${i}`,
			event: [{ reference: `event-${i}` }],
			status: [{ string: 'going' }]
		}));
		const fetchImpl = vi.fn().mockResolvedValue(json({ count: 500, entities }));
		const res = (await listMyRsvps(cfg, 'person-1', fetchImpl)) as unknown as {
			items: unknown[];
			total: number;
			truncated: boolean;
		};
		expect(res.truncated).toBe(false);
		expect(res.total).toBe(500);
		expect(res.items).toHaveLength(500);
	});

	it('a body without count reads as complete (legacy mock shape)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ _id: 'rsvp-1', event: [{ reference: 'event-1' }], status: [{ string: 'late' }] }] })
		);
		expect(await listMyRsvps(cfg, 'person-1', fetchImpl)).toEqual({
			items: [{ rsvpId: 'rsvp-1', eventId: 'event-1', status: 'late' }],
			total: 1,
			truncated: false
		});
	});
});

// (*MVOX:Tallis* — RED spec, #321)
