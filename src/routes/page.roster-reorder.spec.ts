// @vitest-environment happy-dom
//
// TS.4/#98 RED — the /roster page's DRAG-REORDER on section headers
// (integration). These tests render the ACTUAL page route component — same
// "partial assertions hide bugs" rationale as page.roster-picker.spec.ts: a
// unit-covered reorderSections with nothing joining it to the page ships an
// unreachable feature. `groupBySection` runs REAL; only the fetching seams and
// the WRITE seam (sectionActions) are mocked, so GREEN cannot pass without
// genuinely wiring drag handles into the section headers and the drop/keyboard
// paths into `reorderSections`.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS
//     section-drag-handle-<sectionId>   the ≡ drag handle; draggable="true";
//                                       INSIDE its own section-group element
//
//   #150 — the up/down keyboard-fallback buttons this file originally pinned
//   (section-move-up-<id>/section-move-down-<id>) were removed: the drag
//   handle is now the ONLY reorder input, and this page currently has no
//   keyboard-operable path to a reorder at all (an open a11y gap, tracked in
//   #152).
//
//   VISIBILITY — per-header, both gates AND-ed, FAIL CLOSED:
//     - the handle renders on a section header ONLY while THAT section is
//       COLLAPSED (issue #98: "visible only on collapsed section headers" —
//       expanded sections must collapse to reorder; per-header, so a
//       collapsed Soprano shows its handle even while Alto stays expanded);
//     - AND only for `$adminStore === 'admin'` — 'not-admin', 'loading' and
//       'error' all hide it (same fail-closed gate as the section picker);
//     - the Unassigned group NEVER gets a handle (it is not a section entity
//       and always sorts last).
//
//   REORDER SEMANTICS:
//     - a reorder is scoped to ONE SIBLING GROUP: the top-level sections, or
//       one parent's sub-sections. `reorderSections(cfg, orderedIds)` receives
//       EXACTLY the sibling ids in their new order — never ids from another
//       level (#98: dragging a sub-section out of its parent is a structural
//       change, not an order change — it must do NOTHING).
//     - DROP (desktop dnd) and the touch long-press twin: dropping a dragged
//       header onto a SIBLING header means "the dragged section takes the drop
//       target's original position" (downward drag → lands after the target;
//       upward → before it). The drop triggers the write IMMEDIATELY — no
//       confirm step, no save button. These tests dispatch dragstart on the
//       handle and dragover/drop on the target's section-header-<id> element
//       (events bubble — handlers may live on any ancestor). Dropping on a
//       NON-sibling → no call, no move.
//     - OPTIMISTIC-AND-RECONCILE (AC-8): the groups re-render in the new order
//       immediately; on write failure the order REVERTS and the failure is
//       logged; on success it stays — no roster/section refetch.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock, listSectionsMock, assignMock, unassignMock, createMock, reorderMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createMock: vi.fn(),
		reorderMock: vi.fn()
	}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
// The WRITE seam — drops and keyboard moves must land here, with the page's cfg.
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createMock,
	reorderSections: reorderMock
}));
// Severs the entu-config → $env/dynamic/public import under happy-dom (same
// pattern as page.roster-sections.spec.ts).
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
// THREE top-level sections (a 3-element order shows more than a swap):
// Soprano (1) ▸ [Soprano 1 (1), Soprano 2 (2)]; Alto (2); Tenor (3).
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
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, depth: 0, children: [] }
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
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createMock.mockReset();
	reorderMock.mockReset();
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

/** Document-order (pre-order) list of section-group testids — the on-screen order. */
function groupOrder(container: HTMLElement): string[] {
	return [...container.querySelectorAll('[data-testid^="section-group-"]')].map(
		(el) => el.getAttribute('data-testid') ?? ''
	);
}

// TU.2/#110 finding #9 — sections now default COLLAPSED, so this helper is
// STATE-AGNOSTIC (only clicks when currently expanded) rather than assuming an
// expanded start.
async function collapse(container: HTMLElement, id: string): Promise<void> {
	const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
	if (toggle.getAttribute('aria-expanded') === 'true') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});
}

