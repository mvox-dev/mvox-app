// The roster page's write and read seams, handed to its member and section handlers.
import { listJoinStateDetails } from '$lib/profile/linkedIdentities';
import { mintSelfLinkInvite, withdrawInvite } from '$lib/invite/inviteData';
import {
	deactivateMember,
	reinstateMember,
	listDeactivateBlockers
} from '$lib/roster/memberLifecycle';
import {
	loadMemberRecord,
	createMemberRecord,
	updateMemberRecord,
	MemberRecordPartialSaveError
} from '$lib/roster/memberRecord';
import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { listSections } from '$lib/sections/sectionData';
import {
	assignMemberSection,
	unassignMemberSection,
	createSection,
	reorderSections,
	deleteSection,
	reparentSection,
	renameSection
} from '$lib/sections/sectionActions';
import type { RosterActions } from '$lib/roster/rosterPageState';

// Lazy: page specs mock these modules partially, and an eager read of a missing export throws.
export function createRosterActions(): RosterActions {
	return {
		assignMemberSection: (...a) => assignMemberSection(...a),
		unassignMemberSection: (...a) => unassignMemberSection(...a),
		deactivateMember: (...a) => deactivateMember(...a),
		reinstateMember: (...a) => reinstateMember(...a),
		listDeactivateBlockers: (...a) => listDeactivateBlockers(...a),
		resolveMyLibraryId: (...a) => resolveMyLibraryId(...a),
		mintSelfLinkInvite: (...a) => mintSelfLinkInvite(...a),
		withdrawInvite: (...a) => withdrawInvite(...a),
		listJoinStateDetails: (...a) => listJoinStateDetails(...a),
		loadMemberRecord: (...a) => loadMemberRecord(...a),
		createMemberRecord: (...a) => createMemberRecord(...a),
		updateMemberRecord: (...a) => updateMemberRecord(...a),
		isPartialSaveError: (e): e is MemberRecordPartialSaveError =>
			e instanceof MemberRecordPartialSaveError,
		listSections: (...a) => listSections(...a),
		createSection: (...a) => createSection(...a),
		reorderSections: (...a) => reorderSections(...a),
		deleteSection: (...a) => deleteSection(...a),
		reparentSection: (...a) => reparentSection(...a),
		renameSection: (...a) => renameSection(...a)
	};
}
