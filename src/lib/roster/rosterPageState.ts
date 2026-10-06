import { SvelteSet } from 'svelte/reactivity';
import type { RosterRow } from '$lib/roster/rosterData';
import type { SectionNode } from '$lib/sections/sectionData';
import type { JoinState, JoinStateDetail } from '$lib/profile/linkedIdentities';
import type { OwnerTier } from '$lib/nav/adminStore';
import type { InviteLinkCopier } from '$lib/invite/copy-invite-link';
import type { DeactivateBlocker } from '$lib/roster/memberLifecycle';
import type { MemberRecordLookup } from '$lib/roster/memberRecord';
import type { MemberActions } from '$lib/roster/rosterMemberOps';
import type { ArrangeActions } from '$lib/sections/sectionArrangeOps';

// Children get every read or write as a prop, so the page stays the one writer behind the gate.
export type RosterActions = MemberActions & ArrangeActions;

export type RosterViewMode = 'collapsed' | 'expanded' | 'arrange';

/** What the page loads and every cluster reads; lives as long as the page. */
export interface RosterState {
	rows: RosterRow[];
	// Two truncation causes share one notice: the active list and the archived half.
	membersPartial: boolean;
	inactivePartial: boolean;
	joinStates: Record<string, JoinState>;
	joinStateDetails: Record<string, JoinStateDetail>;
	ownerTier: OwnerTier | 'loading';
	sections: SectionNode[];
	sectionsError: boolean;
	view: 'grouped' | 'flat';
	expandedIds: Set<string>;
	viewMode: RosterViewMode;
	showInactive: boolean;
	inactiveRows: RosterRow[];
	inactiveLoadError: boolean;
}

export function createRosterState(): RosterState {
	return {
		rows: [],
		membersPartial: false,
		inactivePartial: false,
		joinStates: {},
		joinStateDetails: {},
		ownerTier: 'loading',
		sections: [],
		sectionsError: false,
		view: 'grouped',
		expandedIds: new Set(),
		viewMode: 'collapsed',
		showInactive: false,
		inactiveRows: [],
		inactiveLoadError: false
	};
}

// Writes only: the page calls the resets inside its load effect.
export function resetRosterState(r: RosterState, { isSwitch }: { isSwitch: boolean }): void {
	r.membersPartial = false;
	if (isSwitch) {
		r.showInactive = false;
		r.inactiveRows = [];
		r.inactiveLoadError = false;
		r.inactivePartial = false;
	}
}

export function clearRosterState(r: RosterState): void {
	r.rows = [];
	r.sections = [];
	r.membersPartial = false;
	r.inactivePartial = false;
	r.expandedIds = new Set();
	r.sectionsError = false;
	r.joinStates = {};
	r.joinStateDetails = {};
	r.ownerTier = 'loading';
}

export interface RecordForm {
	name: string;
	phone: string;
	email: string;
	birthdate: string;
	id_code: string;
}

export type RecordSaveError =
	| { memberId: string; kind: 'failed' }
	| { memberId: string; kind: 'partial'; savedFields: string[] }
	| { memberId: string; kind: 'name-required' }
	| { memberId: string; kind: 'phone-invalid' }
	| { memberId: string; kind: 'email-invalid' }
	| { memberId: string; kind: 'id-code-invalid' };

export function emptyRecordForm(): RecordForm {
	return { name: '', phone: '', email: '', birthdate: '', id_code: '' };
}

/** Per-member write state: section picks, lifecycle, invites and the record editor. */
export interface MemberOpsState {
	sectionWriteError: { memberId: string } | null;
	sectionBusyIds: SvelteSet<string>;
	pendingDeactivateId: string | null;
	deactivateRefusal: { memberId: string; blockers: DeactivateBlocker[] } | null;
	deactivatePending: boolean;
	deactivateActionError: { memberId: string; kind: 'deactivate' | 'reinstate' } | null;
	reinstatePending: string | null;
	inviteActionPending: boolean;
	inviteLinkByMemberId: Record<string, string>;
	inviteErrorByMemberId: Record<string, boolean>;
	withdrawErrorByMemberId: Record<string, boolean>;
	inviteCopierByMemberId: Record<string, InviteLinkCopier>;
	copiedByMemberId: Record<string, boolean>;
	copyFailedByMemberId: Record<string, boolean>;
	recordEditorMemberId: string | null;
	recordEditorLookup: MemberRecordLookup | null;
	recordForm: RecordForm;
	recordSavingMemberId: string | null;
	recordSaveError: RecordSaveError | null;
	emailInputEl: HTMLInputElement | null;
	recordStatus: string;
	recordEditorOriginal: RecordForm | null;
}

export function createMemberOpsState(): MemberOpsState {
	return {
		sectionWriteError: null,
		sectionBusyIds: new SvelteSet(),
		pendingDeactivateId: null,
		deactivateRefusal: null,
		deactivatePending: false,
		deactivateActionError: null,
		reinstatePending: null,
		inviteActionPending: false,
		inviteLinkByMemberId: {},
		inviteErrorByMemberId: {},
		withdrawErrorByMemberId: {},
		inviteCopierByMemberId: {},
		copiedByMemberId: {},
		copyFailedByMemberId: {},
		recordEditorMemberId: null,
		recordEditorLookup: null,
		recordForm: emptyRecordForm(),
		recordSavingMemberId: null,
		recordSaveError: null,
		emailInputEl: null,
		recordStatus: '',
		recordEditorOriginal: null
	};
}

/** The section-pick writes cleared before the page's rename flush. */
export function resetSectionPicks(mo: MemberOpsState): void {
	mo.sectionWriteError = null;
	mo.sectionBusyIds = new SvelteSet();
}

// A minted link is shown once, so the invite maps survive a same-collective reload.
export function resetMemberOps(mo: MemberOpsState, { isSwitch }: { isSwitch: boolean }): void {
	mo.pendingDeactivateId = null;
	mo.deactivateRefusal = null;
	mo.deactivateActionError = null;
	mo.deactivatePending = false;
	mo.reinstatePending = null;
	mo.inviteActionPending = false;
	mo.recordEditorMemberId = null;
	mo.recordEditorLookup = null;
	mo.recordSaveError = null;
	mo.recordStatus = '';
	if (isSwitch) {
		mo.recordSavingMemberId = null;
		clearInvites(mo);
	}
}

export function clearInvites(mo: MemberOpsState): void {
	mo.inviteLinkByMemberId = {};
	mo.inviteErrorByMemberId = {};
	mo.withdrawErrorByMemberId = {};
	mo.inviteCopierByMemberId = {};
	mo.copiedByMemberId = {};
	mo.copyFailedByMemberId = {};
}

// (*MVOX:Josquin*)
