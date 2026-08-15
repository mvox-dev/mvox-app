// @vitest-environment happy-dom
//
// #155/S1 RED — roster VIEW-MODE CHIP SELECTOR + ARRANGE MODE SHELL, on the
// ACTUAL /roster page route (integration).
//
// Design (#155, Gama 2026-08-15): the collapse-all/expand-all toggle is
// REPLACED by a 3-chip selector — Collapsed / Expanded / Arrange. Collapsed and
// Expanded are display modes; Arrange (rights-gated, editors only) is where ALL
// section management will live. S1 ships the selector and the arrange-mode
// SHELL only: a compact section list (name + member count, nesting by
// indentation, no member lists, NO management controls yet — S2–S4 add those).
//
// Same integration discipline as page.roster-sections-ux.spec.ts: the REAL page
// component renders, `groupBySection` runs real, only the fetch seams and the
// sectionActions write seam are mocked — GREEN cannot pass by building the
// selector or the arrange list in isolation without wiring them into the route.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS
//     roster-view-modes            the chip selector container; rendered ABOVE
//                                  the groups (same document-order contract the
//                                  old sections-toggle-all held)
//     roster-view-chip-collapsed   ┐ the chips, in THIS document order. Radio-
//     roster-view-chip-expanded    │ style single selection: each carries
//     roster-view-chip-arrange     ┘ aria-pressed, EXACTLY ONE is "true".
//                                  The arrange chip renders ONLY for
//                                  admin === 'admin' (fail-closed on
//                                  'loading'/'error', same as every other
//                                  admin control on this page).
//     roster-arrange-list          arrange-mode container; rendered ONLY while
//                                  the arrange chip is active; REPLACES
//                                  roster-groups on screen
//     arrange-row-<sectionId>      one row per section (every nesting level),
//                                  in tree PRE-ORDER; carries
//                                  data-depth="<depth>"; its text contains the
//                                  section name and the RECURSIVE member count
//                                  (groupBySection's memberCount — the same
//                                  number the grouped header "(n)" shows)
//
//   REPLACEMENT: sections-toggle-all no longer renders. NOTE FOR GREEN — this
//   SUPERSEDES the toggle-all pins in page.roster-sections-ux.spec.ts
//   (finding #9 describe block) and any helper that clicks it (e.g. the
//   placeFocusAfterRemove fallback target in roster/+page.svelte and the
//   toggle-all reflections in page.roster-sections-ux.spec.ts's F3 block);
//   those specs must be UPDATED to the chip contract, not worked around.
//
//   DEFAULT: Collapsed stays the default mode (finding #9's collapsed-by-
//   default is unchanged — the chip selector only renames how it is driven).
//   The Expanded chip shows every section's members, sub-sections included
//   (what expand-all used to do); the Collapsed chip returns to no member rows.
//
//   DATA: the arrange list is derived from the SAME loadRoster/listSections
//   load the page already did — switching modes refetches NOTHING ("runs once
//   at load", the page's standing contract).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock, listSectionsMock, assignMock, unassignMock, createMock, reorderMock, deleteMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createMock: vi.fn(),
		reorderMock: vi.fn(),
		deleteMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock
}));
// Severs the entu-config → $env/dynamic/public import under happy-dom (same
// pattern as page.roster-sections-ux.spec.ts).
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────
// Soprano (roll-up 3: Ada direct + Eva in Soprano 1 + Selma in Soprano 2)
//   ▸ Soprano 1 (1), Soprano 2 (1); Alto (1); Tenor (1); Bass (0, empty leaf).
// Every member assigned → no Unassigned group.

