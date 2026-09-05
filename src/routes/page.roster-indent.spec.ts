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
//     ORGANIZATION id (the page already holds `currentDbEntityId`, #124) when the
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
// #253: params are ECHOED (key + JSON) so a test can assert what a message was
// — and was NOT — handed: the partial-failure banner must not receive the
// renumber depth (k of N belongs in the typed error, not on screen).
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params && Object.keys(params).length > 0
						? `${String(key)} ${JSON.stringify(params)}`
						: String(key)
		}
	)
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
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
// `dbEntityId` on the top-level nodes and the rows: the unindent-to-top-level write
// needs the page to know the collective org id (`currentDbEntityId`, #124), and the
// #124/F3 org filter only keeps top-level roots whose dbEntityId matches it.

const ORG = 'org-1';

function fixtureTree(): SectionNode[] {
	return [
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			dbEntityId: ORG,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', dbEntityId: null, depth: 1, children: [] },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', dbEntityId: null, depth: 1, children: [] }
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG, depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, dbEntityId: ORG, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: ORG },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], dbEntityId: ORG },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop2'], dbEntityId: ORG },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], dbEntityId: ORG },
		{ memberId: 'm-tara', personId: 'p-tara', name: 'Tara Oja', email: 'tara@x.com', sectionIds: ['sec-tenor'], dbEntityId: ORG }
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
			dbEntityId: ORG,
			depth: 0,
			children: [
				{
					id: 'sec-sop1',
					name: 'Soprano 1',
					displayOrder: 1,
					parentId: 'sec-sop',
					dbEntityId: null,
					depth: 1,
					children: [
						{ id: 'sec-sop1a', name: 'Soprano 1a', displayOrder: 1, parentId: 'sec-sop1', dbEntityId: null, depth: 2, children: [] }
					]
				}
			]
		},
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG, depth: 0, children: [] }
	];
}

function fixtureRowsDeep(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: ORG },
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'], dbEntityId: ORG },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop1a'], dbEntityId: ORG },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'], dbEntityId: ORG }
	];
}

const CFG = { db: 'polyphony', token: 'jwt-abc' };

// ── #253 pin 1 — the refetch mock tells the TRUTH ───────────────────────────
//
// The original listSectionsMock returned one static fixtureTree() no matter
// what had been written first, so the failure-reconcile tests could only prove
// the refetch FIRES — a reconcile that rendered a lie would have passed
// identically (and did: the 'reparent lands, renumber fails' test asserted the
// section back at depth 0, enshrining a REVERT the real server never performs).
// PO ruling on #253: conditioning this mock on prior writes is a first-class
// deliverable — it is what makes every remaining assertion about the reconciled
// DOM an assertion about server truth instead of about a fixture.
//
// `landedReparents` records every reparentSection call the mock RESOLVED; the
// listSections mock re-derives the tree from those landed moves. A rejected
// reparent records nothing → the original tree comes back, exactly like the
// real server.

let landedReparents: Array<{ id: string; newParentId: string }>;

/** displayOrder-then-name — sectionData pass 5's level order, which is what the
 *  real listSections would hand back for a landed `_parent` move whose
 *  renumber never ran (the moved node keeps its OLD number). */
function sortLevel(nodes: SectionNode[]): SectionNode[] {
	return [...nodes].sort(
		(a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)
	);
}

function withDepth(node: SectionNode, depth: number): SectionNode {
	return { ...node, depth, children: node.children.map((c) => withDepth(c, depth + 1)) };
}

/** fixtureTree() with every LANDED `_parent` move applied — and nothing else:
 *  displayOrder stays whatever the section held before (the renumber is a
 *  separate write; when it failed, the server never saw a new number). */
