// src/lib/nav/adminStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { adminStore, resetAdmin, resolveAdmin } from './adminStore';

// TU.1/#109 review — `resolveAdmin` evaluates rights on the PERSON'S OWN
// collective org (resolved from her active member row's `_parent`), read by id.
// The old `entity?_type.string=organization&limit=1` shape live-verifiably
// answered with the UMBRELLA FEDERATION (probe-67: count 6, all `_sharing:
// domain`), so the nav gate judged the wrong org for everyone.

const cfg = { db: 'polyphony', token: 'test-token' };
const personId = 'person-123';
const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_UMBRELLA = '69c7f8718489bfcb0e81b05a';

function json(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body)
	} as unknown as Response;
}

/** Routed mock: the member lookup, then the org GET by id. */
function mockFetch(opts: {
	member?: unknown;
	memberStatus?: number;
	orgById?: Record<string, unknown>;
	orgStatus?: number;
}) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=member')) {
			return Promise.resolve(
				json(opts.member ?? { entities: [], count: 0 }, opts.memberStatus ?? 200)
			);
		}
		// entity/<id>?props=_owner,_editor
		const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
		return Promise.resolve(
			json({ entity: opts.orgById?.[id] ?? undefined }, opts.orgStatus ?? 200)
		);
	}) as unknown as typeof fetch;
}

/** An active member row parented to `orgId` (plus a section parent, live shape). */
function memberBody(orgId: string | null) {
	return {
		entities: [
			{
				_id: 'm-1',
				_parent: [
					{ reference: 'sec-sop', entity_type: 'section' },
					...(orgId ? [{ reference: orgId, entity_type: 'organization' }] : [])
				]
			}
		],
		count: 1
	};
}

describe('resolveAdmin', () => {
	beforeEach(() => {
		resetAdmin();
	});

	it('returns admin when personId is in the OWN org _owner', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			orgById: { [ORG_EFK]: { _id: ORG_EFK, _owner: [{ reference: personId }] } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('admin');
	});

	it('returns admin when personId is in the OWN org _editor', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			orgById: { [ORG_EFK]: { _id: ORG_EFK, _editor: [{ reference: personId }] } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('admin');
	});

	it('reads rights off the member\'s OWN org by id — an umbrella-federation grant does NOT make her an admin here', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			orgById: {
				// Rights on the umbrella (what `limit=1` used to return) — irrelevant.
				[ORG_UMBRELLA]: { _id: ORG_UMBRELLA, _owner: [{ reference: personId }] },
				[ORG_EFK]: { _id: ORG_EFK, _owner: [{ reference: 'someone-else' }] }
			}
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('not-admin');

		const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
			String(c[0])
		);
		expect(urls.some((u) => u.includes(`/entity/${ORG_EFK}?props=_owner,_editor`))).toBe(true);
		expect(urls.some((u) => u.includes('_type.string=organization'))).toBe(false);
	});

	it("returns admin for an EFK rights-holder who holds NOTHING on the umbrella (the case the limit=1 gate wrongly refused)", async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			orgById: {
				[ORG_UMBRELLA]: { _id: ORG_UMBRELLA },
				[ORG_EFK]: { _id: ORG_EFK, _editor: [{ reference: personId }] }
			}
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('admin');
	});

	it('returns not-admin when personId is absent from the own org _owner and _editor', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			orgById: { [ORG_EFK]: { _id: ORG_EFK, _owner: [{ reference: 'other' }] } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('not-admin');
	});

	it('returns not-admin when _owner and _editor are absent (no rights to see the private bucket)', async () => {
		const fetchImpl = mockFetch({
			member: memberBody(ORG_EFK),
			orgById: { [ORG_EFK]: { _id: ORG_EFK } }
		});
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('not-admin');
	});

	it("returns ERROR (not 'not-admin') when the person has no visible active membership — an invisible prerequisite is not a rights answer", async () => {
		const fetchImpl = mockFetch({ member: { entities: [], count: 0 } });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it("returns ERROR when the member row carries no organization _parent", async () => {
		const fetchImpl = mockFetch({ member: memberBody(null) });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error when the own org is not readable by id', async () => {
		const fetchImpl = mockFetch({ member: memberBody(ORG_EFK), orgById: {} });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on HTTP failure of the member lookup', async () => {
		const fetchImpl = mockFetch({ memberStatus: 500 });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on HTTP failure of the org read', async () => {
		const fetchImpl = mockFetch({ member: memberBody(ORG_EFK), orgStatus: 500 });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error when the membership is ambiguous (two active member rows in one db)', async () => {
		const fetchImpl = mockFetch({ member: { ...memberBody(ORG_EFK), count: 2 } });
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});

	it('returns error on network exception', async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
		expect(await resolveAdmin(cfg, personId, fetchImpl)).toBe('error');
	});
});

describe('adminStore', () => {
	it('starts at loading', () => {
		resetAdmin();
		expect(get(adminStore)).toBe('loading');
	});

	it('resetAdmin sets to loading', () => {
		adminStore.set('admin');
		resetAdmin();
		expect(get(adminStore)).toBe('loading');
	});
});
