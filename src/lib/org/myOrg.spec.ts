import { describe, expect, it, vi } from 'vitest';
import { MyOrgLookupError, resolveMyOrgId } from './myOrg';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// TU.1/#109 review — "which org is THIS person's collective" must come from the
// person's own member row, never from `_type.string=organization&limit=1` (live:
// count 6, first hit is the umbrella federation — see module header).

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const PERSON = 'person-ada';
const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_UMBRELLA = '69c7f8718489bfcb0e81b05a';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function memberRow(orgId: string | null) {
	return {
		_id: 'm-ada',
		_parent: [
			{ reference: 'sec-sop', entity_type: 'section' },
			...(orgId ? [{ reference: orgId, entity_type: 'organization' }] : [])
		]
	};
}

describe('resolveMyOrgId', () => {
	it("queries the person's own ACTIVE member row and projects _parent — never an organization search", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [memberRow(ORG_EFK)], count: 1 }));
		const orgId = await resolveMyOrgId(cfg, PERSON, fetchImpl);
		expect(orgId).toBe(ORG_EFK);

		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('/polyphony/entity?_type.string=member');
		expect(url).toContain(`person.reference=${PERSON}`);
		expect(url).toContain('status.string=active');
		expect(url).toContain('props=_parent');
		expect(url).not.toContain('_type.string=organization');
	});

	it('picks the organization `_parent` entry, not the section one that precedes it, and never the umbrella (live shape: a member is parented to both org and section)', async () => {
		const fetchImpl = vi
			.fn()
			.mockImplementation(() => Promise.resolve(json({ entities: [memberRow(ORG_EFK)], count: 1 })));
		const orgId = await resolveMyOrgId(cfg, PERSON, fetchImpl);
		expect(orgId).toBe(ORG_EFK);
		expect(orgId).not.toBe(ORG_UMBRELLA);
		expect(orgId).not.toBe('sec-sop');
	});

	it('returns null when the person has no visible active member row (an answer, not an error)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [], count: 0 }));
		expect(await resolveMyOrgId(cfg, PERSON, fetchImpl)).toBeNull();
	});

	it('returns null when the member row carries no organization `_parent` visible to this reader', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [memberRow(null)], count: 1 }));
		expect(await resolveMyOrgId(cfg, PERSON, fetchImpl)).toBeNull();
	});

	it('fails loud on a non-2xx, naming the status and the db', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 503));
		const err = await resolveMyOrgId(cfg, PERSON, fetchImpl).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(MyOrgLookupError);
		expect((err as MyOrgLookupError).reason).toBe('http');
		expect((err as MyOrgLookupError).status).toBe(503);
		expect((err as Error).message).toMatch(/503/);
		expect((err as Error).message).toMatch(/polyphony/);
	});

	it('fails loud when `count` > 1 — two active memberships in one db is ambiguous, never "take the first"', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [memberRow(ORG_EFK)], count: 2 }));
		const err = await resolveMyOrgId(cfg, PERSON, fetchImpl).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(MyOrgLookupError);
		expect((err as MyOrgLookupError).reason).toBe('ambiguous');
		expect((err as Error).message).toMatch(/2/);
	});

	it('rejects an empty personId before any fetch', async () => {
		const fetchImpl = vi.fn();
		await expect(resolveMyOrgId(cfg, '', fetchImpl)).rejects.toBeInstanceOf(MyOrgLookupError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// (*MVOX:Palestrina*)
