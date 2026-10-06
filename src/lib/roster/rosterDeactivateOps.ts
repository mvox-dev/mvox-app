// The roster's deactivate, reinstate and inactive-list handlers.
import type { RosterRow } from '$lib/roster/rosterData';
import {
	focusAfterRender,
	focusTestIdAfterRender,
	focusableByTestId,
	ownsFocus as ownsFocusOf
} from '$lib/a11y/focusable';
import type { MemberOpsDeps } from '$lib/roster/rosterMemberOps';
import { reportProblem } from '$lib/problems/reportProblem';

export function createDeactivateOps<Halves>(deps: MemberOpsDeps<Halves>) {
	const { roster, mo, actions, generation, isCurrent, isOffline } = deps;

	async function armDeactivate(memberId: string): Promise<void> {
		if (mo.deactivatePending) return;
		mo.deactivateRefusal = null;
		mo.deactivateActionError = null;
		mo.pendingDeactivateId = memberId;
		await focusTestIdAfterRender(`member-deactivate-confirm-${memberId}`);
	}

	async function disarmDeactivate(memberId: string): Promise<void> {
		mo.pendingDeactivateId = null;
		mo.deactivateRefusal = null;
		mo.deactivateActionError = null;
		await focusTestIdAfterRender(`member-deactivate-${memberId}`);
	}

	async function handleDeactivateConfirm(row: RosterRow): Promise<void> {
		if (isOffline()) return;
		if (mo.deactivatePending) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		const ownsFocus = ownsFocusOf(`member-deactivate-confirm-${row.memberId}`);
		const gEntry = generation();
		mo.deactivatePending = true;
		mo.deactivateRefusal = null;
		mo.deactivateActionError = null;
		try {
			const dbEntityId = row.dbEntityId ?? deps.currentDbEntityId();
			if (!dbEntityId) {
				throw new Error(`roster: cannot resolve the database entity id for member ${row.memberId}`);
			}
			const libraryId = await actions.resolveMyLibraryId(cfg, undefined, dbEntityId);
			const blockers = await actions.listDeactivateBlockers(cfg, row.personId, dbEntityId, libraryId);
			if (blockers.length > 0) {
				if (gEntry !== generation()) return;
				mo.deactivateRefusal = { memberId: row.memberId, blockers };
				return;
			}
			await actions.deactivateMember(cfg, row.memberId);
			if (gEntry !== generation()) return;
			mo.pendingDeactivateId = null;
			await deps.loadForSelected();
		} catch (e) {
			console.error('roster: deactivate failed', row.memberId, e);
			if (gEntry !== generation()) return;
			mo.deactivateActionError = { memberId: row.memberId, kind: 'deactivate' };
		} finally {
			if (gEntry === generation()) mo.deactivatePending = false;
			if (ownsFocus && mo.pendingDeactivateId === row.memberId) {
				await focusAfterRender(() => focusableByTestId(`member-deactivate-confirm-${row.memberId}`));
			}
		}
	}

	async function toggleInactive(): Promise<void> {
		const opening = !roster.showInactive;
		roster.showInactive = opening;
		if (!opening) {
			roster.inactivePartial = false;
			return;
		}
		const cfg = deps.cfg();
		if (!cfg) return;
		const g = generation();
		try {
			roster.inactiveLoadError = false;
			const read = await deps.readRosterHalves(cfg);
			if (!isCurrent(g)) return;
			deps.applyRosterHalves(read);
		} catch (e) {
			if (!isCurrent(g)) return;
			reportProblem({ area: 'roster', action: 'loading the inactive roster', error: e });
			roster.inactiveLoadError = true;
			roster.inactiveRows = [];
			roster.inactivePartial = false;
		}
	}

	async function handleReinstate(memberId: string): Promise<void> {
		if (isOffline()) return;
		if (mo.reinstatePending) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		const gEntry = generation();
		mo.reinstatePending = memberId;
		mo.deactivateActionError = null;
		try {
			await actions.reinstateMember(cfg, memberId);
			await deps.loadForSelected();
		} catch (e) {
			console.error('roster: reinstate failed', memberId, e);
			if (gEntry !== generation()) return;
			mo.deactivateActionError = { memberId, kind: 'reinstate' };
		} finally {
			if (gEntry === generation()) mo.reinstatePending = null;
		}
	}

	return { armDeactivate, disarmDeactivate, handleDeactivateConfirm, toggleInactive, handleReinstate };
}
