import { applyAttendanceChange } from './attendanceOptimistic';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { EventAttendance, AttendanceStatus } from './attendanceData';

// #84 TA.3 — the attendance optimistic queue. Mirrors rsvpChangeQueue.ts
// EXACTLY, with the pending key changed from eventId to a composite
// eventId:memberId key: the conductor's panel shows one P/A/L toggle row per
// member for ONE event, so the unit of "a write in flight" is the member row
// WITHIN that event. Per-tap immediate writes — every request() fires exactly
// one applyAttendanceChange round-trip; nothing batches.
//
// The #15 lesson carries over verbatim: the primary double-tap guard is the UI
// disabling the member's toggle row while pending (via setPending); the queue's
// own per-(event,member) guard is a defensive backstop. All callbacks are
// PER-MEMBER (scoped by eventId) — there is no whole-map operation in this API
// for a caller to misuse, so one member's failure structurally cannot clobber
// another member's in-flight state.
//
// #77 fix-forward — two prior FIX attempts (be08583, debe746) tried a
// "generation" guard in the PAGE's callbacks, comparing a snapshot variable
// against a live one. That failed because BOTH variables were re-synced to the
// same value on every panel open — by the time a stale write's callback fired,
// the comparison always read as "current", never as "stale". Root cause fixed
// here instead, at the source:
//   1. Every callback now receives `eventId` as its first argument, so the
//      CALLER can validate a settling write against whichever event is
//      CURRENTLY open, evaluated fresh at callback-fire time (no snapshot
//      variable to fall out of sync).
//   2. The pending Set is keyed by `${eventId}:${memberId}`, not memberId
//      alone. This is what makes reopening the SAME event correctly preserve
//      in-flight pending state (a duplicate tap on the same event+member while
//      pending is still a no-op) while a write for one event never blocks a
//      later request for the SAME member in a DIFFERENT event. There is no
//      longer a `reset()` escape hatch for a caller to misuse (that whole-set
//      clear was reset()'s bug: it wiped in-flight state for the SAME event
//      too, whenever the panel was merely reopened).

/** The row's value for one member — same shape as AttendanceByMemberId's values. */
export interface AttendanceEntry {
	attendanceId: string;
	status: AttendanceStatus;
}

export interface AttendanceChangeCallbacks {
	/** Apply the optimistic value for exactly this event+member, synchronously. */
	setOptimistic(eventId: string, memberId: string, entry: AttendanceEntry | null): void;
	/** Mark/unmark this event+member as having a write in flight — the caller
	 *  threads this into that row's toggle `disabled` prop (all 3 buttons),
	 *  after checking `eventId` against whichever event is currently open. */
	setPending(eventId: string, memberId: string, pending: boolean): void;
	/** A write settled successfully — the final, reconciled value for this event+member. */
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
	/** Return the set of member IDs currently pending for a given event. Used on
	 *  same-event reopen to carry in-flight state back into the UI's pending set
	 *  (Finding 3 — without this, reopening the same event while a write is in
	 *  flight shows the toggle as enabled and unpressed, and a tap is silently
	 *  swallowed by the queue's own guard). */
	pendingMembersForEvent(eventId: string): Set<string>;
}

function pendingKey(eventId: string, memberId: string): string {
	return `${eventId}:${memberId}`;
}

export function createAttendanceChangeQueue(callbacks: AttendanceChangeCallbacks): AttendanceChangeQueue {
	// The only mutable state this module owns: which (event, member) pairs
	// currently have a write in flight. Everything else (the actual attendance
	// values) lives with the caller, touched exclusively through the per-event-
	// per-member callbacks above.
	const pending = new Set<string>();

	return {
		pendingMembersForEvent(eventId: string): Set<string> {
			const result = new Set<string>();
			const prefix = `${eventId}:`;
			for (const key of pending) {
				if (key.startsWith(prefix)) {
					result.add(key.slice(prefix.length));
				}
			}
			return result;
		},
		request(input) {
			const { cfg, eventId, memberId, existing, newStatus } = input;
			const key = pendingKey(eventId, memberId);

			// Defensive backstop (see module doc) — the primary guard is the UI
			// disabling the toggle for a pending member.
			if (pending.has(key)) return;

			pending.add(key);
			callbacks.setPending(eventId, memberId, true);

			const optimisticEntry: AttendanceEntry | null =
				newStatus !== null
					? { attendanceId: existing?.attendanceId ?? '__optimistic__', status: newStatus }
					: null;
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
