// @vitest-environment happy-dom
//
// TS.1/#95 RED — the /roster page's SECTION-GROUPED layout (integration). These
// tests render the ACTUAL page route component and pin the grouped rewrite:
// collapsible display_order-ordered section groups with recursive member counts,
// sub-section indentation, Unassigned at the bottom, and the column-header
// grouped ↔ flat sort toggle. `groupBySection` runs REAL (partial mock — only the
// fetching seams `loadRoster`/`listSections` are mocked), so the page cannot pass
// by re-deriving grouping ad hoc: it must call the genuine data layer.
//
// Pinned testid contract (GREEN must implement):
//   roster-groups                      grouped-view container (default view)
//   section-group-<sectionId>          one group per section, document order =
//                                      display_order pre-order; data-depth="<n>"
//   section-group-unassigned           the Unassigned group, LAST; data-depth="0"
//   section-header-<sectionId|unassigned>  header; text contains "Name (count)"
//   section-toggle-<sectionId>         collapse/expand control, aria-expanded
//   roster-row-<memberId>              member row (same testid family as the flat
//                                      T3.3 roster — rows survive the rewrite)
//   roster-sort-toggle                 column header control: grouped ↔ flat
//   roster-flat-list                   flat-view container (alphabetical)
//   roster-row-section                 flat-view row's section name (secondary
//                                      text; ABSENT on an unassigned member's row)
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only in this file; real copy is
// Comenius's (i18n pass). Any message key resolves to itself.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock, listSectionsMock } = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
// Severs the entu-config → $env/dynamic/public import under happy-dom (same
// pattern as page.roster.spec.ts).
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
// Same severing, for the OTHER real chain this page pulls in: the sectionData
// mock below keeps groupBySection real (importOriginal), which loads
// sectionData.ts's own `entuFetch` import (→ $lib/entu-config → $env/dynamic/public)
// at module scope.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────
// Soprano (order 1) ▸ Soprano 1; Alto (order 2). Members: Ada+Carol in Soprano,
// Eva in Soprano 1, Bea in Alto, Pete unassigned.
// Counts: Soprano (3) — 2 direct + 1 in Soprano 1; Soprano 1 (1); Alto (1).

function fixtureTree(): SectionNode[] {
	const sop1: SectionNode = {
		id: 'sec-sop1',
		name: 'Soprano 1',
		displayOrder: 1,
		parentId: 'sec-sop',
		depth: 1,
		children: []
	};
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			depth: 0,
			children: [sop1]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] },
		{ memberId: 'm-carol', personId: 'p-carol', name: 'Carol Williams', email: 'carol@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
		{ memberId: 'm-pete', personId: 'p-pete', name: 'Pete Wilson', email: 'pete@x.com', sectionIds: [] }
	];
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(fixtureRows());
	listSectionsMock.mockResolvedValue(fixtureTree());
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

async function renderReady() {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	return container;
}

function groupIds(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="section-group-"]')].map(
		(el) => el.getAttribute('data-testid') ?? ''
	);
}

// TU.2/#110 finding #9 — sections (a sub-section's own GROUP included — it
// only renders once its parent is expanded) default COLLAPSED now; this file's
// concerns (grouping/counts/depth) need everything OPEN to inspect, so expand
// every id up front. State-agnostic (only clicks when collapsed) so it is safe
// to call regardless of a given test's starting point.
async function expand(container: HTMLElement, id: string): Promise<void> {
	const toggle = container.querySelector(`[data-testid="section-toggle-${id}"]`) as HTMLElement;
	if (toggle.getAttribute('aria-expanded') === 'false') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});
}

/** Expand Soprano (revealing Soprano 1's toggle), then Soprano 1, Alto and
 *  Unassigned (when present) — every group this file's fixtures can produce. */
async function expandAll(container: HTMLElement): Promise<void> {
	await expand(container, 'sec-sop');
	if (container.querySelector('[data-testid="section-toggle-sec-sop1"]')) {
		await expand(container, 'sec-sop1');
	}
	if (container.querySelector('[data-testid="section-toggle-sec-alto"]')) {
		await expand(container, 'sec-alto');
	}
	if (container.querySelector('[data-testid="section-toggle-unassigned"]')) {
		await expand(container, 'unassigned');
	}
}

// ── grouped layout (default view) ───────────────────────────────────────────────

