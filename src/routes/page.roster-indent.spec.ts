// @vitest-environment happy-dom
//
// #155/S3 RED — INDENT/UNINDENT in arrange mode (integration, on the ACTUAL
// /roster page route). S1 shipped the compact arrange shell, S2 made every row
// the reorder control (drag + touch + keyboard). This file pins the NESTING
// half GH#155 describes:
//
//   "Indent (→) / unindent (←) buttons on every row, always visible"
//   "Indent nests under the immediate previous sibling"
//   "Unindent promotes one level (to the grandparent — or the org, at top)"
//   "Keyboard: ArrowRight indents, ArrowLeft unindents, while grabbed"
//
// Same integration discipline as page.roster-arrange-reorder.spec.ts (#155/S2):
// the REAL page renders, `groupBySection`/the section tree run real, only the
// fetch seams and the sectionActions WRITE seam are mocked. The write goes
// through a NEW data function — `reparentSection(cfg, sectionId, newParentId)`
// (sectionActions.ts; its replace-semantics wire shape is pinned separately in
// sectionActions.reparent.spec.ts) — because indent/unindent changes the
// section's `_parent` REFERENCE, not its `display_order`.
//
// REVIEW FIX (#155/S3 finding F2) — the original RED pinned "`reorderSections`
// is NEVER called by these moves". That was wrong, and the assertion is
// relaxed below. `reparentSection` moves `_parent` and NOTHING else, so the
// moved section arrives in its new sibling group carrying the `display_order`
// it held in the OLD one; `listSections` sorts every level by `displayOrder`
// (sectionData.ts pass 5), so the position the UI optimistically shows does not
// survive a reload — indent Alto (order 2) under Soprano ▸ [Soprano 1 = 1,
// Soprano 2 = 2] renders "last child" and reloads as [Soprano 1, Alto,
// Soprano 2]. The contract is therefore: a reparent is `reparentSection` THEN
// ONE `reorderSections` over the DESTINATION sibling group, in its new order.
// The SOURCE group is left alone — extraction leaves a gap, and a gap sorts
// exactly like a dense run.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS — `arrange-indent-<sectionId>` and `arrange-unindent-<sectionId>`:
//   one pair per arrange row, `type="button"`, ALWAYS RENDERED (not only
//   during a grab). Accessible names via `roster_section_indent` /
//   `roster_section_unindent` (aria-label — the buttons are icon-shaped;
//   the lenient message mock below returns the KEY, real copy is Comenius's).
//
//   GUARDS (drive the `disabled` attribute, and refuse the keyboard move):
//     indent   — disabled when the section has NO PREVIOUS SIBLING (nothing
//                to nest under; nesting under a FOLLOWING sibling would
//                reorder, not indent).
//     unindent — disabled when the section is TOP-LEVEL (its parent is the
//                org; there is no level to promote to).
//
//   INDENT = nest under the immediate previous sibling, as its LAST child:
//     ONE reparentSection(cfg, id, prevSiblingId) call, the local tree
//     re-homes immediately (data-depth bumps, the indent padding class
//     changes, member roll-ups recalculate — the previous sibling's "(n)"
//     absorbs the moved subtree), and the move is announced
//     (`roster_section_indented`).
//
//   UNINDENT = promote one level: ONE reparentSection(cfg, id, newParentId)
//     call where newParentId is the GRANDPARENT section id — or the
//     ORGANIZATION id (the page already holds `currentOrgId`, #124) when the
//     parent is top-level. The promoted section lands AFTER its former
//     parent's subtree among its new siblings. Announced with
//     `roster_section_unindented` (to a section) / `roster_section_unindented_top`
//     (to top level).
//
//   KEYBOARD — while a row is GRABBED (#152 machine, unchanged): ArrowRight
//     commits an indent, ArrowLeft commits an unindent — IMMEDIATELY, through
//     the same reparentSection seam (unlike Up/Down, which stay provisional
//     until drop: a reparent changes the sibling GROUP itself, so the
//     grab's own restore-order snapshot no longer describes anything — the
//     grab therefore ENDS with the commit, and the live region says
//     "indented"/"unindented", never "cancelled"). The same guards apply:
//     a refused move (no previous sibling / already top-level) writes
//     nothing and KEEPS the grab (same posture as the Up/Down clamp).
//
//   IN-FLIGHT — a reparent write in flight disables EVERY indent/unindent
//     button (reuses `reorderPending`, the same guard that flips
//     draggable="false" — one outstanding structural write at a time).
//
//   FAILURE — a failed reparent reconciles against the server exactly like a
//     failed reorder (#98 AC-8): console.error, refetch via listSections,
//     render what the server holds.
import { render, cleanup, createEvent, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadRosterMock,
	listSectionsMock,
	assignMock,
	unassignMock,
	createMock,
	reorderMock,
	deleteMock,
	reparentMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn()
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
	deleteSection: deleteMock,
	reparentSection: reparentMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────
// Soprano ▸ [Soprano 1, Soprano 2]; Alto; Tenor — the #98/#152/S2 shape, WITH
// `orgId` on the top-level nodes and the rows: the unindent-to-top-level write
// needs the page to know the collective org id (`currentOrgId`, #124), and the
// #124/F3 org filter only keeps top-level roots whose orgId matches it.

const ORG = 'org-1';

function fixtureTree(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			orgId: ORG,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', orgId: null, depth: 1, children: [] },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', orgId: null, depth: 1, children: [] }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, orgId: ORG, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, orgId: ORG, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], orgId: ORG },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], orgId: ORG },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop2'], orgId: ORG },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], orgId: ORG },
		{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-tenor'], orgId: ORG }
	];
}

