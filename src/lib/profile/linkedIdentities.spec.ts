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
//               pendingInvites: number }>

import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listLinkedIdentities } from './linkedIdentities';

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt-me' };
const PERSON_ID = 'person-me';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function fetchReturning(body: unknown, status = 200) {
	return vi.fn().mockResolvedValue(json(body, status));
}

describe('listLinkedIdentities — wire shape', () => {
	it('reads the OWN person entity, props=entu_user, under the caller\'s own JWT', async () => {
		const fetchImpl = fetchReturning({ entity: { _id: PERSON_ID, entu_user: [] } });

		await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit?];
		expect(String(url)).toContain('/polyphony/entity/person-me?props=entu_user');
		expect((init?.method ?? 'GET')).toBe('GET');
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-me');
	});
});

describe('listLinkedIdentities — bound identities vs masked placeholders', () => {
	it('returns bound entries in full and counts masked invite placeholders SEPARATELY — full shape', async () => {
		const fetchImpl = fetchReturning({
			entity: {
				_id: PERSON_ID,
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
			pendingInvites: 1
		});
	});

	it('a person with no entu_user property at all yields the empty full shape', async () => {
		const fetchImpl = fetchReturning({ entity: { _id: PERSON_ID } });

		const result = await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(result).toEqual({ identities: [], pendingInvites: 0 });
	});
});

describe('listLinkedIdentities — fail loud (no silent empty list)', () => {
	it('an HTTP failure REJECTS with a named error — it never resolves to an empty list', async () => {
		const fetchImpl = fetchReturning({ error: 'boom' }, 500);

		await expect(listLinkedIdentities(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(/HTTP 500/);
	});
});

// (*MVOX:Tallis* — #193 RED: linked-identities display producer)
