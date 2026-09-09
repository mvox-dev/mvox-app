// #294 RED — `withdrawInvite` (tühista kutse) + the one-live-link invariant.
//
// withdraw is a REVOCATION, not tidiness (Gama shaping + Mihkel rulings, issue
// #294): an unredeemed invite link binds WHOEVER CLICKS IT (#23/#28/#30), so a
// link sent to a mistyped address is a live credential in a stranger's inbox,
// and withdraw is the only action that un-arms it. Two properties of the
// existing sweep (mintSelfLinkInvite steps 1-2, inviteData.ts:393-415) are
// load-bearing and must survive into the standalone operation:
//
//   1. A bound identity is NEVER touched — the sweep filters on `invite`
//      being present; a joined member carries `uid` and never `invite`, so
//      withdraw cannot unlink someone who has actually joined.
//   2. Partial failure IS failure — all-or-report. Multiple placeholders can
//      coexist (Entu APPENDS: the 2026-09-09 admin-cascade probe's bypass POST
//      left TWO live placeholders on one person) and the sweep loops; a
//      surviving placeholder is a live credential the admin has just been told
//      is dead. If any DELETE fails, the operation reports failure — never a
//      partial success rendered as done.
//
// Contract under test (GREEN implements exactly this, in THIS module — the
// sole-mint-mechanism exemption already covers it, and the sweep it reuses
// lives here):
//
//   withdrawInvite(cfg: EntuCfg, personId: string, fetchImpl?): Promise<void>
//   — resolves only when NO entry carrying `invite` survives; rejects loudly
//     on any read or DELETE failure.
//
// Withdrawn == never-invited (DECISION-Mihkel 2026-09-08: "Withdrawn and never
// invited are the same"): withdraw leaves NO marker behind — the truthful
// post-state is "no live credential exists", identical to never-invited. This
// file pins that nothing beyond the placeholder DELETEs is ever written.
//
// The second half pins Gama's demanded invariant test for saada uuesti: one
// person, at most ONE redeemable link, at any moment. entu-api's
// findStoredInvite takes the FIRST stored entry carrying `invite` WITHOUT
// comparing it to the token presented at redemption (routes/auth/
// index.get.js:270-277) — so an un-swept older token stays INDEPENDENTLY
// redeemable. The resend producer is `mintSelfLinkInvite` (the exact function
// the 2026-09-09 admin-cascade probe drove live: db-entity `_owner` → HTTP
// 200), whose sweep-then-mint IS the atomic replace. "Test the invariant, not
// the button": after a resend, the previously issued link must no longer
// redeem.

import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import * as inviteData from './inviteData';
import { mintSelfLinkInvite } from './inviteData';

type WithdrawInvite = (
	cfg: EntuCfg,
	personId: string,
	fetchImpl?: typeof fetch
) => Promise<void>;

// Dynamic-shaped access: at RED the export does not exist yet; each test then
// fails on the call rather than the whole file failing at module link time.
const withdrawInvite = (inviteData as unknown as { withdrawInvite?: WithdrawInvite })
	.withdrawInvite;

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt-owner' };
const PERSON_ID = 'person-target';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/**
 * Stateful fake of the Entu person + its entu_user property values:
 *  - GET  entity/{personId}?props=entu_user → current entries, with every
 *    un-redeemed invite MASKED as '***' (the platform masks on every read
 *    after the mint moment — the stored raw token is never readable again)
 *  - DELETE property/{_id}                  → removes that value (or fails,
 *    when the id is listed in failDeleteIds)
 *  - POST entity/{personId}                 → the mint: appends a fresh
 *    invite-carrying value (Entu APPENDS — it never replaces) and returns the
 *    raw token exactly once, in the update response
 */
interface StoredValue {
	_id: string;
	uid?: string;
	provider?: string;
	email?: string;
	/** The raw redeemable token — what findStoredInvite matches on. Masked on every GET. */
	rawInvite?: string;
}

