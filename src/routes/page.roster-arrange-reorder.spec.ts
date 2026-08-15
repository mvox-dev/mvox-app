// @vitest-environment happy-dom
//
// #155/S2 RED — REORDER inside arrange mode (integration, on the ACTUAL
// /roster page route). S1 (page.roster-arrange.spec.ts) shipped the compact
// read-only shell; this file pins the reorder half GH#155 describes:
//
//   "Whole row is the drag target (no separate handle needed)"
//   "Parent drag moves the entire subtree"
//   "Keyboard: Space/Enter grab, Up/Down move, Escape cancel"
//   "Subtree collapses [visually groups] with parent during drag"
//
// Same integration discipline as page.roster-reorder.spec.ts (#98/#152): the
// REAL page renders, `groupBySection`/the section tree run real, only the
// fetch seams and the sectionActions WRITE seam are mocked. Reorder in
// arrange mode reuses the EXACT SAME write path (`performReorder` →
// `reorderSections`) and announcement region (`roster-reorder-status`) the
// collapsed-header drag/keyboard reorder already has full coverage for
// (#98/#99/#110/#152) — this file does not re-prove that infrastructure, only
// that arrange-mode ROWS now drive it, whole-row draggable, with no separate
// handle, and that a parent's SUBTREE moves and is visually grouped with it.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS — `arrange-row-<sectionId>` (from S1) IS now the drag target AND
//   the keyboard control — no `section-drag-handle-*` inside
//   `roster-arrange-list`. Review F4 added ONE more: `arrange-grip-<sectionId>`,
//   the narrow decorative bar at the head of each row that owns the TOUCH
//   pickup (and only that) so the row can keep `touch-action: pan-y` and the
//   list can still be scrolled by a finger.
//
//   ATTRIBUTES on each arrange-row-<id>:
//     draggable="true" (or "false" while `reorderPending`)
//     role="button", roving tabindex (one row at "0")
//     NO aria-label — the row is named by its own contents ("Soprano (3)"),
//       so the visible member roll-up stays in the accessible name (review F1)
//     aria-grabbed="true" while native-dragged OR keyboard-grabbed
//     data-grabbed="true" ONLY on the row currently held (drag or grab)
//     data-grabbed-subtree="true" on every DESCENDANT row of the held one
//       (S2 point 3: subtree rows visually grouped with the grabbed parent)
//
//   DRAG: dragstart on a row, dragover+drop on a SIBLING row → ONE
//   reorderSections(cfg, siblingIds) call, same "target's original slot"
//   semantics as the collapsed-header drag (#98). A non-sibling drop (e.g. a
//   child row dropped on an unrelated top-level row) does nothing. Dropping a
//   PARENT moves its children rows along with it in the rendered order.
//
//   KEYBOARD: Space/Enter grabs (announces "Grabbed X", data-grabbed appears);
//   ArrowDown/ArrowUp move the grabbed row (and its subtree) one sibling slot,
//   PROVISIONALLY (announces "moved", nothing written yet), clamped at
//   either end; Space/Enter again DROPS — commits through reorderSections
//   (announces "Dropped X"); Escape cancels — restores pre-grab order,
//   announces cancellation, writes nothing.
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
// Soprano ▸ [Soprano 1, Soprano 2]; Alto; Tenor — same shape as #98/#152's own
// fixture (three top-level siblings, one with two children) so a downward /
// upward move and a subtree move are all exercisable.

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
	const from = row(container, fromId);
	const to = row(container, toId);
	await fireEvent.dragStart(from, { dataTransfer });
	await fireEvent.dragOver(to, { dataTransfer });
	await fireEvent.drop(to, { dataTransfer });
}

// ── whole-row is the drag target, no separate handle ─────────────────────────

