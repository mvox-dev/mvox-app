// @vitest-environment happy-dom
//
// TU.2/#110 RED — sections UX polish on the ACTUAL /roster page route
// (integration): four corrections from Mihkel's gate walk.
//
//   finding #6  — reorder SPINNER: a visible loading indicator while the
//                 display_order write is in flight;
//   finding #7  — EMPTY-section REMOVE control (admin-only, rights-gated);
//   finding #9  — COLLAPSE-ALL / EXPAND-ALL toggle + sections DEFAULT COLLAPSED
//                 on initial load;
//   finding #11 — drag DROP-TARGET hint: a dashed-line indicator at the
//                 potential landing position during drag-reorder.
//
// Same integration discipline as page.roster-reorder.spec.ts: the REAL page
// component renders, `groupBySection` runs real, only the fetch seams and the
// sectionActions write seam are mocked — GREEN cannot pass by building any of
// these in isolation without wiring them into the route.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS
//     section-reorder-pending      loading indicator; rendered ONLY while a
//                                  reorderSections write is outstanding;
//                                  carries aria-busy="true"
//     section-remove-<sectionId>   remove control on a section header; renders
//                                  ONLY for admin AND ONLY when the section has
//                                  ZERO members and ZERO sub-sections; INSIDE
//                                  its own section-group element; activation
//                                  calls deleteSection(cfg, id) and removes the
//                                  group locally (no refetch)
//     sections-toggle-all          ONE toggle at the top of the sections list,
//                                  ABOVE the groups: all-collapsed → expands
//                                  every section (incl. sub-sections),
//                                  otherwise collapses every section
//     section-drop-indicator       dashed-line drop hint; rendered INSIDE the
//                                  hovered sibling target's section-group while
//                                  a drag is live over it; class contains
//                                  "dashed"; gone once the drag ends
//
//   DEFAULT STATE (finding #9): sections start COLLAPSED on page load — every
//   section toggle renders aria-expanded="false" and no member rows show until
//   the user expands. NOTE FOR GREEN: this SUPERSEDES the expanded-by-default
//   pin in page.roster-sections.spec.ts ("all sections are EXPANDED by
//   default", ~line 191) per PO decision in #110 — that test (and the
//   `collapse()` helpers in page.roster-reorder.spec.ts /
//   page.sections-a11y.spec.ts that click assuming an expanded start) must be
//   updated to the new default, not worked around. The helpers HERE are
//   state-agnostic (`ensureCollapsed`/`ensureExpanded` read aria-expanded
//   before clicking) so this file is valid both at RED and at GREEN.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
	deleteMock
} = vi.hoisted(() => ({
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
// The WRITE seam — the remove control must land in deleteSection with the
// page's cfg; reorder paths land in reorderSections as before.
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock
}));
// Severs the entu-config → $env/dynamic/public import under happy-dom (same
// pattern as page.roster-reorder.spec.ts).
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
// Soprano (1) ▸ [Soprano 1 (1), Soprano 2 (2)]; Alto (2); Tenor (3); Bass (4).
// Bass is the EMPTY section (zero members, zero children) — finding #7's target.
// Every member assigned → no Unassigned group unless a test adds one.

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
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Every rendered section toggle (real sections AND unassigned when present). */
function allToggles(container: HTMLElement): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>('[data-testid^="section-toggle-"]')];
}

/** State-agnostic: collapse `id` whatever the current default is. Valid both at
 *  RED (expanded-by-default) and at GREEN (collapsed-by-default, finding #9). */
async function ensureCollapsed(container: HTMLElement, id: string): Promise<void> {
	const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
	expect(toggle, `toggle for ${id}`).not.toBeNull();
	if (toggle.getAttribute('aria-expanded') === 'true') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});
}

async function ensureExpanded(container: HTMLElement, id: string): Promise<void> {
	const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
	expect(toggle, `toggle for ${id}`).not.toBeNull();
	if (toggle.getAttribute('aria-expanded') === 'false') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});
}

/** #110 review F4 — removing a section is a TWO-STEP inline confirm: the ✕ only
 *  ARMS it, `section-remove-confirm-<id>` is the activation that writes. Every
 *  test that wants the write goes through here. */
