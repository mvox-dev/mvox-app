// The roster rows' section assign, unassign and move handlers.
import { isSectionMembershipMissing } from '$lib/sections/sectionErrors';
import type { MemberOpsDeps } from '$lib/roster/rosterMemberOps';
import { reportProblem } from '$lib/problems/reportProblem';
import { NO_CFG, writeOwner } from '$lib/roster/rosterProblems';

export function createSectionOps<Halves>(deps: MemberOpsDeps<Halves>) {
	const { roster, mo, actions, generation, isOffline } = deps;

	function currentSectionIds(memberId: string): string[] {
		return roster.rows.find((r) => r.memberId === memberId)?.sectionIds ?? [];
	}

	function patchMemberSectionIds(memberId: string, sectionIds: string[]): void {
		const distinct = [...new Set(sectionIds)];
		roster.rows = roster.rows.map((r) =>
			r.memberId === memberId ? { ...r, sectionIds: distinct } : r
		);
	}

	function dropBack(memberId: string, sectionId: string): void {
		patchMemberSectionIds(
			memberId,
			currentSectionIds(memberId).filter((id) => id !== sectionId)
		);
	}

	async function handleAssign(memberId: string, sectionId: string): Promise<void> {
		if (isOffline()) return;
		mo.sectionWriteError = null;
		const cfg = deps.cfg();
		if (!cfg) {
			reportProblem({ area: 'roster', action: 'assigning a member to a section', reason: NO_CFG });
			mo.sectionWriteError = { memberId };
			return;
		}
		const g = generation();
		const owner = writeOwner(cfg);
		mo.sectionBusyIds.add(memberId);
		patchMemberSectionIds(memberId, [...currentSectionIds(memberId), sectionId]);
		try {
			await actions.assignMemberSection(cfg, memberId, sectionId);
		} catch (e) {
			reportProblem({ area: 'roster', action: 'assigning a member to a section', error: e, owner });
			if (g !== generation()) return;
			dropBack(memberId, sectionId);
			mo.sectionWriteError = { memberId };
		} finally {
			mo.sectionBusyIds.delete(memberId);
		}
	}

	async function handleUnassign(memberId: string, sectionId: string): Promise<void> {
		if (isOffline()) return;
		mo.sectionWriteError = null;
		const cfg = deps.cfg();
		if (!cfg) {
			reportProblem({ area: 'roster', action: 'taking a member out of a section', reason: NO_CFG });
			mo.sectionWriteError = { memberId };
			return;
		}
		const g = generation();
		const owner = writeOwner(cfg);
		mo.sectionBusyIds.add(memberId);
		try {
			await actions.unassignMemberSection(cfg, memberId, sectionId);
			if (g !== generation()) return;
			dropBack(memberId, sectionId);
		} catch (e) {
			// Already out of the section is what the user asked for: nothing failed.
			const missing = isSectionMembershipMissing(e);
			const action = 'taking a member out of a section';
			if (!missing) reportProblem({ area: 'roster', action, error: e, owner });
			if (g !== generation()) return;
			if (missing) {
				dropBack(memberId, sectionId);
			} else {
				mo.sectionWriteError = { memberId };
			}
		} finally {
			mo.sectionBusyIds.delete(memberId);
		}
	}

	async function handleMove(memberId: string, fromId: string, toId: string): Promise<void> {
		if (isOffline()) return;
		mo.sectionWriteError = null;
		const cfg = deps.cfg();
		if (!cfg) {
			reportProblem({ area: 'roster', action: 'moving a member', reason: NO_CFG });
			mo.sectionWriteError = { memberId };
			return;
		}
		const g = generation();
		const owner = writeOwner(cfg);
		mo.sectionBusyIds.add(memberId);
		try {
			try {
				await actions.assignMemberSection(cfg, memberId, toId);
			} catch (e) {
				const action = 'moving a member: adding the new section';
				reportProblem({ area: 'roster', action, error: e, owner });
				if (g !== generation()) return;
				mo.sectionWriteError = { memberId };
				return;
			}
			if (g !== generation()) return;
			patchMemberSectionIds(memberId, [...currentSectionIds(memberId), toId]);
			try {
				await actions.unassignMemberSection(cfg, memberId, fromId);
			} catch (e) {
				const missing = isSectionMembershipMissing(e);
				const action = 'moving a member: leaving the old section';
				if (!missing) reportProblem({ area: 'roster', action, error: e, owner });
				if (g !== generation()) return;
				if (missing) {
					dropBack(memberId, fromId);
					return;
				}
				mo.sectionWriteError = { memberId };
				return;
			}
			if (g !== generation()) return;
			dropBack(memberId, fromId);
		} finally {
			mo.sectionBusyIds.delete(memberId);
		}
	}

	return { handleAssign, handleUnassign, handleMove };
}
