// The link branch of the OAuth callback (#193): only the initiating person is ever persisted.

import type { OAuthState } from '$lib/auth/state';
import { exchangeSessionWithInvite } from '$lib/invite/redeem';
import { getToken, setToken, setUser, setLastProvider } from '$lib/auth/storage';
import { safeRedirectTarget } from '$lib/auth/redirect';
import { hydrateAuth } from '$lib/auth/session';
import { hydrateCollectives } from '$lib/collectives/store';
import { listLinkedIdentities } from '$lib/profile/linkedIdentities';
import { entuFetch } from '$lib/entu/request';
import type { CallbackOutcome } from './run-callback-exchange';
import { reportProblem } from '$lib/problems/reportProblem';

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
	// The initiation always writes both; without either there is no tripwire, so fail loudly.
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
		// Same person on both sides: already linked to them, not taken by another member.
		if (result.existingPersonId === linkPersonId) {
			return {
				ok: false,
				redirectTo: '/profile?link_error=already_linked',
				error: 'link_already_linked'
			};
		}
		// Bound to a different person: persisting it would swap who is signed in.
		return { ok: false, redirectTo: '/profile?link_error=conflict', error: 'link_conflict' };
	}
	if (result.status === 'unexpected') {
		return { ok: false, redirectTo: '/profile?link_error=unexpected', error: 'link_unexpected' };
	}

	try {
		// The redemption JWT names only this collective; keep the broader session if there is one.
		// Read it first: getToken() self-clears on a stale token version.
		const existingToken = getToken();
		// Sequence: user BEFORE token (setToken is the version gate that publishes state).
		setUser({ _id: result.personId, email: result.user.email, name: result.user.name });
		setLastProvider(state.provider);
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

	// A re-link of a provider already held comes back as a duplicate entry (#219); best-effort.
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
			const action = 're-reading the linked accounts';
			reportProblem({ area: 'link callback', action, error: e });
		}
	}

	return { ok: true, redirectTo: safeRedirectTarget(state.return_to) };
}

// (*MVOX:Josquin*)