async function removeSection(container: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(q(container, `section-remove-${id}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `section-remove-confirm-${id}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `section-remove-confirm-${id}`) as HTMLElement);
}

async function collapseAllTopLevel(container: HTMLElement): Promise<void> {
	for (const id of ['sec-sop', 'sec-alto', 'sec-tenor', 'sec-bass']) {
		await ensureCollapsed(container, id);
	}
}

/** Minimal DataTransfer stand-in — happy-dom has no native one. */
function makeDataTransfer() {
	const data: Record<string, string> = {};
	return {
		setData: (k: string, v: string) => {
			data[k] = v;
		},
		getData: (k: string) => data[k] ?? '',
		effectAllowed: '',
		dropEffect: ''
	};
}

// #150 — the up/down arrow buttons this section's tests used to click are
// gone; drag is now the only reorder input.
async function dragAndDrop(container: HTMLElement, fromId: string, toId: string): Promise<void> {
	const dataTransfer = makeDataTransfer();
	const handle = q(container, `section-drag-handle-${fromId}`) as HTMLElement;
	expect(handle, `drag handle for ${fromId}`).not.toBeNull();
	const target = q(container, `section-header-${toId}`) as HTMLElement;
	expect(target, `drop target header for ${toId}`).not.toBeNull();
	await fireEvent.dragStart(handle, { dataTransfer });
	await fireEvent.dragOver(target, { dataTransfer });
	await fireEvent.drop(target, { dataTransfer });
}

/** A reorder write that stays pending until the test resolves/rejects it. */
function deferredReorder(): { resolve: () => void; reject: (e: Error) => void } {
	let release!: () => void;
	let fail!: (e: Error) => void;
	reorderMock.mockImplementation(
		() =>
			new Promise<void>((res, rej) => {
				release = () => res();
				fail = (e: Error) => rej(e);
			})
	);
	return { resolve: () => release(), reject: (e: Error) => fail(e) };
}

// ── finding #6: reorder loading indicator ───────────────────────────────────────

describe('/roster — a reorder write in flight shows a loading indicator (finding #6, AC-8)', () => {
	it('no indicator at rest; while the display_order write is outstanding, section-reorder-pending is VISIBLE and carries aria-busy="true"', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		expect(q(container, 'section-reorder-pending')).toBeNull();

		const pending = deferredReorder();
		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).not.toBeNull();
		});
		expect(q(container, 'section-reorder-pending')?.getAttribute('aria-busy')).toBe('true');

		pending.resolve();
	});

	it('the indicator DISAPPEARS once the write settles successfully', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		const pending = deferredReorder();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).not.toBeNull();
		});

		pending.resolve();
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).toBeNull();
		});
	});

	it('the indicator clears on write FAILURE too — a dead spinner over the error alert would say "still working" about a write that already failed', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		const pending = deferredReorder();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).not.toBeNull();
		});

		pending.reject(new Error('reorder boom'));
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).toBeNull();
		});
		consoleSpy.mockRestore();
	});
});

// ── finding #7: empty-section remove control ────────────────────────────────────