function fixtureTree(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', depth: 1, children: [] },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', depth: 1, children: [] }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, depth: 0, children: [] },
		{ id: 'sec-bass', name: 'Bass', displayOrder: 4, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop2'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] },
		{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-tenor'] }
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
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

async function renderReady(admin: AdminState = 'admin') {
	setAuthedWithOneCollective();
	adminStore.set(admin);
	const { container } = render(Page);
	await waitFor(() => {
		// roster-groups is the ready anchor: the page ALWAYS starts in the
		// grouped/collapsed default (arrange is only reachable via a chip click
		// after load), so this holds at RED and at GREEN alike — and each test
		// then fails on its own chip/arrange assertion, not in this helper.
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function chip(container: HTMLElement, mode: 'collapsed' | 'expanded' | 'arrange'): HTMLElement | null {
	return q(container, `roster-view-chip-${mode}`);
}

/** aria-pressed of the three chips, in document order — the radio-style pin. */
function pressedStates(container: HTMLElement): Record<string, string | null> {
	return {
		collapsed: chip(container, 'collapsed')?.getAttribute('aria-pressed') ?? null,
		expanded: chip(container, 'expanded')?.getAttribute('aria-pressed') ?? null,
		arrange: chip(container, 'arrange')?.getAttribute('aria-pressed') ?? null
	};
}

async function selectMode(
	container: HTMLElement,
	mode: 'collapsed' | 'expanded' | 'arrange'
): Promise<void> {
	const target = chip(container, mode);
	expect(target, `chip for ${mode}`).not.toBeNull();
	await fireEvent.click(target as HTMLElement);
	await waitFor(() => {
		expect((chip(container, mode) as HTMLElement).getAttribute('aria-pressed')).toBe('true');
	});
}

function memberRowCount(container: HTMLElement): number {
	return container.querySelectorAll('[data-testid^="roster-row-"]').length;
}

// ── 1. the chip selector ────────────────────────────────────────────────────────

describe('/roster — the 3-chip view-mode selector replaces the collapse/expand toggle (#155/S1)', () => {
	it('admin: roster-view-modes renders ABOVE the groups with Collapsed, Expanded and Arrange chips in that document order, each with an accessible name', async () => {
		const container = await renderReady('admin');

		const selector = q(container, 'roster-view-modes');
		expect(selector).not.toBeNull();

		const collapsed = chip(container, 'collapsed');
		const expanded = chip(container, 'expanded');
		const arrange = chip(container, 'arrange');
		expect(collapsed).not.toBeNull();
		expect(expanded).not.toBeNull();
		expect(arrange).not.toBeNull();
		for (const c of [collapsed, expanded, arrange]) {
			expect(c?.getAttribute('aria-label') || c?.textContent?.trim()).toBeTruthy();
			// The chips live INSIDE the selector container — one widget, not three
			// scattered buttons.
			expect(selector?.contains(c as HTMLElement)).toBe(true);
		}

		// Document order: Collapsed → Expanded → Arrange.
		expect(
			(collapsed as HTMLElement).compareDocumentPosition(expanded as HTMLElement) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			(expanded as HTMLElement).compareDocumentPosition(arrange as HTMLElement) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();

		// Above the groups, same slot contract the old toggle held.
		const groups = q(container, 'roster-groups') as HTMLElement;
		expect(groups).not.toBeNull();
		expect(
			(selector as HTMLElement).compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('the old sections-toggle-all control is GONE — the chips replace it, they do not sit beside it', async () => {
		const container = await renderReady('admin');
		expect(q(container, 'sections-toggle-all')).toBeNull();
	});

	it('default selection is Collapsed: aria-pressed="true" on the Collapsed chip ONLY, and no member row is on screen', async () => {
		const container = await renderReady('admin');

		expect(pressedStates(container)).toEqual({
			collapsed: 'true',
			expanded: 'false',
			arrange: 'false'
		});
		expect(memberRowCount(container)).toBe(0);
	});

	it('clicking Expanded switches the mode radio-style — Expanded becomes the ONE active chip and every section\'s members (sub-sections included) appear', async () => {
		const container = await renderReady('admin');

		await selectMode(container, 'expanded');

		expect(pressedStates(container)).toEqual({
			collapsed: 'false',
			expanded: 'true',
			arrange: 'false'
		});
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});
		// Sub-section members too — Expanded is what expand-all used to be.
		expect(q(container, 'roster-row-m-eva')).not.toBeNull();
		expect(q(container, 'roster-row-m-sel')).not.toBeNull();
	});

	it('clicking Collapsed after Expanded returns to the collapsed display — one active chip, member rows gone', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'expanded');
		await waitFor(() => {
			expect(memberRowCount(container)).toBeGreaterThan(0);
		});

		await selectMode(container, 'collapsed');

		expect(pressedStates(container)).toEqual({
			collapsed: 'true',
			expanded: 'false',
			arrange: 'false'
		});
		await waitFor(() => {
			expect(memberRowCount(container)).toBe(0);
		});
	});

	it.each(['not-admin', 'loading', 'error'] as const)(
		'%s: the Arrange chip does NOT render — non-editors get exactly the two display chips (fail closed on unresolved/errored rights)',
		async (state) => {
			const container = await renderReady(state);

			expect(chip(container, 'arrange')).toBeNull();
			expect(chip(container, 'collapsed')).not.toBeNull();
			expect(chip(container, 'expanded')).not.toBeNull();
			// Exactly two chips — no third control under another name either.
			expect(
				container.querySelectorAll('[data-testid^="roster-view-chip-"]')
			).toHaveLength(2);
		}
	);
});

// ── 2. arrange mode rendering (the S1 shell) ────────────────────────────────────

describe('/roster — the Arrange chip renders the compact arrange-mode shell (#155/S1)', () => {
	it('activating Arrange makes it the one active chip and swaps roster-groups out for roster-arrange-list', async () => {
		const container = await renderReady('admin');
		expect(q(container, 'roster-arrange-list')).toBeNull();

		await selectMode(container, 'arrange');

		expect(pressedStates(container)).toEqual({
			collapsed: 'false',
			expanded: 'false',
			arrange: 'true'
		});
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
		expect(q(container, 'roster-groups')).toBeNull();
	});

	it('the list holds ONE row per section — every nesting level — in tree pre-order, each row carrying data-depth for its nesting level', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const rows = [
			...(q(container, 'roster-arrange-list') as HTMLElement).querySelectorAll<HTMLElement>(
				'[data-testid^="arrange-row-"]'
			)
		];
		expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor',
			'arrange-row-sec-bass'
		]);
		expect(rows.map((r) => r.getAttribute('data-depth'))).toEqual(['0', '1', '1', '0', '0', '0']);
	});

	it('each row shows the section NAME and its RECURSIVE member count — the same roll-up the grouped headers show (Soprano 3, its subs 1 each, Bass 0)', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const expectRow = (id: string, name: string, count: number) => {
			const row = q(container, `arrange-row-${id}`) as HTMLElement;
			expect(row, `arrange row for ${id}`).not.toBeNull();
			const text = row.textContent ?? '';
			expect(text).toContain(name);
			// The count is on the row as its own number — "(n)", the page's
			// standing header convention.
			expect(text.replace(/\s+/g, ' ')).toContain(`(${count})`);
		};
		expectRow('sec-sop', 'Soprano', 3);
		expectRow('sec-sop1', 'Soprano 1', 1);
		expectRow('sec-sop2', 'Soprano 2', 1);
		expectRow('sec-alto', 'Alto', 1);
		expectRow('sec-tenor', 'Tenor', 1);
		expectRow('sec-bass', 'Bass', 0);
	});

	it('nesting is VISIBLE, not just declared: a depth-1 row renders with indentation a depth-0 row does not have (class/style must differ by depth)', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const root = q(container, 'arrange-row-sec-sop') as HTMLElement;
		const sub = q(container, 'arrange-row-sec-sop1') as HTMLElement;
		// Mechanism is GREEN's choice (margin, padding, a per-depth class) — but
		// the two rows' rendered attributes must not be identical, or "nesting
		// shown by visual indentation" is not on screen. data-depth alone (an
		// invisible attribute) does not satisfy this.
		const fingerprint = (el: HTMLElement) => `${el.className}|${el.getAttribute('style') ?? ''}`;
		expect(fingerprint(sub)).not.toBe(fingerprint(root));
	});

	it('COMPACT means compact: no member rows render anywhere while arrange mode is active', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		expect(memberRowCount(container)).toBe(0);
	});

	it('NO management controls in the S1 shell — no remove ✕, no drag handles, no per-section expand toggles, no pickers, no new-section entry inside the arrange list (S2–S4 add management)', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const list = q(container, 'roster-arrange-list') as HTMLElement;
		for (const prefix of [
			'section-remove-',
			'section-drag-handle-',
			'section-toggle-',
			'section-picker-',
			'roster-new-section'
		]) {
			expect(
				list.querySelectorAll(`[data-testid^="${prefix}"]`),
				`no "${prefix}*" control inside the arrange list`
			).toHaveLength(0);
		}
	});

	it('switching BACK to Collapsed resumes normal rendering: arrange list gone, roster-groups back, sections collapsed', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		await selectMode(container, 'collapsed');

		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).toBeNull();
		});
		expect(q(container, 'roster-groups')).not.toBeNull();
		expect(q(container, 'section-group-sec-sop')).not.toBeNull();
		expect(memberRowCount(container)).toBe(0);
	});

	it('switching from Arrange to Expanded resumes the member-bearing rendering path too', async () => {
		const container = await renderReady('admin');
		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		await selectMode(container, 'expanded');

		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});
		expect(q(container, 'roster-arrange-list')).toBeNull();
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
});

