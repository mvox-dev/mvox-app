// T4.5 (#31) — invite-intent branch of the OAuth callback. Split from
// run-callback-exchange.ts so the proven normal login path stays byte-stable:
// run-callback-exchange delegates here when the (single-use, already-consumed)
// state blob carries `intent: 'invite'`, and the db-less exchangeSession is never
// called in invite mode.
//
// Persistence rule: `redeemed`/`conflict`/`unexpected` all persist the issued
// session (it is real); `dead` persists NOTHING (the returned JWT carries no
// accounts claim — persisting would be a half-authenticated inconsistency).
// A client-side "expired" parse result does NOT short-circuit — the client clock
// is unverified; the server is the authority.

import type { OAuthState } from '$lib/auth/state';
import { parseInviteToken } from '$lib/invite/parse-invite-token';
import { exchangeSessionWithInvite } from '$lib/invite/redeem';
import { setToken, setUser, setLastProvider } from '$lib/auth/storage';
import { hydrateAuth } from '$lib/auth/session';
import { hydrateCollectives } from '$lib/collectives/store';
import type { CallbackOutcome } from './run-callback-exchange';

const INVALID_STATE: CallbackOutcome = {
	ok: false,
	redirectTo: '/auth/login?error=invite_state_invalid',
	error: 'invite_state_invalid'
};

export async function runInviteCallbackExchange(
	key: string,
	state: OAuthState
): Promise<CallbackOutcome> {
	// An invite-intent blob without the invite field, or with an unparseable token,
	// is an INCONSISTENCY (the initiation always writes both) — fail loudly, never
	// degrade to a normal login, never call the exchange.
	const invite = state.invite;
	if (!invite) return INVALID_STATE;

	const parsed = parseInviteToken(invite.token, Date.now());
	if (parsed.status === 'invalid') return INVALID_STATE;
	// `expired` does NOT short-circuit — the client clock is unverified; the server
	// is the authority. A truly dead invite comes back as `dead` below.

	const result = await exchangeSessionWithInvite({
		sessionToken: key,
		db: invite.db,
		inviteToken: invite.token,
		expectedEntityId: parsed.entityId
	});

	const landing = `/invite/${encodeURIComponent(invite.token)}`;

	if (result.status === 'dead') {
		// Nothing persisted: the issued JWT carries no accounts claim — persisting
		// would leave a half-authenticated inconsistency.
		return { ok: false, redirectTo: `${landing}?outcome=dead`, error: 'invite_dead' };
	}
	if (result.status === 'failed') {
		// Retry is real: a fresh CTA click mints a fresh single-use session key.
		return { ok: false, redirectTo: `${landing}?outcome=error`, error: 'invite_exchange_failed' };
	}

	// redeemed / conflict / unexpected all carry a REAL session — persist it
	// (for `unexpected` a retry is impossible anyway: the key is single-use).
	const personId =
		result.status === 'redeemed'
			? result.personId
			: result.status === 'conflict'
				? result.existingPersonId
				: '';
	try {
		// Sequence: user BEFORE token (setToken is the version gate that publishes state).
		setUser({ _id: personId, email: result.user.email, name: result.user.name });
		setLastProvider(state.provider);
		setToken(result.token);
		hydrateAuth();
	} catch {
		return { ok: false, redirectTo: `${landing}?outcome=error`, error: 'persist_failed' };
	}

	// Same rationale as run-callback-exchange: the root layout's onMount already ran
	// (as anonymous) during this callback page's load and does not re-run on the
	// client-side goto — resolve collective discovery before redirecting.
	await hydrateCollectives();

	if (result.status === 'redeemed') return { ok: true, redirectTo: '/' };
	return { ok: true, redirectTo: `${landing}?outcome=${result.status}` };
}