describe('/roster — EMPTY sections show a remove control, admin-only (finding #7)', () => {
	it('the empty Bass section (zero members) shows section-remove-sec-bass with an accessible name, INSIDE its own group element', async () => {
		const container = await renderReady('admin');

		const remove = q(container, 'section-remove-sec-bass');
		expect(remove).not.toBeNull();
		expect(remove?.getAttribute('aria-label') || remove?.textContent?.trim()).toBeTruthy();
		expect(
			container.querySelector(
				'[data-testid="section-group-sec-bass"] [data-testid="section-remove-sec-bass"]'
			)
		).not.toBeNull();
	});

	it('sections WITH members show NO remove control — Soprano, Alto, Tenor and the sub-sections all stay bare', async () => {
		const container = await renderReady('admin');
		await ensureExpanded(container, 'sec-sop'); // sub-section toggles on screen too

		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			expect(q(container, `section-remove-${id}`)).toBeNull();
		}
	});

	it('an empty section with SUB-SECTIONS shows no remove control either — deleting it would orphan its children; its empty LEAF child does', async () => {
		listSectionsMock.mockResolvedValue([
			...fixtureTree(),
			{
				id: 'sec-men',
				name: 'Men',
				displayOrder: 5,
				parentId: null,
				depth: 0,
				children: [
					{ id: 'sec-men1', name: 'Men 1', displayOrder: 1, parentId: 'sec-men', depth: 1, children: [] }
				]
			}
		] satisfies SectionNode[]);
		const container = await renderReady('admin');
		await ensureExpanded(container, 'sec-men'); // the child's header on screen

		expect(q(container, 'section-remove-sec-men')).toBeNull();
		expect(q(container, 'section-remove-sec-men1')).not.toBeNull();
	});

	it.each(['not-admin', 'loading', 'error'] as const)(
		'%s: NO remove control anywhere — members never delete sections, fail closed on unresolved/errored rights',
		async (state) => {
			const container = await renderReady(state);
			expect(container.querySelector('[data-testid^="section-remove-"]')).toBeNull();
		}
	);

	it('the ✕ ARMS a two-step confirm and writes NOTHING on its own — the destructive step is a second, separate activation (#110 review F4)', async () => {
		const container = await renderReady('admin');

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);

		// Nothing written, and the header now offers confirm/cancel instead of ✕.
		expect(deleteMock).not.toHaveBeenCalled();
		expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		expect(q(container, 'section-remove-cancel-sec-bass')).not.toBeNull();
		expect(q(container, 'section-remove-sec-bass')).toBeNull();
		expect(q(container, 'section-group-sec-bass')).not.toBeNull();
	});

	it('CANCEL disarms: back to the ✕, still nothing written, section untouched', async () => {
		const container = await renderReady('admin');

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await fireEvent.click(q(container, 'section-remove-cancel-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'section-remove-sec-bass')).not.toBeNull();
		});
		expect(q(container, 'section-remove-confirm-sec-bass')).toBeNull();
		expect(deleteMock).not.toHaveBeenCalled();
		expect(q(container, 'section-group-sec-bass')).not.toBeNull();
	});

	it('CONFIRM calls deleteSection(cfg, "sec-bass") exactly ONCE and the group leaves the screen — no roster/section refetch', async () => {
		const container = await renderReady('admin');

		await removeSection(container, 'sec-bass');

		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(1);
		});
		expect(deleteMock).toHaveBeenCalledWith(CFG, 'sec-bass');
		await waitFor(() => {
			expect(q(container, 'section-group-sec-bass')).toBeNull();
		});
		// Local removal, not a refetch — same "runs once at load" contract as the
		// rest of this page.
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('a FAILED delete is loud and reverts: the group comes back and the failure lands in console.error — never a silently vanished section', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		deleteMock.mockRejectedValue(new Error('delete boom'));

		await removeSection(container, 'sec-bass');

		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(q(container, 'section-group-sec-bass')).not.toBeNull();
		});
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});

// ── #110 review F1/F3: a failed remove is VISIBLE, not just logged ──────────────

