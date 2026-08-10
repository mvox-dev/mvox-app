// @vitest-environment happy-dom
//
// #86 TA.5 RED — i18n + a11y coverage for all Attendance 1.0 surfaces:
//   - AgendaList's recent-row attendance badge + 'Take attendance' entry point
//   - AttendanceSurface (the conductor's inline P/A/L panel)
//   - SeasonSummary (my rate + conductor's all-members expansion)
//
// Follows the #75/TL.4 precedent (page.library.a11y.spec.ts): source-scan tests
// for i18n hygiene + rendered-DOM tests for aria semantics. These are RED —
// they assert a11y attributes the TA.2–TA.4 components do not yet carry
// (toggle aria-labels, badge dot aria-hidden, role="alert" on load errors,
// aria-controls + list semantics on the season summary, a descriptive
// aria-label on the take-attendance button). A few guard tests pin down
// behaviour that already exists (aria-pressed, save-failed role="alert",
// locale key parity) so GREEN can't regress it.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Paraglide mock: real English strings for the keys that exist today, plus a
// Proxy fallback so aria-label keys ADDED by the GREEN pass resolve without
// this file needing to know their names — the fallback renders
// "<key> <param values...>", so assertions like "the label contains the member
// name" hold for any key shape as long as the name is passed as a param.
vi.mock('$lib/paraglide/messages.js', () => {
	const known: Record<string, (p?: Record<string, unknown>) => string> = {
		agenda_empty_no_rehearsals: () => 'No upcoming rehearsals.',
		agenda_duration_min: (p) => `${p?.minutes} min`,
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (p) => `${p?.weeks} weeks later`,
		agenda_recent: () => 'Recent',
		agenda_take_attendance: () => 'Take attendance',
		rsvp_status_going: () => 'Going',
		rsvp_status_not_going: () => 'Not going',
		rsvp_status_maybe: () => 'Maybe',
		rsvp_status_late: () => 'Running late',
		rsvp_non_member_hint: () => 'You are not an active member.',
		rsvp_save_failed: () => 'Could not save your answer.',
		attendance_status_present: () => 'Present',
		attendance_status_absent: () => 'Absent',
		attendance_status_late: () => 'Late',
		attendance_status_not_recorded: () => 'Not recorded',
		attendance_rsvp_none: () => 'No answer',
		attendance_rsvp_aria_label: (p?: Record<string, unknown>) => `RSVP for ${p?.name}: ${p?.rsvp}`,
		attendance_load_error: () => "Couldn't load attendance.",
		attendance_save_failed: () => "Couldn't save attendance.",
		attendance_tally: (p) => `${p?.present} present · ${p?.absent} absent · ${p?.late} late`,
		attendance_close: () => 'Close',
		attendance_season_summary: () => 'This season',
		attendance_season_rate: (p) => `Attended ${p?.attended} of ${p?.total} rehearsals`,
		attendance_member_rate: (p) => `${p?.attended} of ${p?.total}`,
		attendance_all_members: () => 'All members',
		attendance_season_loading: () => 'Loading…',
		attendance_season_load_error: () => "Couldn't load member rates.",
		attendance_badge_aria_label: (p?: Record<string, unknown>) => `Attendance: ${p?.status}`
	};
	const m = new Proxy(known, {
		get(target, prop) {
			const key = String(prop);
			if (key in target) return target[key];
			return (params?: Record<string, unknown>) =>
				[key, ...(params ? Object.values(params).map(String) : [])].join(' ');
		}
	});
	return { m };
});

import AttendanceSurface from '$lib/components/attendance/AttendanceSurface.svelte';
import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
import AgendaList from '$lib/components/agenda/AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function agendaItem(id: string, overrides: Partial<AgendaItem> = {}): AgendaItem {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime: '2026-06-10T16:00:00.000Z',
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		...overrides
	};
}

const rosterTwo = [
	{ memberId: 'm1', personId: 'pp-1', name: 'Alice Alto', email: 'alice@example.com' },
	{ memberId: 'm2', personId: 'pp-2', name: 'Berta Bass', email: 'berta@example.com' }
];

const memberRatesTwo = [
	{ memberId: 'm1', name: 'Alice Alto', attended: 3, total: 4 },
	{ memberId: 'm2', name: 'Berta Bass', attended: 0, total: 4 }
];

