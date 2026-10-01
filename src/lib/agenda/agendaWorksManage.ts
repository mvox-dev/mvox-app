// Pure builders for the agenda's works-manage bundle, edition pickers and attendance panel.
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import type { PickerOption, WorkRow, WorksManage } from '$lib/repertoire/types';
import type { Edition, Work } from '$lib/library/libraryData';
import type { createRepertoireRowHandlers } from '$lib/repertoire/repertoireRowHandlers';
import { pickableEditionOptions, withoutProgrammed } from '$lib/repertoire/editionOptions';
import type { AttendancePanel } from '$lib/attendance/types';
import type { AttendanceStatus, MyAttendance } from '$lib/attendance/attendanceData';
import { deriveAttendanceRate } from '$lib/attendance/attendanceSummary';

export function pickableEditionsByEventIdOf(
	works: readonly Work[],
	editions: readonly Edition[],
	worksByEventId: Record<string, WorkRow[]>
): Record<string, PickerOption[]> {
	const all = pickableEditionOptions(works, editions);
	const out: Record<string, PickerOption[]> = {};
	for (const [eventId, rows] of Object.entries(worksByEventId)) {
		out[eventId] = withoutProgrammed(all, rows);
	}
	return out;
}

export function visibleByEventId(
	optionsByEventId: Record<string, PickerOption[]>
): Record<string, boolean> {
	const next: Record<string, boolean> = {};
	for (const [eventId, options] of Object.entries(optionsByEventId)) {
		next[eventId] = options.length > 0;
	}
	return next;
}

export type WorksManagePicks = Pick<
	WorksManage,
	| 'pickableWorksList'
	| 'pickableWorksVisible'
	| 'pickableEditionsByEventId'
	| 'pickableEditionsVisibleByEventId'
	| 'editionOptionsByRowId'
	| 'editionsResolvedWorkIds'
>;

export function worksManageOf(
	ag: AgendaLoadState,
	rowHandlers: ReturnType<typeof createRepertoireRowHandlers>,
	picks: WorksManagePicks
): WorksManage | undefined {
	const anyEventRight = Object.values(ag.eventManageRights).some((right) => right === 'editor');
	if (ag.seasonManageRights !== 'editor' && !anyEventRight) return undefined;
	return {
		seasonRights: ag.seasonManageRights,
		eventRightsByEventId: ag.eventManageRights,
		pickableWorksList: picks.pickableWorksList,
		pickableWorksVisible: picks.pickableWorksVisible,
		pickableWorksPartial: ag.libraryWorksPartial,
		pickableEditionsPartial: ag.libraryEditionsPartial,
		pickableEditionsByEventId: picks.pickableEditionsByEventId,
		pickableEditionsVisibleByEventId: picks.pickableEditionsVisibleByEventId,
		editionOptionsByRowId: picks.editionOptionsByRowId,
		editionsResolvedWorkIds: picks.editionsResolvedWorkIds,
		pendingKeys: ag.managePendingKeys,
		onaddwork: rowHandlers.addWork,
		onstatuschange: rowHandlers.statusChange,
		onpinedition: rowHandlers.pinEdition,
		onremoveitem: rowHandlers.removeItem,
		onmoveitem: rowHandlers.move,
		onaddprogramitem: rowHandlers.addProgramItem
	};
}

export function attendancePanelOf(
	ag: AgendaLoadState,
	ontoggle: AttendancePanel['ontoggle'],
	onclose: AttendancePanel['onclose']
): AttendancePanel | undefined {
	if (!ag.attendanceItem) return undefined;
	return {
		item: ag.attendanceItem,
		members: ag.attendanceRoster,
		attendanceByMemberId: ag.attendanceMap,
		rsvpByMemberId: ag.attendanceRsvpMap,
		loading: ag.attendanceLoading,
		error: ag.attendanceError,
		pendingMemberIds: ag.attendancePendingMemberIds,
		failedMemberIds: ag.attendanceFailedMemberIds,
		savedMemberIds: ag.attendanceSavedMemberIds,
		membersPartial: ag.rosterPartial,
		ontoggle,
		onclose
	};
}

export function myAttendanceByEventIdOf(
	myAttendance: readonly MyAttendance[]
): Record<string, AttendanceStatus> {
	const map: Record<string, AttendanceStatus> = {};
	for (const a of myAttendance) map[a.eventId] = a.status;
	return map;
}

export function mySeasonRateOf(ag: AgendaLoadState) {
	const recentIds = new Set(ag.recentItems.map((i) => i.id));
	const mySeasonAttendance = ag.myAttendance.filter((a) => recentIds.has(a.eventId));
	return deriveAttendanceRate(mySeasonAttendance, ag.recentItems.length);
}