/** Soprano ▸ [Soprano 1 ▸ [Soprano 1a]]; Alto — a depth-2 leaf, so an unindent
 *  whose new parent is a SECTION (the grandparent), not the org, is exercisable. */
function fixtureTreeDeep(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			orgId: ORG,
			depth: 0,
			children: [
				{
					id: 'sec-sop1',
					name: 'Soprano 1',
					displayOrder: 1,
					parentId: 'sec-sop',
					orgId: null,
					depth: 1,
					children: [
						{ id: 'sec-sop1a', name: 'Soprano 1a', displayOrder: 1, parentId: 'sec-sop1', orgId: null, depth: 2, children: [] }
					]
				}
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, orgId: ORG, depth: 0, children: [] }
	];
}

function fixtureRowsDeep(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], orgId: ORG },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], orgId: ORG },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop1a'], orgId: ORG },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], orgId: ORG }
	];
}

const CFG = { db: 'polyphony', token: 'jwt-abc' };

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
	// Fresh objects per call — a reconcile REFETCH after a failed write must get
	// a tree the optimistic patch can't have mutated.
	loadRosterMock.mockImplementation(() => Promise.resolve(fixtureRows()));
	listSectionsMock.mockImplementation(() => Promise.resolve(fixtureTree()));
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
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
	reparentMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderInArrangeMode(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

/** Document-order arrange-row testids — the on-screen order. */
function rowOrder(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="arrange-row-"]')].map(
		(el) => el.getAttribute('data-testid') ?? ''
	);
}

function row(container: HTMLElement, id: string): HTMLElement {
	return q(container, `arrange-row-${id}`) as HTMLElement;
}

function indentBtn(container: HTMLElement, id: string): HTMLButtonElement {
	const el = q(container, `arrange-indent-${id}`);
	expect(el, `indent button for ${id}`).not.toBeNull();
	return el as HTMLButtonElement;
}

function unindentBtn(container: HTMLElement, id: string): HTMLButtonElement {
	const el = q(container, `arrange-unindent-${id}`);
	expect(el, `unindent button for ${id}`).not.toBeNull();
	return el as HTMLButtonElement;
}

function statusText(container: HTMLElement): string {
	return q(container, 'roster-reorder-status')?.textContent ?? '';
}

// ── the buttons: present, always visible, guard-driven disabled ──────────────