// ── 3. integration: mode switching rides the EXISTING load ──────────────────────

describe('/roster — the view modes are a rendering switch over the one existing load (#155/S1)', () => {
	it('cycling Collapsed → Arrange → Expanded → Collapsed refetches NOTHING: loadRoster and listSections each ran exactly once, at page load', async () => {
		const container = await renderReady('admin');
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(listSectionsMock).toHaveBeenCalledTimes(1);

		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
		await selectMode(container, 'expanded');
		await waitFor(() => {
			expect(memberRowCount(container)).toBeGreaterThan(0);
		});
		await selectMode(container, 'collapsed');
		await waitFor(() => {
			expect(memberRowCount(container)).toBe(0);
		});

		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});

	it('the arrange list reflects the LOADED tree, not a hardcoded shape: a different fixture renders its own rows', async () => {
		listSectionsMock.mockResolvedValue([
			{
				id: 'sec-men',
				name: 'Men',
				displayOrder: 1,
				parentId: null,
				depth: 0,
				children: [
					{ id: 'sec-men1', name: 'Men 1', displayOrder: 1, parentId: 'sec-men', depth: 1, children: [] }
				]
			}
		] satisfies SectionNode[]);
		loadRosterMock.mockResolvedValue([
			{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-men1'] }
		] satisfies RosterRow[]);
		const container = await renderReady('admin');

		await selectMode(container, 'arrange');
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});

		const rows = [
			...(q(container, 'roster-arrange-list') as HTMLElement).querySelectorAll<HTMLElement>(
				'[data-testid^="arrange-row-"]'
			)
		];
		expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
			'arrange-row-sec-men',
			'arrange-row-sec-men1'
		]);
		// Men's roll-up counts its sub-section's one member.
		expect((q(container, 'arrange-row-sec-men') as HTMLElement).textContent).toContain('(1)');
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();
	});
});

// (*MVOX:Tallis* — #155/S1 RED)
