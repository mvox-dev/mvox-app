// @vitest-environment happy-dom
//
// #194/#202 RED — AgendaList labels every row with its event TYPE.
//
// #202: with the data layer no longer filtering to rehearsals (#194), the
// agenda shows rehearsals, concerts, festivals, free-text types — side by side.
// A list where "Kevadkontsert" and "Monday rehearsal" look identical hides the
// one distinction a singer scans for, so every row carries a type badge.
//
// Contract pinned here (GREEN implements in AgendaList.svelte):
//   - AgendaItem carries `eventType` (produced by listEvents; '' when the event
//     has none)
//   - every UPCOMING row and every RECENT row with a non-empty eventType
//     renders `data-testid="event-type-badge-{id}"` INSIDE that row's container
//     (id-suffixed per the file's per-row testid convention — review F6)
//   - the badge text is the LOCALIZED label via the SHARED
//     $lib/events/eventTypeLabels module (the same map the event detail page
//     uses — #101 F3 taught us what an unlocalized type string costs), so a
//     known type shows its paraglide message and a free-text one ('proov')
//     shows its raw value
//   - eventType '' → NO badge in that row (nothing invented)
//   - the component never filters by type: a concert renders as a full row
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgendaList from './AgendaList.svelte';
import type { AgendaItem } from '$lib/agenda/types';

vi.mock('$lib/paraglide/messages.js', () => {
	const keys: Record<string, (params?: Record<string, unknown>) => string> = {
		agenda_duration_min: (params) => `${(params as { minutes: number }).minutes} min`,
		agenda_row_link_label: (params) => `View details for ${(params as { event: string }).event}`,
		agenda_row_link_label_unnamed: () => 'View event details',
		// Distinct markers prove the badge goes through paraglide, not raw text.
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

// Review F6 — the badge testid is id-suffixed (`event-type-badge-{id}`), the
// convention every other per-row testid in AgendaList follows, so it is
// unambiguous page-wide and can be queried directly. Containment in its OWN row
// is still asserted: the suffix says which event, the row says where it renders.
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

	// NOTE: passes at RED (the component never filtered) — kept as the regression
	// pin that GREEN's badge work must not introduce a type filter here.
	it('a CONCERT renders as a full agenda row — the component never filters by type', () => {
		const { container } = render(AgendaList, {
			items: [item('c1', '2026-06-16T16:00:00.000Z', { eventType: 'concert', name: 'Kevadkontsert' })]
		});
		const row = container.querySelector('[data-testid="agenda-row-c1"]');
		expect(row).not.toBeNull();
		expect(row!.textContent).toContain('Kevadkontsert');
		// No empty state alongside a rendered row
		expect(container.querySelector('[data-testid="agenda-empty"]')).toBeNull();
	});

	it("a free-text type ('proov') shows its RAW value — the shared fallback, never blank", () => {
		const { container } = render(AgendaList, {
			items: [item('p1', '2026-06-15T09:00:00.000Z', { eventType: 'proov' })]
		});
		expect(rowBadge(container, 'agenda-row-p1', 'p1')?.textContent?.trim()).toBe('proov');
	});

	// NOTE: passes trivially at RED (no badge exists yet) — it is the GREEN
	// constraint: adding the badge must not invent one for a type-less event.
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

// (*MVOX:Palestrina* — #194/#202 RED)
