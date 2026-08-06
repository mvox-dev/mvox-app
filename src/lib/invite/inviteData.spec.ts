import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import {
	createInvite,
	InviteCreateError,
	listOrganizations,
	resolvePersonParentId,
	type CreateInviteInput
} from './inviteData';

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt-admin' };

const INPUT: CreateInviteInput = {
	memberName: 'Mari Mets',
	orgId: 'org-1'
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

/** Await a rejection and hand back the typed error — asserting fields needs the instance. */
async function captureError(p: Promise<unknown>): Promise<InviteCreateError> {
	try {
		await p;
	} catch (e) {
		return e as InviteCreateError;
	}
	throw new Error('expected the promise to reject');
}

type Prop = { type: string; reference?: string; string?: string; boolean?: boolean };

/**
 * URL/body-dispatching fetch mock for the whole create sequence. Individual
 * tests override single stations to inject failures.
 */
function makeFetchMock(
	overrides: Partial<{
		personTypeResolve: () => Response;
		memberTypeResolve: () => Response;
		database: () => Response;
		personCreate: () => Response;
		editorGrant: () => Response;
		memberCreate: () => Response;
	}> = {}
) {
	const d = {
		personTypeResolve: () => json({ entities: [{ _id: 'person-type-1' }] }),
		memberTypeResolve: () => json({ entities: [{ _id: 'member-type-1' }] }),
		database: () => json({ entities: [{ _id: 'db-entity-1', add_user: [{ reference: 'parent-1' }] }] }),
		personCreate: () =>
			json({
				_id: 'p1',
				// entu-api returns `properties` as an ARRAY of property objects
				// (utils/entity.js:433,506) — the invite JWT is readable ONLY here.
				properties: [{ _id: 'prop-eu-1', type: 'entu_user', invite: 'tok.abc.def' }]
			}),
		editorGrant: () => json({ _id: 'p1', properties: [] }),
		memberCreate: () => json({ _id: 'm1' }),
		...overrides
	};
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		if (u.includes('name.string=person')) return Promise.resolve(d.personTypeResolve());
		if (u.includes('name.string=member')) return Promise.resolve(d.memberTypeResolve());
		if (u.includes('_type.string=database')) return Promise.resolve(d.database());
		if (u.includes('_type.string=organization'))
			return Promise.resolve(json({ entities: [{ _id: 'org-1', name: [{ string: 'EFK' }] }] }));
		if (/entity\/p1$/.test(u)) return Promise.resolve(d.editorGrant());
		// Remaining calls are the two `POST entity` creates — the person payload is
		// the one carrying the invitee email prop.
		const body = JSON.parse(String(init?.body ?? '[]')) as Prop[];
		if (body.some((p) => p.type === 'entu_user')) return Promise.resolve(d.personCreate());
		return Promise.resolve(d.memberCreate());
	});
}

function callsOf(fetchImpl: ReturnType<typeof makeFetchMock>) {
	return (fetchImpl.mock.calls as Array<[string, RequestInit?]>).map(([url, init]) => ({
		url: String(url),
		method: init?.method ?? 'GET',
		headers: (init?.headers ?? {}) as Record<string, string>,
		body: init?.body ? (JSON.parse(String(init.body)) as Prop[]) : null
	}));
}

// ── Type-level contract (checked by `pnpm check`, not vitest) ──────────────────

// @ts-expect-error — omitting memberName must not typecheck (member.name is a mandatory prop-def)
const _omitsMemberName: CreateInviteInput = { email: 'e@x.ee', orgId: 'o1' };
void _omitsMemberName;

// GREEN drops email from the type + these fixtures — #34 removes it from
// CreateInviteInput entirely, so an "omitting email must not typecheck" guard
// would contradict the no-email design. No replacement fixture needed here.

// @ts-expect-error — omitting orgId must not typecheck (the member's parent org is required)
const _omitsOrgId: CreateInviteInput = { memberName: 'n', email: 'e@x.ee' };
void _omitsOrgId;

// Forward guard: the correct shape DOES typecheck.
const _validInput: CreateInviteInput = { memberName: 'n', orgId: 'o1' };
void _validInput;

// ── resolvePersonParentId ──────────────────────────────────────────────────────

