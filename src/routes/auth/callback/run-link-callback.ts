// #193 — link-intent branch of the OAuth callback: the user came back from the
// SECOND provider carrying a real session key + the self-minted invite in the
// (already-consumed) state blob. Redemption reuses the sole account-scoped
// exchange (exchangeSessionWithInvite) — entu-api's replaceInviteWithCredentials
// then writes the second identity as a separate array entry, leaving the first
// identity untouched (APPEND, platform-verified live in the SPIKE).
//
// The decisive difference from the admin-invite branch (run-invite-callback.ts):
// there, a `conflict` persists the OTHER person as the current user (acceptable
// for a stranger arriving via an admin invite link). For a self-link initiated
// from an authenticated profile page that would mean "clicked link, got
// silently logged in AS SOMEONE ELSE" — this branch REFUSES to persist any
// identity other than the initiating person (state.linkPersonId), and surfaces
// every non-happy outcome as a loud, named error instead.

import type { OAuthState } from '$lib/auth/state';
import { exchangeSessionWithInvite } from '$lib/invite/redeem';
import { getToken, setToken, setUser, setLastProvider } from '$lib/auth/storage';
import { safeRedirectTarget } from '$lib/auth/redirect';
import { hydrateAuth } from '$lib/auth/session';
import { hydrateCollectives } from '$lib/collectives/store';
import { listLinkedIdentities } from '$lib/profile/linkedIdentities';
import { entuFetch } from '$lib/entu/request';
import type { CallbackOutcome } from './run-callback-exchange';

const SAME_IDENTITY_NOOP: CallbackOutcome = {
	ok: true,
	redirectTo: '/profile?link_noop=same_identity'
};

const INVALID_STATE: CallbackOutcome = {
	ok: false,
	redirectTo: '/profile?link_error=invalid',
	error: 'link_state_invalid'
};

export async function runLinkCallbackExchange(
	key: string,
	state: OAuthState
): Promise<CallbackOutcome> {
	// A link-intent blob without the invite carrier, or without the initiating
	// person to tripwire against, is an INCONSISTENCY (the initiation always
	// writes both) — fail loudly, never call the exchange.
	const invite = state.invite;
	const linkPersonId = state.linkPersonId;
	if (!invite || !linkPersonId) return INVALID_STATE;

	const result = await exchangeSessionWithInvite({
		sessionToken: key,
		db: invite.db,
		inviteToken: invite.token,
		expectedEntityId: linkPersonId
	});

	if (result.status === 'dead') {
		// Nothing persisted: the issued JWT carries no accounts claim.
		return { ok: false, redirectTo: '/profile?link_error=dead', error: 'link_dead' };
	}
	if (result.status === 'failed') {
		// Retry is real: a fresh CTA click mints a fresh self-invite.
		return { ok: false, redirectTo: '/profile?link_error=failed', error: 'link_failed' };
	}
	if (result.status === 'conflict') {
		// Same person on both sides: the identity the user just signed in with is
		// already bound to THEM. "Already in use by another member here" would be a
		// lie, so this gets its own outcome. (entu-api only raises the conflict flag
		// when `existingEntry.user._id !== inviteData.entityId` — index.get.js:227-229
		// — so this branch is a tripwire, not a routine path; classifying it anyway
		// keeps the message truthful if that ever changes.)
		if (result.existingPersonId === linkPersonId) {
			return {
				ok: false,
				redirectTo: '/profile?link_error=already_linked',
				error: 'link_already_linked'
			};
		}
		// The session-key holder's second identity is ALREADY bound to a different
		// person than the one that initiated the link. Persisting it here would
		// silently swap who the user is signed in as — refused.
		return { ok: false, redirectTo: '/profile?link_error=conflict', error: 'link_conflict' };
	}
	if (result.status === 'unexpected') {
		return { ok: false, redirectTo: '/profile?link_error=unexpected', error: 'link_unexpected' };
	}

	// redeemed — the ONLY status that persists, and only for linkPersonId itself
	// (result.personId === linkPersonId is guaranteed by the exchange's own
	// expectedEntityId check — any mismatch comes back as `unexpected` instead).
	try {
		// The redemption JWT is ACCOUNT-SCOPED: exchangeSessionWithInvite hits the
		// account-scoped /auth endpoint for the invite's db, and entu-api filters the
		// whole db scan down to that one db (index.get.js:124-129, :143) — so its
		// `accounts` claim names ONLY the collective the link was started from.
		// hydrateAuth reads personIdByDb straight off that claim and hydrateCollectives
		// wholesale-replaces the switcher list, so persisting it would silently DROP
		// every OTHER collective the user belongs to until their next full login.
		// The pre-existing session token is untouched by linking and is strictly
		// broader, so the happy path keeps it.
		//
		// Read the existing token FIRST: getToken() self-clears on a stale token
		// version, which would wipe a user written before it.
		const existingToken = getToken();
		// Sequence: user BEFORE token (setToken is the version gate that publishes state).
		setUser({ _id: result.personId, email: result.user.email, name: result.user.name });
		setLastProvider(state.provider);
		// Fallback only — never the default: with no session token left there is
		// nothing broader to keep, and a narrowed session beats no session at all.
		if (!existingToken) setToken(result.token);
		hydrateAuth();
	} catch {
		return {
			ok: false,
			redirectTo: '/profile?link_error=persist_failed',
			error: 'link_persist_failed'
		};
	}

	await hydrateCollectives();

	// #219 — same-identity re-link detection. `redeemed` alone cannot tell a
	// legitimate new link from entu-api's same-person branch quietly re-binding a
	// provider the person already has (index.get.js:220-225) — the only signal is
	// comparing the post-redemption identity set back against the pre-mint
	// snapshot the profile page rode in on the blob. Best-effort: any failure
	// here (a bad re-read, an unreachable rights-refused DELETE) falls through to
	// the ordinary success path below — the sign-in itself must never fail on
	// this branch, and a missing snapshot (older blob) skips the check entirely
	// rather than guessing which entry is new.
	if (state.linkedSnapshot) {
		try {
			const relinked = await listLinkedIdentities(
				{ db: invite.db, token: result.token },
				linkPersonId,
				fetch
			);
			const snapshotIds = new Set(state.linkedSnapshot.map((s) => s._id));
			const newEntry = relinked.identities.find((i) => !snapshotIds.has(i._id));
			const isDuplicate =
				newEntry !== undefined &&
				state.linkedSnapshot.some(
					(s) => s.uid === newEntry.uid && s.provider === newEntry.provider
				);
			if (newEntry && isDuplicate) {
				const deleteRes = await entuFetch(
					invite.db,
					`property/${newEntry._id}`,
					result.token,
					{ method: 'DELETE' },
					fetch
				);
				if (!deleteRes.ok) {
					console.warn(
						'run-link-callback: same-identity duplicate DELETE failed, status',
						deleteRes.status
					);
				}
				return SAME_IDENTITY_NOOP;
			}
		} catch (e) {
			console.warn('run-link-callback: same-identity re-read failed', e);
		}
	}

	return { ok: true, redirectTo: safeRedirectTarget(state.return_to) };
}

// (*MVOX:Josquin* — #193 GREEN: link-callback redemption branch)