describe('/roster — arrange rows ARE the drag target (#155/S2): no separate handle', () => {
	// #155/S2 review F1 — the accessible name comes from the row's own CONTENTS,
	// and no `aria-label` is allowed to override them. An aria-label of just the
	// section name silenced the "(n)" member roll-up the row visibly shows and
	// made the accessible name a strict subset of the visible label (WCAG 2.5.3).
	it('every arrange row is draggable, is named by its own visible text (section name AND member count, no overriding aria-label), and NO section-drag-handle-* exists inside the arrange list', async () => {
		const container = await renderInArrangeMode();

		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			const el = row(container, id);
			expect(el, `row ${id}`).not.toBeNull();
			expect(el.getAttribute('draggable')).toBe('true');
			expect(el.hasAttribute('aria-label'), `row ${id} must not override its contents`).toBe(
				false
			);
			expect(el.textContent?.replace(/\s+/g, ' ').trim(), `row ${id}`).toBeTruthy();
		}
		// Soprano's roll-up is 3 (Ada direct + Eva in Soprano 1 + Selma in Soprano 2).
		expect(row(container, 'sec-sop').textContent?.replace(/\s+/g, ' ').trim()).toBe('Soprano (3)');

		const list = q(container, 'roster-arrange-list') as HTMLElement;
		expect(list.querySelectorAll('[data-testid^="section-drag-handle-"]')).toHaveLength(0);
	});

	it('roving tabindex: exactly one row sits at tabindex="0" (the first, initially)', async () => {
		const container = await renderInArrangeMode();

		const rows = [...container.querySelectorAll<HTMLElement>('[data-testid^="arrange-row-"]')];
		const zeroTab = rows.filter((r) => r.getAttribute('tabindex') === '0');
		expect(zeroTab).toHaveLength(1);
		expect(zeroTab[0]).toBe(row(container, 'sec-sop'));
		for (const r of rows) {
			if (r !== zeroTab[0]) expect(r.getAttribute('tabindex')).toBe('-1');
		}
	});
});

// ── native drag/drop reorder ──────────────────────────────────────────────────

describe('/roster — arrange-mode drag/drop reorders through the SAME write seam (#155/S2)', () => {
	it('downward drag: Soprano dropped onto Tenor takes Tenor\'s slot → reorderSections(cfg, ["sec-alto","sec-tenor","sec-sop"]); the row order re-renders, INCLUDING Soprano\'s subtree moving with it', async () => {
		const container = await renderInArrangeMode();
		expect(rowOrder(container)).toEqual([
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'arrange-row-sec-alto',
			'arrange-row-sec-tenor'
		]);

		await dragAndDrop(container, 'sec-sop', 'sec-tenor');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-alto', 'sec-tenor', 'sec-sop']);
		await waitFor(() => {
			expect(rowOrder(container)).toEqual([
				'arrange-row-sec-alto',
				'arrange-row-sec-tenor',
				'arrange-row-sec-sop',
				'arrange-row-sec-sop1',
				'arrange-row-sec-sop2'
			]);
		});
	});

	it('a sub-section dropped on a non-sibling top-level row does NOTHING — no call, no move', async () => {
		const container = await renderInArrangeMode();
		const before = rowOrder(container);

		await dragAndDrop(container, 'sec-sop1', 'sec-alto');

		expect(reorderMock).not.toHaveBeenCalled();
		expect(rowOrder(container)).toEqual(before);
	});

	it('sub-sections reorder within their PARENT group only: Soprano 1 dropped onto Soprano 2 swaps just the two children', async () => {
		const container = await renderInArrangeMode();

		await dragAndDrop(container, 'sec-sop1', 'sec-sop2');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-sop2', 'sec-sop1']);
		await waitFor(() => {
			expect(rowOrder(container)).toEqual([
				'arrange-row-sec-sop',
				'arrange-row-sec-sop2',
				'arrange-row-sec-sop1',
				'arrange-row-sec-alto',
				'arrange-row-sec-tenor'
			]);
		});
	});

	it('a failed write reconciles against the server (same AC-8 contract as the collapsed-header drag)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderInArrangeMode();
		reorderMock.mockRejectedValue(new Error('reorder boom'));

		await dragAndDrop(container, 'sec-sop', 'sec-alto');

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(rowOrder(container)).toEqual([
				'arrange-row-sec-sop',
				'arrange-row-sec-sop1',
				'arrange-row-sec-sop2',
				'arrange-row-sec-alto',
				'arrange-row-sec-tenor'
			]);
		});
		expect(consoleSpy).toHaveBeenCalled();
		expect(q(container, 'section-reorder-error')).not.toBeNull();
		consoleSpy.mockRestore();
	});
});

