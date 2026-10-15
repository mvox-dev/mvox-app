// Pure builders for the agenda's attendance panel and badges.
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import type { AttendancePanel } from '$lib/attendance/types';
import type { AttendanceStatus, MyAttendance } from '$lib/attendance/attendanceData';

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
		membersPartial: ag.attendanceRosterPartial,
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
