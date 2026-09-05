// @vitest-environment happy-dom
// #250 — the agenda day header must read as a SECTION TITLE, larger than the
// rows it heads. Today the hierarchy is inverted: the header is 10px muted ink
// (text-[10px] text-ink-2) — the exact treatment of the row DURATION, the least
// significant text on the rows below it, and of the gap marker and Recent-row
// date. A heading quieter than its own content cannot do a heading's job.
//
// Assertions are on stable class TOKENS (classList.contains), never on full
// class-string equality — GREEN may add/reorder tokens freely as long as the
// contract holds.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_today: () => 'Today',
		agenda_tomorrow: () => 'Tomorrow',
		agenda_gap_weeks: (params) => `${(params as { weeks: number }).weeks} weeks later`,
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`
	};
	return {
		// Proxy fallback (same idiom as AgendaList.spec.ts): any key not enumerated
		// resolves to a `[key]` stub so child components can never crash this mock.
		m: new Proxy(keys, {
			get: (target, key) => target[String(key)] ?? (() => `[${String(key)}]`)
		})
	};
});

afterEach(cleanup);

function item(id: string, startDatetime: string, overrides: Partial<AgendaItem> = {}): AgendaItem {
	return {
		id,
		name: `Rehearsal ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		...overrides
	};
}

const plainItems: AgendaItem[] = [item('r1', '2026-06-15T09:00:00.000Z')]; // 12:00 Tallinn

function header(container: HTMLElement): HTMLElement {
	const el = container.querySelector<HTMLElement>('[data-testid="agenda-date-header"]');
	expect(el).not.toBeNull();
	return el as HTMLElement;
}

describe('AgendaList — day header typography (#250)', () => {
	// Done-when 1: visibly larger than the row content it heads.
	it('header is text-base, no longer 10px', () => {
		const { container } = render(AgendaList, { items: plainItems });
		const h = header(container);
		expect(h.classList.contains('text-base')).toBe(true);
		expect(h.classList.contains('text-[10px]')).toBe(false);
	});

	// Done-when 2: full-strength ink, with weight.
	it('header is full-strength ink and carries weight', () => {
		const { container } = render(AgendaList, { items: plainItems });
		const h = header(container);
		expect(h.classList.contains('text-ink')).toBe(true);
		expect(h.classList.contains('text-ink-2')).toBe(false);
		expect(h.classList.contains('font-semibold')).toBe(true);
	});

	// Done-when 3: the small-caps idiom is KEPT — it is what makes the header
	// read as a marker rather than a sentence.
	it('header keeps tracking-wide and uppercase', () => {
		const { container } = render(AgendaList, { items: plainItems });
		const h = header(container);
		expect(h.classList.contains('tracking-wide')).toBe(true);
		expect(h.classList.contains('uppercase')).toBe(true);
	});

	// Done-when 5: vertical rhythm adjusted for 16px type. pt-4 pb-1 was set for
	// 10px text; the exact replacement is GREEN's choice — the contract is only
	// that the old pair is gone and SOME vertical padding/margin/space token
	// exists in its place (sections must still read as separated blocks).
	it('rhythm: pt-4 pb-1 replaced with some other vertical spacing', () => {
		const { container } = render(AgendaList, { items: plainItems });
		const h = header(container);
		expect(h.classList.contains('pt-4')).toBe(false);
		expect(h.classList.contains('pb-1')).toBe(false);
		const spacingTokens = Array.from(h.classList).filter((c) =>
			/^-?(?:p|m)(?:t|b|y)?-.+$/.test(c)
		);
		expect(spacingTokens.length).toBeGreaterThan(0);
	});

	// Done-when 4: TÄNA/HOMME stay visually distinct from the date beside them
	// at the new size — and the mechanism is NAMED, not merely "some token".
	//
	// An "at least one distinct token" check is too weak to hold the contract:
	// it passes on any incidental leftover. The chosen mechanism is an outlined
	// pill — `rounded-full border border-ink px-2` — so that is what gets
	// asserted, on the span and (as a genuine differentiator) NOT on the date
	// span or the shared header line.
	//
	// The two negative halves are the load-bearing part:
	//  - No size or weight STEP. The date is the section title #250 is making
	//    bigger; the relative marker only says WHICH section. Out-sizing the
	//    date re-inverts the hierarchy this issue exists to fix, so the span
	//    must inherit the line's size and weight.
	//  - No re-declared `font-semibold` / `text-ink`. The header line now
	//    carries both, so repeating them on the span is an inherited no-op that
	//    reads as a differentiator without being one — exactly the ambiguity
	//    that let a single incidental token stand in for the mechanism.
	const PILL_TOKENS = ['rounded-full', 'border', 'border-ink', 'px-2'] as const;
	// Any Tailwind font-size utility: text-lg, text-sm, text-[10px], text-2xl…
	// (`text-ink`/`text-ink-2` are colours, not sizes — excluded by the classes.)
	const SIZE_TOKEN = /^text-(?:xs|sm|base|lg|\d?xl|\[)/;

	function relativeSpan(container: HTMLElement, relTestid: string): HTMLElement {
		const h = header(container);
		const rel = container.querySelector<HTMLElement>(`[data-testid="${relTestid}"]`);
		expect(rel).not.toBeNull();
		const spans = Array.from(h.querySelectorAll<HTMLElement>(':scope > span'));
		const dateSpan = spans[spans.length - 1];
		expect(dateSpan).not.toBe(rel);
		return rel as HTMLElement;
	}

	function assertDistinct(container: HTMLElement, relTestid: string) {
		const h = header(container);
		const spans = Array.from(h.querySelectorAll<HTMLElement>(':scope > span'));
		const dateSpan = spans[spans.length - 1];
		const rel = relativeSpan(container, relTestid);

		// The named mechanism is present on the marker...
		for (const token of PILL_TOKENS) {
			expect(rel.classList.contains(token)).toBe(true);
		}
		// ...and genuinely differentiates: absent from the date span AND from
		// the shared line (a token both carry differentiates nothing).
		for (const token of PILL_TOKENS) {
			expect(dateSpan.classList.contains(token)).toBe(false);
			expect(h.classList.contains(token)).toBe(false);
		}
		// No size step: the marker must not out-size the date it qualifies.
		expect(Array.from(rel.classList).filter((c) => SIZE_TOKEN.test(c))).toEqual([]);
		// No inherited no-ops standing in for a differentiator.
		expect(rel.classList.contains('font-semibold')).toBe(false);
		expect(rel.classList.contains('text-ink')).toBe(false);
	}

	it('TODAY span stays visually distinct from the date beside it', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z')); // today = 2026-06-15 Tallinn
			const { container } = render(AgendaList, { items: plainItems });
			assertDistinct(container, 'agenda-relative-today');
		} finally {
			vi.useRealTimers();
		}
	});

	it('TOMORROW span stays visually distinct from the date beside it', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-06-14T10:00:00.000Z')); // tomorrow = 2026-06-15 Tallinn
			const { container } = render(AgendaList, { items: plainItems });
			assertDistinct(container, 'agenda-relative-tomorrow');
		} finally {
			vi.useRealTimers();
		}
	});

	// Done-when 6: bg-highlight on today's header still works (existing
	// behavior, pinned so the larger type cannot cost it).
	describe('bg-highlight on today', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('today header carries bg-highlight', () => {
			vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
			const { container } = render(AgendaList, { items: plainItems });
			expect(header(container).classList.contains('bg-highlight')).toBe(true);
		});

		it('a non-today header does not', () => {
			vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
			const { container } = render(AgendaList, { items: plainItems });
			expect(header(container).classList.contains('bg-highlight')).toBe(false);
		});
	});
});