// ── visual feedback: data-grabbed + subtree grouping ──────────────────────────

describe('/roster — data-grabbed + subtree visual grouping (#155/S2 point 3)', () => {
	it('a live native drag on Soprano marks its row data-grabbed="true" and BOTH children data-grabbed-subtree="true"; siblings get neither', async () => {
		const container = await renderInArrangeMode();
		const dataTransfer = makeDataTransfer();

		await fireEvent.dragStart(row(container, 'sec-sop'), { dataTransfer });

		await waitFor(() => {
			expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBe('true');
		});
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed-subtree')).toBe('true');
		expect(row(container, 'sec-sop2').getAttribute('data-grabbed-subtree')).toBe('true');
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed')).toBeNull();
		expect(row(container, 'sec-alto').getAttribute('data-grabbed-subtree')).toBeNull();
		expect(row(container, 'sec-alto').getAttribute('data-grabbed')).toBeNull();

		await fireEvent.dragEnd(row(container, 'sec-sop'), { dataTransfer });
		await waitFor(() => {
			expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
		});
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed-subtree')).toBeNull();
	});

	it('aria-grabbed reflects the live drag on the dragged row only', async () => {
		const container = await renderInArrangeMode();
		const dataTransfer = makeDataTransfer();

		expect(row(container, 'sec-sop').getAttribute('aria-grabbed')).toBe('false');
		await fireEvent.dragStart(row(container, 'sec-sop'), { dataTransfer });
		await waitFor(() => {
			expect(row(container, 'sec-sop').getAttribute('aria-grabbed')).toBe('true');
		});
		expect(row(container, 'sec-alto').getAttribute('aria-grabbed')).toBe('false');
	});
});

// ── #155/S2 review F2: drop-slot indicator + a distinct held-subtree tint ─────

/** Direct children of the arrange list, in document order — rows AND the dashed
 *  drop indicator, so a hint's SLOT (which side of which row) is assertable. */
function listSlots(container: HTMLElement): string[] {
	const list = q(container, 'roster-arrange-list') as HTMLElement;
	return [...list.children].map((el) => el.getAttribute('data-testid') ?? '?');
}

/** Alto ▸ —; Soprano ▸ [Soprano 1, Soprano 2]; Tenor — the parent-with-children
 *  sits in the MIDDLE, so a DOWNWARD drag onto it can prove the hint lands
 *  after its whole subtree rather than wedged between it and its children. */
function fixtureTreeAltFirst(): SectionNode[] {
	return [
		{ id: 'sec-alto', name: 'Alto', displayOrder: 1, parentId: null, depth: 0, children: [] },
		{
			id: 'sec-sop',
			name: 'Soprano',
			displayOrder: 2,
			parentId: null,
			depth: 0,
			children: [
				{ id: 'sec-sop1', name: 'Soprano 1', displayOrder: 1, parentId: 'sec-sop', depth: 1, children: [] },
				{ id: 'sec-sop2', name: 'Soprano 2', displayOrder: 2, parentId: 'sec-sop', depth: 1, children: [] }
			]
		},
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, depth: 0, children: [] }
	];
}

