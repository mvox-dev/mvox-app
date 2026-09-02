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

// ─── #211 RED — event type badges become COLOR-CODED (mvox palette) ──────────
//
// PO ruling (Gama, 2026-09-02): six hued types (rehearsal/concert/festival/
// retreat/workshop/meeting), social+other keep the quiet default; badge color
// ONLY — no row tint, no icons; the label text ALWAYS stays on the badge; ONE
// scheme (src/lib/events/eventTypeStyles.ts — pinned in eventTypeStyles.spec.ts)
// consumed by the recent badge, the upcoming badge, the event-detail badge and
// later #214's chips.
//
// At RED the module is absent, so Vite's import-analysis fails this WHOLE
// file (the #194/#202 assertions above included). GREEN restores every one of
// them — badge textContent stays unchanged; only classes change.
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
		// Color is an ADDITION: the localized label text stays on the badge.
		expect(rehearsalBadge.textContent?.trim()).toBe('[msg:rehearsal]');

		const socialBadge = rowBadge(container, 'agenda-row-s1', 's1')!;
		expect(socialBadge).not.toBeNull();
		expectClasses(socialBadge, eventTypeBadgeClass('social'));
		// The quiet default carries NO type-* token at all.
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
		await stylesModule(); // RED gate: this test is about #211's markup contract
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

	// Gama ruling (3): badge color ONLY — no row-level tint, no icons.
	it('GUARD: no type-* token leaks onto the ROW element, and no icon element inside the badge', async () => {
		await stylesModule(); // RED gate: guards belong to #211's contract
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
			// The badge holds TEXT only: no svg/img/child element (icons ruled out),
			// no emoji/glyph prepended to the label.
			expect(badge!.children.length).toBe(0);
			expect(badge!.querySelector('svg, img')).toBeNull();
		}
	});
});

// (*MVOX:Palestrina* — #194/#202 RED)
// (*MVOX:Tallis* — #211 RED)
