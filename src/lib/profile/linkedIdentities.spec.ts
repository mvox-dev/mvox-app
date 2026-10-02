// The profile page's linked-identities read from the person's own entu_user values.
import { describe, expect, it, vi } from 'vitest';
import { listLinkedIdentities } from './linkedIdentities';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb', 'jwt-me');
const PERSON_ID = 'person-me';

function fetchReturning(body: unknown, status = 200) {
	return vi.fn().mockResolvedValue(json(body, status));
}

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
					{ _id: 'eu-2', uid: '38510170212', provider: 'mobile-id', email: '38510170212' },
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
		const fetchImpl = fetchReturning({ entity: { _id: PERSON_ID } });

		const result = await listLinkedIdentities(cfg, PERSON_ID, fetchImpl);

		expect(result).toEqual({ identities: [], pendingInvites: 0, readable: false });
	});

	it('an entu_user payload arriving WITHOUT the rights tell is still readable:false — the tell decides, not the payload', async () => {
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