describe('/roster — arrange rows carry indent/unindent buttons (#155/S3)', () => {
	it('every arrange row has an arrange-indent-* and arrange-unindent-* button (type="button"), named via roster_section_indent/roster_section_unindent — with NO grab active', async () => {
		const container = await renderInArrangeMode();

		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			const ind = indentBtn(container, id);
			const un = unindentBtn(container, id);
			expect(ind.getAttribute('type'), `indent ${id}`).toBe('button');
			expect(un.getAttribute('type'), `unindent ${id}`).toBe('button');
			// Lenient message mock returns the KEY — real copy is Comenius's.
			expect(ind.getAttribute('aria-label'), `indent ${id}`).toContain('roster_section_indent');
			expect(un.getAttribute('aria-label'), `unindent ${id}`).toContain('roster_section_unindent');
		}
		// "Always visible" — no row is grabbed, no drag is live, and the buttons
		// are already on screen (the presence assertions above ran grab-free).
		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			expect(row(container, id).getAttribute('data-grabbed')).toBeNull();
		}
	});

	it('guards: indent disabled without a PREVIOUS SIBLING; unindent disabled at TOP LEVEL', async () => {
		const container = await renderInArrangeMode();

		// Soprano — first top-level: nothing to nest under, nothing to promote to.
		expect(indentBtn(container, 'sec-sop').disabled).toBe(true);
		expect(unindentBtn(container, 'sec-sop').disabled).toBe(true);
		// Soprano 1 — first child: no previous sibling, but promotable to top.
		expect(indentBtn(container, 'sec-sop1').disabled).toBe(true);
		expect(unindentBtn(container, 'sec-sop1').disabled).toBe(false);
		// Soprano 2 — has a previous sibling AND a parent to promote from.
		expect(indentBtn(container, 'sec-sop2').disabled).toBe(false);
		expect(unindentBtn(container, 'sec-sop2').disabled).toBe(false);
		// Alto / Tenor — nestable under their previous siblings, already top-level.
		expect(indentBtn(container, 'sec-alto').disabled).toBe(false);
		expect(unindentBtn(container, 'sec-alto').disabled).toBe(true);
		expect(indentBtn(container, 'sec-tenor').disabled).toBe(false);
		expect(unindentBtn(container, 'sec-tenor').disabled).toBe(true);
	});
});

// ── containment: the buttons live OUTSIDE the row's role="button" subtree ─────

describe('/roster — the nesting buttons are SIBLINGS of the arrange row, not children of it (#155/S3 review R2/F1)', () => {
	const ALL_IDS = ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor'];

	it('no arrange row contains a FOCUSABLE descendant — a `<button>` inside a `role="button"` is the `nested-interactive` violation, and it adds tab stops inside a widget #152 gave ONE roving tab stop', async () => {
		const container = await renderInArrangeMode();

		for (const id of ALL_IDS) {
			const r = row(container, id);
			expect(r.getAttribute('role'), `row ${id} is still the role=button control`).toBe('button');
			expect(
				r.querySelector('button, a[href], input, select, textarea, [tabindex], [contenteditable]'),
				`focusable descendant inside row ${id}`
			).toBeNull();
			// …and the buttons are still there, one DOM level out.
			expect(
				indentBtn(container, id).closest('[data-testid^="arrange-row-"]'),
				`indent button for ${id} escaped the row subtree`
			).toBeNull();
			expect(
				unindentBtn(container, id).closest('[data-testid^="arrange-row-"]'),
				`unindent button for ${id} escaped the row subtree`
			).toBeNull();
		}
	});

	it('nothing inside a row contributes to its ACCESSIBLE NAME beyond its own text — no descendant aria-label/title/aria-labelledby, so "Soprano (3)" stays the whole name (WCAG 2.5.3)', async () => {
		const container = await renderInArrangeMode();

		for (const id of ALL_IDS) {
			const r = row(container, id);
			// A `textContent` assertion structurally CANNOT catch this: the
			// buttons carry only an `aria-hidden` SVG, so the text stayed exactly
			// "Soprano (3)" the whole time their `aria-label`s were being appended
			// to the row's computed name by accname step 2F. Name computation
			// recurses into children and takes each child's OWN name first —
			// aria-labelledby, then aria-label, then title. None may be present.
			expect(r.getAttribute('aria-label'), `row ${id} aria-label`).toBeNull();
			expect(
				r.querySelector('[aria-label], [title], [aria-labelledby]'),
				`name-contributing descendant inside row ${id}`
			).toBeNull();
		}
		expect(row(container, 'sec-sop').textContent?.replace(/\s+/g, ' ').trim()).toBe('Soprano (3)');
	});
});

// ── indent behavior ───────────────────────────────────────────────────────────