describe('/roster — a failed section remove SAYS SO on screen (#110 review F1)', () => {
	it('a rejected delete renders section-remove-error as a role="alert" — the group reappearing with no explanation is the bug', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		deleteMock.mockRejectedValue(new Error('403 Forbidden'));

		expect(q(container, 'section-remove-error')).toBeNull();
		await removeSection(container, 'sec-bass');

		await waitFor(() => {
			expect(q(container, 'section-remove-error')).not.toBeNull();
		});
		expect(q(container, 'section-remove-error')?.getAttribute('role')).toBe('alert');
		// The tree is back, so the alert is the ONLY thing on screen naming the event.
		expect(q(container, 'section-group-sec-bass')).not.toBeNull();
		consoleSpy.mockRestore();
	});

	it('a "section is not empty" refusal is its OWN message — the server saw what the active-and-named-only roster count could not (#110 review F3)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		deleteMock.mockRejectedValue(
			Object.assign(new Error('not empty'), { code: 'section-not-empty' })
		);

		await removeSection(container, 'sec-bass');

		await waitFor(() => {
			expect(q(container, 'section-remove-error')).not.toBeNull();
		});
		expect(q(container, 'section-remove-error')?.textContent).toContain(
			'roster_section_remove_not_empty'
		);
		consoleSpy.mockRestore();
	});

	it('a SUCCESSFUL remove renders no alert, and a retry clears the previous failure message', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		deleteMock.mockRejectedValueOnce(new Error('403 Forbidden'));

		await removeSection(container, 'sec-bass');
		await waitFor(() => {
			expect(q(container, 'section-remove-error')).not.toBeNull();
		});

		deleteMock.mockResolvedValue(undefined);
		await removeSection(container, 'sec-bass');
		await waitFor(() => {
			expect(q(container, 'section-group-sec-bass')).toBeNull();
		});
		expect(q(container, 'section-remove-error')).toBeNull();
		consoleSpy.mockRestore();
	});
});

// ── #110 review F2: no delete control on ANOTHER collective's sections ──────────

describe("/roster — the remove control never appears on another org's sections (#110 review F2)", () => {
	// `listSections` is NOT org-scoped and sections are `_sharing: public`, so a
	// foreign collective's sections land in the tree — all with memberCount 0 by
	// construction, since `rows` only ever holds the SELECTED collective's members.
	function foreignTree(): SectionNode[] {
		return [
			...fixtureTree().map((n) => ({ ...n, orgId: 'org-efk' })),
			{
				id: 'sec-other',
				name: "Another collective's empty section",
				displayOrder: 9,
				parentId: null,
				orgId: 'org-sireen',
				depth: 0,
				children: [
					{
						id: 'sec-other-sub',
						name: 'and its empty leaf',
						displayOrder: 1,
						parentId: 'sec-other',
						orgId: null,
						depth: 1,
						children: []
					}
				]
			}
		] satisfies SectionNode[];
	}

	it("our own empty section keeps its ✕; the foreign org's section is not rendered here AT ALL (#124/F3 supersedes 'render it, just hide the control')", async () => {
		// #124 (F3, 2026-08-12 gate walk) — this test used to assert the foreign
		// group STILL RENDERED, just without its remove control. That let a
		// foreign org's empty "(0)" section sit on screen next to the viewer's
		// own empty "(0)" with nothing visually distinguishing "removable" from
		// "not" — exactly the two-headers-disagreeing inconsistency the gate
		// walk caught. The #110 review F2 ruling itself stands (a destructive
		// affordance on another org's entity must never ship); the only way to
		// make that consistent is to not render the foreign group at all.
		listSectionsMock.mockResolvedValue(foreignTree());
		loadRosterMock.mockResolvedValue(fixtureRows().map((r) => ({ ...r, orgId: 'org-efk' })));
		const container = await renderReady('admin');

		expect(q(container, 'section-remove-sec-bass')).not.toBeNull();
		// Neither the foreign ROOT nor its sub-section (which carries no org
		// `_parent` of its own — v4E `parentConstraint: 'exactly_one_of'` — its
		// ROOT's org is what places it, and the whole subtree is excluded with
		// the root) renders at all, control or no control.
		expect(q(container, 'section-group-sec-other')).toBeNull();
		expect(q(container, 'section-remove-sec-other')).toBeNull();
		expect(q(container, 'section-group-sec-other-sub')).toBeNull();
		expect(q(container, 'section-remove-sec-other-sub')).toBeNull();
	});

	it('an org-less tree (pre-TU.1 fixtures, or a reader who sees no org _parent) keeps its controls — the gate excludes only POSITIVELY foreign sections', async () => {
		const container = await renderReady('admin');
		expect(q(container, 'section-remove-sec-bass')).not.toBeNull();
	});
});

// ── finding #9 (superseded by #155/S1's chip selector): collapsed default ───────
//
// The collapse-all/expand-all toggle these tests used to drive is GONE —
// #155/S1 replaced it with the 3-chip view-mode selector
// (roster-view-chip-collapsed/-expanded/-arrange). The collapsed-by-default
// behavior finding #9 shipped is unchanged; only the control that drives it is
// new. See page.roster-arrange.spec.ts for the chip selector's own contract.