describe('resolvePersonParentId', () => {
	it("reads the database entity's add_user reference (mirrors entu-api's own parent discovery) with the admin's Bearer token", async () => {
		const fetchImpl = makeFetchMock();
		const id = await resolvePersonParentId(cfg, fetchImpl);
		expect(id).toBe('parent-1');
		const call = callsOf(fetchImpl).find((c) => c.url.includes('_type.string=database'));
		expect(call).toBeDefined();
		expect(call!.url).toContain('/polyphony/entity?_type.string=database&props=add_user&limit=1');
		expect(call!.headers.Authorization).toBe('Bearer jwt-admin');
	});

	it('throws http (with the status) on a non-2xx response — a network/HTTP failure is NEVER presented as not-admin', async () => {
		const fetchImpl = makeFetchMock({ database: () => json({}, 500) });
		const err = await captureError(resolvePersonParentId(cfg, fetchImpl));
		expect(err).toBeInstanceOf(InviteCreateError);
		expect(err.phase).toBe('person-parent-resolve');
		expect(err.reason).toBe('http');
		expect(err.message).toMatch(/500/);
	});

	it('throws not-visible when no database entity is readable', async () => {
		const fetchImpl = makeFetchMock({ database: () => json({ entities: [] }) });
		const err = await captureError(resolvePersonParentId(cfg, fetchImpl));
		expect(err.phase).toBe('person-parent-resolve');
		expect(err.reason).toBe('not-visible');
	});

	it('throws not-visible when the database entity carries no add_user reference', async () => {
		const fetchImpl = makeFetchMock({ database: () => json({ entities: [{ _id: 'db-entity-1' }] }) });
		const err = await captureError(resolvePersonParentId(cfg, fetchImpl));
		expect(err.reason).toBe('not-visible');
	});
});

// ── listOrganizations ──────────────────────────────────────────────────────────

describe('listOrganizations', () => {
	it('lists ALL organization entities (polyphony verifiably has several — no singleton assumption), name falling back to _id', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json({ entities: [{ _id: 'org-1', name: [{ string: 'EFK' }] }, { _id: 'org-2' }] })
			);
		const orgs = await listOrganizations(cfg, fetchImpl);
		expect(orgs).toEqual([
			{ _id: 'org-1', name: 'EFK' },
			{ _id: 'org-2', name: 'org-2' }
		]);
		const [url] = fetchImpl.mock.calls[0] as [string];
		// Explicit limit — an omitted limit silently caps at the server default of
		// 100 (entu-api routes/[db]/entity/index.get.js:494).
		expect(String(url)).toContain('/polyphony/entity?_type.string=organization&props=name&limit=200');
	});

	it('throws contract on a truncated page (count > returned entities) — a silently incomplete org select is never shown', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ count: 201, entities: [{ _id: 'org-1', name: [{ string: 'EFK' }] }] }));
		const err = await captureError(listOrganizations(cfg, fetchImpl));
		expect(err).toBeInstanceOf(InviteCreateError);
		expect(err.phase).toBe('org-list');
		expect(err.reason).toBe('contract');
		expect(err.message).toMatch(/truncated/);
	});

	it('throws http on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 502));
		const err = await captureError(listOrganizations(cfg, fetchImpl));
		expect(err).toBeInstanceOf(InviteCreateError);
		expect(err.phase).toBe('org-list');
		expect(err.reason).toBe('http');
		expect(err.message).toMatch(/502/);
	});

	it('throws not-visible when zero organizations are readable (names the missing object, no silent empty select)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		const err = await captureError(listOrganizations(cfg, fetchImpl));
		expect(err.phase).toBe('org-list');
		expect(err.reason).toBe('not-visible');
		expect(err.message).toMatch(/organization/i);
	});
});

// ── createInvite — input guards (before any fetch) ─────────────────────────────