async function collapseAllTopLevel(container: HTMLElement): Promise<void> {
	for (const id of ['sec-sop', 'sec-alto', 'sec-tenor']) await collapse(container, id);
}

/** Companion to `collapse` — expand `id` regardless of the current default. */
async function expand(container: HTMLElement, id: string): Promise<void> {
	const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
	if (toggle.getAttribute('aria-expanded') === 'false') await fireEvent.click(toggle);
	await waitFor(() => {
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});
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

// ── visibility: collapsed-only, admin-only, integration presence ────────────────

describe('/roster — drag handles render on the actual page: collapsed headers only, admin only (integration)', () => {
	it('admin + everything EXPANDED (explicitly — TU.2/#110 finding #9 supersedes the old expanded-by-default default) → NO drag handle anywhere', async () => {
		const container = await renderReady('admin');
		// Expand every section (incl. sub-sections) via the same toggle-all
		// control finding #9 shipped — the exhaustive "expand literally
		// everything" this test's premise needs.
		await fireEvent.click(q(container, 'sections-toggle-all') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-toggle-sec-sop1')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid^="section-drag-handle-"]')).toBeNull();
	});

	it('admin + Soprano collapsed → Soprano\'s header gets the handle (draggable="true", INSIDE its group) with an accessible name; still-expanded Alto/Tenor stay bare', async () => {
		const container = await renderReady('admin');
		// TU.2/#110 finding #9 — sections default collapsed now; explicitly
		// expand Alto/Tenor so "still-expanded" is genuinely true, isolating
		// Soprano's collapse as the only reorder-enabling state.
		await expand(container, 'sec-alto');
		await expand(container, 'sec-tenor');
		await collapse(container, 'sec-sop');

		const handle = q(container, 'section-drag-handle-sec-sop');
		expect(handle).not.toBeNull();
		expect(handle?.getAttribute('draggable')).toBe('true');
		// The handle belongs to ITS OWN header's group element.
		expect(
			container.querySelector(
				'[data-testid="section-group-sec-sop"] [data-testid="section-drag-handle-sec-sop"]'
			)
		).not.toBeNull();
		// A11y: the handle carries an accessible name (aria-label).
		expect(handle?.getAttribute('aria-label')).toBeTruthy();

		// Per-header gate: the still-expanded siblings show nothing.
		for (const id of ['sec-alto', 'sec-tenor']) {
			expect(q(container, `section-drag-handle-${id}`)).toBeNull();
		}
	});

	it('the Unassigned group NEVER gets a handle — even collapsed, even for admin (it is not a section and always sorts last)', async () => {
		loadRosterMock.mockResolvedValue([
			...fixtureRows(),
			{ memberId: 'm-pete', personId: 'p-pete', name: 'Pete Wilson', email: 'pete@x.com', sectionIds: [] }
		]);
		const container = await renderReady('admin');
		await collapse(container, 'unassigned');

		expect(q(container, 'section-drag-handle-unassigned')).toBeNull();
	});

	it.each(['not-admin', 'loading', 'error'] as const)(
		'%s: collapsed sections still show NO handles — members never reorder, fail closed on unresolved/errored rights',
		async (state) => {
			const container = await renderReady(state);
			await collapse(container, 'sec-sop');
			expect(container.querySelector('[data-testid^="section-drag-handle-"]')).toBeNull();
		}
	);
});

// ── drop → immediate write ──────────────────────────────────────────────────────