describe('/roster — arrange-mode drop indicator (#155/S2 review F2)', () => {
	it('an UPWARD drag hints ABOVE the target row — one indicator, in that slot', async () => {
		const container = await renderInArrangeMode();
		const dataTransfer = makeDataTransfer();

		await fireEvent.dragStart(row(container, 'sec-tenor'), { dataTransfer });
		await fireEvent.dragOver(row(container, 'sec-sop'), { dataTransfer });

		await waitFor(() => {
			expect(listSlots(container).filter((t) => t === 'section-drop-indicator')).toHaveLength(1);
		});
		const slots = listSlots(container);
		expect(slots.indexOf('section-drop-indicator')).toBe(slots.indexOf('arrange-row-sec-sop') - 1);

		await fireEvent.dragEnd(row(container, 'sec-tenor'), { dataTransfer });
		await waitFor(() => {
			expect(listSlots(container)).not.toContain('section-drop-indicator');
		});
	});

	it('a DOWNWARD drag onto a PARENT hints after that parent’s whole SUBTREE, not between it and its children', async () => {
		listSectionsMock.mockResolvedValue(fixtureTreeAltFirst());
		const container = await renderInArrangeMode();
		const dataTransfer = makeDataTransfer();

		await fireEvent.dragStart(row(container, 'sec-alto'), { dataTransfer });
		await fireEvent.dragOver(row(container, 'sec-sop'), { dataTransfer });

		await waitFor(() => {
			expect(listSlots(container)).toContain('section-drop-indicator');
		});
		expect(listSlots(container)).toEqual([
			'arrange-row-sec-alto',
			'arrange-row-sec-sop',
			'arrange-row-sec-sop1',
			'arrange-row-sec-sop2',
			'section-drop-indicator',
			'arrange-row-sec-tenor'
		]);
	});

	it('a DOWNWARD drag onto the LAST row hints at the end of the list', async () => {
		const container = await renderInArrangeMode();
		const dataTransfer = makeDataTransfer();

		await fireEvent.dragStart(row(container, 'sec-sop'), { dataTransfer });
		await fireEvent.dragOver(row(container, 'sec-tenor'), { dataTransfer });

		await waitFor(() => {
			expect(listSlots(container)).toContain('section-drop-indicator');
		});
		const slots = listSlots(container);
		expect(slots[slots.length - 1]).toBe('section-drop-indicator');
		expect(slots.filter((t) => t === 'section-drop-indicator')).toHaveLength(1);
	});

	it('a NON-sibling hover draws no hint at all (same refusal the drop makes)', async () => {
		const container = await renderInArrangeMode();
		const dataTransfer = makeDataTransfer();

		await fireEvent.dragStart(row(container, 'sec-sop1'), { dataTransfer });
		await fireEvent.dragOver(row(container, 'sec-alto'), { dataTransfer });

		expect(listSlots(container)).not.toContain('section-drop-indicator');
	});

	it('the held SUBTREE and the DROP TARGET are tinted differently', async () => {
		const container = await renderInArrangeMode();
		const dataTransfer = makeDataTransfer();

		await fireEvent.dragStart(row(container, 'sec-sop'), { dataTransfer });
		await fireEvent.dragOver(row(container, 'sec-alto'), { dataTransfer });

		await waitFor(() => {
			expect(row(container, 'sec-alto').className).toContain('bg-ink-5');
		});
		expect(row(container, 'sec-sop1').className).toContain('bg-indigo-soft');
		expect(row(container, 'sec-sop1').className).not.toContain('bg-ink-5');
		expect(row(container, 'sec-alto').className).not.toContain('bg-indigo-soft');
	});
});

// ── keyboard: grab / move / drop / cancel, transferred from #152 ─────────────