describe('/roster — the Collapsed/Expanded view-mode chips; sections default COLLAPSED (finding #9, superseded by #155/S1)', () => {
	it('roster-view-modes renders at the TOP of the sections list (before the groups in document order) with an accessible name on each chip', async () => {
		const container = await renderReady('admin');

		const selector = q(container, 'roster-view-modes');
		expect(selector).not.toBeNull();
		const collapsedChip = q(container, 'roster-view-chip-collapsed');
		expect(collapsedChip).not.toBeNull();
		expect(
			collapsedChip?.getAttribute('aria-label') || collapsedChip?.textContent?.trim()
		).toBeTruthy();

		const groups = q(container, 'roster-groups') as HTMLElement;
		expect(
			(selector as HTMLElement).compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('sections default to COLLAPSED on initial page load — every section header has aria-expanded="false" and NO member row is on screen', async () => {
		const container = await renderReady('admin');

		const toggles = allToggles(container);
		expect(toggles.length).toBeGreaterThan(0);
		for (const toggle of toggles) {
			// Every header carries the attribute, and it says collapsed.
			expect(toggle.getAttribute('aria-expanded')).toBe('false');
		}
		expect(container.querySelectorAll('[data-testid^="roster-row-"]')).toHaveLength(0);
	});

	it('EXPANDED chip: activating it from the collapsed default expands EVERY section — including sub-sections — and the member rows appear', async () => {
		const container = await renderReady('admin');

		await fireEvent.click(q(container, 'roster-view-chip-expanded') as HTMLElement);

		await waitFor(() => {
			// Sub-section headers only render once their parent is expanded — their
			// presence AND expanded state is what "every section" means.
			expect(q(container, 'section-toggle-sec-sop1')).not.toBeNull();
		});
		for (const toggle of allToggles(container)) {
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
		}
		expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		expect(q(container, 'roster-row-m-eva')).not.toBeNull();
	});

	it('COLLAPSED chip: activating it after Expanded collapses EVERY section — headers back to aria-expanded="false", member rows gone', async () => {
		const container = await renderReady('admin');

		await fireEvent.click(q(container, 'roster-view-chip-expanded') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'roster-view-chip-collapsed') as HTMLElement);
		await waitFor(() => {
			expect(container.querySelectorAll('[data-testid^="roster-row-"]')).toHaveLength(0);
		});
		for (const toggle of allToggles(container)) {
			expect(toggle.getAttribute('aria-expanded')).toBe('false');
		}
	});

	it('a MANUALLY part-expanded list still collapses fully: expand one section by hand, then the Collapsed chip → everything collapses', async () => {
		const container = await renderReady('admin');
		await ensureExpanded(container, 'sec-alto');

		await fireEvent.click(q(container, 'roster-view-chip-collapsed') as HTMLElement);

		await waitFor(() => {
			expect(
				(q(container, 'section-toggle-sec-alto') as HTMLElement).getAttribute('aria-expanded')
			).toBe('false');
		});
		expect(container.querySelectorAll('[data-testid^="roster-row-"]')).toHaveLength(0);
	});
});

// ── finding #11: drop-target hint during drag-reorder ───────────────────────────

describe('/roster — a dashed drop-target indicator marks the landing position during drag (finding #11)', () => {
	it('dragging Soprano over Tenor shows section-drop-indicator INSIDE Tenor\'s group, styled as a dashed line; no indicator before the drag', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		expect(q(container, 'section-drop-indicator')).toBeNull();

		const dataTransfer = makeDataTransfer();
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop') as HTMLElement, {
			dataTransfer
		});
		await fireEvent.dragOver(q(container, 'section-header-sec-tenor') as HTMLElement, {
			dataTransfer
		});

		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="section-group-sec-tenor"] [data-testid="section-drop-indicator"]'
				)
			).not.toBeNull();
		});
		// "A dashed line" is the pinned affordance (finding #11 verbatim) — the
		// element's class carries it (Tailwind border-dashed / outline-dashed both
		// contain the token).
		const indicator = q(container, 'section-drop-indicator') as HTMLElement;
		expect(indicator.className).toContain('dashed');
	});

	it('the indicator FOLLOWS the hovered target — dragging on over Alto moves it out of Tenor\'s group and into Alto\'s (one indicator, never two)', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop') as HTMLElement, {
			dataTransfer
		});
		await fireEvent.dragOver(q(container, 'section-header-sec-tenor') as HTMLElement, {
			dataTransfer
		});
		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="section-group-sec-tenor"] [data-testid="section-drop-indicator"]'
				)
			).not.toBeNull();
		});

		await fireEvent.dragOver(q(container, 'section-header-sec-alto') as HTMLElement, {
			dataTransfer
		});
		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="section-group-sec-alto"] [data-testid="section-drop-indicator"]'
				)
			).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid="section-drop-indicator"]')).toHaveLength(1);
	});

	it('the indicator CLEARS when the drag ends without a drop (Esc / release outside) — dragend leaves no stale hint behind', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;
		await fireEvent.dragStart(handle, { dataTransfer });
		await fireEvent.dragOver(q(container, 'section-header-sec-tenor') as HTMLElement, {
			dataTransfer
		});
		await waitFor(() => {
			expect(q(container, 'section-drop-indicator')).not.toBeNull();
		});

		await fireEvent.dragEnd(handle, { dataTransfer });
		await waitFor(() => {
			expect(q(container, 'section-drop-indicator')).toBeNull();
		});
	});

	it('the indicator clears after a completed DROP too — the write fires, the groups reorder, and no hint lingers on the settled list', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		const target = q(container, 'section-header-sec-tenor') as HTMLElement;
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop') as HTMLElement, {
			dataTransfer
		});
		await fireEvent.dragOver(target, { dataTransfer });
		await waitFor(() => {
			expect(q(container, 'section-drop-indicator')).not.toBeNull();
		});

		await fireEvent.drop(target, { dataTransfer });
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(q(container, 'section-drop-indicator')).toBeNull();
		});
	});

	it('the indicator clears when the cursor LEAVES the target mid-drag — a hint pinned to a header the pointer has left promises a slot a release would not use (#110 review F4)', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		const target = q(container, 'section-header-sec-tenor') as HTMLElement;
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop') as HTMLElement, {
			dataTransfer
		});
		await fireEvent.dragOver(target, { dataTransfer });
		await waitFor(() => {
			expect(q(container, 'section-drop-indicator')).not.toBeNull();
		});

		// The drag is STILL LIVE — only the hover left.
		await fireEvent.dragLeave(target, { dataTransfer });
		await waitFor(() => {
			expect(q(container, 'section-drop-indicator')).toBeNull();
		});
	});

	it('leaving one header for the NEXT one keeps exactly one hint — dragleave fires after the new header\'s dragover, so an unguarded clear would blank it (#110 review F4)', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		const tenor = q(container, 'section-header-sec-tenor') as HTMLElement;
		const alto = q(container, 'section-header-sec-alto') as HTMLElement;
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop') as HTMLElement, {
			dataTransfer
		});
		await fireEvent.dragOver(tenor, { dataTransfer });
		// Browser ordering: dragover on the ENTERED element, then dragleave on the
		// one being left.
		await fireEvent.dragOver(alto, { dataTransfer });
		await fireEvent.dragLeave(tenor, { dataTransfer });

		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="section-group-sec-alto"] [data-testid="section-drop-indicator"]'
				)
			).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid="section-drop-indicator"]')).toHaveLength(1);
	});
});