describe('/roster — dropping a dragged header triggers ONE immediate reorderSections write + optimistic re-render', () => {
	it('downward drag: Soprano dropped onto Tenor takes Tenor\'s slot → reorderSections(cfg, ["sec-alto","sec-tenor","sec-sop"]) exactly once; groups re-render in that order', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		expect(groupOrder(container)).toEqual([
			'section-group-sec-sop',
			'section-group-sec-alto',
			'section-group-sec-tenor'
		]);

		await dragAndDrop(container, 'sec-sop', 'sec-tenor');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-alto', 'sec-tenor', 'sec-sop']);
		await waitFor(() => {
			expect(groupOrder(container)).toEqual([
				'section-group-sec-alto',
				'section-group-sec-tenor',
				'section-group-sec-sop'
			]);
		});
	});

	it('upward drag: Tenor dropped onto Soprano takes Soprano\'s slot → reorderSections(cfg, ["sec-tenor","sec-sop","sec-alto"])', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		await dragAndDrop(container, 'sec-tenor', 'sec-sop');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-tenor', 'sec-sop', 'sec-alto']);
		await waitFor(() => {
			expect(groupOrder(container)).toEqual([
				'section-group-sec-tenor',
				'section-group-sec-sop',
				'section-group-sec-alto'
			]);
		});
	});

	it('a SUB-SECTION dropped onto a top-level (non-sibling) header does NOTHING — no reorderSections call, order unchanged (structural change, not an order change)', async () => {
		const container = await renderReady('admin');
		// Soprano must be EXPANDED so its sub-sections are on screen at all
		// (TU.2/#110 finding #9 — collapsed by default now, so this is no longer
		// automatic); the sub-section and the foreign target are both collapsed
		// (both carry handles — that is not enough: the sibling constraint must
		// still reject the drop).
		await expand(container, 'sec-sop');
		await collapse(container, 'sec-sop1');
		await collapse(container, 'sec-alto');
		const before = groupOrder(container);

		await dragAndDrop(container, 'sec-sop1', 'sec-alto');

		expect(reorderMock).not.toHaveBeenCalled();
		expect(groupOrder(container)).toEqual(before);
	});
});

// #150 — the up/down keyboard-fallback buttons this section tested (and their
// dedicated boundary-disabled coverage) are gone; drag is now the only
// reorder input, exercised by the describe blocks around this one.

// ── sub-sections: constrained to their parent group ─────────────────────────────

describe('/roster — sub-sections reorder within their PARENT group only', () => {
	it('dragging collapsed Soprano 1 onto Soprano 2 calls reorderSections with EXACTLY the sibling ids ["sec-sop2","sec-sop1"] — never top-level ids; the two sub-groups swap on screen', async () => {
		const container = await renderReady('admin');
		// Parent must be EXPANDED first (its children must be on screen — TU.2/
		// #110 finding #9, no longer automatic); both sub-sections then collapsed
		// so their handles show.
		await expand(container, 'sec-sop');
		await collapse(container, 'sec-sop1');
		await collapse(container, 'sec-sop2');

		await dragAndDrop(container, 'sec-sop1', 'sec-sop2');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-sop2', 'sec-sop1']);
		await waitFor(() => {
			expect(groupOrder(container)).toEqual([
				'section-group-sec-sop',
				'section-group-sec-sop2',
				'section-group-sec-sop1',
				'section-group-sec-alto',
				'section-group-sec-tenor'
			]);
		});
	});
});

// ── optimistic-and-reconcile (AC-8) ─────────────────────────────────────────────

