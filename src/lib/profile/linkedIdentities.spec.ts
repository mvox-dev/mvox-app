// #193 RED — linked-identities read for the profile page.
//
// Display source per the SPIKE (2026-09-01, live-probed): the person entity's
// OWN `entu_user` array, read with the user's plain JWT —
// GET /{db}/entity/{personId}?props=entu_user. The prop-def is `_sharing:
// private`, and the user's self-`_editor` puts them in their own access set
// (entu-api utils/entity.js:575, utils/rights.js:84-93), so bound entries come
// back in full: {_id, uid, provider, email}. Un-redeemed invite placeholders
// come back MASKED as {_id, invite: '***'} (utils/entity.js:594-598) — they are
// NOT identities and must never be presented as one.
//
// This deliberately REPLACES the current profile identity display, which lies:
// it derives from getLastProvider() (localStorage — whichever provider was used
// for THIS login) instead of the person's actual bound identities.
//
// Contract under test (GREEN implements exactly this, in a NEW module —
// src/lib/profile/linkedIdentities.ts — which needs a MINT_EXEMPT entry in
// singleInviteMechanism.spec.ts because it READS the `entu_user` property
// without being a mint mechanism):
//   listLinkedIdentities(cfg, personId, fetchImpl?):
//     Promise<{ identities: Array<{ _id: string; uid: string; provider: string; email: string }>;
//               pendingInvites: number; readable: boolean }>
//
// #454 added `readable` and the `_viewer` half of the projection. A caller Entu
// refuses does NOT get an error status: `person` entities are `_sharing:
// domain` and the `entu_user` prop-def is `_sharing: private`, so a grant-less
// in-db reader gets HTTP 200 with the property filtered out (entu-api
// utils/entity.js:569-586 picks ONE bucket by tier). Rights-tier arrays live
// only in the private bucket, so `_viewer` returning is the tell that the
// bucket carrying `entu_user` returned too — see THE WITHHELD-BUCKET TELL in
// the module for the full source citation, including why `_viewer` and not
// `_owner`.

import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listLinkedIdentities } from './linkedIdentities';

const cfg: EntuCfg = { db: 'sampledb', token: 'jwt-me' };
const PERSON_ID = 'person-me';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function fetchReturning(body: unknown, status = 200) {
	return vi.fn().mockResolvedValue(json(body, status));
}

// A grant that admits the caller to the private bucket. Only its PRESENCE is
// read; the `.string` a live row carries (grantee name + email, ER-26) is
// deliberately not modelled, because nothing may retain it.
const ADMITTED = [{ _id: 'gr-1', reference: 'person-me', property_type: '_editor' }];

describe('listLinkedIdentities — wire shape', () => {
	it("reads the OWN person entity under the caller's own JWT, asking for entu_user AND the _viewer tell", async () => {
		const fetchImpl = fetchReturning({
			entity: { _id: PERSON_ID, entu_user: [], _viewer: ADMITTED }
		});

		await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit?];
		expect(String(url)).toContain('/sampledb/entity/person-me?props=entu_user,_viewer');
		expect((init?.method ?? 'GET')).toBe('GET');
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-me');
	});
});

describe('listLinkedIdentities — bound identities vs masked placeholders', () => {
	it('returns bound entries in full and counts masked invite placeholders SEPARATELY — full shape', async () => {
		const fetchImpl = fetchReturning({
			entity: {
				_id: PERSON_ID,
				_viewer: ADMITTED,
				entu_user: [
					{ _id: 'eu-1', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' },
					// Live-probed mobile-id shape: the national ID code rides BOTH uid and
					// email — `email` is NOT guaranteed to be an email address.
					{ _id: 'eu-2', uid: '38510170212', provider: 'mobile-id', email: '38510170212' },
					// An un-redeemed placeholder — masked, NOT an identity.
					{ _id: 'eu-3', invite: '***' }
				]
			}
		});

		const result = await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(result).toEqual({
			identities: [
				{ _id: 'eu-1', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' },
				{ _id: 'eu-2', uid: '38510170212', provider: 'mobile-id', email: '38510170212' }
			],
			pendingInvites: 1,
			readable: true,
			// #467 — the placeholder's own value _id, surfaced for the roster's
			// dated join read (listJoinStateDetails) to follow up on.
			pendingInviteId: 'eu-3'
		});
	});

	it('a person the caller CAN read, carrying no entu_user property at all, yields the empty full shape — readable, just empty', async () => {
		const fetchImpl = fetchReturning({ entity: { _id: PERSON_ID, _viewer: ADMITTED } });

		const result = await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(result).toEqual({ identities: [], pendingInvites: 0, readable: true });
	});
});

describe('listLinkedIdentities — the WITHHELD private bucket is not an observation (#454)', () => {
	it('HTTP 200 with NO rights property is readable:false, never an empty identity list dressed as fact', async () => {
		// The exact wire answer a grant-less in-db reader gets for a
		// `_sharing: domain` person: 200, `{ entity: { _id } }`, the private
		// bucket (and with it `entu_user` AND `_viewer`) filtered out. Nothing
		// here is an error to catch.
		const fetchImpl = fetchReturning({ entity: { _id: PERSON_ID } });

		const result = await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(result).toEqual({ identities: [], pendingInvites: 0, readable: false });
	});

	it('an entu_user payload arriving WITHOUT the rights tell is still readable:false — the tell decides, not the payload', async () => {
		// Defensive: `entu_user` cannot reach a caller the private bucket was
		// withheld from, so this shape should never occur on the wire. Pinned so
		// the classifier can never be "trust whatever came back".
		const fetchImpl = fetchReturning({
			entity: { _id: PERSON_ID, entu_user: [{ _id: 'eu-1', uid: 'u', provider: 'p', email: 'e' }] }
		});

		const result = await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(result).toEqual({ identities: [], pendingInvites: 0, readable: false });
	});

	it('an EMPTY _viewer array counts as withheld — the array is deleted when empty (entu-api utils/aggregate.js:230-253), so it is never a legitimate admitted answer', async () => {
		const fetchImpl = fetchReturning({ entity: { _id: PERSON_ID, _viewer: [] } });

		const result = await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(result.readable).toBe(false);
	});
});

describe('listLinkedIdentities — fail loud (no silent empty list)', () => {
	it('an HTTP failure REJECTS with a named error — it never resolves to an empty list', async () => {
		const fetchImpl = fetchReturning({ error: 'boom' }, 500);

		await expect(listLinkedIdentities(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(/HTTP 500/);
	});
});

// (*MVOX:Tallis* — #193 RED: linked-identities display producer)
// (*MVOX:Josquin* — #454: the withheld-bucket refusal shape)
