// @vitest-environment happy-dom
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

const plainItems: AgendaItem[] = [item('r1', '2026-06-15T09:00:00.000Z')];

function header(container: HTMLElement): HTMLElement {
	const el = container.querySelector<HTMLElement>('[data-testid="agenda-date-header"]');
	expect(el).not.toBeNull();
	return el as HTMLElement;
}

describe('AgendaList — day header typography (#250)', () => {
	it('header is text-base, no longer 10px', () => {
		const { container } = render(AgendaList, { items: plainItems });
		const h = header(container);
		expect(h.classList.contains('text-base')).toBe(true);
		expect(h.classList.contains('text-[10px]')).toBe(false);
	});

	it('header is full-strength ink and carries weight', () => {
		const { container } = render(AgendaList, { items: plainItems });
		const h = header(container);
		expect(h.classList.contains('text-ink')).toBe(true);
		expect(h.classList.contains('text-ink-2')).toBe(false);
		expect(h.classList.contains('font-semibold')).toBe(true);
	});

	it('header keeps tracking-wide and uppercase', () => {
		const { container } = render(AgendaList, { items: plainItems });
		const h = header(container);
		expect(h.classList.contains('tracking-wide')).toBe(true);
		expect(h.classList.contains('uppercase')).toBe(true);
	});

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

	const PILL_TOKENS = ['rounded-full', 'border', 'border-ink', 'px-2'] as const;
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

		for (const token of PILL_TOKENS) {
			expect(rel.classList.contains(token)).toBe(true);
		}
		for (const token of PILL_TOKENS) {
			expect(dateSpan.classList.contains(token)).toBe(false);
			expect(h.classList.contains(token)).toBe(false);
		}
		expect(Array.from(rel.classList).filter((c) => SIZE_TOKEN.test(c))).toEqual([]);
		expect(rel.classList.contains('font-semibold')).toBe(false);
		expect(rel.classList.contains('text-ink')).toBe(false);
	}

	it('TODAY span stays visually distinct from the date beside it', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
			const { container } = render(AgendaList, { items: plainItems });
			assertDistinct(container, 'agenda-relative-today');
		} finally {
			vi.useRealTimers();
		}
	});

	it('TOMORROW span stays visually distinct from the date beside it', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-06-14T10:00:00.000Z'));
			const { container } = render(AgendaList, { items: plainItems });
			assertDistinct(container, 'agenda-relative-tomorrow');
		} finally {
			vi.useRealTimers();
		}
	});

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

describe('AgendaList — #250 scope fence (unchanged neighbours)', () => {
	it('gap marker keeps text-[10px] text-ink-2', () => {
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