function treeWithLandedMoves(moves: Array<{ id: string; newParentId: string }>): SectionNode[] {
	let roots = fixtureTree();
	for (const mv of moves) {
		let moved: SectionNode | null = null;
		const detach = (nodes: SectionNode[]): SectionNode[] =>
			nodes
				.filter((n) => {
					if (n.id === mv.id) {
						moved = n;
						return false;
					}
					return true;
				})
				.map((n) => ({ ...n, children: detach(n.children) }));
		roots = detach(roots);
		if (!moved) continue;
		const found: SectionNode = moved;
		if (mv.newParentId === ORG) {
			roots = sortLevel([
				...roots,
				withDepth({ ...found, parentId: null, dbEntityId: ORG }, 0)
			]);
		} else {
			const attach = (nodes: SectionNode[], depth: number): SectionNode[] =>
				nodes.map((n) =>
					n.id === mv.newParentId
						? {
								...n,
								children: sortLevel([
									...n.children,
									withDepth({ ...found, parentId: n.id, dbEntityId: null }, depth + 1)
								])
							}
						: { ...n, children: attach(n.children, depth + 1) }
				);
			roots = attach(roots, 0);
		}
	}
	return roots;
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
	landedReparents = [];
	// Fresh objects per call — a reconcile REFETCH after a failed write must get
	// a tree the optimistic patch can't have mutated. #253: the tree ANSWERS
	// FROM THE LANDED WRITES (see treeWithLandedMoves above) — a reparent the
	// mock resolved is visible in the next listSections, one it rejected is not,
	// exactly like the real server.
	loadRosterMock.mockImplementation(() => Promise.resolve(fixtureRows()));
	listSectionsMock.mockImplementation(() => Promise.resolve(treeWithLandedMoves(landedReparents)));
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockImplementation((_cfg: unknown, id: string, newParentId: string) => {
		landedReparents.push({ id, newParentId });
		return Promise.resolve(undefined);
	});
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
	// #253 — each render starts from the pristine server: a couple of tests
	// render TWICE (button path, then keyboard path, same fixture both times),
	// so moves landed under the previous render must not leak into this one.
	landedReparents.length = 0;
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

	it('nothing inside a row contributes to its ACCESSIBLE NAME beyond the row\'s own label — no descendant aria-label/title/aria-labelledby, so "Soprano (3)" stays the whole name (WCAG 2.5.3)', async () => {
		const container = await renderInArrangeMode();

		for (const id of ALL_IDS) {
			const r = row(container, id);
			// A `textContent` assertion structurally CANNOT catch this: the
			// buttons carry only an `aria-hidden` SVG, so the text stayed exactly
			// "Soprano (3)" the whole time their `aria-label`s were being appended
			// to the row's computed name by accname step 2F. The containment fix
			// is what keeps them out; nothing left INSIDE the row may contribute a
			// name of its own (aria-labelledby, then aria-label, then title).
			expect(
				r.querySelector('[aria-label], [title], [aria-labelledby]'),
				`name-contributing descendant inside row ${id}`
			).toBeNull();
		}
		// #205 — the NAME's home is the rename activator beside the row, and review
		// F1 (round 2) moved the "(n)" roll-up out to its own span after it, so the
		// row states the "<name> (<count>)" pair in its own `aria-label` and renders
		// nothing visible itself. The pair is what must never be broken up.
		expect(row(container, 'sec-sop').getAttribute('aria-label')).toBe('Soprano (3)');
		expect(row(container, 'sec-sop').textContent?.replace(/\s+/g, ' ').trim()).toBe('');
		expect((q(container, 'arrange-count-sec-sop')?.textContent ?? '').trim()).toBe('(3)');
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
		expect(row(container, 'sec-sop').getAttribute('aria-label')).toBe('Soprano (4)');
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
		expect(row(container, 'sec-sop').getAttribute('aria-label')).toBe('Soprano (2)');
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

	it('a reparent that LANDS but whose sibling RENUMBER fails reconciles to the TRUTH — the section renders AT ITS NEW PARENT AND DEPTH (the move happened), and the banner SAYS the move happened (#253)', async () => {
		// The pre-#253 version of this test asserted sec-alto back at depth 0 —
		// but only because the static listSections mock ANSWERED with the
		// original tree. The real server holds the landed `_parent` move, so the
		// reconcile renders Alto UNDER Soprano (keeping its old displayOrder 2,
		// which sorts it between Soprano 1 and Soprano 2 — pass-5 name
		// tie-break). Asserting a revert enshrined the lie #253 is about.
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		const listCallsBefore = listSectionsMock.mock.calls.length;
		reorderMock.mockRejectedValue({
			code: 'section-reparent-partial',
			step: 'renumber',
			renumberedCount: 1,
			totalCount: 3,
			status: 429,
			body: 'rate limit exceeded'
		});

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(listSectionsMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
		// THE TRUTH, not a revert: the `_parent` move landed, so the reconciled
		// DOM shows Alto nested under Soprano.
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-alto',
			'arrange-row-sec-sop2',
			'arrange-row-sec-tenor'
		]);
		// And the banner tells the same truth — the LANDED-move copy (#253 pin 4b),
		// not the "order couldn't be saved" copy that implies nothing changed.
		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		expect(banner).toContain('roster_section_reparent_partial');
		expect(banner).not.toContain('roster_section_reorder_failed');
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// ── #253 — the two truthful banner states + the pinned refusals ─────────────
//
// PO ruling (issue #253, Gama 2026-09-05): TWO user-facing states, not three.
//   (a) NOTHING landed (the reparent itself failed)      → today's copy stays.
//   (b) the move LANDED, the ordering did not            → NEW copy that says
//       the section DID move (that is what decides what the user does next).
// The renumber depth (k of N) is DIAGNOSIS — it lives in the typed error and
// reaches console.error, never the banner. And two refusals, pinned as tests:
// NO retry (the GET→POST→DELETE sequence is not idempotent) and NO automatic
// unwind (a reverse write against a system that just failed a write).

describe('/roster — a failed reparent reports WHAT ACTUALLY LANDED, with the evidence captured (#253)', () => {
	const partialEvidence = {
		code: 'section-reparent-partial',
		step: 'renumber',
		renumberedCount: 1,
		totalCount: 3,
		status: 429,
		body: 'rate limit exceeded'
	};

	it('state (a) — the reparent ITSELF fails, nothing landed: today\'s roster_section_reorder_failed copy stays, the tree reverts (the server never saw the move), and the evidence reaches console.error', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reparentMock.mockRejectedValue({
			code: 'section-reparent-partial',
			step: 'reparent',
			renumberedCount: 0,
			totalCount: 0,
			status: 403,
			body: 'forbidden by rights'
		});

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		expect(banner).toContain('roster_section_reorder_failed');
		expect(banner).not.toContain('roster_section_reparent_partial');
		// Nothing landed → the conditioned refetch answers the ORIGINAL tree.
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
		});
		expect(reorderMock).not.toHaveBeenCalled();
		// The captured status AND body are readable post-hoc — the evidence
		// object itself reaches console.error, not only a swallowed message.
		expect(
			consoleSpy.mock.calls.some((args) =>
				args.some(
					(a) =>
						(a as { status?: unknown })?.status === 403 &&
						(a as { body?: unknown })?.body === 'forbidden by rights'
				)
			)
		).toBe(true);
		consoleSpy.mockRestore();
	});

	it('state (b) — the move LANDED, the renumber did not: the NEW copy renders WITHOUT the renumber depth (k of N stays in the typed error), and the evidence reaches console.error', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reorderMock.mockRejectedValue(partialEvidence);

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		await waitFor(() => {
			expect((q(container, 'section-reorder-error')?.textContent ?? '')).toContain(
				'roster_section_reparent_partial'
			);
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		// The message mock echoes every param it is handed (key + JSON), so a
		// banner that received the renumber progress would show it here. It
		// must not: k/N is diagnosis, not user guidance (PO ruling).
		expect(banner).not.toContain('renumbered');
		expect(banner).not.toContain('total');
		expect(banner).not.toMatch(/1\s*(of|\/)\s*3/);
		// The full evidence — status AND body — is post-hoc readable.
		expect(
			consoleSpy.mock.calls.some((args) =>
				args.some(
					(a) =>
						(a as { status?: unknown })?.status === 429 &&
						(a as { body?: unknown })?.body === 'rate limit exceeded'
				)
			)
		).toBe(true);
		consoleSpy.mockRestore();
	});

	// #253 review F1 — the banner follows the PHASE, not the rejection's shape.
	// `reorderSections` reaches this catch UNTYPED whenever the failure happens
	// below the status check: `entuFetch` propagates a fetch rejection verbatim
	// (offline / DNS / connection reset — one of the issue's own leading
	// candidate causes), `await res.json()` throws a SyntaxError on a malformed
	// body, and a 401 rejects with AuthExpiredError. In every one of those the
	// `_parent` move HAS landed, so the truthful-move copy must still win.
	for (const [label, rejection] of [
		['a network rejection propagated verbatim by entuFetch', new TypeError('Failed to fetch')],
		['a SyntaxError from a malformed response body', new SyntaxError('Unexpected token < in JSON')],
		['a plain untagged Error', new Error('renumber boom')]
	] as const) {
		it(`state (b) with an UNTYPED rejection — ${label}: the move still landed, so the banner still says so and the section still renders at its new parent`, async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const container = await renderInArrangeMode();
			reorderMock.mockRejectedValue(rejection);

			await fireEvent.click(indentBtn(container, 'sec-alto'));

			await waitFor(() => {
				expect(q(container, 'section-reorder-error')).not.toBeNull();
			});
			await waitFor(() => {
				expect(q(container, 'section-reorder-error')?.textContent ?? '').toContain(
					'roster_section_reparent_partial'
				);
			});
			// The mismatch #253 criterion 2 forbids: never "the order couldn't be
			// saved" over a screen that shows the move.
			expect(q(container, 'section-reorder-error')?.textContent ?? '').not.toContain(
				'roster_section_reorder_failed'
			);
			// …and the screen DOES show the move — the refetch answers from the
			// landed reparent, so Alto sits under Soprano at depth 1.
			await waitFor(() => {
				expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
			});
			// The reparent went out exactly once; no unwind write followed.
			expect(reparentMock.mock.calls).toEqual([[CFG, 'sec-alto', 'sec-sop']]);
			expect(consoleSpy.mock.calls.some((args) => args.some((a) => a === rejection))).toBe(true);
			consoleSpy.mockRestore();
		});
	}

	it('the reparent phase failing UNTYPED keeps the nothing-landed copy — an untyped rejection is not evidence of a landed move', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reparentMock.mockRejectedValue(new TypeError('Failed to fetch'));

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		const banner = q(container, 'section-reorder-error')?.textContent ?? '';
		expect(banner).toContain('roster_section_reorder_failed');
		expect(banner).not.toContain('roster_section_reparent_partial');
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('0');
		});
		expect(reorderMock).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('REFUSALS (PO #253): no retry and no automatic unwind — EXACTLY one forward reparent write, exactly one renumber attempt, and never a reverse `_parent` write after the failure', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reorderMock.mockRejectedValue(partialEvidence);

		await fireEvent.click(indentBtn(container, 'sec-alto'));

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		// Let the failure path fully settle before counting writes.
		await waitFor(() => {
			expect(row(container, 'sec-alto').getAttribute('data-depth')).toBe('1');
		});
		// ONE forward reparent — no retry of a non-idempotent POST/DELETE
		// choreography, and no compensating write back to the org: the landed
		// move STAYS and the banner tells the truth about it.
		expect(reparentMock.mock.calls).toEqual([[CFG, 'sec-alto', 'sec-sop']]);
		// ONE renumber attempt — not re-issued either.
		expect(reorderMock.mock.calls).toEqual([[CFG, ['sec-sop1', 'sec-sop2', 'sec-alto']]]);
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
	/** Same tree as `fixtureTree`, with NO `dbEntityId` anywhere — the permissive
	 *  "org unknown to this reader" state `visibleSections` deliberately keeps
	 *  rendering (an unauthenticated/limited reader, or a pre-#124-shaped
	 *  response). Every row is org-less too, so `currentDbEntityId` is null as well. */
	function fixtureTreeNoOrg(): SectionNode[] {
		return [
			{
				id: 'sec-sop',
				name: 'Soprano',
				displayOrder: 1,
				parentId: null,
				dbEntityId: null,
				depth: 0,
				children: [
					{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', dbEntityId: null, depth: 1, children: [] }
				]
			},
			{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: null, depth: 0, children: [] }
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

// ── #156: the nesting buttons are POINTER-ONLY, and the row is their keyboard ──

// Mihkel's ruling, recorded in `.claude/workflows/roving-tabindex-pipeline.js`
// ("EXCLUDED: buttons with tabindex=-1 that are mouse/touch only (like
// indent/unindent per Mihkel ruling)") and re-affirmed by #156 review checklist
// item 10. Nothing in the source pinned it before — this block does, so an edit
// that quietly restores or removes the two tab stops fails here rather than in
// a later a11y sweep.
//
// The exclusion is only defensible because the row-grab machine above offers
// the SAME two writes from the keyboard. That equivalence is asserted directly
// (same seam, same arguments), not assumed.
describe('/roster — indent/unindent are pointer-only (tabindex="-1"), with the row grab as their keyboard equivalent (#156, checklist item 10)', () => {
	const ALL_IDS = ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor'];

	it('every indent AND unindent button carries tabindex="-1" — no Tab stops for the nesting pair', async () => {
		const container = await renderInArrangeMode();
		for (const id of ALL_IDS) {
			expect(indentBtn(container, id).getAttribute('tabindex'), `indent ${id}`).toBe('-1');
			expect(unindentBtn(container, id).getAttribute('tabindex'), `unindent ${id}`).toBe('-1');
		}
	});

	it('they stay pointer-operable — a click still runs the write (the exclusion removes the TAB STOP, not the control)', async () => {
		const container = await renderInArrangeMode();
		await fireEvent.click(indentBtn(container, 'sec-alto'));
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-alto', 'sec-sop');
	});

	it('the row-grab keyboard path produces the IDENTICAL write to the indent button — this is what makes dropping the tab stop safe (WCAG 2.1.1)', async () => {
		// Button path.
		const byButton = await renderInArrangeMode();
		await fireEvent.click(indentBtn(byButton, 'sec-alto'));
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));
		const buttonCall = reparentMock.mock.calls[0];

		cleanup();
		reparentMock.mockClear();

		// Keyboard path: focus the row, Space to grab, ArrowRight to indent.
		const byKeyboard = await renderInArrangeMode();
		const target = row(byKeyboard, 'sec-alto');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
		await fireEvent.keyDown(row(byKeyboard, 'sec-alto'), { key: 'ArrowRight' });
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));

		expect(reparentMock.mock.calls[0]).toEqual(buttonCall);
	});

	it('the row-grab keyboard path produces the IDENTICAL write to the unindent button too', async () => {
		const byButton = await renderInArrangeMode();
		await fireEvent.click(unindentBtn(byButton, 'sec-sop1'));
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));
		const buttonCall = reparentMock.mock.calls[0];

		cleanup();
		reparentMock.mockClear();

		const byKeyboard = await renderInArrangeMode();
		const target = row(byKeyboard, 'sec-sop1');
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
		await fireEvent.keyDown(row(byKeyboard, 'sec-sop1'), { key: 'ArrowLeft' });
		await waitFor(() => expect(reparentMock).toHaveBeenCalledTimes(1));

		expect(reparentMock.mock.calls[0]).toEqual(buttonCall);
	});

	it('the ASYMMETRY is deliberate: rename and delete in the SAME wrapper keep their normal tab stops (no row-level equivalent exists for them)', async () => {
		const container = await renderInArrangeMode();
		for (const id of ALL_IDS) {
			const rename = q(container, `arrange-rename-${id}`);
			const remove = q(container, `section-remove-${id}`);
			expect(rename, `rename button for ${id}`).not.toBeNull();
			expect(remove, `remove button for ${id}`).not.toBeNull();
			expect(rename!.getAttribute('tabindex'), `rename ${id} must stay a Tab stop`).toBeNull();
			expect(remove!.getAttribute('tabindex'), `remove ${id} must stay a Tab stop`).toBeNull();
		}
	});
});

