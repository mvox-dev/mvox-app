// The link branch of the OAuth callback (#193): only the initiating person is ever persisted.

import type { OAuthState } from '$lib/auth/state';
import { exchangeSessionWithInvite } from '$lib/invite/redeem';
import { getToken, setToken, setUser, setLastProvider } from '$lib/auth/storage';
import { safeRedirectTarget } from '$lib/auth/redirect';
import { hydrateAuth } from '$lib/auth/session';
import { hydrateCollectives } from '$lib/collectives/store';
import { listLinkedIdentities } from '$lib/profile/linkedIdentities';
import { entuFetch } from '$lib/entu/request';
import { cfgFor } from '$lib/entu/cfg';
import type { CallbackOutcome } from './run-callback-exchange';
import { reportProblem } from '$lib/problems/reportProblem';
import type { CollectiveIdentity } from '$lib/collectives/store';

const AREA = 'link callback';

const SAME_IDENTITY_NOOP: CallbackOutcome = {
	ok: true,
	redirectTo: '/profile?link_noop=same_identity'
};

// Linking errors report (the person is signed in); one callback run per attempt, one report.
function linkError(
	code: string,
	error: string,
	owner: CollectiveIdentity | undefined,
	reason: string = code
): CallbackOutcome {
	reportProblem({ area: AREA, action: 'linking another account', reason, owner });
	return { ok: false, redirectTo: `/profile?link_error=${code}`, error };
}

export async function runLinkCallbackExchange(
	key: string,
	state: OAuthState
): Promise<CallbackOutcome> {
	// The initiation always writes both; without either there is no tripwire, so fail loudly.
	const invite = state.invite;
	const linkPersonId = state.linkPersonId;
	if (!invite || !linkPersonId) {
		// No person to file under: this fresh page load selects a collective only after discovery.
		hydrateAuth();
		await hydrateCollectives();
		return linkError('invalid', 'link_state_invalid', undefined);
	}
	const owner = { db: invite.db, personId: linkPersonId };

	const result = await exchangeSessionWithInvite({
		sessionToken: key,
		db: invite.db,
		inviteToken: invite.token,
		expectedEntityId: linkPersonId
	});

	if (result.status === 'dead') {
		// Nothing persisted: the issued JWT carries no accounts claim.
		return linkError('dead', 'link_dead', owner);
	}
	if (result.status === 'failed') {
		// Retry is real: a fresh CTA click mints a fresh self-invite.
		return linkError('failed', 'link_failed', owner);
	}
	if (result.status === 'conflict') {
		// Same person on both sides: already linked to them, not taken by another member.
		if (result.existingPersonId === linkPersonId) {
			return linkError('already_linked', 'link_already_linked', owner);
		}
		// Bound to a different person: persisting it would swap who is signed in.
		return linkError('conflict', 'link_conflict', owner);
	}
	if (result.status === 'unexpected') {
		const reason = `unexpected: ${result.detail}`;
		return linkError('unexpected', 'link_unexpected', owner, reason);
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
	} catch (e) {
		reportProblem({ area: AREA, action: 'saving the linked sign-in', error: e, owner });
		return {
			ok: false,
			redirectTo: '/profile?link_error=persist_failed',
			error: 'link_persist_failed'
		};
	}

	await hydrateCollectives();

	// A re-link of an account already held comes back as a duplicate entry (#219); best-effort.
	// Same provider and same non-empty string is the same account; anything else is kept (#1030).
	if (state.linkedSnapshot) {
		try {
			const relinked = await listLinkedIdentities(
				cfgFor(invite.db, result.token),
				linkPersonId,
				fetch
			);
			const snapshotIds = new Set(state.linkedSnapshot.map((s) => s._id));
			const newEntry = relinked.identities.find((i) => !snapshotIds.has(i._id));
			const isDuplicate =
				newEntry !== undefined &&
				newEntry.string !== '' &&
				state.linkedSnapshot.some(
					(s) => s.provider === newEntry.provider && s.string === newEntry.string
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
					const action = 'removing a duplicate linked account';
					reportProblem({ area: AREA, action, reason: `status ${deleteRes.status}`, owner });
				}
				return SAME_IDENTITY_NOOP;
			}
		} catch (e) {
			const action = 're-reading the linked accounts';
			reportProblem({ area: AREA, action, error: e, owner });
		}
	}

	return { ok: true, redirectTo: safeRedirectTarget(state.return_to) };
}

// (*MVOX:Josquin*)
