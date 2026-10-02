// The roster rows' section assign, unassign and move handlers.
import { isSectionMembershipMissing } from '$lib/sections/sectionErrors';
import type { MemberOpsDeps } from '$lib/roster/rosterMemberOps';

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
			console.error('roster: section assign with no cfg', memberId, sectionId);
			mo.sectionWriteError = { memberId };
			return;
		}
		const g = generation();
		mo.sectionBusyIds.add(memberId);
		patchMemberSectionIds(memberId, [...currentSectionIds(memberId), sectionId]);
		try {
			await actions.assignMemberSection(cfg, memberId, sectionId);
		} catch (e) {
			console.error('roster: section assign failed', memberId, sectionId, e);
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
			console.error('roster: section unassign with no cfg', memberId, sectionId);
			mo.sectionWriteError = { memberId };
			return;
		}
		const g = generation();
		mo.sectionBusyIds.add(memberId);
		try {
			await actions.unassignMemberSection(cfg, memberId, sectionId);
			if (g !== generation()) return;
			dropBack(memberId, sectionId);
		} catch (e) {
			console.error('roster: section unassign failed', memberId, sectionId, e);
			if (g !== generation()) return;
			if (isSectionMembershipMissing(e)) {
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
			console.error('roster: section move with no cfg', memberId, fromId, toId);
			mo.sectionWriteError = { memberId };
			return;
		}
		const g = generation();
		mo.sectionBusyIds.add(memberId);
		try {
			try {
				await actions.assignMemberSection(cfg, memberId, toId);
			} catch (e) {
				console.error('roster: move — assigning the new section failed', memberId, fromId, toId, e);
				if (g !== generation()) return;
				mo.sectionWriteError = { memberId };
				return;
			}
			if (g !== generation()) return;
			patchMemberSectionIds(memberId, [...currentSectionIds(memberId), toId]);
			try {
				await actions.unassignMemberSection(cfg, memberId, fromId);
			} catch (e) {
				console.error(
					'roster: move — unassigning the old section failed',
					memberId,
					fromId,
					toId,
					e
				);
				if (g !== generation()) return;
				if (isSectionMembershipMissing(e)) {
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