describe('/roster — INDENT nests under the immediate previous sibling (#155/S3)', () => {
	it('indent Alto → ONE reparentSection(cfg, "sec-alto", "sec-sop") call; Alto re-renders as Soprano\'s LAST child (depth 1, indent class), Soprano\'s roll-up absorbs Bea → "Soprano (4)", and the DESTINATION sibling group is renumbered so the position survives a reload', async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
		// Review F2 — Alto keeps display_order 2 from its old (top-level) group,
		// which would sort it BETWEEN Soprano 1 and Soprano 2 on the next
		// listSections. The renumber over Soprano's children is what makes "last
		// child" true on the server too.
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-sop1', 'sec-sop2', 'sec-alto']);

		// LAST child: Alto lands after Soprano 2, not wedged in as first child.
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor'
		]);
		expect(row(container, 'sec-alto').className).toContain('pl-4');
		// The tree RECALCULATED — the same groupBySection roll-up the headers use.
		expect(row(container, 'sec-sop').textContent?.replace(/\s+/g, ' ').trim()).toBe('Soprano (4)');
		// The button tap must not leak into the row's grab state machine
		// (the row's own role=button click handler sits right underneath).
		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBeNull();
		// It was announced.
		expect(statusText(container)).toContain('roster_section_indented');
	});

	it('guards RECALCULATE after the move: the indented Alto can now unindent, and Tenor (whose previous sibling is now Soprano) can still indent', async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});

		expect(unindentBtn(container, 'sec-alto').disabled).toBe(false);
		expect(indentBtn(container, 'sec-tenor').disabled).toBe(false);
		// Alto is now Soprano's LAST child — its previous sibling is Soprano 2.
		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(2);
		});
		expect(reparentMock).toHaveBeenLastCalledWith(CFG, 'sec-alto', 'sec-sop2');
	});
});

// ── unindent behavior ─────────────────────────────────────────────────────────

describe('/roster — UNINDENT promotes one level (#155/S3)', () => {
	it('unindent Soprano 1 (top-level parent) → ONE reparentSection(cfg, "sec-sop1", "<org id>") call — the ORGANIZATION becomes the parent; it lands AFTER Soprano\'s subtree at depth 0, and Soprano\'s roll-up drops Eva → "Soprano (2)"', async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(unindentBtn(container, 'sec-sop1'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1', ORG);
		// Review F2 — promoted with display_order 1 (its rank among Soprano's
		// children), which would sort it FIRST at top level, not "after its former
		// parent". The destination group here is the VISIBLE top level.
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, [
			'sec-sop',
			'sec-sop1',
			'sec-alto',
			'sec-tenor'
		]);

		await waitFor(() => {
			expect(row(container, 'sec-sop1').getAttribute('data-depth')).toBe('0');
		});
		// AFTER the former parent's subtree — not before Soprano, not still inside it.
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop2',
			'arrange-row-sec-sop1',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor'
		]);
		expect(row(container, 'sec-sop1').className).toContain('pl-0');
		expect(row(container, 'sec-sop').textContent?.replace(/\s+/g, ' ').trim()).toBe('Soprano (2)');
		// Promoted to TOP LEVEL — announced with the top-level wording, and the
		// section now refuses to unindent any further.
		expect(statusText(container)).toContain('roster_section_unindented_top');
		expect(unindentBtn(container, 'sec-sop1').disabled).toBe(true);
	});

	it('unindent a depth-2 section → the GRANDPARENT SECTION becomes the parent: reparentSection(cfg, "sec-sop1a", "sec-sop"), announced with roster_section_unindented (a named parent, not top level)', async () => {
		listSectionsMock.mockImplementation(() => Promise.resolve(fixtureTreeDeep()));
		loadRosterMock.mockImplementation(() => Promise.resolve(fixtureRowsDeep()));
		const container = await renderInArrangeMode();
		expect(row(container, 'sec-sop1a').getAttribute('data-depth')).toBe('2');

		await fireEvent.click(unindentBtn(container, 'sec-sop1a'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1a', 'sec-sop');
		await waitFor(() => {
			expect(row(container, 'sec-sop1a').getAttribute('data-depth')).toBe('1');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop1a',
			'arrange-row-sec-alto'
		]);
		expect(statusText(container)).toContain('roster_section_unindented');
		expect(statusText(container)).not.toContain('roster_section_unindented_top');
	});
});

// ── keyboard: ArrowRight/ArrowLeft while grabbed ─────────────────────────────