describe('/roster — a failed reorder write RECONCILES against the server and logs (AC-8)', () => {
	it('reorderSections rejects → the section tree is re-read and the groups show the SERVER order; the failure lands in console.error; the ROSTER is not refetched', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		reorderMock.mockRejectedValue(new Error('reorder boom'));

		await dragAndDrop(container, 'sec-sop', 'sec-alto');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		// Reconcile: back to the server order (Soprano first again) — nothing landed.
		await waitFor(() => {
			expect(groupOrder(container)).toEqual([
				'section-group-sec-sop',
				'section-group-sec-alto',
				'section-group-sec-tenor'
			]);
		});
		expect(consoleSpy).toHaveBeenCalled();
		// The SECTION tree is re-read (once) — see the partial-write test below for why.
		// The roster itself is untouched: a reorder cannot change membership.
		await waitFor(() => {
			expect(listSectionsMock).toHaveBeenCalledTimes(2);
		});
		expect(listSectionsMock).toHaveBeenLastCalledWith(CFG);
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
		consoleSpy.mockRestore();
	});

	// F3 code-review fix (#98 review). `reorderSections` walks the sibling group
	// SERIALLY and throws on the first non-2xx, so the sections it already wrote
	// KEEP their new display_order. Reverting the whole optimistic order therefore
	// asserted an order the server no longer held — and this page never refetches,
	// so the lie was permanent.
	it('a PARTIAL write failure shows what the server actually holds, not the pre-move order — the half-landed renumber wins', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		// Alto's renumber landed (display_order 1), Soprano's 403'd — so the server
		// now sorts Alto, Soprano, Tenor even though the write as a whole failed.
		reorderMock.mockRejectedValue(new Error('HTTP 403'));
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{
				id: 'sec-sop',
				name: 'Soprano',
				displayOrder: 1,
				parentId: null,
				depth: 0,
				children: fixtureTree()[0].children
			},
			{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, depth: 0, children: [] }
		] satisfies SectionNode[]);

		await dragAndDrop(container, 'sec-sop', 'sec-alto');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(groupOrder(container).filter((id) => !id.includes('sop1') && !id.includes('sop2'))).toEqual([
				'section-group-sec-alto',
				'section-group-sec-sop',
				'section-group-sec-tenor'
			]);
		});
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('when the reconciling re-read ALSO fails, the optimistic order is reverted as a last resort and BOTH failures are logged — never a silent half-state', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		reorderMock.mockRejectedValue(new Error('reorder boom'));
		listSectionsMock.mockRejectedValue(new Error('refetch boom'));

		await dragAndDrop(container, 'sec-sop', 'sec-alto');

		await waitFor(() => {
			expect(listSectionsMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(groupOrder(container)).toEqual([
				'section-group-sec-sop',
				'section-group-sec-alto',
				'section-group-sec-tenor'
			]);
		});
		expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
		consoleSpy.mockRestore();
	});
});

// ── #98 review fixes ────────────────────────────────────────────────────────────

describe('/roster — dragstart populates the drag data store (#98 review F1)', () => {
	it('dragstart on the handle calls dataTransfer.setData and sets effectAllowed — Firefox refuses to start a drag session with an empty store, which would kill the drop path entirely', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const dataTransfer = makeDataTransfer();
		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;
		// happy-dom builds its OWN DataTransfer for the event (the stub's methods
		// get copied onto it, so `getData` still reads through the stub's store,
		// but `effectAllowed` lands on the event's object) — so read the real one
		// off the event, after the component's handler has run.
		let seen: DataTransfer | null = null;
		handle.addEventListener('dragstart', (event) => {
			seen = (event as DragEvent).dataTransfer;
		});
		await fireEvent.dragStart(handle, { dataTransfer });

		expect(dataTransfer.getData('text/plain')).toBe('sec-sop');
		expect(seen).not.toBeNull();
		expect((seen as unknown as DataTransfer).effectAllowed).toBe('move');
	});
});

describe('/roster — an in-flight reorder write blocks a second one (#98 review F2)', () => {
	/** A reorder write that stays pending until the test resolves it. */
	function deferredReorder(): { resolve: () => void } {
		let release!: () => void;
		reorderMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		return { resolve: () => release() };
	}

	it('a second drop while the first write is outstanding is REFUSED, and the handles visibly disable — two overlapping full-sibling renumbers would leave a section holding two display_order values', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		const pending = deferredReorder();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});

		// Every drag handle is disabled while the write is outstanding — the
		// primary double-tap guard is the UI refusing the drag, not swallowing it.
		await waitFor(() => {
			expect(q(container, 'section-drag-handle-sec-sop')?.getAttribute('draggable')).toBe('false');
		});
		expect(q(container, 'section-drag-handle-sec-alto')?.getAttribute('draggable')).toBe('false');
		expect(q(container, 'section-drag-handle-sec-tenor')?.getAttribute('draggable')).toBe('false');

		// Backstop: even a drop that got through anyway writes nothing — the
		// handle's `draggable="false"` is the visible refusal, `reorderPending`'s
		// early return in `performReorder` is what actually enforces it.
		await dragAndDrop(container, 'sec-tenor', 'sec-sop');
		expect(reorderMock).toHaveBeenCalledTimes(1);

		// Settled → the controls come back and a move works again.
		pending.resolve();
		await waitFor(() => {
			expect(q(container, 'section-drag-handle-sec-tenor')?.getAttribute('draggable')).toBe('true');
		});
		await dragAndDrop(container, 'sec-tenor', 'sec-sop');
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(2);
		});
	});
});

