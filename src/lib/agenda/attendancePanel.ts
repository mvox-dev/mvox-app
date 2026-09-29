import type { AttendanceChangeCallbacks } from '$lib/attendance/attendanceChangeQueue';
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';

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
				const cleared = new Set(eventFailed);
				cleared.delete(memberId);
				const nextMap = new Map(ag.attendanceFailedByEvent);
				if (cleared.size === 0) nextMap.delete(eventId);
				else nextMap.set(eventId, cleared);
				ag.attendanceFailedByEvent = nextMap;
			}
		}
		if (eventId !== ag.attendanceItem?.id) return;
		const next = new Set(ag.attendancePendingMemberIds);
		if (isPending) next.add(memberId);
		else next.delete(memberId);
		ag.attendancePendingMemberIds = next;
		if (isPending && ag.attendanceFailedMemberIds.has(memberId)) {
			const cleared = new Set(ag.attendanceFailedMemberIds);
			cleared.delete(memberId);
			ag.attendanceFailedMemberIds = cleared;
		}
		if (isPending && ag.attendanceSavedMemberIds.has(memberId)) {
			const cleared = new Set(ag.attendanceSavedMemberIds);
			cleared.delete(memberId);
			ag.attendanceSavedMemberIds = cleared;
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
			const cleared = new Set(ag.attendanceSavedMemberIds);
			cleared.delete(targetMemberId);
			ag.attendanceSavedMemberIds = cleared;
		}
	}
	};
}
