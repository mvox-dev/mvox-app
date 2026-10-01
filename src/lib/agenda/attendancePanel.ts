import { createAttendanceWriteStatus } from '$lib/attendance/attendanceWriteStatus';
import type { AttendanceChangeCallbacks, AttendanceEntry } from '$lib/attendance/attendanceChangeQueue';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import type { WriteTokens } from '$lib/net/writeTokens';
import { withEntry, withItem, withItemIfPresent } from '$lib/collections/immutable';
import { withFailedMark } from '$lib/attendance/attendancePanelLoad';

function setMyAttendance(ag: AgendaLoadState, eventId: string, entry: AttendanceEntry | null): void {
	if (entry) {
		const idx = ag.myAttendance.findIndex((a) => a.eventId === eventId);
		const record = { attendanceId: entry.attendanceId, eventId, status: entry.status };
		if (idx >= 0) {
			const next = [...ag.myAttendance];
			next[idx] = record;
			ag.myAttendance = next;
		} else {
			ag.myAttendance = [...ag.myAttendance, record];
		}
	} else {
		ag.myAttendance = ag.myAttendance.filter((a) => a.eventId !== eventId);
	}
}

export function attendanceQueueHandlers(
	ag: AgendaLoadState,
	tokens: WriteTokens<string>
): AttendanceChangeCallbacks {
	return createAttendanceWriteStatus({
		tokens,
		accessors: {
			shows: (eventId) => eventId === ag.attendanceItem?.id,
			setEntry(memberId, entry) {
				ag.attendanceMap = withEntry(ag.attendanceMap, memberId, entry);
			},
			setPending(memberId, pending) {
				ag.attendancePendingMemberIds = withItem(ag.attendancePendingMemberIds, memberId, pending);
			},
			setFailed(memberId, failed) {
				const ids = ag.attendanceFailedMemberIds;
				ag.attendanceFailedMemberIds = withItemIfPresent(ids, memberId, failed);
			},
			setSaved(memberId, saved) {
				const ids = ag.attendanceSavedMemberIds;
				ag.attendanceSavedMemberIds = withItemIfPresent(ids, memberId, saved);
			}
		},
		onPending(eventId, memberId) {
			const byEvent = ag.attendanceFailedByEvent;
			ag.attendanceFailedByEvent = withFailedMark(byEvent, eventId, memberId, false);
		},
		onReconcile(eventId, memberId, entry) {
			ag.seasonRatesLoaded = false;
			if (memberId === ag.memberId) setMyAttendance(ag, eventId, entry);
		},
		onRevert(eventId, memberId, before) {
			ag.seasonRatesLoaded = false;
			const byEvent = ag.attendanceFailedByEvent;
			ag.attendanceFailedByEvent = withFailedMark(byEvent, eventId, memberId, true);
			if (memberId === ag.memberId) setMyAttendance(ag, eventId, before);
		}
	});
}
