import type { AttendanceChangeCallbacks } from '$lib/attendance/attendanceChangeQueue';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import { withItem, without } from '$lib/collections/immutable';

export function attendanceQueueHandlers(ag: AgendaLoadState): AttendanceChangeCallbacks {
	return {
	setOptimistic(eventId, memberId, entry) {
		if (eventId !== ag.attendanceItem?.id) return;
		const next = { ...ag.attendanceMap };
		if (entry) next[memberId] = entry;
		else delete next[memberId];
		ag.attendanceMap = next;
	},
	setPending(eventId, memberId, isPending) {
		if (isPending) {
			const eventFailed = ag.attendanceFailedByEvent.get(eventId);
			if (eventFailed?.has(memberId)) {
				const cleared = without(eventFailed, memberId);
				ag.attendanceFailedByEvent =
					cleared.size === 0
						? without(ag.attendanceFailedByEvent, eventId)
						: new Map(ag.attendanceFailedByEvent).set(eventId, cleared);
			}
		}
		if (eventId !== ag.attendanceItem?.id) return;
		ag.attendancePendingMemberIds = withItem(ag.attendancePendingMemberIds, memberId, isPending);
		if (isPending && ag.attendanceFailedMemberIds.has(memberId)) {
			ag.attendanceFailedMemberIds = without(ag.attendanceFailedMemberIds, memberId);
		}
		if (isPending && ag.attendanceSavedMemberIds.has(memberId)) {
			ag.attendanceSavedMemberIds = without(ag.attendanceSavedMemberIds, memberId);
		}
	},
	reconcile(eventId, targetMemberId, entry) {
		ag.seasonRatesLoaded = false;
		if (targetMemberId === ag.memberId) {
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

		if (eventId !== ag.attendanceItem?.id) return;
		const next = { ...ag.attendanceMap };
		if (entry) next[targetMemberId] = entry;
		else delete next[targetMemberId];
		ag.attendanceMap = next;
		const saved = new Set(ag.attendanceSavedMemberIds);
		saved.add(targetMemberId);
		ag.attendanceSavedMemberIds = saved;
	},
	revert(eventId, targetMemberId, before) {
		ag.seasonRatesLoaded = false;

		const eventFailed = new Set(ag.attendanceFailedByEvent.get(eventId) ?? []);
		eventFailed.add(targetMemberId);
		const nextMap = new Map(ag.attendanceFailedByEvent);
		nextMap.set(eventId, eventFailed);
		ag.attendanceFailedByEvent = nextMap;

		if (targetMemberId === ag.memberId) {
			if (before) {
				const idx = ag.myAttendance.findIndex((a) => a.eventId === eventId);
				const record = { attendanceId: before.attendanceId, eventId, status: before.status };
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

		if (eventId !== ag.attendanceItem?.id) return;
		const next = { ...ag.attendanceMap };
		if (before) next[targetMemberId] = before;
		else delete next[targetMemberId];
		ag.attendanceMap = next;
		const failed = new Set(ag.attendanceFailedMemberIds);
		failed.add(targetMemberId);
		ag.attendanceFailedMemberIds = failed;
		if (ag.attendanceSavedMemberIds.has(targetMemberId)) {
			ag.attendanceSavedMemberIds = without(ag.attendanceSavedMemberIds, targetMemberId);
		}
	}
	};
}