describe('/roster — section-grouped layout (integration: real groupBySection behind the actual page)', () => {
	it('renders groups in display_order pre-order with Unassigned LAST; each member row sits inside ITS section\'s group; sub-sections carry data-depth', async () => {
		const container = await renderReady();
		await expandAll(container); // TU.2/#110 finding #9 — collapsed by default now

		expect(groupIds(container)).toEqual([
			'section-group-sec-sop',
			'section-group-sec-sop1',
			'section-group-sec-alto',
			'section-group-unassigned'
		]);

		const sop = container.querySelector('[data-testid="section-group-sec-sop"]');
		const sop1 = container.querySelector('[data-testid="section-group-sec-sop1"]');
		const alto = container.querySelector('[data-testid="section-group-sec-alto"]');
		const unassigned = container.querySelector('[data-testid="section-group-unassigned"]');

		// Rows live under the RIGHT group — Eva belongs to the sub-section, not to
		// Soprano's own row list. (If the DOM nests sub-section groups inside their
		// parent group element, Eva's row may sit inside sop TRANSITIVELY via sop1 —
		// so assert her row is inside sop1, and that sop's DIRECT rows are Ada+Carol.)
		expect(sop1?.querySelector('[data-testid="roster-row-m-eva"]')).not.toBeNull();
		expect(alto?.querySelector('[data-testid="roster-row-m-bea"]')).not.toBeNull();
		expect(unassigned?.querySelector('[data-testid="roster-row-m-pete"]')).not.toBeNull();
		expect(sop?.querySelector('[data-testid="roster-row-m-ada"]')).not.toBeNull();
		expect(sop?.querySelector('[data-testid="roster-row-m-carol"]')).not.toBeNull();
		expect(alto?.querySelector('[data-testid="roster-row-m-pete"]')).toBeNull();

		// Indentation levels are DATA the DOM exposes (data-depth), not just CSS.
		expect(sop?.getAttribute('data-depth')).toBe('0');
		expect(sop1?.getAttribute('data-depth')).toBe('1');
		expect(alto?.getAttribute('data-depth')).toBe('0');
		expect(unassigned?.getAttribute('data-depth')).toBe('0');
	});

	it('section headers show RECURSIVE member counts — "Soprano (3)" = 2 direct + 1 in Soprano 1', async () => {
		const container = await renderReady();
		await expand(container, 'sec-sop'); // TU.2/#110 finding #9 — Soprano 1's own header only renders once Soprano is expanded
		const headerText = (id: string) =>
			container.querySelector(`[data-testid="section-header-${id}"]`)?.textContent ?? '';
		expect(headerText('sec-sop')).toMatch(/Soprano\s*\(3\)/);
		expect(headerText('sec-sop1')).toMatch(/Soprano 1\s*\(1\)/);
		expect(headerText('sec-alto')).toMatch(/Alto\s*\(1\)/);
		expect(headerText('unassigned')).toMatch(/\(1\)/);
	});

	it('all sections are COLLAPSED by default (every toggle aria-expanded="false", no member row present — TU.2/#110 finding #9 supersedes the old expanded-by-default default); expanding shows rows/subtree, collapsing a parent hides it again (direct rows AND sub-section groups), re-expanding restores it', async () => {
		const container = await renderReady();

		const toggles = [...container.querySelectorAll('[data-testid^="section-toggle-"]')];
		expect(toggles.length).toBeGreaterThan(0);
		for (const t of toggles) expect(t.getAttribute('aria-expanded')).toBe('false');
		expect(container.querySelectorAll('[data-testid^="roster-row-"]')).toHaveLength(0);

		// Expand every section (Soprano 1's toggle only appears once Soprano itself
		// is expanded) plus Unassigned, to get every row on screen.
		const sopToggle = container.querySelector(
			'[data-testid="section-toggle-sec-sop"]'
		) as HTMLElement;
		await fireEvent.click(sopToggle);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="section-toggle-sec-sop1"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="section-toggle-sec-sop1"]') as HTMLElement
		);
		await fireEvent.click(
			container.querySelector('[data-testid="section-toggle-sec-alto"]') as HTMLElement
		);
		await fireEvent.click(
			container.querySelector('[data-testid="section-toggle-unassigned"]') as HTMLElement
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-row-m-ada"]')).not.toBeNull();
		});
		for (const m of ['m-ada', 'm-bea', 'm-carol', 'm-eva', 'm-pete']) {
			expect(container.querySelector(`[data-testid="roster-row-${m}"]`)).not.toBeNull();
		}

		// Collapse Soprano → its direct rows AND its sub-section's content disappear;
		// other sections are untouched.
		await fireEvent.click(sopToggle);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-row-m-ada"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-row-m-carol"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-row-m-eva"]')).toBeNull();
		expect(sopToggle.getAttribute('aria-expanded')).toBe('false');
		expect(container.querySelector('[data-testid="roster-row-m-bea"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="roster-row-m-pete"]')).not.toBeNull();

		// Re-expand → everything back.
		await fireEvent.click(sopToggle);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-row-m-ada"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-row-m-eva"]')).not.toBeNull();
	});
});