// ── #252 — findable and tappable: touch target, applicability, distinctness ──
//
// From live pilot testing (Joosep, roster screenshot 2026-09-05, GH#252): the
// indent/unindent pair rendered as 12×12px mirror-image triangles (`h-3 w-3`)
// in ~20px of tap target (`p-1`), in the muted `text-ink-2` tone, with an
// inapplicable direction presenting as a tappable-looking control at
// `disabled:opacity-30`. The app's own icon-button standard — RE-CONFIRMED BY
// GREP before these pins were written, because the issue's claim had been
// flagged unverifiable — is `min-h-11 min-w-11` (44px): the season trashcans
// (+page.svelte :5893/:6201/:6767/:6899/:7264/:7628), the wizard skip control
// (:6585), the close button (:5936) and the library controls
// (library/+page.svelte:834+) all carry it; on THIS page the drag grip keeps
// the height half (`min-h-11 w-4`, :3258) and the rename activator keeps
// `min-h-11 flex-1` (:3295). The nesting pair is the outlier.
//
// These pins assert the #252 CONTRACT structurally and deliberately leave the
// MECHANISM to GREEN (which must state its choices, per the issue):
//   - the hit-area tokens are pinned; the glyph inside may stay small;
//   - the inapplicable-direction treatment (invisible-but-space-holding vs
//     disabled-restyled) is GREEN's call — pinned only as "no opacity-30
//     ghost, not interactive, slot still holds the row's box";
//   - the distinguishability treatment is GREEN's call — pinned only as "the
//     two controls differ by more than a reflection/rotation of one glyph";
//   - the replacement tone is GREEN's call — pinned only as "not the muted
//     `text-ink-2`" (#238 finding: a control the user must locate must not be
//     the quietest thing on the row).
// The keyboard path is OUT OF SCOPE by issue fiat (#252 item 5): the
// tabindex="-1" pins above (Mihkel's ruling) and the row-grab Arrow parity
// block stay byte-identical. The testids `arrange-indent-{id}` /
// `arrange-unindent-{id}` stay on whatever element occupies each direction's
// slot — that is what makes the space-reservation contract assertable.