describe('/roster — keyboard grab/move/drop/cancel on arrange rows (#155/S2, transferred from #152)', () => {
	it('Space grabs the focused row: data-grabbed appears, aria-grabbed flips true, and "Grabbed X" is announced', async () => {
		const container = await renderInArrangeMode();
		const target = row(container, 'sec-sop');
		target.focus();

		await fireEvent.keyDown(target, { key: ' ' });

		await waitFor(() => {
			expect(target.getAttribute('data-grabbed')).toBe('true');
		});
		expect(target.getAttribute('aria-grabbed')).toBe('true');
		// Lenient message mock returns the KEY, not real copy (real wording is
		// Comenius's) — "Grabbed {name}" is `roster_section_grabbed`.
		expect(q(container, 'roster-reorder-status')?.textContent).toContain('roster_section_grabbed');
	});

	it('ArrowDown while grabbed moves the row (and its subtree) one sibling slot PROVISIONALLY — no write yet — then Enter DROPS and commits via reorderSections', async () => {
		const container = await renderInArrangeMode();
		let target = row(container, 'sec-sop');
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		await fireEvent.keyDown(target, { key: 'ArrowDown' });

		// Provisional: Soprano (+ its two children) now sits after Alto, nothing written yet.
		await waitFor(() => {
			expect(rowOrder(container)).toEqual([
				'arrange-row-sec-alto',
				'arrange-row-sec-sop',
				'arrange-row-sec-sop1',
				'arrange-row-sec-sop2',
				'arrange-row-sec-tenor'
			]);
		});
		expect(reorderMock).not.toHaveBeenCalled();
		expect(q(container, 'roster-reorder-status')?.textContent).toBeTruthy();

		// Focus followed the moved row — re-fetch it before dropping.
		target = row(container, 'sec-sop');
		await fireEvent.keyDown(target, { key: 'Enter' });

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-alto', 'sec-sop', 'sec-tenor']);
		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
	});

	it('Escape cancels a grab: the pre-grab order is restored, nothing is written, and the row is no longer marked grabbed', async () => {
		const container = await renderInArrangeMode();
		const target = row(container, 'sec-sop');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
		await fireEvent.keyDown(target, { key: 'ArrowDown' });
		await waitFor(() => {
			expect(rowOrder(container)[0]).toBe('arrange-row-sec-alto');
		});

		await fireEvent.keyDown(row(container, 'sec-sop'), { key: 'Escape' });

		await waitFor(() => {
			expect(rowOrder(container)).toEqual([
				'arrange-row-sec-sop',
				'arrange-row-sec-sop1',
				'arrange-row-sec-sop2',
				'arrange-row-sec-alto',
				'arrange-row-sec-tenor'
			]);
		});
		expect(reorderMock).not.toHaveBeenCalled();
		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
	});

	it('ArrowUp/ArrowDown clamp at the sibling group\'s bounds — no wrap, no error', async () => {
		const container = await renderInArrangeMode();
		const target = row(container, 'sec-sop');
		target.focus();
		await fireEvent.keyDown(target, { key: ' ' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));

		// Soprano is already first among its siblings — ArrowUp must no-op.
		await fireEvent.keyDown(row(container, 'sec-sop'), { key: 'ArrowUp' });
		await waitFor(() => {
			expect(rowOrder(container)[0]).toBe('arrange-row-sec-sop');
		});

		await fireEvent.keyDown(row(container, 'sec-sop'), { key: 'Escape' });
	});

	it('idle-state ArrowDown roves focus to the next row without grabbing it', async () => {
		const container = await renderInArrangeMode();
		const first = row(container, 'sec-sop');
		first.focus();

		await fireEvent.keyDown(first, { key: 'ArrowDown' });

		await waitFor(() => {
			expect(row(container, 'sec-sop1').getAttribute('tabindex')).toBe('0');
		});
		expect(first.getAttribute('tabindex')).toBe('-1');
		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
		expect(reorderMock).not.toHaveBeenCalled();
	});
});

// ── reuse: reorderPending in-flight guard ─────────────────────────────────────

