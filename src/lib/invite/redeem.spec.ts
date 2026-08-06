import { describe, expect, it, vi } from 'vitest';
import {
	exchangeSessionWithInvite,
	type InviteExchangeArgs,
	type InviteExchangeResult
} from './redeem';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

const ARGS: InviteExchangeArgs = {
	sessionToken: 'sess-key-1',
	db: 'polyphony',
	inviteToken: 'inv.tok.sig',
	expectedEntityId: 'p1'
};

const USER = { _id: 'oauth-u1', email: 'mari@example.com', name: 'Mari' };

/** A successful account-scoped exchange body (entu-api routes/auth/index.get.js:253-267). */
function bodyWith(accounts: unknown[], extra: Record<string, unknown> = {}) {
	return { accounts, user: USER, token: 'new-12h-jwt', expires: 9_999_999_999, ...extra };
}

// ── Type-level contract (checked by `pnpm check`, not vitest) ──────────────────

// @ts-expect-error — omitting expectedEntityId must not typecheck: without it the
// AC1 tripwire (id-equality check) cannot run
const _missingExpected: InviteExchangeArgs = {
	sessionToken: 's',
	db: 'polyphony',
	inviteToken: 't'
};
void _missingExpected;

// ── Wire shape ─────────────────────────────────────────────────────────────────

describe('exchangeSessionWithInvite — wire shape (the sole account-scoped /auth call)', () => {
	it('GETs auth?account=<db>&invite=<token> with the session Bearer token — AC1: the call ALWAYS carries invite=, which suppresses auto-create (entu-api index.get.js:199,236)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(bodyWith([{ _id: 'polyphony', name: 'P', user: { _id: 'p1' } }])));

		await exchangeSessionWithInvite(ARGS, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('auth?account=polyphony&invite=inv.tok.sig');
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer sess-key-1');
		expect(headers.Accept).toBe('application/json');
	});
});

// ── Outcome classification (entu-api routes/auth/index.get.js:199-267) ─────────

describe('exchangeSessionWithInvite — outcome classification', () => {
	async function run(body: unknown, status = 200): Promise<InviteExchangeResult> {
		const fetchImpl = vi.fn().mockResolvedValue(json(body, status));
		return exchangeSessionWithInvite(ARGS, fetchImpl);
	}

	it('redeemed: the db entry matches expectedEntityId and is not new', async () => {
		const result = await run(bodyWith([{ _id: 'polyphony', name: 'P', user: { _id: 'p1', name: 'Mari' } }]));
		expect(result).toMatchObject({ status: 'redeemed', token: 'new-12h-jwt', personId: 'p1' });
	});

	it("conflict: body.conflict === 'invite' → the identity is already bound to a DIFFERENT entity; the issued session is real", async () => {
		const result = await run(
			bodyWith([{ _id: 'polyphony', name: 'P', user: { _id: 'existing-9', name: 'Mari' } }], {
				conflict: 'invite'
			})
		);
		expect(result).toMatchObject({
			status: 'conflict',
			token: 'new-12h-jwt',
			existingPersonId: 'existing-9'
		});
	});

	it('dead: no account entry and no conflict, with a live session (body.user.email present) — expired/consumed/tampered are server-indistinguishable by design (silent catch index.get.js:232, auto-create suppressed :236)', async () => {
		const result = await run(bodyWith([]));
		expect(result).toEqual({ status: 'dead' });
	});

	it('failed (NOT dead): no account entry AND an empty user object — the session key itself failed (index.get.js:107-121 catch → API-key path yields 200 + token + empty accounts + empty user); the invite may still be live, retry is real', async () => {
		const result = await run({ token: 'new-12h-jwt', accounts: [], user: {} });
		expect(result).toEqual({ status: 'failed' });
	});

	it('dead: an entry for a DIFFERENT db does not count as redemption in this db', async () => {
		const result = await run(bodyWith([{ _id: 'otherdb', name: 'O', user: { _id: 'p1' } }]));
		expect(result).toEqual({ status: 'dead' });
	});

	it('unexpected (AC1 tripwire): entry id differs from expectedEntityId WITHOUT a conflict flag — impossible per source, never absorbed as success', async () => {
		const result = await run(bodyWith([{ _id: 'polyphony', name: 'P', user: { _id: 'other-2' } }]));
		expect(result).toMatchObject({ status: 'unexpected', token: 'new-12h-jwt' });
		expect((result as { detail: string }).detail).toMatch(/other-2/);
	});

	it('unexpected (AC1 tripwire): entry carries user.new:true — auto-create ran, which invite= forbids; the flag rides the USER sub-object on the wire (addAccount spreads extra into user, index.get.js:136-139, :240)', async () => {
		const result = await run(
			bodyWith([{ _id: 'polyphony', name: 'P', user: { _id: 'p1', new: true } }])
		);
		expect(result).toMatchObject({ status: 'unexpected' });
	});

	it('unexpected (tripwire): conflict flag WITHOUT an account entry for the db — impossible per source (index.get.js:226-229 lists the existing entity); the real issued session is never discarded as dead', async () => {
		const result = await run(bodyWith([], { conflict: 'invite' }));
		expect(result).toMatchObject({ status: 'unexpected', token: 'new-12h-jwt' });
		expect((result as { detail: string }).detail).toMatch(/polyphony/);
	});

	it('unexpected (tripwire): conflict flag with an entry that lacks user._id — same guard, never a conflict with an undefined existingPersonId', async () => {
		const result = await run(bodyWith([{ _id: 'polyphony', name: 'P', user: {} }], { conflict: 'invite' }));
		expect(result).toMatchObject({ status: 'unexpected', token: 'new-12h-jwt' });
		expect((result as { detail: string }).detail).toMatch(/polyphony/);
	});
});

// ── Failure paths ──────────────────────────────────────────────────────────────

describe('exchangeSessionWithInvite — failed (retryable: a fresh CTA click mints a fresh single-use session key)', () => {
	it('failed on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ message: 'nope' }, 401));
		expect(await exchangeSessionWithInvite(ARGS, fetchImpl)).toEqual({ status: 'failed' });
	});

	it('failed when the body carries no token', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ accounts: [] }));
		expect(await exchangeSessionWithInvite(ARGS, fetchImpl)).toEqual({ status: 'failed' });
	});

	it('failed when fetch itself rejects (network error) — never a throw to the caller', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));
		expect(await exchangeSessionWithInvite(ARGS, fetchImpl)).toEqual({ status: 'failed' });
	});
});