// ---------------------------------------------------------------------------
// Source-scan helpers (i18n hygiene) — same strategy as page.library.a11y.spec.ts:
// strip Svelte expressions + HTML comments from the template, then any remaining
// bare text node with letters in it is a hardcoded user-facing string.
// ---------------------------------------------------------------------------
const ATTENDANCE_SURFACE_FILES = [
	'src/lib/components/attendance/AttendanceSurface.svelte',
	'src/lib/components/attendance/SeasonSummary.svelte',
	'src/lib/components/agenda/AgendaList.svelte'
];

function readSource(relPath: string): string {
	return readFileSync(resolve(process.cwd(), relPath), 'utf-8');
}

function bareTextNodes(source: string): string[] {
	const templateMatch = source.match(/<\/script>\s*([\s\S]*)$/);
	// A component may be template-only (no <script>) — then the whole file is template.
	let template = templateMatch ? templateMatch[1] : source;
	// Strip HTML comments — they carry prose but render nothing.
	template = template.replace(/<!--[\s\S]*?-->/g, '');
	// Repeatedly remove innermost { … } blocks until none remain.
	let prev = '';
	while (prev !== template) {
		prev = template;
		template = template.replace(/\{[^{}]*\}/g, '');
	}
	const nodes: string[] = [];
	const textNodePattern = />([^<]+)</g;
	let match: RegExpExecArray | null;
	while ((match = textNodePattern.exec(template)) !== null) {
		const text = match[1].trim();
		if (!text) continue;
		// Pure punctuation / decorative unicode is fine.
		if (/^[▸▾·×\s\-–—|]+$/.test(text)) continue;
		// HTML entities (&times; &nbsp; …) are decorative glyphs, not prose.
		if (/^(&[a-zA-Z]+;|&#\d+;)+$/.test(text)) continue;
		// Must contain at least one letter to count as user-facing prose.
		if (!/[a-zA-Z]/.test(text)) continue;
		nodes.push(text);
	}
	return nodes;
}

// ---------------------------------------------------------------------------
// 1 — i18n: every attendance surface renders via Paraglide keys only
// ---------------------------------------------------------------------------
describe('#86 — i18n: no hardcoded user-facing strings on attendance surfaces', () => {
	for (const relPath of ATTENDANCE_SURFACE_FILES) {
		it(`${relPath} contains no bare text nodes outside m.* calls`, () => {
			expect(bareTextNodes(readSource(relPath))).toEqual([]);
		});

		it(`${relPath} has no hardcoded aria-label string literals (labels must come from m.*)`, () => {
			const source = readSource(relPath);
			// aria-label="Some words" is a hardcoded English label; aria-label={m.key()}
			// is the required shape. Attribute values with letters are the violation.
			const hardcoded = source.match(/aria-label="[^"]*[a-zA-Z][^"]*"/g) ?? [];
			expect(hardcoded).toEqual([]);
		});
	}

	it('every attendance_* / agenda_take_attendance key in en.json exists in et, lv and uk', () => {
		const en = JSON.parse(readSource('messages/en.json')) as Record<string, string>;
		const attendanceKeys = Object.keys(en).filter(
			(k) => k.startsWith('attendance_') || k.startsWith('agenda_take_attendance')
		);
		expect(attendanceKeys.length).toBeGreaterThan(0);
		for (const locale of ['et', 'lv', 'uk']) {
			const messages = JSON.parse(readSource(`messages/${locale}.json`)) as Record<string, string>;
			const missing = attendanceKeys.filter((k) => !(k in messages));
			expect(missing, `${locale}.json is missing attendance keys`).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// 2 — P/A/L toggle buttons: aria-pressed + aria-label
// ---------------------------------------------------------------------------
describe('#86 — a11y: P/A/L toggles carry aria-pressed and aria-label', () => {
	function renderPanel() {
		return render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			attendanceByMemberId: { m1: { attendanceId: 'a1', status: 'present' as const } },
			rsvpByMemberId: {}
		});
	}

	it('every toggle exposes aria-pressed reflecting the current status', () => {
		const { container } = renderPanel();
		// m1 is present → the P toggle is pressed, A and L are not.
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-present"]')!.getAttribute('aria-pressed')
		).toBe('true');
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-absent"]')!.getAttribute('aria-pressed')
		).toBe('false');
		expect(
			container.querySelector('[data-testid="attendance-toggle-m1-late"]')!.getAttribute('aria-pressed')
		).toBe('false');
		// m2 has no record → all three unpressed.
		for (const status of ['present', 'absent', 'late']) {
			expect(
				container.querySelector(`[data-testid="attendance-toggle-m2-${status}"]`)!.getAttribute('aria-pressed')
			).toBe('false');
		}
	});

	it("every toggle has an aria-label naming the member — 'Present' alone doesn't tell a screen reader WHOSE presence is toggled", () => {
		const { container } = renderPanel();
		for (const [memberId, name] of [
			['m1', 'Alice Alto'],
			['m2', 'Berta Bass']
		] as const) {
			for (const status of ['present', 'absent', 'late']) {
				const toggle = container.querySelector(
					`[data-testid="attendance-toggle-${memberId}-${status}"]`
				) as HTMLElement;
				const label = toggle.getAttribute('aria-label');
				expect(label, `toggle ${memberId}/${status} is missing aria-label`).toBeTruthy();
				expect(label).toContain(name);
			}
		}
	});

	it("a member's three toggle aria-labels are distinct (the status must be part of the label, not just the name)", () => {
		const { container } = renderPanel();
		const labels = ['present', 'absent', 'late'].map((status) =>
			(container.querySelector(`[data-testid="attendance-toggle-m1-${status}"]`) as HTMLElement).getAttribute(
				'aria-label'
			)
		);
		expect(new Set(labels).size).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// 3 — recent-row attendance badge: screen-reader text, decorative dot hidden
// ---------------------------------------------------------------------------
describe('#86 — a11y: attendance badge is readable without color', () => {
	function renderRecent(myAttendanceByEventId: Record<string, 'present' | 'absent' | 'late' | 'not-recorded'> = {}) {
		return render(AgendaList, {
			items: [],
			recentItems: [agendaItem('past-1')],
			membership: 'member' as const,
			myAttendanceByEventId
		});
	}

	it('the badge carries a visible text label, not just the colored dot', () => {
		const { container } = renderRecent({ 'past-1': 'present' });
		const badge = container.querySelector('[data-testid="attendance-badge-past-1"]') as HTMLElement;
		expect(badge).not.toBeNull();
		expect(badge.textContent).toContain('Present');
	});

	it("an unrecorded event's badge says 'Not recorded' in text", () => {
		const { container } = renderRecent({});
		const badge = container.querySelector('[data-testid="attendance-badge-past-1"]') as HTMLElement;
		expect(badge.textContent).toContain('Not recorded');
	});

	it('the color dot is aria-hidden — it duplicates the text label and must not reach the accessibility tree', () => {
		const { container } = renderRecent({ 'past-1': 'present' });
		const dot = container.querySelector(
			'[data-testid="attendance-badge-past-1"] .rounded-full'
		) as HTMLElement;
		expect(dot).not.toBeNull();
		expect(dot.getAttribute('aria-hidden')).toBe('true');
	});

	it("the badge carries an aria-label distinguishing attendance from RSVP — a screen reader hearing 'Going … Present' adjacently needs context", () => {
		const { container } = renderRecent({ 'past-1': 'present' });
		const badge = container.querySelector('[data-testid="attendance-badge-past-1"]') as HTMLElement;
		const label = badge.getAttribute('aria-label');
		expect(label, 'attendance badge must have aria-label').toBeTruthy();
		expect(label).toContain('Attendance');
		expect(label).toContain('Present');
	});
});

// ---------------------------------------------------------------------------
// 4 — error surfaces announce themselves: role="alert"
// ---------------------------------------------------------------------------
describe('#86 — a11y: attendance error surfaces use role="alert"', () => {
	it('the panel load-error has role="alert"', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			error: true
		});
		const errorEl = container.querySelector('[data-testid="attendance-panel-error"]') as HTMLElement;
		expect(errorEl).not.toBeNull();
		expect(errorEl.getAttribute('role')).toBe('alert');
	});

	it("a member's save-failed line has role=\"alert\"", () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			failedMemberIds: new Set(['m1'])
		});
		const errorEl = container.querySelector('[data-testid="attendance-save-failed-m1"]') as HTMLElement;
		expect(errorEl).not.toBeNull();
		expect(errorEl.getAttribute('role')).toBe('alert');
	});

	it('the season-summary member-rates load-error has role="alert"', () => {
		const { container } = render(SeasonSummary, {
			myRate: { attended: 2, total: 4 },
			canExpand: true,
			expanded: true,
			error: true
		});
		const errorEl = container.querySelector('[data-testid="season-rates-error"]') as HTMLElement;
		expect(errorEl).not.toBeNull();
		expect(errorEl.getAttribute('role')).toBe('alert');
	});
});

// ---------------------------------------------------------------------------
// 5 — season summary: aria-expanded/aria-controls on the toggle, list
//     semantics on the per-member rates
// ---------------------------------------------------------------------------
describe('#86 — a11y: season summary expansion + member-rates semantics', () => {
	it('the all-members toggle reflects state via aria-expanded', () => {
		const collapsed = render(SeasonSummary, {
			myRate: { attended: 2, total: 4 },
			canExpand: true,
			expanded: false
		});
		const collapsedToggle = collapsed.container.querySelector(
			'[data-testid="season-summary-expand"]'
		) as HTMLElement;
		expect(collapsedToggle.getAttribute('aria-expanded')).toBe('false');
		cleanup();

		const expanded = render(SeasonSummary, {
			myRate: { attended: 2, total: 4 },
			canExpand: true,
			expanded: true,
			memberRates: memberRatesTwo
		});
		const expandedToggle = expanded.container.querySelector(
			'[data-testid="season-summary-expand"]'
		) as HTMLElement;
		expect(expandedToggle.getAttribute('aria-expanded')).toBe('true');
	});

	it('the all-members toggle does NOT carry aria-controls (the target region only renders when expanded, so a collapsed toggle would dangle the IDREF; aria-expanded alone suffices)', () => {
		const { container } = render(SeasonSummary, {
			myRate: { attended: 2, total: 4 },
			canExpand: true,
			expanded: false
		});
		const toggle = container.querySelector('[data-testid="season-summary-expand"]') as HTMLElement;
		expect(toggle.getAttribute('aria-controls')).toBeNull();
	});

	it('the expanded member rates are exposed as a list (role="list" / role="listitem") — a div soup gives a screen reader no row structure', () => {
		const { container } = render(SeasonSummary, {
			myRate: { attended: 2, total: 4 },
			canExpand: true,
			expanded: true,
			memberRates: memberRatesTwo
		});
		const membersEl = container.querySelector('[data-testid="season-summary-members"]') as HTMLElement;
		expect(membersEl).not.toBeNull();
		// role="list" is on an inner wrapper (not the outer region) so that
		// loading/error branches never produce an ARIA-invalid list with non-listitem children.
		const listEl = membersEl.querySelector('[role="list"]');
		expect(listEl, 'inner list wrapper with role="list" must exist').not.toBeNull();
		const rows = container.querySelectorAll('[data-testid^="member-rate-"]');
		expect(rows.length).toBe(2);
		rows.forEach((row) => {
			expect(row.getAttribute('role')).toBe('listitem');
		});
	});

	it('loading/error states do NOT carry role="list" — a <p> inside a list violates ARIA required-children (F1)', () => {
		// Loading state: no list wrapper, just a <p>
		const { container: loadingContainer } = render(SeasonSummary, {
			myRate: { attended: 2, total: 4 },
			canExpand: true,
			expanded: true,
			loading: true
		});
		const loadingRegion = loadingContainer.querySelector('[data-testid="season-summary-members"]') as HTMLElement;
		expect(loadingRegion.getAttribute('role')).not.toBe('list');
		cleanup();
		// Error state: no list wrapper, just a <p role="alert">
		const { container: errorContainer } = render(SeasonSummary, {
			myRate: { attended: 2, total: 4 },
			canExpand: true,
			expanded: true,
			error: true
		});
		const errorRegion = errorContainer.querySelector('[data-testid="season-summary-members"]') as HTMLElement;
		expect(errorRegion.getAttribute('role')).not.toBe('list');
	});
});

// ---------------------------------------------------------------------------
// 6 — 'Take attendance' button: descriptive aria-label
// ---------------------------------------------------------------------------
describe("#86 — a11y: 'Take attendance' button identifies its event", () => {
	it("the button's aria-label names the event — several recent rows each carry one, and 'Take attendance' alone doesn't say which rehearsal", () => {
		const { container } = render(AgendaList, {
			items: [],
			recentItems: [
				agendaItem('past-1', { name: 'Spem rehearsal' }),
				agendaItem('past-2', { name: 'Ave rehearsal', startDatetime: '2026-06-03T16:00:00.000Z' })
			],
			membership: 'member' as const,
			conductorEventIds: new Set(['past-1', 'past-2']),
			ontakeattendance: () => {}
		});
		const buttons = container.querySelectorAll('[data-testid="take-attendance-btn"]');
		expect(buttons.length).toBe(2);
		const labels = Array.from(buttons).map((b) => b.getAttribute('aria-label'));
		labels.forEach((label) => expect(label, 'take-attendance button is missing aria-label').toBeTruthy());
		expect(labels[0]).toContain('Spem rehearsal');
		expect(labels[1]).toContain('Ave rehearsal');
		// Distinct per row — the label must key off the event, not be a shared constant.
		expect(new Set(labels).size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 7 — aria-busy on toggle group while a write is in flight (F2)
// ---------------------------------------------------------------------------
describe('#86 — a11y: toggle group carries aria-busy while pending', () => {
	it('pending member — the toggle wrapper advertises aria-busy="true"', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			attendanceByMemberId: {},
			rsvpByMemberId: {},
			pendingMemberIds: new Set(['m1'])
		});
		// The toggle wrapper is the parent of the toggle buttons
		const toggle = container.querySelector('[data-testid="attendance-toggle-m1-present"]') as HTMLElement;
		const wrapper = toggle.parentElement as HTMLElement;
		expect(wrapper.getAttribute('aria-busy')).toBe('true');
	});

	it('non-pending member — aria-busy is absent', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			attendanceByMemberId: {},
			rsvpByMemberId: {},
			pendingMemberIds: new Set<string>()
		});
		const toggle = container.querySelector('[data-testid="attendance-toggle-m1-present"]') as HTMLElement;
		const wrapper = toggle.parentElement as HTMLElement;
		expect(wrapper.getAttribute('aria-busy')).not.toBe('true');
	});
});