// Done-when 7 / scope fence: the gap marker and the Recent-row date are NOT
// section titles — they keep the quiet 10px muted treatment. Restyling every
// small-caps line is exactly the over-reach #250 refused.
describe('AgendaList — #250 scope fence (unchanged neighbours)', () => {
	it('gap marker keeps text-[10px] text-ink-2', () => {
		// 3 weeks apart — well over the 13-day gap-marker threshold.
		const items = [item('r1', '2026-06-01T09:00:00.000Z'), item('r2', '2026-06-22T09:00:00.000Z')];
		const { container } = render(AgendaList, { items });
		const marker = container.querySelector<HTMLElement>('[data-testid="agenda-gap-marker"]');
		expect(marker).not.toBeNull();
		expect(marker?.classList.contains('text-[10px]')).toBe(true);
		expect(marker?.classList.contains('text-ink-2')).toBe(true);
	});

	it('Recent-row date keeps text-[10px] text-ink-2', () => {
		const { container } = render(AgendaList, {
			items: plainItems,
			recentItems: [item('p1', '2026-05-01T09:00:00.000Z')]
		});
		const date = container.querySelector<HTMLElement>('[data-testid="recent-row-date"]');
		expect(date).not.toBeNull();
		expect(date?.classList.contains('text-[10px]')).toBe(true);
		expect(date?.classList.contains('text-ink-2')).toBe(true);
	});

	it('testids and grouping stay intact: one day group per Tallinn day, header inside it', () => {
		const items = [
			item('r1', '2026-06-15T16:00:00.000Z'),
			item('r2', '2026-06-16T16:00:00.000Z')
		];
		const { container } = render(AgendaList, { items });
		const groups = container.querySelectorAll('[data-testid="agenda-day-group"]');
		expect(groups.length).toBe(2);
		expect(groups[0].querySelector('[data-testid="agenda-date-header"]')).not.toBeNull();
		expect(groups[0].querySelector('[data-testid^="agenda-row-"]')?.getAttribute('data-testid')).toBe(
			'agenda-row-r1'
		);
	});
});
