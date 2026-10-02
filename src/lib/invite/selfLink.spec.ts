// mintSelfLinkInvite: sweep stale invite placeholders, then mint on the caller's own person.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
import { mintSelfLinkInvite, SelfLinkMintError, INVITE_MINT_TRIGGER } from './inviteData';

const cfg: EntuCfg = { db: 'sampledb', token: 'jwt-me' };
const PERSON_ID = 'person-me';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** Await a rejection and hand back the typed error — asserting fields needs the instance. */
async function captureError(p: Promise<unknown>): Promise<SelfLinkMintError> {
	try {
		await p;
	} catch (e) {
		return e as SelfLinkMintError;
	}
	throw new Error('expected the promise to reject');
}

type MintProp = { type: string; string?: string };

function makeFetchMock(
	overrides: Partial<{
		identityRead: () => Response;
		propertyDelete: () => Response;
		mint: () => Response;
	}> = {}
) {
	const d = {
		identityRead: () => json({ entity: { _id: PERSON_ID, entu_user: [] } }),
		propertyDelete: () => json({ deleted: true }),
		mint: () =>
			json({
				_id: PERSON_ID,
				properties: [{ _id: 'prop-eu-new', type: 'entu_user', invite: 'tok.link.1' }]
			}),
		...overrides
	};
	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		if (method === 'GET') return Promise.resolve(d.identityRead());
		if (method === 'DELETE') return Promise.resolve(d.propertyDelete());
		return Promise.resolve(d.mint());
	});
}

function callsOf(fetchImpl: ReturnType<typeof makeFetchMock>) {
	return (fetchImpl.mock.calls as Array<[string, RequestInit?]>).map(([url, init]) => ({
		url: String(url),
		method: init?.method ?? 'GET',
		headers: (init?.headers ?? {}) as Record<string, string>,
		body: init?.body ? (JSON.parse(String(init.body)) as MintProp[]) : null
	}));
}

describe('mintSelfLinkInvite — the POST wire shape (the real mint producer)', () => {
	it('POSTs the fixed trigger constant to the OWN person, under the caller\'s own JWT, and returns the minted token', async () => {
		const fetchImpl = makeFetchMock();

		const result = await mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl);

		expect(result).toEqual({ inviteToken: 'tok.link.1' });

		const calls = callsOf(fetchImpl);
		// Full sequence, full shape: exactly one read + one mint, nothing else.
		expect(calls.length).toBe(2);

		// 1. identity read — the stale-placeholder sweep's source of truth.
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toContain('/sampledb/entity/person-me?props=entu_user');
		expect(calls[0].headers.Authorization).toBe('Bearer jwt-me');

		expect(calls[1].method).toBe('POST');
		expect(calls[1].url).toContain('/sampledb/entity/person-me');
		expect(calls[1].headers.Authorization).toBe('Bearer jwt-me');
		expect(calls[1].body).toEqual([{ type: 'entu_user', string: 'trigger invite token' }]);
		// The literal is the shared constant — the sole-mint-mechanism invariant.
		expect(calls[1].body?.[0]?.string).toBe(INVITE_MINT_TRIGGER);
	});

	it('the trigger constant is never anything email-shaped (legacy email-migration lookup matches on entu_user.string)', () => {
		expect(INVITE_MINT_TRIGGER).toBe('trigger invite token');
		expect(INVITE_MINT_TRIGGER).not.toContain('@');
	});
});