const TOUCH_TOKENS = ['min-h-11', 'min-w-11'];

/** Class-token helpers — Tailwind classes are whitespace-separated tokens;
 *  substring matching would confuse `text-ink` with `text-ink-2`. */
function classTokens(el: Element): string[] {
	return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}
function hasBareToken(el: Element, token: string): boolean {
	return classTokens(el).includes(token);
}
/** TOKEN bare OR behind any variant prefix — `disabled:opacity-30` is still
 *  the opacity-30 ghost. */
function hasTokenAnyVariant(el: Element, token: string): boolean {
	return classTokens(el).some((c) => c === token || c.endsWith(`:${token}`));
}

/** fixtureTree() applicability matrix — the same one the guard test above pins
 *  via `.disabled`: Soprano ▸ [Soprano 1, Soprano 2]; Alto; Tenor. */
const APPLICABLE_252: Array<{ dir: 'indent' | 'unindent'; id: string }> = [
	{ dir: 'indent', id: 'sec-sop2' },
	{ dir: 'indent', id: 'sec-alto' },
	{ dir: 'indent', id: 'sec-tenor' },
	{ dir: 'unindent', id: 'sec-sop1' },
	{ dir: 'unindent', id: 'sec-sop2' }
];
const INAPPLICABLE_252: Array<{ dir: 'indent' | 'unindent'; id: string }> = [
	{ dir: 'indent', id: 'sec-sop' },
	{ dir: 'indent', id: 'sec-sop1' },
	{ dir: 'unindent', id: 'sec-sop' },
	{ dir: 'unindent', id: 'sec-alto' },
	{ dir: 'unindent', id: 'sec-tenor' }
];
const ALL_IDS_252 = ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor'];

