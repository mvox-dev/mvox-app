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

/**
 * One member's rate in the conductor's full-roster view. A proper
 * discriminated union (on `inactive`), not one interface with two optional
 * fields — a plain `total?: number` let a TS control-flow narrow on
 * `rate.inactive` leave `rate.total` looking possibly-undefined even in the
 * active branch, which doesn't match reality (an ACTIVE row always carries
 * `total`; an INACTIVE row — #255 done-when 3 — never does, see
 * `deriveAllMemberRates`'s doc for why no rate is ever shown for her, only
 * the attended count). `inactive?: false` on the active arm (rather than
 * omitting it) is what lets `{#if rate.inactive}` in SeasonSummary.svelte
 * narrow correctly — it costs nothing at runtime since it's simply never set.
 */
export type MemberAttendanceRate =
	| { memberId: string; name: string; attended: number; total: number; inactive?: false }
	| { memberId: string; name: string; attended: number; inactive: true };

/**
 * The singer's own season line: how many of `totalEvents` past events she
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
	totalEvents: number,
	// #255 done-when 3 + acceptance §2 — a deactivated member's history KEEPS
	// ITS SUBJECT here: the reason deactivate beat delete in the first place is
	// that past attendance stays visible, and the conductor's full-roster
	// summary is the surface that most directly embodies that promise. Optional
	// (defaults to []) so every pre-#255 caller keeps its exact 3-arg
	// behaviour, byte for byte.
	inactiveMembers: RosterRow[] = []
): MemberAttendanceRate[] {
	const attendedCountFor = (memberId: string): number =>
		allAttendances.filter(
			(a) => a.memberId === memberId && (a.status === 'present' || a.status === 'late')
		).length;

	const activeRows = members.map((member) => ({
		memberId: member.memberId,
		name: member.name,
		attended: attendedCountFor(member.memberId),
		total: totalEvents
	}));

	// Gama binding: `total: totalEvents` counts every event in the WHOLE
	// season, including ones occurring after she was gone — so any percentage
	// computed against it for a deactivated member is wrong in a way that
	// reads as a judgement about the person, not a fact about attendance.
	// There is no honest denominator without a deactivation date, and
	// done-when 1 forbids adding one (status is the ONLY thing a deactivate
	// ever changes) — so her row carries the attended COUNT and, deliberately,
	// no `total`/rate/percentage key of any kind, rather than a number that
	// would be wrong in that way.
	const inactiveRows = inactiveMembers.map((member) => ({
		memberId: member.memberId,
		name: member.name,
		attended: attendedCountFor(member.memberId),
		inactive: true as const
	}));

	return [...activeRows, ...inactiveRows];
}

// (*MVOX:Josquin*)
