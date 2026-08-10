import type { EventAttendance, MyAttendance } from './attendanceData';
import type { RosterRow } from '$lib/roster/rosterData';

// #85 TA.4 GREEN — pure derivation functions for the "my attendance" line and
// the conductor's full-roster season summary. No IO here at all: both
// functions take already-loaded records and fold them into a rate.
//
// `late` COUNTS as attended in both derivations — she showed up, so the rate
// answers "was she there", not "was she punctual". `absent` and NO RECORD
// (a past event nobody ever marked) both do NOT count — a missing record is
// never defaulted to attended.

/** One member's rate in the conductor's full-roster view. */
export interface MemberAttendanceRate {
	memberId: string;
	name: string;
	attended: number;
	total: number;
}

/**
 * The singer's own season line: how many of `totalEvents` past rehearsals she
 * attended (present or late), out of the total. `totalEvents` — not
 * `attendances.length` — is the denominator, since a past event with no
 * record for her still counts toward the season's total, just not toward
 * `attended`.
 */
export function deriveAttendanceRate(
	attendances: MyAttendance[],
	totalEvents: number
): { attended: number; total: number } {
	const attended = attendances.filter((a) => a.status === 'present' || a.status === 'late').length;
	return { attended, total: totalEvents };
}

/**
 * The conductor's full-roster rates: one entry per ROSTER member, in roster
 * order, zero-filled for members with no records at all. A record for someone
 * not on the roster is ignored — no phantom row (the roster, not the
 * attendance records, drives which rows exist).
 */
export function deriveAllMemberRates(
	allAttendances: EventAttendance[],
	members: RosterRow[],
	totalEvents: number
): MemberAttendanceRate[] {
	return members.map((member) => {
		const attended = allAttendances.filter(
			(a) => a.memberId === member.memberId && (a.status === 'present' || a.status === 'late')
		).length;
		return { memberId: member.memberId, name: member.name, attended, total: totalEvents };
	});
}

// (*MVOX:Josquin*)