// ---------------------------------------------------------------------------
// 8 — tally line uses aria-live so screen readers announce updates (F3)
// ---------------------------------------------------------------------------
describe('#86 — a11y: attendance tally is a live region', () => {
	it('the tally <p> carries aria-live="polite"', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			attendanceByMemberId: {}
		});
		const tally = container.querySelector('[data-testid="attendance-tally"]') as HTMLElement;
		expect(tally).not.toBeNull();
		expect(tally.getAttribute('aria-live')).toBe('polite');
	});
});

// ---------------------------------------------------------------------------
// 9 — P/A/L toggles are keyboard-operable (F5)
// ---------------------------------------------------------------------------
describe('#86 — a11y: P/A/L toggles are keyboard-operable', () => {
	it('every toggle is a native <button> (guaranteeing Tab + Space/Enter operability)', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			attendanceByMemberId: {}
		});
		const toggles = container.querySelectorAll('[data-testid^="attendance-toggle-"]');
		expect(toggles.length).toBeGreaterThan(0);
		toggles.forEach((toggle) => {
			expect(toggle.tagName).toBe('BUTTON');
			// Native buttons are focusable by default; no tabindex needed unless set to -1
			expect(toggle.getAttribute('tabindex')).not.toBe('-1');
		});
	});

	it('a non-pending toggle has type="button" and is not disabled (keyboard-reachable)', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			attendanceByMemberId: {},
			pendingMemberIds: new Set<string>()
		});
		const toggle = container.querySelector('[data-testid="attendance-toggle-m1-present"]') as HTMLButtonElement;
		expect(toggle.type).toBe('button');
		expect(toggle.disabled).toBe(false);
	});

	it('a pending toggle uses aria-disabled (not native disabled) so the browser keeps it focusable and focus is not lost', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			attendanceByMemberId: {},
			pendingMemberIds: new Set(['m1'])
		});
		const toggle = container.querySelector('[data-testid="attendance-toggle-m1-present"]') as HTMLButtonElement;
		// aria-disabled keeps the element in the tab order — native disabled would remove it
		expect(toggle.disabled).toBe(false);
		expect(toggle.getAttribute('aria-disabled')).toBe('true');
		// Focus can be set and retained (native disabled would reject focus)
		toggle.focus();
		expect(container.ownerDocument.activeElement).toBe(toggle);
	});
});

// ---------------------------------------------------------------------------
// Guards on a11y that already exists — GREEN must not regress these
// ---------------------------------------------------------------------------
describe('#86 — a11y guards: existing attendance semantics stay intact', () => {
	it('the panel collapse button keeps its i18n aria-label', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo
		});
		const closeBtn = container.querySelector('[data-testid="attendance-collapse-btn"]') as HTMLElement;
		expect(closeBtn.getAttribute('aria-label')).toBe('Close');
	});

	it('the loading skeleton stays aria-hidden', () => {
		const { container } = render(AttendanceSurface, {
			item: agendaItem('past-1'),
			members: rosterTwo,
			loading: true
		});
		const skeleton = container.querySelector('[data-testid="attendance-panel-loading"]') as HTMLElement;
		expect(skeleton.getAttribute('aria-hidden')).toBe('true');
	});
});

// (*MVOX:Tallis*)
