// @vitest-environment happy-dom
//
// #255 done-when 3 + acceptance §2 RED — HISTORY KEEPS ITS SUBJECT, in-slice.
// The conductor's season summary currently derives its row set from the ACTIVE
// roster (deriveAllMemberRates over RosterRow[], attendanceSummary.ts:42), so
// deactivating a member silently vanishes her whole history from the one
// surface that most embodies "past attendance keeps its subject" — the reason
// deactivate beat delete. Pinned here:
//
//   - deriveAllMemberRates grows a 4th param: the INACTIVE members' rows. Their
//     entries stay, marked inactive, with the attended COUNT and NO rate — no
//     `total`, no denominator, no percentage, anywhere (Gama: `total` counts
//     events occurring after she was gone, so any percentage is wrong in a way
//     that reads as a judgement about the person; there is no honest
//     denominator without a deactivation date, which done-when 1 forbids).
//   - That reasoning must live in a CODE COMMENT AT THE SITE (Gama binding) —
//     pinned below via a source-marker assertion (the phrase "no honest
//     denominator" must appear in attendanceSummary.ts). Stated choice: marker
//     assertion, not left to review.
//   - SeasonSummary renders an inactive entry as a marked row with the count
//     and WITHOUT the rate message.
//
// The RED calls cast around the current 3-arg signature so this file compiles
// against the unmodified module and fails on ASSERTIONS, not on types.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

import { deriveAllMemberRates, type MemberAttendanceRate } from './attendanceSummary';
import type { EventAttendance } from './attendanceData';
import type { RosterRow } from '$lib/roster/rosterData';
import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';

afterEach(cleanup);

const active: RosterRow[] = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' }
];
const inactive: RosterRow[] = [
	{ memberId: 'm9', personId: 'pp-9', name: 'Gone Girl', email: 'gone@example.com' }
];
const records: EventAttendance[] = [
	{ attendanceId: 'a1', memberId: 'm1', status: 'present' },
	{ attendanceId: 'a2', memberId: 'm9', status: 'present' },
	{ attendanceId: 'a3', memberId: 'm9', status: 'late' },
	{ attendanceId: 'a4', memberId: 'm9', status: 'absent' }
] as EventAttendance[];

// The widened signature GREEN implements; RED casts to call it today.
const derive = deriveAllMemberRates as unknown as (
	allAttendances: EventAttendance[],
	members: RosterRow[],
	totalEvents: number,
	inactiveMembers: RosterRow[]
) => Array<Record<string, unknown>>;

describe('deriveAllMemberRates — inactive members keep their rows (done-when 3)', () => {
	it('FULL SHAPE: active rows unchanged {memberId,name,attended,total}; inactive rows appended as {memberId,name,attended,inactive:true} — NO total, NO rate, NO denominator key of any kind', () => {
		const rows = derive(records, active, 4, inactive);
		expect(rows).toEqual([
			{ memberId: 'm1', name: 'Alice Alto', attended: 1, total: 4 },
			{ memberId: 'm9', name: 'Gone Girl', attended: 2, inactive: true }
		]);
	});

	it('an inactive member counts present + late as attended, absent and no-record do not (same rule as active rows)', () => {
		const rows = derive(records, [], 4, inactive);
		expect(rows).toEqual([{ memberId: 'm9', name: 'Gone Girl', attended: 2, inactive: true }]);
	});

	it('an inactive member with no records at all still keeps her row, zero-filled', () => {
		const rows = derive([], active, 4, inactive);
		expect(rows).toEqual([
			{ memberId: 'm1', name: 'Alice Alto', attended: 0, total: 4 },
			{ memberId: 'm9', name: 'Gone Girl', attended: 0, inactive: true }
		]);
	});

	it('omitting the 4th argument keeps the existing 3-arg behaviour byte-for-byte (no regression for callers without an inactive read)', () => {
		const rows = deriveAllMemberRates(records, active, 4);
		expect(rows).toEqual([{ memberId: 'm1', name: 'Alice Alto', attended: 1, total: 4 }]);
	});
});

describe('the no-rate reasoning comment AT THE SITE (Gama binding)', () => {
	it("attendanceSummary.ts carries the 'no honest denominator' reasoning where the next person will look for the missing percentage", () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/attendance/attendanceSummary.ts'),
			'utf-8'
		);
		expect(source).toMatch(/no honest denominator/i);
		// The core of the reasoning: the judgement-about-the-person point, not
		// just a bare "no rate here".
		expect(source).toMatch(/judgement about the person/i);
	});
});

describe('SeasonSummary — inactive rows render count-without-rate, marked', () => {
	const memberRates = [
		{ memberId: 'm1', name: 'Alice Alto', attended: 3, total: 4 },
		{ memberId: 'm9', name: 'Gone Girl', attended: 2, inactive: true }
	] as unknown as MemberAttendanceRate[];

	function renderExpanded() {
		return render(SeasonSummary, {
			props: {
				myRate: { attended: 3, total: 4 },
				canExpand: true,
				expanded: true,
				memberRates
			}
		});
	}

	it('an inactive entry renders as member-rate-inactive-{id} with her name and attended count', () => {
		const { container } = renderExpanded();
		const row = container.querySelector('[data-testid="member-rate-inactive-m9"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain('Gone Girl');
		expect(row?.textContent).toContain('2');
	});

	it('the inactive row shows NO rate: the attendance_member_rate message (the one carrying a total) never renders for her, and no percent sign appears', () => {
		const { container } = renderExpanded();
		const row = container.querySelector('[data-testid="member-rate-inactive-m9"]');
		expect(row?.textContent ?? '').not.toContain('[attendance_member_rate ');
		expect(row?.textContent ?? '').not.toContain('%');
		// Belt: the mocked rate message stringifies its params, so a smuggled
		// denominator would surface as "total" in the row text.
		expect(row?.textContent ?? '').not.toContain('total');
	});

	it('the active row is untouched: renders via attendance_member_rate with attended AND total', () => {
		const { container } = renderExpanded();
		const row = container.querySelector('[data-testid="member-rate-m1"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain('[attendance_member_rate {"attended":3,"total":4}]');
	});
});

// (*MVOX:Tallis*)