// ── column-header sort toggle: grouped ↔ flat ──────────────────────────────────

describe('/roster — column header toggles grouped ↔ flat (alphabetical) views', () => {
	it('default is GROUPED; toggling shows the FLAT alphabetical list (no section groups, rows name-sorted, section name as secondary text, absent on unassigned rows); toggling again returns to grouped', async () => {
		const container = await renderReady();
		const toggle = container.querySelector('[data-testid="roster-sort-toggle"]') as HTMLElement;
		expect(toggle).not.toBeNull();

		// → flat
		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-groups"]')).toBeNull();
		expect(groupIds(container)).toEqual([]);

		// Alphabetical by name, ALL members present (grouping never gates visibility).
		const names = [...container.querySelectorAll('[data-testid="roster-row-name"]')].map(
			(el) => el.textContent?.trim() ?? ''
		);
		expect(names).toEqual(['Ada Lovelace', 'Bea Noe', 'Carol Williams', 'Eva Green', 'Pete Wilson']);

		// Section name rides along as secondary text — resolved from the TREE (id →
		// name), and ABSENT (no node, not an empty node) for an unassigned member.
		const evaRow = container.querySelector('[data-testid="roster-row-m-eva"]');
		expect(evaRow?.querySelector('[data-testid="roster-row-section"]')?.textContent).toContain(
			'Soprano 1'
		);
		const peteRow = container.querySelector('[data-testid="roster-row-m-pete"]');
		expect(peteRow?.querySelector('[data-testid="roster-row-section"]')).toBeNull();

		// → back to grouped
		await fireEvent.click(
			container.querySelector('[data-testid="roster-sort-toggle"]') as HTMLElement
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-flat-list"]')).toBeNull();
	});
});

// ── F1 code-review fix: multi-section members ──────────────────────────────────

describe('/roster — F1 code-review fix: a member in MULTIPLE sections appears in every one of them', () => {
	it('a member with sectionIds in two groups shows up in BOTH groups\' member lists (grouped view), and both section names ride along in the flat view', async () => {
		loadRosterMock.mockResolvedValue([
			...fixtureRows(),
			{
				memberId: 'm-multi',
				personId: 'p-multi',
				name: 'Mia Multi',
				email: 'mia@x.com',
				sectionIds: ['sec-sop', 'sec-alto']
			}
		]);
		const container = await renderReady();
		// TU.2/#110 finding #9 — collapsed by default now; expand both groups to
		// see their rows.
		await expand(container, 'sec-sop');
		await expand(container, 'sec-alto');

		const sop = container.querySelector('[data-testid="section-group-sec-sop"]');
		const alto = container.querySelector('[data-testid="section-group-sec-alto"]');
		expect(sop?.querySelector('[data-testid="roster-row-m-multi"]')).not.toBeNull();
		expect(alto?.querySelector('[data-testid="roster-row-m-multi"]')).not.toBeNull();

		// Counts reflect her in BOTH sections — 3 in Soprano (was 2), 2 in Alto (was 1).
		const headerText = (id: string) =>
			container.querySelector(`[data-testid="section-header-${id}"]`)?.textContent ?? '';
		expect(headerText('sec-sop')).toMatch(/Soprano\s*\(4\)/); // 2 direct + Eva's Soprano 1 (1) + Mia (1)
		expect(headerText('sec-alto')).toMatch(/Alto\s*\(2\)/);

		// Flat view: both section names ride along as secondary text.
		await fireEvent.click(container.querySelector('[data-testid="roster-sort-toggle"]') as HTMLElement);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		const multiRow = container.querySelector('[data-testid="roster-row-m-multi"]');
		const sectionText = multiRow?.querySelector('[data-testid="roster-row-section"]')?.textContent ?? '';
		expect(sectionText).toContain('Soprano');
		expect(sectionText).toContain('Alto');
	});
});

// ── F2 code-review fix: sub-section indentation ─────────────────────────────────

describe('/roster — F2 code-review fix: sub-section indentation is a constant per level, not depth*1rem', () => {
	it('a depth-2 node gets margin-left: 1rem (constant), NOT 2rem — nesting inside its already-indented parent supplies the second rem visually', async () => {
		const deepTree: SectionNode[] = [
			{
				id: 'sec-sop',
				name: 'Soprano',
				displayOrder: 1,
				parentId: null,
				depth: 0,
				children: [
					{
						id: 'sec-sop1',
						name: 'Soprano 1',
						displayOrder: 1,
						parentId: 'sec-sop',
						depth: 1,
						children: [
							{
								id: 'sec-sop1a',
								name: 'Soprano 1a',
								displayOrder: 1,
								parentId: 'sec-sop1',
								depth: 2,
								children: []
							}
						]
					}
				]
			}
		];
		loadRosterMock.mockResolvedValue([]);
		listSectionsMock.mockResolvedValue(deepTree);
		const container = await renderReady();
		// TU.2/#110 finding #9 — a sub-section's own GROUP element only renders
		// once its parent is expanded; collapsed by default now.
		await expand(container, 'sec-sop');
		await expand(container, 'sec-sop1');

		const root = container.querySelector('[data-testid="section-group-sec-sop"]') as HTMLElement;
		const mid = container.querySelector('[data-testid="section-group-sec-sop1"]') as HTMLElement;
		const deep = container.querySelector('[data-testid="section-group-sec-sop1a"]') as HTMLElement;

		expect(root.style.marginLeft).toBe('0rem');
		expect(mid.style.marginLeft).toBe('1rem');
		expect(deep.style.marginLeft).toBe('1rem');
	});
});

// ── F3 code-review fix: decoupled loads ──────────────────────────────────────────

describe('/roster — F3 code-review fix: a section-tree failure does not black out an otherwise-loaded roster', () => {
	it('rows load OK, sections load REJECTS → flat list renders (not roster-load-error) with a visible error banner; all rows stay visible; failure is still logged', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockResolvedValue(fixtureRows());
		listSectionsMock.mockRejectedValue(new Error('sections boom'));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-flat-list"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-groups"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-sections-load-error"]')).not.toBeNull();
		for (const m of ['m-ada', 'm-bea', 'm-carol', 'm-eva', 'm-pete']) {
			expect(container.querySelector(`[data-testid="roster-row-${m}"]`)).not.toBeNull();
		}
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('rows load REJECTS (even though sections load OK) → still the full loud load-error — no partial view when the roster itself is unreadable', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadRosterMock.mockRejectedValue(new Error('rows boom'));
		listSectionsMock.mockResolvedValue(fixtureTree());
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-groups"]')).toBeNull();
		expect(container.querySelector('[data-testid="roster-flat-list"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

// ── F4 code-review fix: empty roster vs. empty section structure ────────────────

describe('/roster — F4 code-review fix: the empty placeholder is gated on rows AND sections, not rows alone', () => {
	it('rows=[] but sections exist → the section structure renders with (0) counts, NOT the roster-empty placeholder', async () => {
		loadRosterMock.mockResolvedValue([]);
		listSectionsMock.mockResolvedValue(fixtureTree());
		const container = await renderReady();
		await expand(container, 'sec-sop'); // TU.2/#110 finding #9 — Soprano 1's header needs its parent open

		expect(container.querySelector('[data-testid="roster-empty"]')).toBeNull();
		const headerText = (id: string) =>
			container.querySelector(`[data-testid="section-header-${id}"]`)?.textContent ?? '';
		expect(headerText('sec-sop')).toMatch(/Soprano\s*\(0\)/);
		expect(headerText('sec-sop1')).toMatch(/Soprano 1\s*\(0\)/);
		expect(headerText('sec-alto')).toMatch(/Alto\s*\(0\)/);
		// Zero members → no Unassigned group either.
		expect(container.querySelector('[data-testid="section-group-unassigned"]')).toBeNull();
	});

	it('rows=[] AND sections=[] → the roster-empty placeholder still shows (nothing at all to structure)', async () => {
		loadRosterMock.mockResolvedValue([]);
		listSectionsMock.mockResolvedValue([]);
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="roster-empty"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="roster-groups"]')).toBeNull();
	});
});

// (*MVOX:Tallis* — TS.1/#95 RED)
// (*MVOX:Palestrina* — F1-F4 code-review fixes, TS.1/#95)