describe('/roster — an ABORTED drag cannot arm a later foreign drop (#98 review F1)', () => {
	it('dragend clears the drag source: after an aborted drag (Esc / release outside a drop zone), a drop on another collapsed header writes NOTHING', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		const before = groupOrder(container);

		// Grab Soprano's handle, then abort — `dragend` fires, `drop` never does.
		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;
		await fireEvent.dragStart(handle, { dataTransfer: makeDataTransfer() });
		await fireEvent.dragEnd(handle, { dataTransfer: makeDataTransfer() });

		// Later: something from OUTSIDE (a file, a selection, a link) is dragged over
		// Tenor's header and released. With a stale drag source this silently
		// reordered the sibling group — an unrequested, unconfirmed, permanent write.
		const target = q(container, 'section-header-sec-tenor') as HTMLElement;
		await fireEvent.dragOver(target, { dataTransfer: makeDataTransfer() });
		await fireEvent.drop(target, { dataTransfer: makeDataTransfer() });

		expect(reorderMock).not.toHaveBeenCalled();
		expect(groupOrder(container)).toEqual(before);
	});

	it('a collapsed admin header is NOT a drop zone while no section drag is live — dragover leaves the event un-prevented, so the browser never fires drop at all', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);

		const target = q(container, 'section-header-sec-tenor') as HTMLElement;
		const foreign = new Event('dragover', { bubbles: true, cancelable: true });
		target.dispatchEvent(foreign);
		expect(foreign.defaultPrevented).toBe(false);

		// …and it IS a drop zone once one of our handles is actually being dragged.
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop') as HTMLElement, {
			dataTransfer: makeDataTransfer()
		});
		const ours = new Event('dragover', { bubbles: true, cancelable: true });
		target.dispatchEvent(ours);
		expect(ours.defaultPrevented).toBe(true);
	});
});

