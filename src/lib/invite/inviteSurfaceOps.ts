// The async reads and the submit of InviteSurface, as results the component turns into state.
import { reportProblem } from '$lib/problems/reportProblem';
import { getToken } from '$lib/auth/storage';
import { cfgFor } from '$lib/entu/cfg';
import { isAuthExpiredError } from '$lib/entu/request';
import { resolveDbRight, type DbRight } from '$lib/nav/dbRights';
import { listJoinStates, type JoinState } from '$lib/profile/linkedIdentities';
import { InviteCreateError, resolveInviteParentId, type SendInviteResult } from './inviteData';

type Cfg = { db: string; token: string };

export async function loadPersonInviteData(
	cfg: Cfg,
	dbEntityIdForTier: string,
	personIdForTier: string,
	personIds: string[]
): Promise<{ dbRight: DbRight; joinStates: Record<string, JoinState>; personListError: boolean }> {
	let tier: DbRight;
	try {
		tier = await resolveDbRight(cfg, personIdForTier, undefined, dbEntityIdForTier);
	} catch (e) {
		reportProblem({ area: 'admin/invite', action: 'reading the owner tier', error: e });
		tier = 'error';
	}
	if (tier !== 'owner') return { dbRight: tier, joinStates: {}, personListError: false };
	try {
		return { dbRight: tier, joinStates: await listJoinStates(cfg, personIds), personListError: false };
	} catch (e) {
		reportProblem({ area: 'admin/invite', action: 'loading the join states', error: e });
		return { dbRight: tier, joinStates: {}, personListError: true };
	}
}

export type PrerequisitesResult =
	| { status: 'ready'; dbEntityId: string }
	| { status: 'session-expired' | 'no-access' | 'load-error' };

export async function loadPrerequisites(targetDb: string): Promise<PrerequisitesResult> {
	const token = getToken();
	if (!token) {
		console.error('admin/invite: no auth token in storage on a protected route');
		return { status: 'load-error' };
	}
	try {
		return { status: 'ready', dbEntityId: await resolveInviteParentId(cfgFor(targetDb)) };
	} catch (e) {
		if (isAuthExpiredError(e)) return { status: 'session-expired' };
		if (e instanceof InviteCreateError && e.reason === 'not-visible') return { status: 'no-access' };
		reportProblem({ area: 'admin/invite', action: 'load', error: e });
		return { status: 'load-error' };
	}
}

export type SubmitResult =
	| { kind: 'sent'; outcome: SendInviteResult; refreshedJoinStates: Record<string, JoinState> }
	| { kind: 'session-expired' }
	| { kind: 'send-error'; createdPersonId?: string }
	| { kind: 'create-error'; personId?: string };

export interface SubmitSeams {
	createInvite: (cfg: Cfg, input: { dbEntityId: string; email: string }) => Promise<{ personId: string }>;
	sendInvite: (cfg: Cfg, personId: string) => Promise<SendInviteResult>;
}

async function refreshJoinState(cfg: Cfg, personId: string): Promise<Record<string, JoinState>> {
	try {
		return await listJoinStates(cfg, [personId]);
	} catch (error) {
		reportProblem({ area: 'admin/invite', action: 're-reading the join state after an invite', error });
		return {};
	}
}

// A new person is created with the email first, then both paths send through send-invite.
export async function submitInvite(
	cfg: Cfg,
	target: { dbEntityId: string; personId: string; email: string },
	seams: SubmitSeams
): Promise<SubmitResult> {
	let personId = target.personId;
	if (!personId) {
		try {
			const input = { dbEntityId: target.dbEntityId, email: target.email };
			personId = (await seams.createInvite(cfg, input)).personId;
		} catch (e) {
			if (isAuthExpiredError(e)) return { kind: 'session-expired' };
			console.error('admin/invite: create failed', e);
			return { kind: 'create-error', personId: e instanceof InviteCreateError ? e.personId : undefined };
		}
	}
	let outcome: SendInviteResult;
	try {
		outcome = await seams.sendInvite(cfg, personId);
	} catch (error) {
		if (isAuthExpiredError(error)) return { kind: 'session-expired' };
		reportProblem({ area: 'admin/invite', action: 'sending an invite', error });
		return { kind: 'send-error', createdPersonId: target.personId ? undefined : personId };
	}
	const refreshedJoinStates = target.personId ? await refreshJoinState(cfg, personId) : {};
	return { kind: 'sent', outcome, refreshedJoinStates };
}
