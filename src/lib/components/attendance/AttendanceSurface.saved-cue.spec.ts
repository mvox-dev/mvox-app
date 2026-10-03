// @vitest-environment happy-dom
// Each member row owns a persistent, visible role=status node, blank until that member's write
// settles, then m.attendance_saved(). The tally is marked unconfirmed while any write is pending.
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttendanceSurface from './AttendanceSurface.svelte';
import type { AgendaItem } from '$lib/agenda/types';
import { expectNameMarkedOnce } from '$lib/testing/nameMarker';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', {
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_group_label: (p) => `Attendance for ${(p as { name: string }).name}`,
		attendance_toggle_aria_label: (p) =>
			`Mark ${(p as { name: string }).name} as ${(p as { status: string }).status}`,
		attendance_rsvp_none: () => 'No answer',
		attendance_rsvp_aria_label: (p) =>
			`RSVP for ${(p as { name: string }).name}: ${(p as { rsvp: string }).rsvp}`,
		attendance_close: () => 'Close',
		attendance_loading: () => 'Loading attendance…',
		attendance_ready: (p) => `Attendance loaded, ${(p as { count: number }).count} members`,
		attendance_load_error: () => "Couldn't load attendance.",
		attendance_save_failed: () => 'Could not save attendance.',
		attendance_saved: () => 'Saved.',
		attendance_tally: (p) => {
			const t = p as { present: number; absent: number; late: number };
			return `${t.present} present · ${t.absent} absent · ${t.late} late`;
		},
		attendance_tally_unconfirmed: () => 'Counts include unconfirmed changes.',
		picker_partial_members_notice: () => 'Not every member is listed here',
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late'
	})
);

afterEach(cleanup);

const ITEM: AgendaItem = {
	id: 'ev1',
	name: 'Tuesday Rehearsal',
	startDatetime: '2026-06-10T16:00:00.000Z',
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
};

const MEMBERS = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

function baseProps(overrides: Record<string, unknown> = {}) {
	return {
		item: ITEM,
		members: MEMBERS,
		attendanceByMemberId: {},
		rsvpByMemberId: {},
		loading: false,
		error: false,
		...overrides
	};
}

function savedRegion(container: HTMLElement, memberId: string): HTMLElement | null {
	return container.querySelector(`[data-testid="attendance-saved-status-${memberId}"]`);
}

const STATUSES = ['present', 'absent', 'late'] as const;

describe('AttendanceSurface — every row mounts a PERSISTENT saved announcement region (#267 rule, #326 shape)', () => {
	it('the region exists on every member row even when nothing is saved — a live region must pre-exist its first announcement', () => {
		const { container } = render(AttendanceSurface, baseProps());
		expect(savedRegion(container, 'm1')).not.toBeNull();
		expect(savedRegion(container, 'm2')).not.toBeNull();
	});

	it('the region is role="status" aria-live="polite" — a polite announcement, never an alert', () => {
		const { container } = render(AttendanceSurface, baseProps());
		const region = savedRegion(container, 'm1');
		expect(region?.getAttribute('role')).toBe('status');
		expect(region?.getAttribute('aria-live')).toBe('polite');
	});

	it('the region is VISIBLE, not sr-only — the #326 GREEN stated choice (a), one combined visible+aria-live node', () => {
		const { container } = render(AttendanceSurface, baseProps({ savedMemberIds: new Set(['m1']) }));
		const region = savedRegion(container, 'm1');
		expect(region?.className ?? '').not.toMatch(/sr-only|hidden/);
	});

	it('savedMemberIds omitted (default) — every region is mounted BLANK, no saved text anywhere', () => {
		const { container } = render(AttendanceSurface, baseProps());
		expect(savedRegion(container, 'm1')?.textContent?.trim()).toBe('');
		expect(savedRegion(container, 'm2')?.textContent?.trim()).toBe('');
		expect(container.textContent).not.toContain('Saved.');
	});

	it('the region lives INSIDE its own member row — the cue physically sits on the row that reconciled', () => {
		const { container } = render(AttendanceSurface, baseProps({ savedMemberIds: new Set(['m1']) }));
		expect(
			container.querySelector(
				'[data-testid="attendance-row-m1"] [data-testid="attendance-saved-status-m1"]'
			)
		).not.toBeNull();
	});
});

