// The attendance write-status reducer shared by the agenda panel and the event page.
import type { AttendanceChangeCallbacks, AttendanceEntry } from '$lib/attendance/attendanceChangeQueue';
import type { WriteTokens } from '$lib/net/writeTokens';
import type { EventAttendance } from '$lib/attendance/attendanceData';

export function existingAttendance(
	entry: AttendanceEntry | undefined,
	memberId: string
): EventAttendance | null {
	return entry ? { attendanceId: entry.attendanceId, memberId, status: entry.status } : null;
}

export interface AttendanceWriteAccessors {
	/** Whether this event's member rows are on screen. */
	shows(eventId: string): boolean;
	setEntry(memberId: string, entry: AttendanceEntry | null): void;
	setPending(memberId: string, pending: boolean): void;
	setFailed(memberId: string, failed: boolean): void;
	setSaved(memberId: string, saved: boolean): void;
}

export interface AttendanceWriteStatusDeps {
	accessors: AttendanceWriteAccessors;
	tokens: WriteTokens<string>;
	onPending?(eventId: string, memberId: string): void;
	onReconcile?(eventId: string, memberId: string, entry: AttendanceEntry | null): void;
	onRevert?(eventId: string, memberId: string, before: AttendanceEntry | null): void;
}

export const attendanceWriteKey = (eventId: string, memberId: string) => `${eventId}:${memberId}`;

export function createAttendanceWriteStatus(deps: AttendanceWriteStatusDeps): AttendanceChangeCallbacks {
	const { accessors: a, tokens } = deps;
	return {
		setOptimistic(eventId, memberId, entry) {
			if (!tokens.isCurrent(attendanceWriteKey(eventId, memberId)) || !a.shows(eventId)) return;
			a.setEntry(memberId, entry);
		},
		setPending(eventId, memberId, pending) {
			const key = attendanceWriteKey(eventId, memberId);
			if (pending) tokens.begin(key);
			const current = pending && tokens.isCurrent(key);
			if (current) deps.onPending?.(eventId, memberId);
			if (!a.shows(eventId)) return;
			a.setPending(memberId, pending);
			if (current) {
				a.setFailed(memberId, false);
				a.setSaved(memberId, false);
			}
		},
		reconcile(eventId, memberId, entry) {
			if (!tokens.end(attendanceWriteKey(eventId, memberId))) return;
			deps.onReconcile?.(eventId, memberId, entry);
			if (!a.shows(eventId)) return;
			a.setEntry(memberId, entry);
			a.setSaved(memberId, true);
		},
		revert(eventId, memberId, before) {
			if (!tokens.end(attendanceWriteKey(eventId, memberId))) return;
			deps.onRevert?.(eventId, memberId, before);
			if (!a.shows(eventId)) return;
			a.setEntry(memberId, before);
			a.setFailed(memberId, true);
			a.setSaved(memberId, false);
		}
	};
}
