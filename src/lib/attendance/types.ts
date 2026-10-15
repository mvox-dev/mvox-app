// The attendance panel view model AgendaList hands to AttendanceSurface (#87).

import type { AgendaItem } from '$lib/agenda/types';
import type { AttendanceStatus } from '$lib/attendance/attendanceData';
import type { RosterRow } from '$lib/roster/rosterData';

// One prop, not a dozen: AgendaList alone knows which recent row owns the open panel.
export interface AttendancePanel {
	item: AgendaItem;
	members: RosterRow[];
	attendanceByMemberId: Record<string, { attendanceId: string; status: AttendanceStatus }>;
	rsvpByMemberId: Record<string, { rsvpId: string; status: string }>;
	loading: boolean;
	error: boolean;
	pendingMemberIds: ReadonlySet<string>;
	failedMemberIds: ReadonlySet<string>;
	savedMemberIds: ReadonlySet<string>;
	membersPartial: boolean;
	ontoggle(memberId: string, status: AttendanceStatus | null): void;
	onclose(): void;
}

// (*MVOX:Josquin*)
