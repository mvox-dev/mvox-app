// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_row_link_label: (params) => `View details for ${(params as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details',
		event_type_rehearsal: () => '[msg:rehearsal]',
		event_type_concert: () => '[msg:concert]'
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
		name: `Event ${id}`,
		startDatetime,
		durationMinutes: 90,
		location: '',
		conductors: [],
		owners: [],
		editors: [],
		eventType: 'rehearsal',
		...overrides
	} as AgendaItem;
}

function rowBadge(container: HTMLElement, rowTestid: string, itemId: string): HTMLElement | null {
	const row = container.querySelector(`[data-testid="${rowTestid}"]`);
	expect(row).not.toBeNull();
	const badge = container.querySelector<HTMLElement>(
		`[data-testid="event-type-badge-${itemId}"]`
	);
	if (badge) expect(row!.contains(badge)).toBe(true);
	return badge;
}

describe('AgendaList — event type badge (#194/#202)', () => {
	it('every upcoming row carries a badge with the LOCALIZED type label', () => {
		const { container } = render(AgendaList, {
			items: [
				item('r1', '2026-06-15T09:00:00.000Z', { eventType: 'rehearsal' }),
				item('c1', '2026-06-16T16:00:00.000Z', { eventType: 'concert' })
			]
		});
		expect(rowBadge(container, 'agenda-row-r1', 'r1')?.textContent?.trim()).toBe('[msg:rehearsal]');
		expect(rowBadge(container, 'agenda-row-c1', 'c1')?.textContent?.trim()).toBe('[msg:concert]');
	});

	it('a CONCERT renders as a full agenda row — the component never filters by type', () => {
		const { container } = render(AgendaList, {
			items: [item('c1', '2026-06-16T16:00:00.000Z', { eventType: 'concert', name: 'Kevadkontsert' })]
		});
		const row = container.querySelector('[data-testid="agenda-row-c1"]');
		expect(row).not.toBeNull();
		expect(row!.textContent).toContain('Kevadkontsert');
		expect(container.querySelector('[data-testid="agenda-empty"]')).toBeNull();
	});

	it("a free-text type ('proov') shows its RAW value — the shared fallback, never blank", () => {
		const { container } = render(AgendaList, {
			items: [item('p1', '2026-06-15T09:00:00.000Z', { eventType: 'proov' })]
		});
		expect(rowBadge(container, 'agenda-row-p1', 'p1')?.textContent?.trim()).toBe('proov');
	});

	it('an item with NO eventType renders NO badge (nothing invented)', () => {
		const { container } = render(AgendaList, {
			items: [item('n1', '2026-06-15T09:00:00.000Z', { eventType: '' })]
		});
		expect(rowBadge(container, 'agenda-row-n1', 'n1')).toBeNull();
	});

	it('RECENT rows carry the badge too', () => {
		const { container } = render(AgendaList, {
			items: [],
			recentItems: [item('past-c', '2026-06-01T16:00:00.000Z', { eventType: 'concert' })]
		});
		expect(rowBadge(container, 'agenda-recent-row-past-c', 'past-c')?.textContent?.trim()).toBe(
			'[msg:concert]'
		);
	});
});

const stylesModule = () =>
	import('$lib/events/eventTypeStyles') as Promise<{
		eventTypeBadgeClass: (type: string | undefined) => string;
	}>;

function expectClasses(badge: HTMLElement, classString: string) {
	for (const cls of classString.split(/\s+/)) {
		expect(badge.classList.contains(cls), `badge missing class '${cls}'`).toBe(true);
	}
}

const noTypeToken = (el: Element) =>
	expect(
		[...el.classList].filter((cls) => cls.includes('type-')),
		`unexpected type-* classes on <${el.tagName.toLowerCase()} data-testid="${el.getAttribute('data-testid')}">`
	).toEqual([]);