// ── #110 review F1: the hint must point at the slot the drop ACTUALLY uses ──────
//
// `dropOnto` gives the dragged section the target's ORIGINAL index, so the
// landing slot depends on the drag's DIRECTION: a downward drag lands BELOW the
// target, an upward one lands ABOVE it. A hint rendered at a fixed spot is right
// for one direction and a slot off for the other — these pin both.

/** The header row (the `role="group"` bar carrying the toggle/handle/buttons) of
 *  a section, as the document-order anchor the indicator is placed relative to. */
function headerRowOf(container: HTMLElement, id: string): HTMLElement {
	const header = q(container, `section-header-${id}`) as HTMLElement;
	expect(header, `header for ${id}`).not.toBeNull();
	const row = header.closest('[role="group"]') as HTMLElement | null;
	expect(row, `header row for ${id}`).not.toBeNull();
	return row as HTMLElement;
}

function soleIndicator(container: HTMLElement): HTMLElement {
	const all = container.querySelectorAll<HTMLElement>('[data-testid="section-drop-indicator"]');
	expect(all).toHaveLength(1);
	return all[0];
}

describe('/roster — the drop indicator marks the LANDING SLOT, which depends on drag direction (#110 review F1)', () => {
	it('DOWNWARD (Soprano ▸ Tenor): the item lands BELOW Tenor, so the indicator sits AFTER Tenor\'s header row', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		const target = q(container, 'section-header-sec-tenor') as HTMLElement;
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop') as HTMLElement, {
			dataTransfer
		});
		await fireEvent.dragOver(target, { dataTransfer });

		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="section-group-sec-tenor"] [data-testid="section-drop-indicator"]'
				)
			).not.toBeNull();
		});
		const indicator = soleIndicator(container);
		const row = headerRowOf(container, 'sec-tenor');
		// row PRECEDES indicator ⇒ the dashed line reads "lands below this header".
		expect(row.compareDocumentPosition(indicator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		// …and that is exactly where the drop puts it.
		await fireEvent.drop(target, { dataTransfer });
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, [
			'sec-alto',
			'sec-tenor',
			'sec-sop',
			'sec-bass'
		]);
	});

	it('UPWARD (Bass ▸ Soprano): the item lands ABOVE Soprano, so the indicator sits BEFORE Soprano\'s header row — not one slot below it', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		const target = q(container, 'section-header-sec-sop') as HTMLElement;
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-bass') as HTMLElement, {
			dataTransfer
		});
		await fireEvent.dragOver(target, { dataTransfer });

		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="section-group-sec-sop"] [data-testid="section-drop-indicator"]'
				)
			).not.toBeNull();
		});
		const indicator = soleIndicator(container);
		const row = headerRowOf(container, 'sec-sop');
		// indicator PRECEDES row ⇒ the dashed line reads "lands above this header".
		expect(indicator.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await fireEvent.drop(target, { dataTransfer });
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, [
			'sec-bass',
			'sec-sop',
			'sec-alto',
			'sec-tenor'
		]);
	});
});