describe('AttendanceSurface — savedMemberIds announces the reconciled write, per member (granularity)', () => {
	it("a member in savedMemberIds carries m.attendance_saved() in that member's region", () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m1: { attendanceId: 'att-1', status: 'present' } },
				savedMemberIds: new Set(['m1'])
			})
		);
		expect(savedRegion(container, 'm1')?.textContent).toContain('Saved.');
	});

	it('a cue never claims more than the row that reconciled — the OTHER row stays blank (the issue bullet, verbatim)', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m1: { attendanceId: 'att-1', status: 'present' } },
				savedMemberIds: new Set(['m1'])
			})
		);
		expect(savedRegion(container, 'm2')?.textContent?.trim()).toBe('');
		expect(
			container.querySelector('[data-testid="attendance-row-m2"]')?.textContent
		).not.toContain('Saved.');
	});

	it('a successfully CLEARED record announces too — reconciled-null renders identically to never-marked, the cue is the only distinguisher', () => {
		// m1 is in savedMemberIds with NO attendance entry: her record was just
		// cleared and the write reconciled.
		const { container } = render(
			AttendanceSurface,
			baseProps({ savedMemberIds: new Set(['m1']) })
		);
		expect(savedRegion(container, 'm1')?.textContent).toContain('Saved.');
		for (const status of STATUSES) {
			expect(
				container
					.querySelector(`[data-testid="attendance-toggle-m1-${status}"]`)
					?.getAttribute('aria-pressed'),
				`attendance-toggle-m1-${status}`
			).toBe('false');
		}
	});

	it('saved never disables — the row stays fully interactive, a tap still reaches ontoggle', async () => {
		const ontoggle = vi.fn();
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m1: { attendanceId: 'att-1', status: 'present' } },
				savedMemberIds: new Set(['m1']),
				ontoggle
			})
		);
		for (const status of STATUSES) {
			expect(
				container
					.querySelector(`[data-testid="attendance-toggle-m1-${status}"]`)
					?.getAttribute('aria-disabled'),
				`attendance-toggle-m1-${status}`
			).toBeNull();
		}
		await fireEvent.click(container.querySelector('[data-testid="attendance-toggle-m1-late"]')!);
		expect(ontoggle).toHaveBeenCalledWith('m1', 'late');
	});

	it('saved does NOT set aria-busy — a settled state, not an in-flight one', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m1: { attendanceId: 'att-1', status: 'present' } },
				savedMemberIds: new Set(['m1'])
			})
		);
		expect(
			container
				.querySelector('[data-testid="attendance-status-group-m1"]')
				?.getAttribute('aria-busy')
		).not.toBe('true');
	});
});

describe('AttendanceSurface — pending stays a SILENT disable, byte-preserved (PO ruling; task pin 4)', () => {
	it('a pending member: toolbar aria-busy + buttons aria-disabled, saved region BLANK, no new row text', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m1: { attendanceId: '__optimistic__', status: 'present' } },
				pendingMemberIds: new Set(['m1'])
			})
		);
		expect(
			container
				.querySelector('[data-testid="attendance-status-group-m1"]')
				?.getAttribute('aria-busy')
		).toBe('true');
		for (const status of STATUSES) {
			expect(
				container
					.querySelector(`[data-testid="attendance-toggle-m1-${status}"]`)
					?.getAttribute('aria-disabled'),
				`attendance-toggle-m1-${status}`
			).toBe('true');
		}
		expect(savedRegion(container, 'm1')?.textContent?.trim()).toBe('');
		expect(
			container.querySelector('[data-testid="attendance-row-m1"]')?.textContent
		).not.toContain('Saved.');
	});
});