describe('AgendaList — event type badge COLORS (#211)', () => {
	it('an UPCOMING rehearsal badge carries the rehearsal scheme classes; a social badge the quiet default', async () => {
		const { eventTypeBadgeClass } = await stylesModule();
		const { container } = render(AgendaList, {
			items: [
				item('r1', '2026-06-15T09:00:00.000Z', { eventType: 'rehearsal' }),
				item('s1', '2026-06-16T18:00:00.000Z', { eventType: 'social' })
			]
		});

		const rehearsalBadge = rowBadge(container, 'agenda-row-r1', 'r1')!;
		expect(rehearsalBadge).not.toBeNull();
		expectClasses(rehearsalBadge, eventTypeBadgeClass('rehearsal'));
		expect(rehearsalBadge.textContent?.trim()).toBe('[msg:rehearsal]');

		const socialBadge = rowBadge(container, 'agenda-row-s1', 's1')!;
		expect(socialBadge).not.toBeNull();
		expectClasses(socialBadge, eventTypeBadgeClass('social'));
		noTypeToken(socialBadge);
	});

	it('a RECENT rehearsal badge carries the same scheme classes; a recent social badge the default', async () => {
		const { eventTypeBadgeClass } = await stylesModule();
		const { container } = render(AgendaList, {
			items: [],
			recentItems: [
				item('past-r', '2026-06-01T09:00:00.000Z', { eventType: 'rehearsal' }),
				item('past-s', '2026-06-02T18:00:00.000Z', { eventType: 'social' })
			]
		});

		const showMore = container.querySelector('[data-testid="agenda-recent-show-more"]');
		expect(showMore, '#471 show-more button').not.toBeNull();
		await fireEvent.click(showMore!);

		const rehearsalBadge = rowBadge(container, 'agenda-recent-row-past-r', 'past-r')!;
		expect(rehearsalBadge).not.toBeNull();
		expectClasses(rehearsalBadge, eventTypeBadgeClass('rehearsal'));
		expect(rehearsalBadge.textContent?.trim()).toBe('[msg:rehearsal]');

		const socialBadge = rowBadge(container, 'agenda-recent-row-past-s', 'past-s')!;
		expect(socialBadge).not.toBeNull();
		expectClasses(socialBadge, eventTypeBadgeClass('social'));
		noTypeToken(socialBadge);
	});

	it('the badge base classes (shape, font, uppercase) stay shared across hued and default badges', async () => {
		await stylesModule();
		const { container } = render(AgendaList, {
			items: [
				item('r1', '2026-06-15T09:00:00.000Z', { eventType: 'rehearsal' }),
				item('s1', '2026-06-16T18:00:00.000Z', { eventType: 'social' })
			]
		});
		const base = ['w-fit', 'rounded-full', 'border', 'px-1.5', 'py-0.5', 'font-mono', 'uppercase'];
		for (const id of ['r1', 's1']) {
			const badge = rowBadge(container, `agenda-row-${id}`, id)!;
			for (const cls of base) {
				expect(badge.classList.contains(cls), `badge ${id} missing base class '${cls}'`).toBe(true);
			}
		}
	});

	it('GUARD: no type-* token leaks onto the ROW element, and no icon element inside the badge', async () => {
		await stylesModule();
		const { container } = render(AgendaList, {
			items: [item('r1', '2026-06-15T09:00:00.000Z', { eventType: 'rehearsal' })],
			recentItems: [item('past-c', '2026-06-01T16:00:00.000Z', { eventType: 'concert' })]
		});

		for (const rowTestid of ['agenda-row-r1', 'agenda-recent-row-past-c']) {
			const row = container.querySelector<HTMLElement>(`[data-testid="${rowTestid}"]`);
			expect(row).not.toBeNull();
			noTypeToken(row!);
		}

		for (const itemId of ['r1', 'past-c']) {
			const badge = container.querySelector<HTMLElement>(
				`[data-testid="event-type-badge-${itemId}"]`
			);
			expect(badge).not.toBeNull();
			expect(badge!.children.length).toBe(0);
			expect(badge!.querySelector('svg, img')).toBeNull();
		}
	});
});