// ── #110 review F2: the touch hint obeys the same gate the touch DROP does ──────

describe('/roster — the touch long-press hint never promises a drop that dropOnto refuses (#110 review F2)', () => {
	// happy-dom has no layout, so `elementFromPoint` always returns null — same
	// explicit y → section stub page.roster-reorder.spec.ts uses for the touch path.
	function stubHitTest(container: HTMLElement, yToId: Record<number, string>) {
		return vi
			.spyOn(document, 'elementFromPoint')
			.mockImplementation((_x: number, y: number) =>
				yToId[y] ? container.querySelector(`[data-testid="section-header-${yToId[y]}"]`) : null
			);
	}

	const TOUCH = { pointerType: 'touch', pointerId: 1, isPrimary: true } as const;

	async function pickUp(container: HTMLElement, id: string, y: number): Promise<HTMLElement> {
		const handle = q(container, `section-drag-handle-${id}`) as HTMLElement;
		expect(handle, `drag handle for ${id}`).not.toBeNull();
		await fireEvent.pointerDown(handle, { ...TOUCH, clientX: 10, clientY: y });
		await waitFor(() => {
			expect(handle.className).toContain('opacity-50');
		});
		return handle;
	}

	it('POSITIVE CONTROL — long-press-dragging Bass over its sibling Soprano DOES hint, and (upward) above Soprano\'s header row', async () => {
		const container = await renderReady('admin');
		const hitTest = stubHitTest(container, { 10: 'sec-bass', 50: 'sec-sop' });

		const handle = await pickUp(container, 'sec-bass', 10);
		await fireEvent.pointerMove(handle, { ...TOUCH, clientX: 10, clientY: 50 });

		await waitFor(() => {
			expect(
				container.querySelector(
					'[data-testid="section-group-sec-sop"] [data-testid="section-drop-indicator"]'
				)
			).not.toBeNull();
		});
		const indicator = soleIndicator(container);
		const row = headerRowOf(container, 'sec-sop');
		expect(indicator.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		hitTest.mockRestore();
	});

	it('a SUB-section dragged across a top-level header gets NO hint there — that drop is a structural move dropOnto silently refuses (#98), so the affordance must not claim otherwise', async () => {
		const container = await renderReady('admin');
		await ensureExpanded(container, 'sec-sop'); // sub-section headers on screen
		await ensureCollapsed(container, 'sec-sop1'); // …so it carries a drag handle
		await ensureCollapsed(container, 'sec-alto');
		const hitTest = stubHitTest(container, { 10: 'sec-sop1', 50: 'sec-alto' });

		const handle = await pickUp(container, 'sec-sop1', 10);
		await fireEvent.pointerMove(handle, { ...TOUCH, clientX: 10, clientY: 50 });

		// The hint and the bg highlight agree, and both say "nothing will happen".
		expect(
			container.querySelector('[data-testid="section-group-sec-alto"] [data-drop-target="true"]')
		).toBeNull();
		expect(q(container, 'section-drop-indicator')).toBeNull();

		await fireEvent.pointerUp(handle, { ...TOUCH, clientX: 10, clientY: 50 });
		expect(reorderMock).not.toHaveBeenCalled();
		hitTest.mockRestore();
	});
});

// ── #110 review F3 (superseded by #155/S1): a remove must not desync the
// on-screen expand state from what drove it ──────────────────────────────────
//
// The old sections-toggle-all was a SINGLE control whose own label was
// COMPUTED off live `expandedIds` (#110 review F3's concern: don't let that
// computed label go stale against a removed section's leftover id). #155/S1's
// chip selector has no such computed label — `roster-view-chip-expanded`'s
// aria-pressed is a plain reflection of `viewMode`, never re-derived from
// `expandedIds` — so that specific staleness class cannot occur by
// construction. What still matters, and what these now check: a remove must
// not silently desync the Expanded chip from what is ACTUALLY on screen
// (still expanded, still failing loud on a rejected write, exactly like every
// other section here).
describe('/roster — a remove does not desync the Expanded chip from what is ON SCREEN (#110 review F3, superseded by #155/S1)', () => {
	it('removing a section while Expanded is active leaves the chip pressed and the REMAINING sections still expanded', async () => {
		const container = await renderReady('admin');
		await fireEvent.click(q(container, 'roster-view-chip-expanded') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});

		// Bass is the empty leaf — the one section carrying a remove control.
		await removeSection(container, 'sec-bass');
		await waitFor(() => {
			expect(q(container, 'section-group-sec-bass')).toBeNull();
		});

		expect(
			(q(container, 'roster-view-chip-expanded') as HTMLElement).getAttribute('aria-pressed')
		).toBe('true');
		expect(q(container, 'roster-row-m-ada')).not.toBeNull();
	});

	it('a FAILED remove keeps the section AND its expanded state — the Expanded chip stays pressed throughout', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		await fireEvent.click(q(container, 'roster-view-chip-expanded') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-row-m-ada')).not.toBeNull();
		});
		deleteMock.mockRejectedValue(new Error('delete boom'));

		await removeSection(container, 'sec-bass');

		await waitFor(() => {
			expect(q(container, 'section-group-sec-bass')).not.toBeNull();
		});
		expect(
			(q(container, 'section-toggle-sec-bass') as HTMLElement).getAttribute('aria-expanded')
		).toBe('true');
		expect(
			(q(container, 'roster-view-chip-expanded') as HTMLElement).getAttribute('aria-pressed')
		).toBe('true');
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis* — TU.2/#110 RED)
// (*MVOX:Byrd* — #110 review F1/F2/F3 regression pins)
