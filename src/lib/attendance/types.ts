// #87 fix — the ONE definition of the attendance panel view model AgendaList
// forwards to AttendanceSurface, mirroring repertoire/types.ts's WorksManage:
// grouped into ONE prop rather than a dozen loose ones because it travels as a
// unit (page -> AgendaList -> AttendanceSurface), and it is AgendaList — not
// the page — that is positioned to know WHICH recent row currently owns the
// open panel (`item.id` against the row it is rendering).
//
// Absent entirely = no panel open anywhere (the page's `attendanceItem` is
// null). Present = exactly one row (the one whose id matches `item.id`)
// renders AttendanceSurface directly beneath its 'Take attendance' button.

import type { AgendaItem } from '$lib/agenda/types';
import type { AttendanceStatus } from '$lib/attendance/attendanceData';
import type { RosterRow } from '$lib/roster/rosterData';

export interface AttendancePanel {
	/** The recent event whose panel is open — also the row-matching key. */
	item: AgendaItem;
	members: RosterRow[];
	attendanceByMemberId: Record<string, { attendanceId: string; status: AttendanceStatus }>;
	rsvpByMemberId: Record<string, { rsvpId: string; status: string }>;
	loading: boolean;
	error: boolean;
	pendingMemberIds: ReadonlySet<string>;
	failedMemberIds: ReadonlySet<string>;
	/** #327 — members whose last write RECONCILED successfully; threaded
	 *  straight into AttendanceSurface's own prop of the same name. */
	savedMemberIds: ReadonlySet<string>;
	/** #321 (PO ruling 2026-09-11) — the member read behind `members` was
	 *  partial. Travels with the rest of the panel because it is a fact ABOUT
	 *  those rows: the surface states it inside itself, where a conductor
	 *  looking for a missing singer is actually looking. */
	membersPartial: boolean;
	ontoggle(memberId: string, status: AttendanceStatus | null): void;
	onclose(): void;
}

// (*MVOX:Josquin*)