describe('/roster — an in-flight arrange-mode reorder blocks a second one (reuses reorderPending)', () => {
	it('a second drop while the first write is outstanding is refused; rows visibly disable (draggable="false")', async () => {
		let release!: () => void;
		reorderMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		const container = await renderInArrangeMode();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(row(container, 'sec-tenor').getAttribute('draggable')).toBe('false');
		});

		await dragAndDrop(container, 'sec-tenor', 'sec-sop');
		expect(reorderMock).toHaveBeenCalledTimes(1);

		release();
		await waitFor(() => {
			expect(row(container, 'sec-tenor').getAttribute('draggable')).toBe('true');
		});
	});

	// #155/S2 review F3 — the in-flight refusal must not wash the list out. The
	// collapsed view's `opacity-30` lived on the ≡ glyph; on a whole row it made
	// every section name and count unreadable for the length of the write.
	it('the in-flight state does not dim the rows — names and counts stay legible', async () => {
		reorderMock.mockImplementation(() => new Promise<void>(() => {}));
		const container = await renderInArrangeMode();

		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		await waitFor(() => {
			expect(row(container, 'sec-tenor').getAttribute('draggable')).toBe('false');
		});

		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			expect(row(container, id).className, `row ${id}`).not.toContain('opacity-30');
			expect(row(container, id).className, `row ${id}`).toContain('cursor-default');
		}
		expect(row(container, 'sec-tenor').textContent?.replace(/\s+/g, ' ').trim()).toBe('Tenor (1)');
	});
});

// ── touch: long-press the grip, drag, release ────────────────────────────────

