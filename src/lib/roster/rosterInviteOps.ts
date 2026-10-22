// The roster rows' invite send and withdraw handlers.
import type { RosterRow } from '$lib/roster/rosterData';
import type { EntuCfg } from '$lib/entu/cfg';
import { isAuthExpiredError } from '$lib/entu/request';
import { reportProblem } from '$lib/problems/reportProblem';
import { bareJoinStates } from '$lib/roster/joinStateView';
import { withEntry } from '$lib/collections/immutable';
import type { MemberOpsDeps } from '$lib/roster/rosterMemberOps';

export function createInviteOps<Halves>(deps: MemberOpsDeps<Halves>) {
	const { roster, mo, actions, generation, isCurrent, isOffline } = deps;

	async function refreshJoinState(cfg: EntuCfg, personId: string, g: number): Promise<void> {
		const updated = await actions.listJoinStateDetails(cfg, [personId]);
		if (!isCurrent(g)) return;
		roster.joinStateDetails = { ...roster.joinStateDetails, ...updated };
		roster.joinStates = { ...roster.joinStates, ...bareJoinStates(updated) };
	}

	async function runInviteOp<T>(
		row: RosterRow,
		errorKey: 'inviteErrorByMemberId' | 'withdrawErrorByMemberId',
		action: string,
		write: (cfg: EntuCfg) => Promise<T>,
		onDone: (result: T) => void
	): Promise<void> {
		if (isOffline()) return;
		if (mo.inviteActionPending) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		mo.inviteActionPending = true;
		const g = generation();
		try {
			const result = await write(cfg);
			if (!isCurrent(g)) return;
			mo[errorKey] = withEntry(mo[errorKey], row.memberId, null);
			onDone(result);
			await refreshJoinState(cfg, row.personId, g);
		} catch (e) {
			if (!isCurrent(g)) return;
			if (isAuthExpiredError(e)) {
				deps.sessionExpired();
				return;
			}
			reportProblem({ area: 'roster', action, error: e });
			mo[errorKey] = withEntry(mo[errorKey], row.memberId, true);
		} finally {
			if (isCurrent(g)) mo.inviteActionPending = false;
		}
	}

	function handleSendInvite(row: RosterRow): Promise<void> {
		return runInviteOp(
			row,
			'inviteErrorByMemberId',
			'sending an invite',
			(cfg) => actions.sendInvite(cfg, row.personId),
			(outcome) => {
				mo.inviteOutcomeByMemberId = withEntry(mo.inviteOutcomeByMemberId, row.memberId, outcome);
			}
		);
	}

	function handleWithdrawInvite(row: RosterRow): Promise<void> {
		return runInviteOp(
			row,
			'withdrawErrorByMemberId',
			'withdrawing an invite',
			(cfg) => actions.withdrawInvite(cfg, row.personId),
			() => {
				mo.inviteOutcomeByMemberId = withEntry(mo.inviteOutcomeByMemberId, row.memberId, null);
			}
		);
	}

	return { handleSendInvite, handleWithdrawInvite };
}