function makeEntuStore(initial: StoredValue[], failDeleteIds: string[] = []) {
	const state = { values: [...initial] };
	const ops: Array<{ method: string; url: string }> = [];
	let mintN = 0;
	const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		ops.push({ method, url: u });
		if (method === 'GET' && u.includes(`/entity/${PERSON_ID}`) && u.includes('props=entu_user')) {
			const masked = state.values.map((v) =>
				v.rawInvite !== undefined
					? { _id: v._id, invite: '***' }
					: { _id: v._id, uid: v.uid, provider: v.provider, email: v.email }
			);
			return Promise.resolve(
				json({ entity: { _id: PERSON_ID, ...(masked.length ? { entu_user: masked } : {}) } })
			);
		}
		if (method === 'DELETE' && u.includes('/property/')) {
			const id = u.split('/property/')[1]?.split('?')[0] ?? '';
			if (failDeleteIds.includes(id)) return Promise.resolve(json({ error: 'boom' }, 500));
			state.values = state.values.filter((v) => v._id !== id);
			return Promise.resolve(json({ deleted: true }));
		}
		if (method === 'POST' && u.includes(`/entity/${PERSON_ID}`)) {
			mintN += 1;
			const raw = `tok-fresh-${mintN}`;
			state.values.push({ _id: `eu-minted-${mintN}`, rawInvite: raw });
			return Promise.resolve(
				json({ _id: PERSON_ID, properties: [{ type: 'entu_user', invite: raw }] })
			);
		}
		return Promise.resolve(json({ error: `unexpected ${method} ${u}` }, 404));
	}) as unknown as typeof fetch;
	return { fetchImpl, state, ops };
}

/**
 * entu-api's redemption lookup, simulated faithfully: the FIRST stored value
 * carrying `invite`, with NO comparison against the token the redeemer
 * presents (routes/auth/index.get.js:270-277). Whatever this returns is what
 * any presented link lands on — an older un-swept entry shadows a fresh one.
 */
function findStoredInvite(values: StoredValue[]): StoredValue | undefined {
	return values.find((v) => v.rawInvite !== undefined);
}

const BOUND: StoredValue = {
	_id: 'eu-bound',
	uid: 'google:real',
	provider: 'google',
	email: 'joined@example.com'
};