function slot252(
	container: HTMLElement,
	dir: 'indent' | 'unindent',
	id: string
): HTMLElement | null {
	return q(container, `arrange-${dir}-${id}`);
}

/** "Yields its interactivity" WITHOUT pinning how: any reasonable mechanism
 *  satisfies this — hidden from the a11y tree, invisible (space-preserving),
 *  pointer-inert, or disabled. What the slot may NOT be is a live control for
 *  an action that cannot be taken. (`hidden`/display:none is deliberately NOT
 *  accepted — it collapses the box and forfeits the reserved space.) */
function isNonInteractive252(el: HTMLElement): boolean {
	return (
		el.getAttribute('aria-hidden') === 'true' ||
		hasBareToken(el, 'invisible') ||
		hasBareToken(el, 'pointer-events-none') ||
		(el instanceof HTMLButtonElement && el.disabled)
	);
}

describe("/roster — the nesting controls meet the app's own touch-target standard (#252)", () => {
	it('every APPLICABLE direction carries `min-h-11 min-w-11` — the 44px standard the trashcan/gear/create buttons already keep (the glyph inside may stay small)', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of APPLICABLE_252) {
			const el = slot252(container, dir, id);
			expect(el, `${dir} control for ${id}`).not.toBeNull();
			for (const token of TOUCH_TOKENS) {
				expect(
					hasBareToken(el!, token),
					`${dir} ${id} must carry ${token} — a 12px glyph in ~20px of padding is less than half the app's own touch minimum (GH#252 item 1)`
				).toBe(true);
			}
		}
	});

	it("EVERY slot holds the same hit-area box — inapplicable directions included, so a row never jumps when applicability changes (space reserved, GH#252 item 2)", async () => {
		const container = await renderInArrangeMode();
		for (const id of ALL_IDS_252) {
			for (const dir of ['indent', 'unindent'] as const) {
				const el = slot252(container, dir, id);
				expect(
					el,
					`${dir} slot for ${id} must exist — reserving the space is what keeps rows from shifting`
				).not.toBeNull();
				for (const token of TOUCH_TOKENS) {
					expect(
						hasBareToken(el!, token),
						`${dir} ${id}: the slot must hold the ${token} box whether or not the action applies`
					).toBe(true);
				}
			}
		}
	});
});

