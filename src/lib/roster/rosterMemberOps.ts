// The roster page's member handlers, composed from one module per concern.
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
	MemberRecordPartialSaveError,
	updateMemberRecord
} from '$lib/roster/memberRecord';
import type { resolveMyLibraryId } from '$lib/library/librarianStore';
import type { assignMemberSection, unassignMemberSection } from '$lib/sections/sectionActions';
import type { MemberOpsState, RosterState } from '$lib/roster/rosterPageState';
import { createSectionOps } from '$lib/roster/rosterSectionOps';
import { createDeactivateOps } from '$lib/roster/rosterDeactivateOps';
import { createInviteOps } from '$lib/roster/rosterInviteOps';
import { createRecordOps } from '$lib/roster/rosterRecordOps';

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
	return {
		...createSectionOps(deps),
		...createDeactivateOps(deps),
		...createInviteOps(deps),
		...createRecordOps(deps)
	};
}
