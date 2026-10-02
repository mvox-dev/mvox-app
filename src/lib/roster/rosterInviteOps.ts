// The roster rows' invite mint, withdraw and copy handlers.
import type { RosterRow } from '$lib/roster/rosterData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { isAuthExpiredError } from '$lib/entu/request';
// The invite token is a bearer secret: the row hands out a full URL, never a bare JWT.
// The URL composer and the copy-click share their code with InviteSurface.
import { buildInviteUrl } from '$lib/invite/invite-links';
import { createInviteLinkCopier } from '$lib/invite/copy-invite-link';
import { bareJoinStates } from '$lib/roster/joinStateView';
import type { MemberOpsDeps } from '$lib/roster/rosterMemberOps';

export function createInviteOps<Halves>(deps: MemberOpsDeps<Halves>) {
	const { roster, mo, actions, generation, isCurrent, isOffline } = deps;

	async function refreshJoinState(cfg: EntuCfg, personId: string, g: number): Promise<void> {
		const updated = await actions.listJoinStateDetails(cfg, [personId]);
		if (!isCurrent(g)) return;
		roster.joinStateDetails = { ...roster.joinStateDetails, ...updated };
		roster.joinStates = { ...roster.joinStates, ...bareJoinStates(updated) };
	}

	async function handleMintInvite(row: RosterRow): Promise<void> {
		if (isOffline()) return;
		if (mo.inviteActionPending) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		mo.inviteActionPending = true;
		const g = generation();
		try {
			const { inviteToken } = await actions.mintSelfLinkInvite(cfg, row.personId);
			if (!isCurrent(g)) return;
			const { [row.memberId]: _dropped, ...restErrors } = mo.inviteErrorByMemberId;
			mo.inviteErrorByMemberId = restErrors;
			mo.inviteLinkByMemberId = {
				...mo.inviteLinkByMemberId,
				[row.memberId]: buildInviteUrl(window.location.origin, inviteToken)
			};
			mo.copiedByMemberId = { ...mo.copiedByMemberId, [row.memberId]: false };
			mo.copyFailedByMemberId = { ...mo.copyFailedByMemberId, [row.memberId]: false };
			await refreshJoinState(cfg, row.personId, g);
		} catch (e) {
			if (!isCurrent(g)) return;
			if (isAuthExpiredError(e)) {
				deps.sessionExpired();
				return;
			}
			console.error('roster: invite mint failed', row.memberId, e);
			mo.inviteErrorByMemberId = { ...mo.inviteErrorByMemberId, [row.memberId]: true };
		} finally {
			if (isCurrent(g)) mo.inviteActionPending = false;
		}
	}

	async function handleWithdrawInvite(row: RosterRow): Promise<void> {
		if (isOffline()) return;
		if (mo.inviteActionPending) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		mo.inviteActionPending = true;
		const g = generation();
		try {
			await actions.withdrawInvite(cfg, row.personId);
			if (!isCurrent(g)) return;
			const { [row.memberId]: _droppedW, ...restWithdrawErrors } = mo.withdrawErrorByMemberId;
			mo.withdrawErrorByMemberId = restWithdrawErrors;
			const { [row.memberId]: _droppedLink, ...restLinks } = mo.inviteLinkByMemberId;
			mo.inviteLinkByMemberId = restLinks;
			await refreshJoinState(cfg, row.personId, g);
		} catch (e) {
			if (!isCurrent(g)) return;
			if (isAuthExpiredError(e)) {
				deps.sessionExpired();
				return;
			}
			console.error('roster: withdraw failed', row.memberId, e);
			mo.withdrawErrorByMemberId = { ...mo.withdrawErrorByMemberId, [row.memberId]: true };
		} finally {
			if (isCurrent(g)) mo.inviteActionPending = false;
		}
	}

	async function copyInviteLink(memberId: string): Promise<void> {
		let copier = mo.inviteCopierByMemberId[memberId];
		if (!copier) {
			copier = createInviteLinkCopier(() => mo.inviteLinkByMemberId[memberId] ?? '');
			mo.inviteCopierByMemberId = { ...mo.inviteCopierByMemberId, [memberId]: copier };
		}
		const pending = copier.copy();
		mo.copiedByMemberId = { ...mo.copiedByMemberId, [memberId]: copier.copied };
		mo.copyFailedByMemberId = { ...mo.copyFailedByMemberId, [memberId]: copier.copyFailed };
		await pending;
		mo.copiedByMemberId = { ...mo.copiedByMemberId, [memberId]: copier.copied };
		mo.copyFailedByMemberId = { ...mo.copyFailedByMemberId, [memberId]: copier.copyFailed };
	}

	return { handleMintInvite, handleWithdrawInvite, copyInviteLink };
}