describe('/roster — arrange-mode TOUCH long-press reorders too (#155/S2 review F4/F5)', () => {
	// happy-dom has no layout, so `elementFromPoint` always returns null. Stub it
	// with an explicit y → row map: what these pin is the hit-testing LOGIC over
	// arrange rows (`sectionIdUnderPointer` learned an `arrange-row-` branch and a
	// second prefix to strip), not browser geometry.
	function stubHitTest(container: HTMLElement, yToId: Record<number, string>) {
		return vi
			.spyOn(document, 'elementFromPoint')
			.mockImplementation((_x: number, y: number) =>
				yToId[y] ? container.querySelector(`[data-testid="arrange-row-${yToId[y]}"]`) : null
			);
	}

	const TOUCH = { pointerType: 'touch', pointerId: 1, isPrimary: true } as const;

	function grip(container: HTMLElement, id: string): HTMLElement {
		const el = q(container, `arrange-grip-${id}`);
		expect(el, `grip for ${id}`).not.toBeNull();
		return el as HTMLElement;
	}

	/** Long-press the row's grip until it visibly picks up (no fake timers — the
	 *  affordance IS the readiness signal a finger gets). */
	async function pickUp(container: HTMLElement, id: string, y: number): Promise<HTMLElement> {
		const g = grip(container, id);
		await fireEvent.pointerDown(g, { ...TOUCH, clientX: 10, clientY: y });
		await waitFor(() => {
			expect(row(container, id).getAttribute('data-grabbed')).toBe('true');
		});
		return g;
	}

	// #155/S2 review F4 — the touch pickup is ZONED to the grip precisely so the
	// rest of the row can still scroll the page. `touch-action` is latched when a
	// gesture starts, so this split is the only thing that can give the scroll
	// back: no runtime toggle would arrive in time.
	it('only the narrow grip suppresses touch panning — the row itself stays `pan-y`, so a swipe that starts on a section name still scrolls', async () => {
		const container = await renderInArrangeMode();

		for (const id of ['sec-sop', 'sec-sop1', 'sec-sop2', 'sec-alto', 'sec-tenor']) {
			expect(row(container, id).getAttribute('style'), `row ${id}`).toContain('touch-action: pan-y');
			expect(grip(container, id).getAttribute('style'), `grip ${id}`).toContain('touch-action: none');
		}
	});

	it('the grip carries no text — the row stays named by its own visible label', async () => {
		const container = await renderInArrangeMode();

		expect(grip(container, 'sec-sop').textContent?.trim()).toBe('');
		expect(grip(container, 'sec-sop').getAttribute('aria-hidden')).toBe('true');
		expect(row(container, 'sec-sop').textContent?.replace(/\s+/g, ' ').trim()).toBe('Soprano (3)');
	});

	it("long-press Soprano's grip, drag onto Tenor, release → the SAME single reorderSections write the drop makes, with the subtree marked as held throughout", async () => {
		const container = await renderInArrangeMode();
		stubHitTest(container, { 10: 'sec-sop', 90: 'sec-tenor' });

		const g = await pickUp(container, 'sec-sop', 10);
		// The held row's whole subtree travels with it — the same grouping the
		// keyboard grab and the native drag paint.
		expect(row(container, 'sec-sop1').getAttribute('data-grabbed-subtree')).toBe('true');
		expect(row(container, 'sec-sop2').getAttribute('data-grabbed-subtree')).toBe('true');

		await fireEvent.pointerMove(g, { ...TOUCH, clientX: 10, clientY: 90 });
		// A touch drag gets no browser-drawn drag image, so the target affordance
		// has to be ours.
		await waitFor(() => {
			expect(row(container, 'sec-tenor').className).toContain('bg-ink-5');
		});
		await fireEvent.pointerUp(g, { ...TOUCH, clientX: 10, clientY: 90 });

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith(CFG, ['sec-alto', 'sec-tenor', 'sec-sop']);
		await waitFor(() => {
			expect(rowOrder(container)).toEqual([
				'arrange-row-sec-alto',
				'arrange-row-sec-tenor',
				'arrange-row-sec-sop',
				'arrange-row-sec-sop1',
				'arrange-row-sec-sop2'
			]);
		});
		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
	});

	it('a SCROLL is not a drag: drifting past the slop before the long-press completes cancels the pickup, and the release writes nothing', async () => {
		const container = await renderInArrangeMode();
		stubHitTest(container, { 10: 'sec-sop', 90: 'sec-tenor' });

		const g = grip(container, 'sec-sop');
		await fireEvent.pointerDown(g, { ...TOUCH, clientX: 10, clientY: 10 });
		// Finger travels immediately — that gesture is a scroll, not a pickup.
		await fireEvent.pointerMove(g, { ...TOUCH, clientX: 10, clientY: 90 });
		await new Promise((resolve) => setTimeout(resolve, 500));
		await fireEvent.pointerUp(g, { ...TOUCH, clientX: 10, clientY: 90 });

		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('releasing a long-press over a NON-SIBLING row does nothing — the sibling constraint holds on touch exactly as it does on drop', async () => {
		const container = await renderInArrangeMode();
		stubHitTest(container, { 30: 'sec-sop1', 90: 'sec-tenor' });
		const before = rowOrder(container);

		const g = await pickUp(container, 'sec-sop1', 30);
		await fireEvent.pointerMove(g, { ...TOUCH, clientX: 10, clientY: 90 });
		await fireEvent.pointerUp(g, { ...TOUCH, clientX: 10, clientY: 90 });

		expect(reorderMock).not.toHaveBeenCalled();
		expect(rowOrder(container)).toEqual(before);
	});

	it('a MOUSE pointerdown on the grip is ignored — the native HTML5 drag owns mouse, and two protocols racing on one gesture would double-write', async () => {
		const container = await renderInArrangeMode();
		stubHitTest(container, { 10: 'sec-sop', 90: 'sec-tenor' });

		const g = grip(container, 'sec-sop');
		await fireEvent.pointerDown(g, { pointerType: 'mouse', pointerId: 2, clientX: 10, clientY: 10 });
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
		await fireEvent.pointerUp(g, { pointerType: 'mouse', pointerId: 2, clientX: 10, clientY: 90 });
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('pointercancel (the system stealing the gesture) aborts the pickup — no write, and the row stops looking held', async () => {
		const container = await renderInArrangeMode();
		stubHitTest(container, { 10: 'sec-sop', 90: 'sec-tenor' });

		const g = await pickUp(container, 'sec-sop', 10);
		await fireEvent.pointerMove(g, { ...TOUCH, clientX: 10, clientY: 90 });
		await fireEvent.pointerCancel(g, { ...TOUCH, clientX: 10, clientY: 90 });

		await waitFor(() => {
			expect(row(container, 'sec-sop').getAttribute('data-grabbed')).toBeNull();
			expect(row(container, 'sec-sop1').getAttribute('data-grabbed-subtree')).toBeNull();
		});
		await fireEvent.pointerUp(g, { ...TOUCH, clientX: 10, clientY: 90 });
		expect(reorderMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — #155/S2 RED)
