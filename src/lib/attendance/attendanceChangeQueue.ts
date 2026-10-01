// The attendance optimistic write queue: one write per (event, member) tap.
import { applyAttendanceChange } from './attendanceOptimistic';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { EventAttendance, AttendanceStatus } from './attendanceData';

export interface AttendanceEntry {
	attendanceId: string;
	status: AttendanceStatus;
}

export interface AttendanceChangeCallbacks {
	/** Apply the optimistic value for exactly this event+member, synchronously. */
	setOptimistic(eventId: string, memberId: string, entry: AttendanceEntry | null): void;
	/** The caller checks `eventId` against the open event before disabling the row. */
	setPending(eventId: string, memberId: string, pending: boolean): void;
	reconcile(eventId: string, memberId: string, entry: AttendanceEntry | null): void;
	/** A write failed — restore exactly this event+member's PRE-tap value. Nothing else. */
	revert(eventId: string, memberId: string, before: AttendanceEntry | null): void;
}

export interface RequestAttendanceChangeInput {
	cfg: EntuCfg;
	eventId: string;
	memberId: string;
	/** The real (or already-reconciled) existing attendance for this member, or null. */
	existing: EventAttendance | null;
	newStatus: AttendanceStatus | null;
}

export interface AttendanceChangeQueue {
	request(input: RequestAttendanceChangeInput): void;
	/** Reopening an event reads these back, so a row still saving shows as pending. */
	pendingMembersForEvent(eventId: string): Set<string>;
	/** The in-flight values for an event's members; a pending clear has no entry. */
	pendingEntriesForEvent(eventId: string): Record<string, AttendanceEntry>;
}

// Keyed by event and member, so one event's write never blocks the same member in another.
function pendingKey(eventId: string, memberId: string): string {
	return `${eventId}:${memberId}`;
}

export function createAttendanceChangeQueue(callbacks: AttendanceChangeCallbacks): AttendanceChangeQueue {
	const pending = new Map<string, AttendanceEntry | null>();

	function pendingFor(eventId: string): Array<[string, AttendanceEntry | null]> {
		const prefix = `${eventId}:`;
		return [...pending]
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, entry]) => [key.slice(prefix.length), entry]);
	}

	return {
		pendingMembersForEvent(eventId: string): Set<string> {
			return new Set(pendingFor(eventId).map(([memberId]) => memberId));
		},
		pendingEntriesForEvent(eventId: string): Record<string, AttendanceEntry> {
			const result: Record<string, AttendanceEntry> = {};
			for (const [memberId, entry] of pendingFor(eventId)) if (entry) result[memberId] = entry;
			return result;
		},
		request(input) {
			const { cfg, eventId, memberId, existing, newStatus } = input;
			const key = pendingKey(eventId, memberId);

			// Backstop only: the UI disables a pending member's toggle.
			if (pending.has(key)) return;

			const optimisticEntry: AttendanceEntry | null =
				newStatus !== null
					? { attendanceId: existing?.attendanceId ?? '__optimistic__', status: newStatus }
					: null;
			pending.set(key, optimisticEntry);
			callbacks.setPending(eventId, memberId, true);
			callbacks.setOptimistic(eventId, memberId, optimisticEntry);

			applyAttendanceChange({ cfg, eventId, memberId, existing, newStatus })
				.then((result) => {
					pending.delete(key);
					callbacks.setPending(eventId, memberId, false);
					const reconciled: AttendanceEntry | null =
						newStatus !== null ? { attendanceId: result.attendanceId ?? '', status: newStatus } : null;
					callbacks.reconcile(eventId, memberId, reconciled);
				})
				.catch(() => {
					pending.delete(key);
					callbacks.setPending(eventId, memberId, false);
					const before: AttendanceEntry | null = existing
						? { attendanceId: existing.attendanceId, status: existing.status }
						: null;
					callbacks.revert(eventId, memberId, before);
				});
		}
	};
}

// (*MVOX:Josquin*)