describe('createInvite — input guards fire before any network call', () => {
	it('rejects an empty memberName, naming the field', async () => {
		const fetchImpl = vi.fn();
		await expect(createInvite(cfg, { ...INPUT, memberName: '  ' }, fetchImpl)).rejects.toThrow(
			/memberName/
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	// GREEN drops email from the type + this guard — #34 removes the `@` check
	// along with the email field itself. No replacement test needed here.

	it('rejects an empty orgId, naming the field', async () => {
		const fetchImpl = vi.fn();
		await expect(createInvite(cfg, { ...INPUT, orgId: '' }, fetchImpl)).rejects.toThrow(/orgId/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// ── createInvite — happy path wire shape ───────────────────────────────────────

describe('createInvite — happy path', () => {
	it('returns personId, memberId and the invite token captured from the person-create response', async () => {
		const fetchImpl = makeFetchMock();
		const result = await createInvite(cfg, INPUT, fetchImpl);
		expect(result).toEqual({ personId: 'p1', memberId: 'm1', inviteToken: 'tok.abc.def' });
	});

	it('person payload is EXACTLY: _type ref, _parent=add_user parent, entu_user=mint-trigger constant, _sharing:domain, _inheritrights:true — and NO name/email props (prop-defs deleted in T4.3)', async () => {
		const fetchImpl = makeFetchMock();
		await createInvite(cfg, INPUT, fetchImpl);
		const personCall = callsOf(fetchImpl).find((c) => c.body?.some((p) => p.type === 'entu_user'));
		expect(personCall).toBeDefined();
		expect(personCall!.method).toBe('POST');
		expect(personCall!.body).toEqual(
			expect.arrayContaining([
				{ type: '_type', reference: 'person-type-1' },
				{ type: '_parent', reference: 'parent-1' },
				// #34 — entu_user carries a fixed mint-trigger literal, NEVER the invitee
				// email: any truthy string mints an identical invite token (entu-api
				// utils/entity.js:462-467), so the invitee's real email must never reach
				// Entu. Hard-coded here (not imported from source) so RED fails on the
				// assertion, not on a missing export.
				{ type: 'entu_user', string: 'trigger invite token' },
				{ type: '_sharing', string: 'domain' },
				{ type: '_inheritrights', boolean: true }
			])
		);
		expect(personCall!.body).toHaveLength(5);
		expect(personCall!.body!.some((p) => p.type === 'name' || p.type === 'email')).toBe(false);
	});

	it("#34 — the invitee's real email NEVER reaches Entu: the person-create request body contains no occurrence of it, anywhere", async () => {
		const fetchImpl = makeFetchMock();
		await createInvite(cfg, INPUT, fetchImpl);
		const personCall = callsOf(fetchImpl).find((c) => c.body?.some((p) => p.type === 'entu_user'));
		expect(personCall).toBeDefined();
		// Literal, not INPUT.email — GREEN drops `email` from CreateInviteInput, so
		// referencing INPUT.email here would stop compiling once that lands.
		expect(JSON.stringify(personCall!.body)).not.toContain('mari@example.com');
	});

	it('member payload is EXACTLY: _type ref, _parent=orgId, name, person ref, status:active, _sharing:private, _viewer=person, _inheritrights:true (slice3-proven visibility model)', async () => {
		const fetchImpl = makeFetchMock();
		await createInvite(cfg, INPUT, fetchImpl);
		const memberCall = callsOf(fetchImpl).find((c) => c.body?.some((p) => p.type === 'person'));
		expect(memberCall).toBeDefined();
		expect(memberCall!.method).toBe('POST');
		expect(memberCall!.body).toEqual(
			expect.arrayContaining([
				{ type: '_type', reference: 'member-type-1' },
				{ type: '_parent', reference: 'org-1' },
				{ type: 'name', string: 'Mari Mets' },
				{ type: 'person', reference: 'p1' },
				{ type: 'status', string: 'active' },
				{ type: '_sharing', string: 'private' },
				{ type: '_viewer', reference: 'p1' },
				{ type: '_inheritrights', boolean: true }
			])
		);
		expect(memberCall!.body).toHaveLength(8);
	});

	it('grants the person self-_editor via POST entity/{personId} (parity with native auto-create — load-bearing for T4.6 lazy creates)', async () => {
		const fetchImpl = makeFetchMock();
		await createInvite(cfg, INPUT, fetchImpl);
		const grantCall = callsOf(fetchImpl).find((c) => /entity\/p1$/.test(c.url.split('?')[0]));
		expect(grantCall).toBeDefined();
		expect(grantCall!.method).toBe('POST');
		expect(grantCall!.body).toEqual([{ type: '_editor', reference: 'p1' }]);
	});

	it('all reads (type resolves + parent discovery) precede all writes, and every call carries the admin Bearer token', async () => {
		const fetchImpl = makeFetchMock();
		await createInvite(cfg, INPUT, fetchImpl);
		const calls = callsOf(fetchImpl);
		const firstWrite = calls.findIndex((c) => c.method === 'POST');
		expect(firstWrite).toBeGreaterThan(-1);
		for (const [i, c] of calls.entries()) {
			if (c.method === 'GET') expect(i).toBeLessThan(firstWrite);
			expect(c.headers.Authorization).toBe('Bearer jwt-admin');
		}
	});

	it("never touches the T4.4 sole create path's type name in any request URL (YELLOW-T4.4.1)", async () => {
		const fetchImpl = makeFetchMock();
		await createInvite(cfg, INPUT, fetchImpl);
		for (const c of callsOf(fetchImpl)) {
			expect(c.url).not.toContain('name.string=profile');
		}
	});
});

// ── createInvite — fail-loud ledger ────────────────────────────────────────────

describe('createInvite — every failure is loud, phased, and names the orphan where one exists', () => {
	it("wraps a type-resolution miss as phase 'type-resolve'", async () => {
		const fetchImpl = makeFetchMock({ personTypeResolve: () => json({ entities: [] }) });
		const err = await captureError(createInvite(cfg, INPUT, fetchImpl));
		expect(err).toBeInstanceOf(InviteCreateError);
		expect(err.phase).toBe('type-resolve');
	});

	it("throws phase 'person-create' with the status on a non-2xx person create (a 403 here IS the authoritative admin gate)", async () => {
		const fetchImpl = makeFetchMock({ personCreate: () => json({}, 403) });
		const err = await captureError(createInvite(cfg, INPUT, fetchImpl));
		expect(err.phase).toBe('person-create');
		expect(err.reason).toBe('http');
		expect(err.message).toMatch(/403/);
	});

	it("throws phase 'person-create' on a 2xx person create WITHOUT _id — the apparent-success trap, never treated as a completed create", async () => {
		const fetchImpl = makeFetchMock({ personCreate: () => json({}) });
		const err = await captureError(createInvite(cfg, INPUT, fetchImpl));
		expect(err.phase).toBe('person-create');
		expect(err.message).toMatch(/_id/i);
	});

	it("throws phase 'invite-mint' (reason contract, personId set) when the create response carries no invite token — no link is ever fabricated", async () => {
		const fetchImpl = makeFetchMock({
			personCreate: () => json({ _id: 'p1', properties: [{ _id: 'x', type: 'entu_user' }] })
		});
		const err = await captureError(createInvite(cfg, INPUT, fetchImpl));
		expect(err.phase).toBe('invite-mint');
		expect(err.reason).toBe('contract');
		expect(err.personId).toBe('p1');
	});

	it("throws phase 'editor-grant' with the orphaned personId when the self-_editor grant fails", async () => {
		const fetchImpl = makeFetchMock({ editorGrant: () => json({}, 500) });
		const err = await captureError(createInvite(cfg, INPUT, fetchImpl));
		expect(err.phase).toBe('editor-grant');
		expect(err.personId).toBe('p1');
	});

	it("throws phase 'member-create' with the orphaned personId on a non-2xx member create — and does NOT attempt a compensating delete", async () => {
		const fetchImpl = makeFetchMock({ memberCreate: () => json({}, 500) });
		const err = await captureError(createInvite(cfg, INPUT, fetchImpl));
		expect(err.phase).toBe('member-create');
		expect(err.personId).toBe('p1');
		const deletes = callsOf(fetchImpl).filter((c) => c.method === 'DELETE');
		expect(deletes).toEqual([]);
	});

	it("throws phase 'member-create' on a 2xx member create WITHOUT _id (apparent-success trap), naming the person", async () => {
		const fetchImpl = makeFetchMock({ memberCreate: () => json({}) });
		const err = await captureError(createInvite(cfg, INPUT, fetchImpl));
		expect(err.phase).toBe('member-create');
		expect(err.personId).toBe('p1');
		expect(err.message).toMatch(/_id/i);
	});
});