describe('/roster — TOUCH long-press drag reorders too (#98 review F2)', () => {
	// happy-dom has no layout, so `elementFromPoint` always returns null. Stub it
	// with an explicit y → section map: the hit-testing LOGIC (innermost group,
	// never Unassigned) is what these tests are pinning, not browser geometry.
	function stubHitTest(container: HTMLElement, yToId: Record<number, string>) {
		return vi
			.spyOn(document, 'elementFromPoint')
			.mockImplementation((_x: number, y: number) =>
				yToId[y] ? container.querySelector(`[data-testid="section-header-${yToId[y]}"]`) : null
			);
	}

	const TOUCH = { pointerType: 'touch', pointerId: 1, isPrimary: true } as const;

	/** Long-press the handle until it visibly picks up (no fake timers — the
	 *  affordance IS the readiness signal a finger gets). */
	async function pickUp(container: HTMLElement, id: string, y: number): Promise<HTMLElement> {
		const handle = q(container, `section-drag-handle-${id}`) as HTMLElement;
		expect(handle, `drag handle for ${id}`).not.toBeNull();
		await fireEvent.pointerDown(handle, { ...TOUCH, clientX: 10, clientY: y });
		await waitFor(() => {
			expect(handle.className).toContain('opacity-50');
		});
		return handle;
	}

	it('long-press Soprano, drag onto Tenor, release → the SAME single reorderSections write the desktop drop makes, and the groups re-render', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		stubHitTest(container, { 10: 'sec-sop', 30: 'sec-alto', 50: 'sec-tenor' });

		const handle = await pickUp(container, 'sec-sop', 10);
		await fireEvent.pointerMove(handle, { ...TOUCH, clientX: 10, clientY: 50 });
		// The hovered header is marked while the finger is over it — a pointer drag
		// gets no browser-drawn drag image, so the affordance has to be ours.
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="section-group-sec-tenor"] [data-drop-target="true"]')
			).not.toBeNull();
		});
		await fireEvent.pointerUp(handle, { ...TOUCH, clientX: 10, clientY: 50 });

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-alto', 'sec-tenor', 'sec-sop']);
		await waitFor(() => {
			expect(groupOrder(container)).toEqual([
				'section-group-sec-alto',
				'section-group-sec-tenor',
				'section-group-sec-sop'
			]);
		});
	});

	it('a SCROLL is not a drag: moving past the slop before the long-press completes cancels the pickup, and the release writes nothing', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		stubHitTest(container, { 10: 'sec-sop', 50: 'sec-tenor' });

		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;
		await fireEvent.pointerDown(handle, { ...TOUCH, clientX: 10, clientY: 10 });
		// Finger travels immediately — that is a scroll gesture, not a pickup.
		await fireEvent.pointerMove(handle, { ...TOUCH, clientX: 10, clientY: 50 });
		await new Promise((resolve) => setTimeout(resolve, 500));
		await fireEvent.pointerUp(handle, { ...TOUCH, clientX: 10, clientY: 50 });

		expect(handle.className).not.toContain('opacity-50');
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('a MOUSE pointerdown is ignored — the native HTML5 drag owns mouse, and two protocols racing on one gesture would double-write', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		stubHitTest(container, { 10: 'sec-sop', 50: 'sec-tenor' });

		const handle = q(container, 'section-drag-handle-sec-sop') as HTMLElement;
		await fireEvent.pointerDown(handle, { pointerType: 'mouse', pointerId: 2, clientX: 10, clientY: 10 });
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(handle.className).not.toContain('opacity-50');
		await fireEvent.pointerUp(handle, { pointerType: 'mouse', pointerId: 2, clientX: 10, clientY: 50 });
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('releasing a long-press over a NON-SIBLING header does nothing — the sibling constraint holds on touch exactly as it does on drop', async () => {
		const container = await renderReady('admin');
		// Soprano must be expanded first (its children on screen — TU.2/#110
		// finding #9, no longer automatic), then the sub-section and the foreign
		// top-level target both collapsed so both carry handles.
		await expand(container, 'sec-sop');
		await collapse(container, 'sec-sop1');
		await collapse(container, 'sec-alto');
		stubHitTest(container, { 10: 'sec-sop1', 50: 'sec-alto' });
		const before = groupOrder(container);

		const handle = await pickUp(container, 'sec-sop1', 10);
		await fireEvent.pointerMove(handle, { ...TOUCH, clientX: 10, clientY: 50 });
		await fireEvent.pointerUp(handle, { ...TOUCH, clientX: 10, clientY: 50 });

		expect(reorderMock).not.toHaveBeenCalled();
		expect(groupOrder(container)).toEqual(before);
	});

	it('pointercancel (the system stealing the gesture) aborts the pickup — no write, and the handle stops looking dragged', async () => {
		const container = await renderReady('admin');
		await collapseAllTopLevel(container);
		stubHitTest(container, { 10: 'sec-sop', 50: 'sec-tenor' });

		const handle = await pickUp(container, 'sec-sop', 10);
		await fireEvent.pointerMove(handle, { ...TOUCH, clientX: 10, clientY: 50 });
		await fireEvent.pointerCancel(handle, { ...TOUCH, clientX: 10, clientY: 50 });

		await waitFor(() => {
			expect(handle.className).not.toContain('opacity-50');
		});
		await fireEvent.pointerUp(handle, { ...TOUCH, clientX: 10, clientY: 50 });
		expect(reorderMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — TS.4/#98 RED)
// (*MVOX:Josquin* — #98 review-fix regression tests)
