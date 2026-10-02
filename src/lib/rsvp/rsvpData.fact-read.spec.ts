// The scoped one-row read of a singer's own RSVP on one event.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { findMyRsvpForEvent } from './rsvpData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

describe('findMyRsvpForEvent — the scoped one-row fact read (#329)', () => {
	it('issues EXACTLY the scoped query — full wire shape, findMyMemberId precedent', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ entities: [{ _id: 'rsvp-77', status: [{ string: 'going' }] }] }));
		await findMyRsvpForEvent(cfg, 'p-viewer', 'ev1', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url.split('?')[1]).toBe(
			'_type.string=rsvp&_parent.reference=p-viewer&event.reference=ev1&props=status&limit=1'
		);
		expect(url).toContain('/testdb/entity?');
	});

	it('encodeURIComponent on BOTH ids — same hygiene as every other rsvpData query', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await findMyRsvpForEvent(cfg, 'person p', 'ev 1', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain(`_parent.reference=${encodeURIComponent('person p')}`);
		expect(url).toContain(`event.reference=${encodeURIComponent('ev 1')}`);
		expect(url).not.toContain('_parent.reference=person p');
	});

	it('answer exists → the full { rsvpId, status } shape (toEqual, not objectContaining)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json({ entities: [{ _id: 'rsvp-77', status: [{ string: 'maybe' }] }] })
			);
		const result = await findMyRsvpForEvent(cfg, 'p-viewer', 'ev1', fetchImpl);
		expect(result).toEqual({ rsvpId: 'rsvp-77', status: 'maybe' });
	});

	it('genuinely no answer → null (the scoped read CONFIRMS absence — no cap to fall past)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		const result = await findMyRsvpForEvent(cfg, 'p-viewer', 'ev1', fetchImpl);
		expect(result).toBeNull();
	});

	it('a missing status value defaults to going — listMyRsvps parity, one mapping rule', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'rsvp-9' }] }));
		const result = await findMyRsvpForEvent(cfg, 'p-viewer', 'ev1', fetchImpl);
		expect(result).toEqual({ rsvpId: 'rsvp-9', status: 'going' });
	});

	it('a FAILED read throws — never null, which would fabricate the negative this issue removes', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(findMyRsvpForEvent(cfg, 'p-viewer', 'ev1', fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis*)