describe('/roster — only applicable actions present as tappable; an inapplicable one yields interactivity but holds its space (#252)', () => {
	it('no inapplicable direction renders the old opacity-30 ghost — the token is gone bare AND behind variants (`disabled:opacity-30` is still the ghost)', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of INAPPLICABLE_252) {
			const el = slot252(container, dir, id);
			if (el === null) continue; // slot existence is pinned above; this pin is about presentation
			expect(
				hasTokenAnyVariant(el, 'opacity-30'),
				`${dir} ${id}: an action that cannot be taken must not present as a tappable control at 30% opacity (GH#252 item 2, Mihkel's direction — "show only active actions")`
			).toBe(false);
		}
	});

	it('an inapplicable direction is not an interactive control, and clicking its slot writes NOTHING', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of INAPPLICABLE_252) {
			const el = slot252(container, dir, id);
			if (el === null) continue;
			expect(
				isNonInteractive252(el),
				`${dir} ${id}: hidden-from-AT, invisible, pointer-inert or disabled — GREEN's pick which, but never a live control`
			).toBe(true);
			await fireEvent.click(el);
		}
		expect(reparentMock).not.toHaveBeenCalled();
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it("space held ACROSS a state change: after unindenting Soprano 1 to top level, its now-inapplicable unindent slot still holds the row's box and is not a ghost", async () => {
		const container = await renderInArrangeMode();

		await fireEvent.click(slot252(container, 'unindent', 'sec-sop1') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		expect(reparentMock).toHaveBeenCalledWith(CFG, 'sec-sop1', ORG);

		// Soprano 1 is now top-level → unindent no longer applies. The slot must
		// survive the flip (space reserved), yield its interactivity, and not
		// fall back to the opacity-30 ghost.
		await waitFor(() => {
			const el = slot252(container, 'unindent', 'sec-sop1');
			expect(el, 'the unindent slot survives the applicability flip').not.toBeNull();
			expect(isNonInteractive252(el!)).toBe(true);
		});
		const el = slot252(container, 'unindent', 'sec-sop1') as HTMLElement;
		for (const token of TOUCH_TOKENS) {
			expect(
				hasBareToken(el, token),
				`the slot must still hold the ${token} box after the move — rows must not jump`
			).toBe(true);
		}
		expect(hasTokenAnyVariant(el, 'opacity-30')).toBe(false);
	});
});

