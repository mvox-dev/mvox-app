import { createAttendanceWriteStatus } from '$lib/attendance/attendanceWriteStatus';
import type { AttendanceChangeCallbacks, AttendanceEntry } from '$lib/attendance/attendanceChangeQueue';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import type { WriteTokens } from '$lib/net/writeTokens';
import { withItem } from '$lib/collections/immutable';
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
				const next = { ...ag.attendanceMap };
				if (entry) next[memberId] = entry;
				else delete next[memberId];
				ag.attendanceMap = next;
			},
			setPending(memberId, pending) {
				ag.attendancePendingMemberIds = withItem(ag.attendancePendingMemberIds, memberId, pending);
			},
			setFailed(memberId, failed) {
				if (failed || ag.attendanceFailedMemberIds.has(memberId)) {
					ag.attendanceFailedMemberIds = withItem(ag.attendanceFailedMemberIds, memberId, failed);
				}
			},
			setSaved(memberId, saved) {
				if (saved || ag.attendanceSavedMemberIds.has(memberId)) {
					ag.attendanceSavedMemberIds = withItem(ag.attendanceSavedMemberIds, memberId, saved);
				}
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
