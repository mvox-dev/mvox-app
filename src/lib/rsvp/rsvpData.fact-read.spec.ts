// #329 RED — the scoped one-row FACT read for a singer's own rsvp on ONE event.
//
// The ruling (issue #329, from #321's residual): a negative derived from a
// truncated read is not a fact — get the fact or say you don't have it, never
// print the negative. The event page derived "not answered" from the
// person-LIFETIME `listMyRsvps` read (limit=500, reachable cap): an answer
// past the cap rendered "not answered" for an event she DID answer.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/lib/rsvp/rsvpData.ts
//     export async function findMyRsvpForEvent(
//       cfg: EntuCfg,
//       personId: string,
//       eventId: string,
//       fetchImpl?: typeof fetch
//     ): Promise<{ rsvpId: string; status: RsvpStatus } | null>;
//
//   Wire shape — the `findMyMemberId` precedent (rsvpData.ts:45-51): ONE
//   scoped query, `limit=1` an ample explicit bound (a singer has at most one
//   rsvp per event by construction — the agenda's own map keys on eventId):
//
//     entity?_type.string=rsvp&_parent.reference=<personId>
//       &event.reference=<eventId>&props=status&limit=1
//
//   `null` means CONFIRMED no answer (the scoped read cannot truncate an
//   answer away — the row either comes back or does not exist). A FAILED read
//   throws — it must never collapse into null, which would be exactly the
//   fabricated negative this issue removes.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { findMyRsvpForEvent } from './rsvpData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('findMyRsvpForEvent — the scoped one-row fact read (#329)', () => {
	it('issues EXACTLY the scoped query — full wire shape, findMyMemberId precedent', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ entities: [{ _id: 'rsvp-77', status: [{ string: 'going' }] }] }));
		await findMyRsvpForEvent(cfg, 'p-viewer', 'ev1', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		// Full-query toEqual, never toContain fragments — partial assertions hide
		// bugs (a stray extra filter or a missing limit would slip a contains).
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

// (*MVOX:Tallis* — #329 RED)
