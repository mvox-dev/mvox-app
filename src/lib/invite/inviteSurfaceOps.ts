// The async reads and the submit of InviteSurface, as results the component turns into state.
import { reportProblem } from '$lib/problems/reportProblem';
import { getToken } from '$lib/auth/storage';
import { isAuthExpiredError } from '$lib/entu/request';
import { resolveOwnerTier, type OwnerTier } from '$lib/nav/adminStore';
import { listJoinStates, type JoinState } from '$lib/profile/linkedIdentities';
import { InviteCreateError, resolveInviteParentId, SelfLinkMintError } from './inviteData';

type Cfg = { db: string; token: string };

export async function loadPersonInviteData(
	cfg: Cfg,
	dbEntityIdForTier: string,
	personIdForTier: string,
	personIds: string[]
): Promise<{ ownerTier: OwnerTier; joinStates: Record<string, JoinState>; personListError: boolean }> {
	let tier: OwnerTier;
	try {
		tier = await resolveOwnerTier(cfg, personIdForTier, undefined, dbEntityIdForTier);
	} catch (e) {
		reportProblem({ area: 'admin/invite', action: 'reading the owner tier', error: e });
		tier = 'error';
	}
	if (tier !== 'owner') return { ownerTier: tier, joinStates: {}, personListError: false };
	try {
		return { ownerTier: tier, joinStates: await listJoinStates(cfg, personIds), personListError: false };
	} catch (e) {
		reportProblem({ area: 'admin/invite', action: 'loading the join states', error: e });
		return { ownerTier: tier, joinStates: {}, personListError: true };
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
		return { status: 'ready', dbEntityId: await resolveInviteParentId({ db: targetDb, token }) };
	} catch (e) {
		if (isAuthExpiredError(e)) return { status: 'session-expired' };
		if (e instanceof InviteCreateError && e.reason === 'not-visible') return { status: 'no-access' };
		reportProblem({ area: 'admin/invite', action: 'load', error: e });
		return { status: 'load-error' };
	}
}

export type SubmitResult =
	| { kind: 'done'; refreshedJoinStates: Record<string, JoinState> }
	| { kind: 'session-expired' }
	| { kind: 'person-error'; name: string; ownerOnly: boolean }
	| { kind: 'create-error'; personId?: string };

export interface SubmitSeams {
	createInvite: (cfg: Cfg, input: { dbEntityId: string }) => Promise<{ inviteToken: string }>;
	mintSelfLinkInvite: (cfg: Cfg, personId: string) => Promise<{ inviteToken: string }>;
}

export async function submitInvite(
	cfg: Cfg,
	target: { dbEntityId: string; personId: string; personName: string },
	seams: SubmitSeams,
	onToken: (inviteToken: string) => void
): Promise<SubmitResult> {
	if (target.personId) {
		try {
			const { inviteToken } = await seams.mintSelfLinkInvite(cfg, target.personId);
			onToken(inviteToken);
			let refreshedJoinStates: Record<string, JoinState> = {};
			try {
				refreshedJoinStates = await listJoinStates(cfg, [target.personId]);
			} catch (refreshErr) {
				reportProblem({
					area: 'admin/invite',
					action: 're-reading the join state after an invite',
					error: refreshErr
				});
			}
			return { kind: 'done', refreshedJoinStates };
		} catch (e) {
			if (isAuthExpiredError(e)) return { kind: 'session-expired' };
			console.error('admin/invite: person-targeted mint failed', e);
			const ownerOnly = e instanceof SelfLinkMintError && e.reason === 'missing-self-editor';
			return { kind: 'person-error', name: target.personName, ownerOnly };
		}
	}
	try {
		const result = await seams.createInvite(cfg, { dbEntityId: target.dbEntityId });
		onToken(result.inviteToken);
		return { kind: 'done', refreshedJoinStates: {} };
	} catch (e) {
		if (isAuthExpiredError(e)) return { kind: 'session-expired' };
		console.error('admin/invite: create failed', e);
		return { kind: 'create-error', personId: e instanceof InviteCreateError ? e.personId : undefined };
	}
}
