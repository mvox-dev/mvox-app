import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { createAttendance, updateAttendanceStatus, deleteAttendance } from './attendanceData';
import type { EventAttendance, AttendanceStatus } from './attendanceData';

// One attendance tap's write (#84); touches no Svelte state, so specs need no live component tree.

export interface AttendanceChangeInput {
	cfg: EntuCfg;
	eventId: string;
	memberId: string;
	/** The real (or already-reconciled) existing attendance for this member, or null. */
	existing: EventAttendance | null;
	newStatus: AttendanceStatus | null;
}

interface ApplyAttendanceChangeResult {
	attendanceId: string | null;
}

// Rejects on any write failure, so the caller's optimistic revert always fires.
export async function applyAttendanceChange(
	input: AttendanceChangeInput
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

	return { attendanceId: null };
}

// (*MVOX:Josquin*)
