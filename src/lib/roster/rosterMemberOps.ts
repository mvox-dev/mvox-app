import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import type { RosterRow } from '$lib/roster/rosterData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { listJoinStateDetails } from '$lib/profile/linkedIdentities';
import type { mintSelfLinkInvite, withdrawInvite } from '$lib/invite/inviteData';
import type {
	deactivateMember,
	listDeactivateBlockers,
	reinstateMember
} from '$lib/roster/memberLifecycle';
import type {
	createMemberRecord,
	loadMemberRecord,
	MemberRecord,
	MemberRecordPartialSaveError,
	updateMemberRecord
} from '$lib/roster/memberRecord';
import type { resolveMyLibraryId } from '$lib/library/librarianStore';
import type { assignMemberSection, unassignMemberSection } from '$lib/sections/sectionActions';
import { isValidIdCode } from '$lib/roster/idCode';
import { isSectionMembershipMissing } from '$lib/sections/sectionErrors';
import { isAuthExpiredError } from '$lib/entu/request';
import { focusableByTestId } from '$lib/a11y/focusable';
// The invite token is a bearer secret: the row hands out a full URL, never a bare JWT.
// The URL composer and the copy-click share their code with InviteSurface.
import { buildInviteUrl } from '$lib/invite/invite-links';
import { createInviteLinkCopier } from '$lib/invite/copy-invite-link';
import { bareJoinStates } from '$lib/roster/joinStateView';
import { emptyRecordForm, type MemberOpsState, type RosterState } from '$lib/roster/rosterPageState';

export interface MemberActions {
	assignMemberSection: typeof assignMemberSection;
	unassignMemberSection: typeof unassignMemberSection;
	deactivateMember: typeof deactivateMember;
	reinstateMember: typeof reinstateMember;
	listDeactivateBlockers: typeof listDeactivateBlockers;
	resolveMyLibraryId: typeof resolveMyLibraryId;
	// Write producers: mintSelfLinkInvite and withdrawInvite, never createInvite,
	// which mints a second person+member.
	mintSelfLinkInvite: typeof mintSelfLinkInvite;
	withdrawInvite: typeof withdrawInvite;
	listJoinStateDetails: typeof listJoinStateDetails;
	loadMemberRecord: typeof loadMemberRecord;
	createMemberRecord: typeof createMemberRecord;
	updateMemberRecord: typeof updateMemberRecord;
	isPartialSaveError: (e: unknown) => e is MemberRecordPartialSaveError;
}

export interface MemberOpsDeps<Halves> {
	roster: RosterState;
	mo: MemberOpsState;
	actions: MemberActions;
	cfg: () => EntuCfg | null;
	generation: () => number;
	isCurrent: (g: number) => boolean;
	isOffline: () => boolean;
	currentDbEntityId: () => string | null;
	loadForSelected: () => Promise<void>;
	sessionExpired: () => void;
	readRosterHalves: (cfg: EntuCfg) => Promise<Halves>;
	applyRosterHalves: (read: Halves) => void;
}

export type MemberOps = ReturnType<typeof createMemberOps>;