describe('AttendanceSurface — failure and saved are mutually exclusive per row (task pin 4)', () => {
	it('a failed member: the role=alert line renders exactly as today, and her saved region stays blank', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({ failedMemberIds: new Set(['m1']) })
		);
		const alert = container.querySelector('[data-testid="attendance-save-failed-m1"]');
		expect(alert).not.toBeNull();
		expect(alert?.getAttribute('role')).toBe('alert');
		expect(alert?.textContent).toContain('Could not save attendance.');
		expect(savedRegion(container, 'm1')?.textContent?.trim()).toBe('');
	});

	it("one member's failure never mutes another member's saved cue — per-(event,member) independence", () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m2: { attendanceId: 'att-2', status: 'late' } },
				failedMemberIds: new Set(['m1']),
				savedMemberIds: new Set(['m2'])
			})
		);
		expect(container.querySelector('[data-testid="attendance-save-failed-m1"]')).not.toBeNull();
		expect(savedRegion(container, 'm2')?.textContent).toContain('Saved.');
	});
});

describe("AttendanceSurface — #321's membersPartial notice is byte-untouched by the cue (task pin 4)", () => {
	it('membersPartial renders the same visible role="status" notice alongside a saved cue', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m1: { attendanceId: 'att-1', status: 'present' } },
				savedMemberIds: new Set(['m1']),
				membersPartial: true
			})
		);
		const notice = container.querySelector('[data-testid="attendance-panel-partial-notice"]');
		expect(notice).not.toBeNull();
		expect(notice?.getAttribute('role')).toBe('status');
		expect(notice?.textContent).toContain('Not every member is listed here');
		expect(notice?.className).not.toMatch(/sr-only|hidden/);
		expect(savedRegion(container, 'm1')?.textContent).toContain('Saved.');
	});
});

describe('AttendanceSurface — the tally says when its counts are unconfirmed (issue bullet 3, RED stated choice)', () => {
	it('no write in flight → NO unconfirmed marking: every counted value is server-settled', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: {
					m1: { attendanceId: 'att-1', status: 'present' },
					m2: { attendanceId: 'att-2', status: 'absent' }
				}
			})
		);
		expect(
			container.querySelector('[data-testid="attendance-tally-unconfirmed"]')
		).toBeNull();
		expect(
			container.querySelector('[data-testid="attendance-tally"]')?.textContent
		).toContain('1 present · 1 absent · 0 late');
	});

	it('a write in flight → the tally line ITSELF carries the visible unconfirmed marking', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: {
					m1: { attendanceId: '__optimistic__', status: 'present' },
					m2: { attendanceId: 'att-2', status: 'absent' }
				},
				pendingMemberIds: new Set(['m1'])
			})
		);
		const marker = container.querySelector(
			'[data-testid="attendance-tally"] [data-testid="attendance-tally-unconfirmed"]'
		);
		expect(marker).not.toBeNull();
		expect(marker?.textContent).toContain('Counts include unconfirmed changes.');
		expect(marker?.className ?? '').not.toMatch(/sr-only|hidden/);
	});

	it('a FAILED write is not "unconfirmed" — revert restored server truth, so the marking is absent (the per-row alert carries the failure)', () => {
		const { container } = render(
			AttendanceSurface,
			baseProps({
				attendanceByMemberId: { m2: { attendanceId: 'att-2', status: 'absent' } },
				failedMemberIds: new Set(['m1'])
			})
		);
		expect(
			container.querySelector('[data-testid="attendance-tally-unconfirmed"]')
		).toBeNull();
	});
});

// (*MVOX:Tallis*)

// ── the member row's name carries the capture-redaction marker ──────────────
// The name's aria-labels are attributes no marker can cover; redact.ts lists them.
describe('#361 — AttendanceSurface member rows: the name is marked', () => {
	it('every member row name sits inside exactly one marker', () => {
		const { container } = render(AttendanceSurface, baseProps());
		expectNameMarkedOnce(container, 'Alice Alto', 'in the attendance member row');
		expectNameMarkedOnce(container, 'Berta Bass', 'in the attendance member row');
	});
});

// (*MVOX:Tallis*)
