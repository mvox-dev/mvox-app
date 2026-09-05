import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { createAttendance, updateAttendanceStatus, deleteAttendance } from './attendanceData';
import type { EventAttendance, AttendanceStatus } from './attendanceData';

// #84 TA.3 — the write-dispatch half of "tap updates immediately and reverts on
// failure", mirroring rsvpOptimistic.ts exactly. Kept framework-agnostic (no
// Svelte state touched here) on purpose — unit-testable without a live component
// tree. The Svelte-side optimistic SET (before calling this) and REVERT (in the
// caller's catch) live in attendanceChangeQueue.ts / the panel's page wiring.

interface ApplyAttendanceChangeInput {
	cfg: EntuCfg;
	eventId: string;
	memberId: string;
	existing: EventAttendance | null;
	newStatus: AttendanceStatus | null;
}

/** `attendanceId: null` means the record was cleared (deleted). */
interface ApplyAttendanceChangeResult {
	attendanceId: string | null;
}

/**
 * Dispatch one attendance write to the right #84 primitive:
 *   - no existing record, a status is set   → createAttendance
 *   - an existing record, a (different) status is set → updateAttendanceStatus
 *   - an existing record, status cleared (tap-active)  → deleteAttendance
 *   - no existing record, no status (nothing to do)    → no write issued
 *
 * REJECTS on any underlying write failure — propagates, does not swallow, so
 * the caller's optimistic-UI revert always fires on a real failure.
 */
export async function applyAttendanceChange(
	input: ApplyAttendanceChangeInput
): Promise<ApplyAttendanceChangeResult> {
	const { cfg, eventId, memberId, existing, newStatus } = input;

	if (!existing && newStatus) {
		const attendanceId = await createAttendance(cfg, { eventId, memberId, status: newStatus });
		return { attendanceId };
	}

	if (existing && newStatus) {
		await updateAttendanceStatus(cfg, existing.attendanceId, newStatus);
		return { attendanceId: existing.attendanceId };
	}

	if (existing && !newStatus) {
		await deleteAttendance(cfg, existing.attendanceId);
		return { attendanceId: null };
	}

	// No existing record, no status — nothing to do.
	return { attendanceId: null };
}

// (*MVOX:Josquin*)