describe('withdrawInvite — the sweep, standalone (revocation, not tidiness)', () => {
	it('sweeps EVERY live placeholder — two coexisting placeholders (the observed append shape) → two property DELETEs, none surviving', async () => {
		const { fetchImpl, state, ops } = makeEntuStore([
			{ _id: 'eu-old-1', rawInvite: 'tok-old-1' },
			{ _id: 'eu-old-2', rawInvite: 'tok-old-2' }
		]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(findStoredInvite(state.values)).toBeUndefined();
		const deletes = ops.filter((o) => o.method === 'DELETE');
		expect(deletes).toHaveLength(2);
		// Endpoint discipline: property VALUES die at /property/{_id}, never at
		// /entity/{_id} — conflating the two 404s and silently pollutes.
		for (const d of deletes) expect(d.url).toMatch(/\/property\/eu-old-[12]/);
	});

	it('a bound identity is NEVER touched — withdraw on a person with a bound entry AND a placeholder deletes ONLY the placeholder', async () => {
		const { fetchImpl, state, ops } = makeEntuStore([
			BOUND,
			{ _id: 'eu-stale', rawInvite: 'tok-stale' }
		]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(state.values).toContainEqual(BOUND);
		expect(findStoredInvite(state.values)).toBeUndefined();
		const deletes = ops.filter((o) => o.method === 'DELETE');
		expect(deletes).toHaveLength(1);
		expect(deletes[0].url).toContain('/property/eu-stale');
	});

	it('withdraw cannot unlink a member who has actually JOINED: only bound entries present → zero DELETEs, resolves as a no-op', async () => {
		const { fetchImpl, state, ops } = makeEntuStore([BOUND]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(state.values).toEqual([BOUND]);
		expect(ops.filter((o) => o.method === 'DELETE')).toHaveLength(0);
	});

	it('all-or-report: with two placeholders, a failure on the SECOND delete rejects — one delete having succeeded is not success', async () => {
		// A surviving placeholder is a live credential the admin has just been
		// told is dead. Rendering this partial outcome as done is the failure
		// mode the control exists to prevent.
		const { fetchImpl, state } = makeEntuStore(
			[
				{ _id: 'eu-old-1', rawInvite: 'tok-old-1' },
				{ _id: 'eu-old-2', rawInvite: 'tok-old-2' }
			],
			['eu-old-2']
		);
		await expect(withdrawInvite!(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(/eu-old-2|500/);
		// The un-deleted placeholder is still live — the rejection is the truth.
		expect(findStoredInvite(state.values)).toBeDefined();
	});

	it('all-or-report: a failure on the FIRST delete rejects loudly', async () => {
		const { fetchImpl } = makeEntuStore([{ _id: 'eu-old-1', rawInvite: 'tok-old-1' }], [
			'eu-old-1'
		]);
		await expect(withdrawInvite!(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(/eu-old-1|500/);
	});

	it('an identity-read failure rejects — never silently treated as "nothing to withdraw"', async () => {
		const failingRead = vi
			.fn()
			.mockResolvedValue(json({ error: 'forbidden' }, 403)) as unknown as typeof fetch;
		await expect(withdrawInvite!(cfg, PERSON_ID, failingRead)).rejects.toThrow(/403/);
	});

	it('withdraw leaves NO marker: no POST is ever issued — withdrawn and never-invited are the SAME state (Mihkel ruling)', async () => {
		const { fetchImpl, ops } = makeEntuStore([{ _id: 'eu-old', rawInvite: 'tok-old' }]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(ops.filter((o) => o.method === 'POST')).toHaveLength(0);
	});
});

describe('the one-live-link invariant — after saada uuesti, the OLD link no longer redeems (Gama, issue #294)', () => {
	// These pin the invariant on the resend producer itself
	// (mintSelfLinkInvite — sweep-then-mint, the atomic replace). They are
	// expected to hold from the sweep already shipped in #193; they stand here
	// as the demanded, redemption-framed guard so no later "optimisation" can
	// drop the sweep without failing a test that says WHY it exists.

	it('after a resend, findStoredInvite can only ever land on the FRESH token — the previously issued link is gone from the store', async () => {
		const { fetchImpl, state } = makeEntuStore([{ _id: 'eu-old', rawInvite: 'tok-old' }]);
		const { inviteToken } = await mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl);
		const redeemable = findStoredInvite(state.values);
		expect(redeemable).toBeDefined();
		expect(redeemable!.rawInvite).toBe(inviteToken);
		expect(redeemable!.rawInvite).not.toBe('tok-old');
		// At most one redeemable link, at any moment:
		expect(state.values.filter((v) => v.rawInvite !== undefined)).toHaveLength(1);
	});

	it('the sweep PRECEDES the mint on the wire — the old link is dead before the new one exists, never two live at once', async () => {
		const { fetchImpl, ops } = makeEntuStore([{ _id: 'eu-old', rawInvite: 'tok-old' }]);
		await mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl);
		const deleteIdx = ops.findIndex((o) => o.method === 'DELETE');
		const mintIdx = ops.findIndex((o) => o.method === 'POST');
		expect(deleteIdx).toBeGreaterThan(-1);
		expect(mintIdx).toBeGreaterThan(-1);
		expect(deleteIdx).toBeLessThan(mintIdx);
	});
});

// (*MVOX:Tallis* — #294 RED: withdraw = sweep-without-mint, all-or-report;
//  one-live-link invariant pinned at the redemption lookup, not the button)
