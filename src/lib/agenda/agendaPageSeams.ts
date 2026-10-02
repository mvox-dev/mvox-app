// The agenda page's read and write seams, handed to its loader and repertoire queues.
import { findMyMemberId, listMyRsvps, rsvpsByEventId } from '$lib/rsvp/rsvpData';
import { loadActiveAndArchivedRosters } from '$lib/roster/memberLifecycle';
import {
	listAttendance,
	listMyAttendance,
	listAllRsvpsForEvent,
	attendanceByMemberId
} from '$lib/attendance/attendanceData';
import { listScheduleItemsByEventId } from '$lib/schedule/scheduleData';
import { listRepertoireItems } from '$lib/repertoire/repertoireData';
import {
	canMarkAttendance,
	createProgramItem,
	createRepertoireItem,
	createRepertoireWriteQueue,
	deleteProgramItem,
	deleteRepertoireItem,
	manageRightsFrom,
	pinEdition,
	planProgramMove,
	reorderProgramItems,
	resolveManageRights,
	updateRepertoireStatus
} from '$lib/repertoire/repertoireActions';
import { manageRightsOrNone } from '$lib/repertoire/manageRights';
import { listWorks, listAllEditions, listAllCopies } from '$lib/library/libraryData';
import type { AgendaLoadDeps } from './agendaLoad';
import type { AgendaRepertoireDeps } from './agendaRepertoireQueues';

type LoaderReads = Pick<
	AgendaLoadDeps,
	| 'findMyMemberId'
	| 'listMyRsvps'
	| 'rsvpsByEventId'
	| 'listMyAttendance'
	| 'listAttendance'
	| 'listAllRsvpsForEvent'
	| 'attendanceByMemberId'
	| 'listWorks'
	| 'listAllEditions'
	| 'listAllCopies'
	| 'listRepertoireItems'
	| 'listScheduleItemsByEventId'
	| 'loadActiveAndArchivedRosters'
	| 'canMarkAttendance'
	| 'manageRightsFrom'
	| 'manageRightsOrNone'
	| 'resolveManageRights'
>;

// Lazy: page specs mock these modules partially, and an eager read of a missing export throws.
export function agendaLoaderReads(): LoaderReads {
	return {
		findMyMemberId: (...a) => findMyMemberId(...a),
		listMyRsvps: (...a) => listMyRsvps(...a),
		rsvpsByEventId: (...a) => rsvpsByEventId(...a),
		listMyAttendance: (...a) => listMyAttendance(...a),
		listAttendance: (...a) => listAttendance(...a),
		listAllRsvpsForEvent: (...a) => listAllRsvpsForEvent(...a),
		attendanceByMemberId: (...a) => attendanceByMemberId(...a),
		listWorks: (...a) => listWorks(...a),
		listAllEditions: (...a) => listAllEditions(...a),
		listAllCopies: (...a) => listAllCopies(...a),
		listRepertoireItems: (...a) => listRepertoireItems(...a),
		listScheduleItemsByEventId: (...a) => listScheduleItemsByEventId(...a),
		loadActiveAndArchivedRosters: (...a) => loadActiveAndArchivedRosters(...a),
		canMarkAttendance: (...a) => canMarkAttendance(...a),
		manageRightsFrom: (...a) => manageRightsFrom(...a),
		manageRightsOrNone: (...a) => manageRightsOrNone(...a),
		resolveManageRights: (...a) => resolveManageRights(...a)
	};
}

export function agendaRepertoireSeams(): Pick<
	AgendaRepertoireDeps,
	'actions' | 'createRepertoireWriteQueue' | 'listRepertoireItems'
> {
	return {
		actions: {
			createRepertoireItem: (...a) => createRepertoireItem(...a),
			updateRepertoireStatus: (...a) => updateRepertoireStatus(...a),
			pinEdition: (...a) => pinEdition(...a),
			deleteProgramItem: (...a) => deleteProgramItem(...a),
			deleteRepertoireItem: (...a) => deleteRepertoireItem(...a),
			planProgramMove: (...a) => planProgramMove(...a),
			reorderProgramItems: (...a) => reorderProgramItems(...a),
			createProgramItem: (...a) => createProgramItem(...a)
		},
		createRepertoireWriteQueue,
		listRepertoireItems: (...a) => listRepertoireItems(...a)
	};
}