export function createMemberOps<Halves>(deps: MemberOpsDeps<Halves>) {
	const { roster, mo, actions, generation, isCurrent, isOffline } = deps;

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

	async function armDeactivate(memberId: string): Promise<void> {
		if (mo.deactivatePending) return;
		mo.deactivateRefusal = null;
		mo.deactivateActionError = null;
		mo.pendingDeactivateId = memberId;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="member-deactivate-confirm-${memberId}"]`)?.focus();
	}

	async function disarmDeactivate(memberId: string): Promise<void> {
		mo.pendingDeactivateId = null;
		mo.deactivateRefusal = null;
		mo.deactivateActionError = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="member-deactivate-${memberId}"]`)?.focus();
	}

	async function handleDeactivateConfirm(row: RosterRow): Promise<void> {
		if (isOffline()) return;
		if (mo.deactivatePending) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		const activeAtStart = document.activeElement;
		const ownsFocus =
			!activeAtStart ||
			activeAtStart === document.body ||
			activeAtStart ===
				document.querySelector(`[data-testid="member-deactivate-confirm-${row.memberId}"]`);
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
				await tick();
				focusableByTestId(`member-deactivate-confirm-${row.memberId}`)?.focus();
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
			console.error('roster: inactive roster load failed', e);
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

	async function openRecordEditor(row: RosterRow): Promise<void> {
		const cfg = deps.cfg();
		if (!cfg) return;
		const memberId = row.memberId;
		mo.recordEditorMemberId = memberId;
		mo.recordEditorLookup = null;
		mo.recordSaveError = null;
		mo.recordEditorOriginal = null;
		mo.recordForm = emptyRecordForm();
		const g = generation();
		try {
			const result = await actions.loadMemberRecord(cfg, row.personId);
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			mo.recordEditorLookup = result;
			if (result.state === 'none') {
				mo.recordForm = {
					name: row.profileName ?? row.name,
					phone: '',
					email: row.email,
					birthdate: '',
					id_code: ''
				};
				mo.recordEditorOriginal = { ...mo.recordForm };
			} else if (result.state === 'one') {
				mo.recordForm = {
					name: result.record.name,
					phone: result.record.phone,
					email: result.record.email,
					birthdate: result.record.birthdate,
					id_code: result.record.id_code ?? ''
				};
				mo.recordEditorOriginal = { ...mo.recordForm };
			}
		} catch (e) {
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			console.error('roster: member record load failed', memberId, e);
			mo.recordEditorMemberId = null;
		}
	}

	function cancelRecordEditor(): void {
		mo.recordEditorMemberId = null;
		mo.recordEditorLookup = null;
		mo.recordSaveError = null;
		mo.recordEditorOriginal = null;
	}

	async function saveRecordEditor(row: RosterRow): Promise<void> {
		if (mo.recordSavingMemberId !== null) return;
		if (isOffline()) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		const lookup = mo.recordEditorLookup;
		if (!lookup || lookup.state === 'damaged') return;
		const memberId = row.memberId;
		const form = mo.recordForm;
		mo.recordSaveError = null;
		mo.recordStatus = '';
		if (form.name.trim() === '') {
			mo.recordSaveError = { memberId, kind: 'name-required' };
			return;
		}
		if (/\p{L}/u.test(form.phone)) {
			mo.recordSaveError = { memberId, kind: 'phone-invalid' };
			return;
		}
		if (mo.emailInputEl && !mo.emailInputEl.checkValidity()) {
			mo.recordSaveError = { memberId, kind: 'email-invalid' };
			return;
		}
		if (!isValidIdCode(form.id_code)) {
			mo.recordSaveError = { memberId, kind: 'id-code-invalid' };
			return;
		}
		const g = generation();
		mo.recordSavingMemberId = memberId;
		try {
			const fresh = await actions.loadMemberRecord(cfg, row.personId);
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			if (fresh.state === 'damaged') {
				mo.recordEditorLookup = fresh;
				return;
			}
			const current = mo.recordForm;
			if (fresh.state === 'none') {
				const dbEntityId = row.dbEntityId ?? deps.currentDbEntityId();
				if (!dbEntityId) {
					throw new Error(`roster: cannot resolve the database entity id for member ${memberId}`);
				}
				await actions.createMemberRecord(cfg, {
					dbEntityId,
					personId: row.personId,
					name: current.name,
					phone: current.phone,
					email: current.email,
					birthdate: current.birthdate,
					id_code: current.id_code
				});
			} else {
				const original = mo.recordEditorOriginal ?? emptyRecordForm();
				const changes: Partial<
					Pick<MemberRecord, 'name' | 'phone' | 'email' | 'birthdate' | 'id_code'>
				> = {};
				if (current.name !== original.name) changes.name = current.name;
				if (current.phone !== original.phone) changes.phone = current.phone;
				if (current.email !== original.email) changes.email = current.email;
				if (current.birthdate !== original.birthdate) changes.birthdate = current.birthdate;
				if (current.id_code !== original.id_code) changes.id_code = current.id_code;
				await actions.updateMemberRecord(cfg, fresh.record._id, changes);
			}
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			mo.recordEditorMemberId = null;
			mo.recordEditorLookup = null;
			mo.recordEditorOriginal = null;
			mo.recordStatus = m.roster_record_saved();
		} catch (e) {
			if (!isCurrent(g) || mo.recordEditorMemberId !== memberId) return;
			if (actions.isPartialSaveError(e)) {
				console.error('roster: member record save incomplete', memberId, e.failedField);
				mo.recordSaveError =
					e.landedFields.length > 0
						? { memberId, kind: 'partial', savedFields: e.landedFields }
						: { memberId, kind: 'failed' };
			} else {
				console.error('roster: member record save failed', memberId, e);
				mo.recordSaveError = { memberId, kind: 'failed' };
			}
		} finally {
			if (mo.recordSavingMemberId === memberId) mo.recordSavingMemberId = null;
		}
	}

	return {
		handleAssign,
		handleUnassign,
		handleMove,
		armDeactivate,
		disarmDeactivate,
		handleDeactivateConfirm,
		toggleInactive,
		handleReinstate,
		handleMintInvite,
		handleWithdrawInvite,
		copyInviteLink,
		openRecordEditor,
		cancelRecordEditor,
		saveRecordEditor
	};
}

// (*MVOX:Josquin*)
