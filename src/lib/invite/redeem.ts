// T4.5 (#31) — the SOLE account-scoped `/auth` call site in the codebase (the
// normal login exchange in $lib/auth/exchange.ts is deliberately db-less and is
// NOT modified). Structurally enforced: the literal `auth?account=` may appear
// only here (see singleInviteMechanism.spec.ts).
//
// AC1 (no auto-provision): this call ALWAYS carries `invite=`, and presenting any
// `invite` param suppresses Entu's auto-create (entu-api routes/auth/
// index.get.js:199, 236). Redemption is pure token-possession — the server never
// compares an email (the token holds none).
//
// Outcome classification per verified index.get.js:199-267:
// - `dead` — expired / already-consumed / tampered are SERVER-INDISTINGUISHABLE
//   by design (silent catch at :232, auto-create suppressed at :236): no account
//   entry, no conflict flag, but `body.user.email` present (a live session always
//   carries it, index.get.js:116-117, 247-251). Nothing may be persisted.
// - `failed` — no account entry AND no `body.user.email`: the SESSION KEY itself
//   failed (aud=IP-bound, 5-minute, single-use — [provider].get.js:157-161;
//   jwt.verify + session lookup share one try whose catch falls to the API-key
//   path, index.get.js:107-121, yielding 200 + token + empty accounts + empty
//   user). The invite was never verified server-side and may still be live —
//   retryable via a fresh CTA click, NEVER presented as a dead invite.
// - `unexpected` — an id-mismatch without a conflict flag, or `user.new: true`
//   (auto-create ran — impossible under inviteAttempted; the flag rides the user
//   sub-object, index.get.js:136-139 spreads extra into `user`, :240 passes
//   `{ new: true }`): the AC1 fail-loud tripwire. The issued session is real;
//   never absorbed as success, never discarded as failure.
//
// NOTE: the post-redemption JWT's `accounts` map is filtered to the invite's db
// (index.get.js:142); a later normal login restores the full map.

import { ENTU_API_BASE } from '$lib/entu-config';

export type InviteExchangeResult =
	| { status: 'redeemed'; token: string; user: { email?: string; name?: string }; personId: string }
	| {
			status: 'conflict';
			token: string;
			user: { email?: string; name?: string };
			existingPersonId: string;
	  }
	| {
			status: 'unexpected';
			token: string;
			user: { email?: string; name?: string };
			detail: string;
	  }
	| { status: 'dead' }
	| { status: 'failed' };

export interface InviteExchangeArgs {
	sessionToken: string;
	db: string;
	inviteToken: string;
	expectedEntityId: string;
}

interface ExchangeAccountEntry {
	_id?: string;
	name?: string;
	// `new` rides the user sub-object: addAccount spreads the extra object into
	// `user` (index.get.js:136-139), and auto-create passes `{ new: true }` (:240).
	user?: { _id?: string; email?: string; name?: string; new?: boolean };
}

interface ExchangeBody {
	token?: string;
	accounts?: ExchangeAccountEntry[];
	user?: { _id?: string; email?: string; name?: string };
	conflict?: string;
}

export async function exchangeSessionWithInvite(
	args: InviteExchangeArgs,
	fetchImpl: typeof fetch = fetch
): Promise<InviteExchangeResult> {
	let res: Response;
	try {
		res = await fetchImpl(
			`${ENTU_API_BASE}auth?account=${encodeURIComponent(args.db)}&invite=${encodeURIComponent(args.inviteToken)}`,
			{
				headers: {
					Authorization: `Bearer ${args.sessionToken}`,
					Accept: 'application/json'
				}
			}
		);
	} catch {
		return { status: 'failed' };
	}
	if (!res.ok) return { status: 'failed' };

	let body: ExchangeBody;
	try {
		body = (await res.json()) as ExchangeBody;
	} catch {
		return { status: 'failed' };
	}
	if (typeof body.token !== 'string' || !body.token) return { status: 'failed' };

	const user = { email: body.user?.email, name: body.user?.name };
	const entry = (body.accounts ?? []).find((a) => a?._id === args.db);

	if (body.conflict === 'invite') {
		const existingPersonId = entry?.user?._id;
		if (typeof existingPersonId === 'string' && existingPersonId) {
			return { status: 'conflict', token: body.token, user, existingPersonId };
		}
		// conflict flag without an account entry for this db — impossible per source
		// (index.get.js:226-229 lists the existing entity): tripwire, never absorbed.
		return {
			status: 'unexpected',
			token: body.token,
			user,
			detail: `conflict flag set but no account entry for db '${args.db}'`
		};
	}

	if (!entry) {
		// Discriminate on body.user.email: a live session ALWAYS carries it
		// (index.get.js:116-117, 247-251). Absent → the single-use, IP-bound session
		// key itself failed (index.get.js:107-121 catch → API-key path) and the
		// invite was never verified server-side: retryable `failed`, never the
		// terminal `dead` (which would invite a duplicate person re-mint).
		if (!body.user?.email) return { status: 'failed' };
		return { status: 'dead' };
	}

	const entryPersonId = entry.user?._id;
	if (entry.user?.new === true) {
		return {
			status: 'unexpected',
			token: body.token,
			user,
			detail: `account entry for '${args.db}' carries user.new:true — auto-create ran for entity ${entryPersonId}, which the invite= param forbids (index.get.js:236)`
		};
	}
	if (entryPersonId !== args.expectedEntityId) {
		return {
			status: 'unexpected',
			token: body.token,
			user,
			detail: `account entry is bound to entity ${entryPersonId}, expected ${args.expectedEntityId}, with no conflict flag`
		};
	}

	return { status: 'redeemed', token: body.token, user, personId: entryPersonId };
}