describe('/roster — the two directions are distinguishable at a glance (#252)', () => {
	/** Every coordinate pair in a path's `d`. Sufficient for the M/L/Z triangle
	 *  glyphs under test; a richer glyph that defeats this parser is by
	 *  construction "more than a mirrored triangle" and passes on other axes. */
	function pathPoints(d: string): Array<[number, number]> {
		const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
		const pts: Array<[number, number]> = [];
		for (let i = 0; i + 1 < nums.length; i += 2) {
			pts.push([nums[i]!, nums[i + 1]!]);
		}
		return pts;
	}
	function normalizePts(pts: Array<[number, number]>): string {
		return [...pts]
			.map(([x, y]) => `${x},${y}`)
			.sort()
			.join(' ');
	}
	function viewBoxSize(svg: Element | null): [number, number] {
		const vb = (svg?.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
		return vb.length === 4 ? [vb[2]!, vb[3]!] : [16, 16];
	}

	it('indent and unindent (both live on Soprano 2) differ by MORE than a reflection/rotation of one identical glyph — mirror triangles at 12px are the pinned defect (GH#252 item 3; GREEN states its treatment and why)', async () => {
		const container = await renderInArrangeMode();
		const a = slot252(container, 'indent', 'sec-sop2') as HTMLElement;
		const b = slot252(container, 'unindent', 'sec-sop2') as HTMLElement;
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();

		// ANY of these axes distinguishes the pair without pinning WHICH one
		// GREEN picks: differing visible text, differing class treatment on the
		// control or its glyph, or genuinely different glyph geometry.
		const textDistinguishes = (a.textContent ?? '').trim() !== (b.textContent ?? '').trim();
		const classDistinguishes =
			(a.getAttribute('class') ?? '') !== (b.getAttribute('class') ?? '') ||
			(a.querySelector('svg')?.getAttribute('class') ?? '') !==
				(b.querySelector('svg')?.getAttribute('class') ?? '');

		const aPaths = [...a.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
		const bPaths = [...b.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
		let glyphDistinguishes: boolean;
		if (aPaths.length === 1 && bPaths.length === 1) {
			const [w, h] = viewBoxSize(a.querySelector('svg'));
			const pa = pathPoints(aPaths[0]!);
			const pb = normalizePts(pathPoints(bPaths[0]!));
			const transforms: Array<Array<[number, number]>> = [
				pa, // the identical glyph on both sides is no better
				pa.map(([x, y]) => [w - x, y] as [number, number]), // horizontal mirror — today's defect
				pa.map(([x, y]) => [x, h - y] as [number, number]), // vertical mirror
				pa.map(([x, y]) => [w - x, h - y] as [number, number]) // 180° rotation
			];
			glyphDistinguishes = !transforms.some((t) => normalizePts(t) === pb);
		} else {
			// Different path counts, or multi-path glyphs that are not
			// byte-identical, count as distinct geometry.
			glyphDistinguishes =
				aPaths.length !== bPaths.length || aPaths.join('|') !== bPaths.join('|');
		}

		expect(
			textDistinguishes || classDistinguishes || glyphDistinguishes,
			'side by side at phone size, ▶ and ◀ read as the same shape — the two directions must differ by more than a mirror transform (GH#252 item 3)'
		).toBe(true);
	});
});

describe("/roster — the controls carry the app's normal control tone, not the muted row-metadata ink (#252)", () => {
	it('no APPLICABLE direction uses bare `text-ink-2` as its base tone — the replacement tone is GREEN\'s to pick and state (GH#252 item 4, #238 finding)', async () => {
		const container = await renderInArrangeMode();
		for (const { dir, id } of APPLICABLE_252) {
			const el = slot252(container, dir, id) as HTMLElement;
			expect(el, `${dir} control for ${id}`).not.toBeNull();
			expect(
				hasBareToken(el, 'text-ink-2'),
				`${dir} ${id}: a control the user must LOCATE must not be the quietest thing on the row (GH#252 item 4)`
			).toBe(false);
		}
	});
});

// (*MVOX:Tallis* — #155/S3 RED)
// (*MVOX:Byrd* — #155/S3 review fixes F1/F2/F3)
// (*MVOX:Tallis* — #253 RED: conditioned listSections mock + two-state banner + refusal pins)
// (*MVOX:Tallis* — #252 RED: touch-target, reserved-space, distinguishability + tone pins)
