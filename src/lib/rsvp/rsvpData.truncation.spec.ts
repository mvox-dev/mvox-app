// listMyRsvps flags a truncated lifetime read from the server count.
import { describe, expect, it, vi } from 'vitest';
import { listMyRsvps } from './rsvpData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

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
		const res = await listMyRsvps(cfg, 'person-1', fetchImpl);
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

// (*MVOX:Tallis*)