describe('/roster — keyboard ArrowRight indents / ArrowLeft unindents while grabbed (#155/S3)', () => {
	it('grab Alto, ArrowRight → the SAME single reparentSection(cfg, "sec-alto", "sec-sop") write the button makes; the commit is announced ("indented", NEVER "cancelled") and the grab ENDS', async () => {
		const container = await renderInArrangeMode();
		const target = row(container, 'sec-alto');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-alto'), { key: 'ArrowRight' });

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		// The reparent changed Alto's sibling GROUP — the grab's restore snapshot
		// describes nothing anymore, so the grab ends with the commit …
		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBeNull();
		// … and the live region reports the indent, not a cancellation.
		expect(statusText(container)).toContain('roster_section_indented');
		expect(statusText(container)).not.toContain('roster_section_move_cancelled');
	});

	it('grab Soprano 1, ArrowLeft → unindents to top level: reparentSection(cfg, "sec-sop1", "<org id>"), announced, grab ended', async () => {
		const container = await renderInArrangeMode();
		const target = row(container, 'sec-sop1');
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-sop1'), { key: 'ArrowLeft' });

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1', ORG);
		await waitFor(() => {
			expect(row(container, 'sec-sop1').getAttribute('data-depth')).toBe('0');
		});
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed')).toBeNull();
		expect(statusText(container)).toContain('roster_section_unindented_top');
	});

	it('ArrowRight with NO previous sibling is refused: nothing written, the grab STAYS (same posture as the Up/Down clamp) — and the guard is the same one disabling the button', async () => {
		const container = await renderInArrangeMode();
		// Soprano is first among its siblings — its indent button says so too.
		expect(indentBtn(container, 'sec-sop').disabled).toBe(true);
		const target = row(container, 'sec-sop');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-sop'), { key: 'ArrowRight' });

		expect(reparentMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBe('true');
		expect(rowOrder(container)[0]).toBe('arrange-row-sec-sop');

		await fireEvent.keyDown(row(container, 'sec-sop'), { key: 'Escape' });
	});

	it('ArrowLeft on a grabbed TOP-LEVEL section is refused: nothing written, grab stays — same guard as the disabled unindent button', async () => {
		const container = await renderInArrangeMode();
		expect(unindentBtn(container, 'sec-alto').disabled).toBe(true);
		const target = row(container, 'sec-alto');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(row(container, 'sec-alto'), { key: 'ArrowLeft' });

		expect(reparentMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBe('true');
		expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');

		await fireEvent.keyDown(row(container, 'sec-alto'), { key: 'Escape' });
	});

	it('idle (ungrabbed) ArrowRight/ArrowLeft write nothing and move nothing — the nesting keys only act on a held row', async () => {
		const container = await renderInArrangeMode();
		// RED anchor: the buttons exist even while nothing is grabbed.
		expect(indentBtn(container, 'sec-alto')).not.toBeNull();
		const before = rowOrder(container);
		const target = row(container, 'sec-alto');
		target.focus();

		await fireEvent.keyDown(target, { key: 'ArrowRight' });
		await fireEvent.keyDown(target, { key: 'ArrowLeft' });

		expect(reparentMock).not.toHaveBeenCalled();
		expect(rowOrder(container)).toEqual(before);
		expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
	});
});

// ── in-flight guard + failure reconcile ──────────────────────────────────────

describe('/roster — reparent writes share the one-outstanding-write guard and the reconcile-on-failure contract (#155/S3)', () => {
	it('while a reparent is in flight EVERY indent/unindent button is disabled; they re-enable (per their own guards) once it lands', async () => {
		let release!: () => void;
		reparentMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		const container = await renderInArrangeMode();

		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(indentBtn(container, 'sec-tenor').disabled).toBe(true);
		});
		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			expect(indentBtn(container, id).disabled, `indent ${id} during flight`).toBe(true);
			expect(unindentBtn(container, id).disabled, `unindent ${id} during flight`).toBe(true);
		}
		// A second structural move while one is outstanding is refused.
		await fireEvent.click(indentBtn(container, 'sec-tenor'));
		expect(reparentMock).toHaveBeenCalledTimes(1);

		release();
		// Tenor's previous sibling is now Soprano (Alto nested under it) — its
		// indent guard passes again once the write lands.
		await waitFor(() => {
			expect(indentBtn(container, 'sec-tenor').disabled).toBe(false);
		});
	});

	it('a failed reparent reconciles against the server (same AC-8 contract as a failed reorder): console.error, listSections refetch, the server tree renders — Alto back at top level', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		const listCallsBefore = listSectionsMock.mock.calls.length;
		reparentMock.mockRejectedValue(new Error('reparent boom'));

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(listSectionsMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor'
		]);
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('a reparent that lands but whose sibling RENUMBER fails reconciles the same way — the partial state is re-derived from the server, not guessed at', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		const listCallsBefore = listSectionsMock.mock.calls.length;
		reorderMock.mockRejectedValue(new Error('renumber boom'));

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(listSectionsMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// ── review fixes (#155/S3) ───────────────────────────────────────────────────

describe('/roster — the indent/unindent buttons are keyboard-operable in their OWN right (#155/S3 review F1)', () => {
	it('Enter/Space on a focused indent button does NOT drive the row\'s grab machine, and does NOT preventDefault (so the browser\'s native button activation survives)', async () => {
		const container = await renderInArrangeMode();
		const btn = indentBtn(container, 'sec-alto');
		btn.focus();

		for (const key of ['Enter', ' ']) {
			const ev = createEvent.keyDown(btn, { key, bubbles: true, cancelable: true });
			await fireEvent(btn, ev);
			// The row's own handler must not have swallowed it: a preventDefault
			// here is what suppressed the button's native activation, so the
			// control a keyboard user pressed grabbed the row instead of indenting.
			expect(ev.defaultPrevented, `defaultPrevented for ${key}`).toBe(false);
		}

		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBeNull();
		expect(row(container, 'sec-alto').getAttribute('aria-grabbed')).toBe('false');
		expect(statusText(container)).not.toContain('roster_section_grabbed');
		// happy-dom does not run a button's default activation behaviour, so the
		// activation itself is asserted through the click the browser would
		// synthesize — one reparent, still no grab.
		await fireEvent.click(btn);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
		expect(row(container, 'sec-alto').getAttribute('aria-grabbed')).toBe('false');
	});

	it('ArrowUp/ArrowDown on a focused indent/unindent button do nothing — focus stays ON THE BUTTON instead of roving to another row', async () => {
		const container = await renderInArrangeMode();
		const btn = unindentBtn(container, 'sec-sop1');
		btn.focus();
		expect(document.activeElement).toBe(btn);

		await fireEvent.keyDown(btn, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(btn);
		await fireEvent.keyDown(btn, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(btn);

		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed')).toBeNull();
	});
});

describe('/roster — an unindent with no resolvable organization fails LOUDLY (#155/S3 review F3)', () => {
	/** Same tree as `fixtureTree`, with NO `orgId` anywhere — the permissive
	 *  "org unknown to this reader" state `visibleSections` deliberately keeps
	 *  rendering (an unauthenticated/limited reader, or a pre-#124-shaped
	 *  response). Every row is org-less too, so `currentOrgId` is null as well. */
	function fixtureTreeNoOrg(): SectionNode[] {
		return [
			{
				id: 'sec-sop',
				name: 'Soprano',
				displayOrder: 1,
				parentId: null,
				orgId: null,
				depth: 0,
				children: [
					{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', orgId: null, depth: 1, children: [] }
				]
			},
			{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, orgId: null, depth: 0, children: [] }
		];
	}

	function fixtureRowsNoOrg(): RosterRow[] {
		return [
			{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'] },
			{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
			{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] }
		];
	}

	it('promote-to-top-level with no known organization id raises the reorder banner and writes NOTHING — never a dead button that silently does nothing', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		listSectionsMock.mockImplementation(() => Promise.resolve(fixtureTreeNoOrg()));
		loadRosterMock.mockImplementation(() => Promise.resolve(fixtureRowsNoOrg()));
		const container = await renderInArrangeMode();
		// The button is live — `canUnindent` only asks whether there IS a parent.
		expect(unindentBtn(container, 'sec-sop1').disabled).toBe(false);

		await fireEvent.click(unindentBtn(container, 'sec-sop1'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-sop1').getAttribute('data-depth')).toBe('1');
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis* — #155/S3 RED)
// (*MVOX:Byrd* — #155/S3 review fixes F1/F2/F3)
