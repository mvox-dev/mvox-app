import { reassignEventSeries, unassignEventSeries } from '$lib/events/eventSeriesActions';
import { convertEventToSeries } from '$lib/events/eventConvert';
import { createEvent } from '$lib/entity/entityCreate';
// deleteEvent is imported directly (not re-exported elsewhere) so the
// event-delete spec's partial vi.mock('$lib/seasons/seasonManage', ...),
// which replaces only deleteEvent, still resolves the rest for real.
import { deleteEvent, getSeriesDefaults } from '$lib/seasons/seasonManage';
import { findMyMemberId, findMyRsvpForEvent } from '$lib/rsvp/rsvpData';
import { createRsvpChangeQueue } from '$lib/rsvp/rsvpChangeQueue';
import {
	listAllRsvpsForEvent,
	listAttendance,
	attendanceByMemberId
} from '$lib/attendance/attendanceData';
import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
import { loadRosterIncludingArchived } from '$lib/roster/memberLifecycle';
import { listRepertoireItems } from '$lib/repertoire/repertoireData';
import {
	createProgramItem,
	createRepertoireItem,
	createRepertoireWriteQueue,
	deleteProgramItem,
	deleteRepertoireItem,
	pickableWorks,
	pinEdition,
	planProgramMove,
	reorderProgramItems,
	resolveManageRights,
	updateRepertoireStatus
} from '$lib/repertoire/repertoireActions';
import { listEditions } from '$lib/library/libraryData';
import { updateEventField } from '$lib/events/eventFieldEdit';
import {
	listScheduleItems,
	createScheduleItem,
	updateScheduleItemField,
	removeScheduleItem
} from '$lib/schedule/scheduleData';
import type { EventActions } from '$lib/events/eventPageState';

export function createEventActions(): EventActions {
	return {
		deleteEvent: (...a) => deleteEvent(...a),
		convertEventToSeries: (...a) => convertEventToSeries(...a),
		createEvent: (...a) => createEvent(...a),
		findMyMemberId: (...a) => findMyMemberId(...a),
		findMyRsvpForEvent: (...a) => findMyRsvpForEvent(...a),
		createRsvpChangeQueue: (...a) => createRsvpChangeQueue(...a),
		listAllRsvpsForEvent: (...a) => listAllRsvpsForEvent(...a),
		listAttendance: (...a) => listAttendance(...a),
		attendanceByMemberId: (...a) => attendanceByMemberId(...a),
		createAttendanceChangeQueue: (...a) => createAttendanceChangeQueue(...a),
		loadRosterIncludingArchived: (...a) => loadRosterIncludingArchived(...a),
		listRepertoireItems: (...a) => listRepertoireItems(...a),
		resolveManageRights: (...a) => resolveManageRights(...a),
		createRepertoireWriteQueue: (...a) => createRepertoireWriteQueue(...a),
		createProgramItem: (...a) => createProgramItem(...a),
		createRepertoireItem: (...a) => createRepertoireItem(...a),
		deleteProgramItem: (...a) => deleteProgramItem(...a),
		deleteRepertoireItem: (...a) => deleteRepertoireItem(...a),
		pickableWorks: (...a) => pickableWorks(...a),
		pinEdition: (...a) => pinEdition(...a),
		planProgramMove: (...a) => planProgramMove(...a),
		reorderProgramItems: (...a) => reorderProgramItems(...a),
		updateRepertoireStatus: (...a) => updateRepertoireStatus(...a),
		listEditions: (...a) => listEditions(...a),
		listScheduleItems: (...a) => listScheduleItems(...a),
		createScheduleItem: (...a) => createScheduleItem(...a),
		updateScheduleItemField: (...a) => updateScheduleItemField(...a),
		removeScheduleItem: (...a) => removeScheduleItem(...a),
		updateEventField: (...a) => updateEventField(...a),
		getSeriesDefaults: (...a) => getSeriesDefaults(...a),
		reassignEventSeries: (...a) => reassignEventSeries(...a),
		unassignEventSeries: (...a) => unassignEventSeries(...a)
	};
}

// (*MVOX:Josquin*)