describe('mintSelfLinkInvite — stale-invite cleanup BEFORE mint (orphan hazard)', () => {
	it('deletes every un-redeemed invite placeholder first, and NEVER touches a bound identity', async () => {
		const fetchImpl = makeFetchMock({
			identityRead: () =>
				json({
					entity: {
						_id: PERSON_ID,
						entu_user: [
							// A real bound identity — must survive untouched (APPEND, not replace).
							{ _id: 'eu-bound-1', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' },
							// Two stale placeholders from abandoned link attempts — both must go
							// (findStoredInvite consumes only the FIRST match; leftovers are
							// live 24h bearer credentials).
							{ _id: 'eu-stale-1', invite: '***' },
							{ _id: 'eu-stale-2', invite: '***' }
						]
					}
				})
		});

		await mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl);

		const calls = callsOf(fetchImpl);
		// Full ordered sequence: read → delete stale × 2 → mint.
		expect(
			calls.map((c) => ({ method: c.method, url: c.url.slice(c.url.indexOf('/sampledb')) }))
		).toEqual([
			{ method: 'GET', url: '/sampledb/entity/person-me?props=entu_user' },
			{ method: 'DELETE', url: '/sampledb/property/eu-stale-1' },
			{ method: 'DELETE', url: '/sampledb/property/eu-stale-2' },
			{ method: 'POST', url: '/sampledb/entity/person-me' }
		]);
		// The bound identity's property id appears in NO delete call — destroying it
		// would destroy a real sign-in credential.
		const deletes = calls.filter((c) => c.method === 'DELETE');
		expect(deletes.some((c) => c.url.includes('eu-bound-1'))).toBe(false);
	});

	it('a failed placeholder delete aborts LOUDLY before any mint (no mint on top of an unconsumed stale invite)', async () => {
		const fetchImpl = makeFetchMock({
			identityRead: () =>
				json({ entity: { _id: PERSON_ID, entu_user: [{ _id: 'eu-stale-1', invite: '***' }] } }),
			propertyDelete: () => json({ error: 'nope' }, 500)
		});

		const err = await captureError(mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl));
		expect(err).toBeInstanceOf(SelfLinkMintError);
		expect(err.name).toBe('SelfLinkMintError');
		expect(err.phase).toBe('stale-invite-cleanup');
		expect(err.reason).toBe('http');
		// No mint POST went out after the failed cleanup.
		const calls = callsOf(fetchImpl);
		expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
	});
});

describe('mintSelfLinkInvite — fail loud, every step named (no silent fallback)', () => {
	it('an identity-read failure throws a named error — never silently treated as "no identities"', async () => {
		const fetchImpl = makeFetchMock({ identityRead: () => json({ error: 'boom' }, 500) });

		const err = await captureError(mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl));
		expect(err).toBeInstanceOf(SelfLinkMintError);
		expect(err.phase).toBe('identity-read');
		expect(err.reason).toBe('http');
		// The read failed → nothing may be written.
		expect(callsOf(fetchImpl).filter((c) => c.method !== 'GET')).toEqual([]);
	});

	it('a mint 403 names the MISSING SELF-_EDITOR — the one known rights gap for invite-joined persons', async () => {
		const fetchImpl = makeFetchMock({ mint: () => json({ error: 'forbidden' }, 403) });

		const err = await captureError(mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl));
		expect(err).toBeInstanceOf(SelfLinkMintError);
		expect(err.phase).toBe('mint');
		expect(err.reason).toBe('missing-self-editor');
		expect(err.message).toContain('_editor');
	});

	it('a 2xx mint WITHOUT a token in the response is an apparent-success trap — throws, never resolves', async () => {
		// The update response is the ONLY readable pass (every later GET masks the
		// token as '***', entu-api utils/entity.js:594-598) — a 2xx without it must
		// never be treated as a completed mint.
		const fetchImpl = makeFetchMock({
			mint: () => json({ _id: PERSON_ID, properties: [{ _id: 'prop-x', type: 'entu_user' }] })
		});

		const err = await captureError(mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl));
		expect(err).toBeInstanceOf(SelfLinkMintError);
		expect(err.phase).toBe('mint');
		expect(err.reason).toBe('contract');
	});
});

describe('sole mint mechanism — the trigger literal lives ONLY in lib/invite/inviteConstants.ts', () => {
	it('no other non-spec source file contains the mint-trigger literal', () => {
		const libDir = join(import.meta.dirname, '..'); // src/lib
		const srcDir = join(libDir, '..'); // src
		const routesDir = join(srcDir, 'routes');
		const offenders = [
			...findSourceFiles(libDir, ['.ts', '.svelte']),
			...findSourceFiles(routesDir, ['.ts', '.svelte'])
		]
			.map((full) => ({ full, rel: relative(srcDir, full) }))
			.filter(({ rel }) => !rel.endsWith('.spec.ts'))
			.filter(({ full }) => readFileSync(full, 'utf-8').includes('trigger invite token'))
			.map(({ rel }) => rel);
		expect(offenders).toEqual(['lib/invite/inviteConstants.ts']);
	});
});

// (*MVOX:Tallis* — #193 RED: self-invite mint producer)
