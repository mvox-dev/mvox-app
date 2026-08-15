// @vitest-environment happy-dom
//
// #113 TU.5 RED — a11y pass over the TU.2/#110 sections-UX surfaces on the
// REAL /roster route (./roster/+page.svelte — never a component in isolation,
// per "partial assertions hide bugs"):
//
//   RED (defects the TU.2 pass shipped without):
//   - the reorder loading indicator carries aria-busy but NO explicit
//     aria-live — the pinned contract is belt-and-braces: role="status" +
//     aria-live="polite" + aria-busy="true", matching the page's own
//     roster-reorder-status region;
//   - the two-step remove confirm DESTROYS ITS OWN FOCUS TARGET twice over:
//     arming (✕ → confirm/cancel) unmounts the focused ✕ and cancelling
//     unmounts the focused Cancel, both dropping focus to <body> — the exact
//     WCAG 2.4.3 defect class the picker already fixed (closeMenu). Focus
//     must land on the confirm button on arm, and back on the restored ✕ on
//     cancel.
//
//   Guards (what TU.2 already carries, so GREEN can't regress it):
//   - remove/confirm/cancel are native <button>s (Enter/Space for free) with
//     contextual m.* aria-labels naming the section;
//   - collapse-all/expand-all is a native <button> whose visible label and
//     aria-label flip truthfully with state;
//   - section headers stay proper disclosures (native <button>,
//     aria-expanded);
//   - the dashed drop-target hint is aria-hidden decoration, the hovered
//     header announces aria-dropeffect="move", and the handle announces
//     aria-grabbed;
//   - the reorder result live region (roster-reorder-status) is present from
//     first render with role="status" + aria-live="polite".
//
//   #150 — the labelled ▲/▼ buttons this file used to pin as "the keyboard
//   alternative to the drag" are gone; drag/touch is now the only reorder
//   input.
//
//   #152 RED (section 5 below) — the replacement keyboard path, ON THE HANDLE
//   ITSELF: focusable role="button", Space/Enter grabs, ArrowUp/ArrowDown move
//   the grabbed section one sibling slot per press (provisional, no write),
//   Space/Enter drops and COMMITS through the same reorderSections seam the
//   drag path uses, Escape cancels back to the original order with no write.
//   Every outcome lands in the existing roster-reorder-status live region.
//
//   #152 review fixes:
//   - F1 — the handle's role="button" is honoured for CLICK activation too
//     (detail === 0 only, so no pointer gesture reaches the state machine), and
//     the protocol is discoverable via aria-describedby, not guesswork;
//   - F2 — the COMMITTED drop is announced differently from the PROVISIONAL
//     arrow press, so a screen-reader user can tell "saved" from "moved but not
//     saved yet".
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Paraglide mock: real English strings for the keys the surfaces use today,
// plus a Proxy fallback rendering "<key> <param values...>" so keys ADDED by
// GREEN resolve without this file knowing their names — "the label contains
// the section name" then holds for any key shape that carries the name param.
vi.mock('$lib/paraglide/messages.js', () => {
	const known: Record<string, (p?: Record<string, unknown>) => string> = {
		roster_title: () => 'Roster',
		roster_no_collective: () => 'Select a collective to view the roster.',
		roster_load_error: () => 'Something went wrong loading the roster.',
		roster_retry: () => 'Retry',
		roster_empty: () => 'No members to show yet.',
		roster_unassigned: () => 'Unassigned',
		roster_column_name: () => 'Name',
		roster_sort_alphabetical: () => 'Sort A–Z',
		roster_sort_grouped: () => 'Group by section',
		roster_sections_load_error: () =>
			"Section grouping couldn't be loaded — showing the flat list instead.",
		roster_new_section: () => '+ New section…',
		roster_section_drag_handle: (p) => `Drag to reorder ${p?.name}`,
		roster_section_moved: (p) => `${p?.name} moved to position ${p?.position} of ${p?.total}`,
		roster_section_reorder_failed: () => "The new order couldn't be saved.",
		roster_section_reorder_pending: () => 'Saving new order…',
		roster_sections_expand_all: () => 'Expand all sections',
		roster_sections_collapse_all: () => 'Collapse all sections',
		roster_section_remove: (p) => `Remove ${p?.name}`,
		roster_section_remove_confirm_short: () => 'Remove?',
		roster_section_remove_confirm: (p) => `Confirm removing ${p?.name}`,
		roster_section_remove_cancel_short: () => 'Cancel',
		roster_section_remove_cancel: (p) => `Keep ${p?.name}`,
		roster_section_remove_failed: (p) => `${p?.name} couldn't be removed — the section is still there.`,
		roster_section_remove_not_empty: (p) =>
			`${p?.name} still has members or sub-sections — nothing was removed.`,
		// #152 — the keyboard-cancel announcement. The key name is a proposal: the
		// tests below assert /cancel/i + the section name, so a GREEN that names
		// the key differently still passes through the Proxy fallback as long as
		// "cancel" appears in the key or its text.
		roster_section_move_cancelled: (p) => `${p?.name} — move cancelled.`,
		// #152 review F2 — the two announcements the drop path has to keep
		// DISTINCT: "moved" is provisional (an arrow press, nothing written),
		// "dropped" is committed (the write landed).
		roster_section_grabbed: (p) => `Grabbed ${p?.name}.`,
		roster_section_dropped: (p) => `Dropped ${p?.name} at position ${p?.position} of ${p?.total}.`,
		roster_section_reorder_instructions: () =>
			'Press Space to grab, arrow keys to move, Space to drop, Escape to cancel.'
	};
	const m = new Proxy(known, {
		get(target, prop) {
			const key = String(prop);
			if (key in target) return target[key];
			return (params?: Record<string, unknown>) =>
				[key, ...(params ? Object.values(params).map(String) : [])].join(' ');
		}
	});
	return { m };
});

// Page seams — the same mock set as page.roster-sections-ux.spec.ts:
// groupBySection runs REAL, only the fetch seams and the write seams are
// mocked (deleteSection included — TU.2's remove path fires it).
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
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────
// Soprano (one member), Alto (one member), Tenor (EMPTY leaf — the remove
// control's home), all same-org roots so canRemove's own-org gate passes.

function fixtureTree(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, orgId: 'org-1', depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, orgId: 'org-1', depth: 0, children: [] },
		{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, orgId: 'org-1', depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: ['sec-sop'],
			orgId: 'org-1'
		},
		{
			memberId: 'm-bea',
			personId: 'p-bea',
			name: 'Bea Noe',
			email: '',
			sectionIds: ['sec-alto'],
			orgId: 'org-1'
		}
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

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Render the real route ready. Sections stay in their TU.2 default state
 *  (COLLAPSED) — every surface this file exercises (reorder controls, remove
 *  controls, headers, toggle-all) renders on collapsed headers. */
async function renderReady(admin: AdminState = 'admin'): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set(admin);
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	return container;
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

// #150 — the ▲/▼ buttons this file used to click to trigger a reorder are
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

// ---------------------------------------------------------------------------
// 1 — the reorder loading indicator (TU.2 finding #6)
// ---------------------------------------------------------------------------
describe('#113 — a11y: reorder loading indicator (aria-busy + aria-live)', () => {
	async function renderWithPendingReorder(): Promise<{
		container: HTMLElement;
		pending: HTMLElement;
		settle: () => void;
	}> {
		let settle!: () => void;
		reorderMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					settle = res;
				})
		);
		const container = await renderReady();
		await dragAndDrop(container, 'sec-sop', 'sec-alto');
		let pending!: HTMLElement;
		await waitFor(() => {
			const el = q(container, 'section-reorder-pending');
			expect(el).not.toBeNull();
			pending = el as HTMLElement;
		});
		return { container, pending, settle };
	}

	it('RED: the indicator carries BOTH aria-busy="true" AND an explicit aria-live="polite" while the write is outstanding', async () => {
		const { pending, settle } = await renderWithPendingReorder();
		expect(pending.getAttribute('aria-busy')).toBe('true');
		// role="status" implies polite on modern AT, but the page's own precedent
		// (roster-reorder-status) is explicit aria-live — the pinned contract is
		// both, so older AT that only honours the attribute still announces it.
		expect(pending.getAttribute('aria-live')).toBe('polite');
		settle();
	});

	it('guard: the indicator text comes from m.* and the spinner glyph is aria-hidden decoration', async () => {
		const { pending, settle } = await renderWithPendingReorder();
		expect(pending.textContent).toContain('Saving new order…');
		const spinner = pending.querySelector('[aria-hidden="true"]');
		expect(spinner, 'spinner element must be aria-hidden').not.toBeNull();
		settle();
	});

	it('guard: the indicator (and its aria-busy claim) leaves the page once the write settles', async () => {
		const { container, settle } = await renderWithPendingReorder();
		settle();
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).toBeNull();
		});
	});
});

// ---------------------------------------------------------------------------
// 2 — the two-step remove confirm (TU.2 findings #7/F4)
// ---------------------------------------------------------------------------
describe('#113 — a11y: empty-section remove confirm (labels + focus order)', () => {
	it('guard: the remove control is a native <button> with a contextual aria-label naming the section', async () => {
		const container = await renderReady();
		const remove = q(container, 'section-remove-sec-tenor') as HTMLElement;
		expect(remove, 'empty leaf Tenor must offer the admin remove control').not.toBeNull();
		expect(remove.tagName).toBe('BUTTON');
		expect(remove.getAttribute('aria-label')).toContain('Tenor');
	});

	it('guard: arming swaps in native confirm/cancel <button>s, each with a contextual aria-label naming the section', async () => {
		const container = await renderReady();
		await fireEvent.click(q(container, 'section-remove-sec-tenor')!);
		const confirm = q(container, 'section-remove-confirm-sec-tenor') as HTMLElement;
		const cancel = q(container, 'section-remove-cancel-sec-tenor') as HTMLElement;
		expect(confirm).not.toBeNull();
		expect(cancel).not.toBeNull();
		expect(confirm.tagName).toBe('BUTTON');
		expect(cancel.tagName).toBe('BUTTON');
		expect(confirm.getAttribute('aria-label')).toContain('Tenor');
		expect(cancel.getAttribute('aria-label')).toContain('Tenor');
	});

	it('RED: arming moves focus to the confirm button — the ✕ just unmounted under the user, focus must not drop to <body> (WCAG 2.4.3)', async () => {
		const container = await renderReady();
		const remove = q(container, 'section-remove-sec-tenor') as HTMLElement;
		remove.focus();
		expect(document.activeElement).toBe(remove); // precondition, not the assertion
		await fireEvent.click(remove);
		const confirm = await waitFor(() => {
			const el = q(container, 'section-remove-confirm-sec-tenor');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(document.activeElement, 'focus must land on the confirm button').toBe(confirm);
	});

	it('RED: cancelling returns focus to the restored ✕ remove button — Cancel unmounts itself, focus must not drop to <body>', async () => {
		const container = await renderReady();
		const remove = q(container, 'section-remove-sec-tenor') as HTMLElement;
		remove.focus();
		await fireEvent.click(remove);
		const cancel = await waitFor(() => {
			const el = q(container, 'section-remove-cancel-sec-tenor');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		cancel.focus();
		await fireEvent.click(cancel);
		const restored = await waitFor(() => {
			const el = q(container, 'section-remove-sec-tenor');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(document.activeElement, 'focus must return to the remove button').toBe(restored);
	});

	// #113 review F1 — the COMPLETING transition, missing from the RED pair
	// above: arm and cancel were pinned, the successful remove (the only
	// irreversible one of the three) was not.
	it('a SUCCESSFUL remove moves focus to the previous sibling header — the Confirm button unmounts with the whole group, focus must not drop to <body> (WCAG 2.4.3)', async () => {
		const container = await renderReady();
		const remove = q(container, 'section-remove-sec-tenor') as HTMLElement;
		remove.focus();
		await fireEvent.click(remove);
		const confirm = await waitFor(() => {
			const el = q(container, 'section-remove-confirm-sec-tenor');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		confirm.focus();
		await fireEvent.click(confirm);
		await waitFor(() => {
			expect(q(container, 'section-group-sec-tenor'), 'Tenor must be gone').toBeNull();
		});
		// Tenor is the LAST root sibling — Alto is the row it sat under.
		const alto = q(container, 'section-toggle-sec-alto') as HTMLElement;
		expect(alto).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement, 'focus must land on the previous sibling header').toBe(alto);
		});
	});

	it('a SUCCESSFUL remove announces itself in a role="status" live region naming the section — the one outcome with neither an alert nor a status before', async () => {
		const container = await renderReady();
		const region = q(container, 'roster-section-remove-status') as HTMLElement;
		expect(region, 'the remove live region must exist from first render').not.toBeNull();
		expect(region.getAttribute('role')).toBe('status');
		expect(region.getAttribute('aria-live')).toBe('polite');
		expect(region.textContent?.trim(), 'nothing announced before a removal').toBe('');
		await fireEvent.click(q(container, 'section-remove-sec-tenor')!);
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor')!);
		await waitFor(() => {
			expect(q(container, 'roster-section-remove-status')!.textContent).toContain('Tenor');
		});
	});

	it('a REFUSED remove returns focus to the restored ✕ — the tree comes back, so the control the user pressed does too', async () => {
		deleteMock.mockRejectedValue(new Error('403'));
		const container = await renderReady();
		const remove = q(container, 'section-remove-sec-tenor') as HTMLElement;
		remove.focus();
		await fireEvent.click(remove);
		const confirm = await waitFor(() => {
			const el = q(container, 'section-remove-confirm-sec-tenor');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		confirm.focus();
		await fireEvent.click(confirm);
		const restored = await waitFor(() => {
			const el = q(container, 'section-remove-sec-tenor');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(restored);
		});
		// …and the failure is an ALERT, not a status: the live region stays empty.
		expect(q(container, 'roster-section-remove-status')!.textContent?.trim()).toBe('');
	});

	it('guard: a failed remove announces via role="alert" naming the section (pinning TU.2 F1 against regression)', async () => {
		deleteMock.mockRejectedValue(new Error('403'));
		const container = await renderReady();
		await fireEvent.click(q(container, 'section-remove-sec-tenor')!);
		await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor')!);
		await waitFor(() => {
			const alert = q(container, 'section-remove-error');
			expect(alert).not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('Tenor');
		});
	});
});

// ---------------------------------------------------------------------------
// 3 — collapse/expand: headers + the toggle-all control (TU.2 finding #9)
// ---------------------------------------------------------------------------
describe('#113 — a11y: collapse/expand controls', () => {
	it('guard: every section header toggle is a native <button> reporting aria-expanded (Enter/Space operability for free)', async () => {
		const container = await renderReady();
		for (const id of ['sec-sop', 'sec-alto', 'sec-tenor']) {
			const toggle = q(container, `section-toggle-${id}`) as HTMLElement;
			expect(toggle, `toggle for ${id}`).not.toBeNull();
			expect(toggle.tagName).toBe('BUTTON');
			expect(toggle.getAttribute('aria-expanded')).toBe('false'); // TU.2 default collapsed
		}
	});

	it('guard: toggling a header flips its aria-expanded and back', async () => {
		const container = await renderReady();
		const toggle = q(container, 'section-toggle-sec-sop') as HTMLElement;
		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
		});
		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(toggle.getAttribute('aria-expanded')).toBe('false');
		});
	});

	it('guard: collapse-all/expand-all is a native <button> whose visible label AND aria-label flip truthfully with state', async () => {
		const container = await renderReady();
		const toggleAll = q(container, 'sections-toggle-all') as HTMLElement;
		expect(toggleAll).not.toBeNull();
		expect(toggleAll.tagName).toBe('BUTTON');
		// Default collapsed → the offer is to expand.
		expect(toggleAll.textContent).toContain('Expand all sections');
		expect(toggleAll.getAttribute('aria-label')).toBe('Expand all sections');
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(toggleAll.textContent).toContain('Collapse all sections');
			expect(toggleAll.getAttribute('aria-label')).toBe('Collapse all sections');
		});
	});

	it('guard: the disclosure caret glyphs are aria-hidden decoration', async () => {
		const container = await renderReady();
		const toggle = q(container, 'section-toggle-sec-sop') as HTMLElement;
		const glyph = toggle.querySelector('[aria-hidden="true"]');
		expect(glyph, 'the ▸/▾ caret must be aria-hidden').not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 4 — drag-reorder affordances (TU.2 finding #11)
// #150 — this page's ONLY keyboard-alternative to the drag (the ▲/▼ buttons)
// has been removed; the replacement keyboard path (ON the handle) is #152 —
// section 5 below defines it.
// ---------------------------------------------------------------------------
describe('#113 — a11y: drag-reorder (drop-target hint, ARIA drag state)', () => {
	it('guard: during a drag-over, the dashed drop-target hint renders as aria-hidden decoration and the hovered header announces aria-dropeffect="move"', async () => {
		const container = await renderReady();
		const dt = makeDataTransfer();
		await fireEvent.dragStart(q(container, 'section-drag-handle-sec-sop')!, { dataTransfer: dt });
		// The handle announces the grab the moment the drag starts.
		expect(q(container, 'section-drag-handle-sec-sop')!.getAttribute('aria-grabbed')).toBe('true');
		const altoHeader = container.querySelector(
			'[data-testid="section-group-sec-alto"] > div[role="group"]'
		) as HTMLElement;
		expect(altoHeader, "Alto's header row").not.toBeNull();
		expect(altoHeader.getAttribute('aria-dropeffect')).toBe('move');
		await fireEvent.dragOver(altoHeader, { dataTransfer: dt });
		await waitFor(() => {
			const hint = q(container, 'section-drop-indicator');
			expect(hint, 'the dashed landing hint').not.toBeNull();
			expect(hint!.getAttribute('aria-hidden')).toBe('true');
		});
		await fireEvent.dragEnd(q(container, 'section-drag-handle-sec-sop')!);
	});

	it('guard: the reorder result live region is present from first render with role="status" + aria-live="polite"', async () => {
		const container = await renderReady();
		const region = q(container, 'roster-reorder-status') as HTMLElement;
		expect(region).not.toBeNull();
		expect(region.getAttribute('role')).toBe('status');
		expect(region.getAttribute('aria-live')).toBe('polite');
	});
});

// ---------------------------------------------------------------------------
// 5 — #152 RED: keyboard section reorder on the drag handle (WCAG 2.1.1)
//
// #150 left the drag handle as the SOLE reorder input: `tabindex="-1"`,
// `role="img"`, no keyboard protocol — a keyboard-only admin cannot reorder
// sections at all. These tests define the replacement contract on the REAL
// route (never a component in isolation, per "partial assertions hide bugs"):
//
//   - the handle is a focusable role="button" with an accessible name naming
//     its section (supersedes the #99 F5 role="img" pin, which was explicitly
//     conditioned on the handle being non-operable);
//   - Space/Enter GRABS (aria-grabbed="true" + a visible affordance);
//   - ArrowUp/ArrowDown move the grabbed section one sibling slot per press —
//     PROVISIONAL: the DOM reorders, focus stays on the moved handle, the live
//     region announces the new position, but NO write fires yet;
//   - Space/Enter while grabbed DROPS: one reorderSections write with the
//     final order (the same seam the drag path commits through), announced in
//     roster-reorder-status;
//   - Escape CANCELS: the original order comes back, no write ever fires, and
//     the cancellation is announced;
//   - top/bottom presses CLAMP (no wrap), and reorderPending refuses a new
//     grab while a write is outstanding.
// ---------------------------------------------------------------------------
describe('#152 — keyboard section reorder on the drag handle', () => {
	function handleOf(container: HTMLElement, id: string): HTMLElement {
		const handle = q(container, `section-drag-handle-${id}`) as HTMLElement;
		expect(handle, `drag handle for ${id}`).not.toBeNull();
		return handle;
	}

	/** Top-level section order as rendered — the observable a keyboard move
	 *  must change (and a cancel must restore). */
	function sectionOrder(container: HTMLElement): string[] {
		return Array.from(
			(q(container, 'roster-groups') as HTMLElement).querySelectorAll(
				'[data-testid^="section-group-"]'
			)
		).map((el) => el.getAttribute('data-testid')!.slice('section-group-'.length));
	}

	/** Focus `id`'s handle and grab it with Space. */
	async function grab(container: HTMLElement, id: string): Promise<HTMLElement> {
		const handle = handleOf(container, id);
		handle.focus();
		await fireEvent.keyDown(handle, { key: ' ' });
		return handle;
	}

	// ── handle accessibility ────────────────────────────────────────────────

	it('the handle is role="button" — it implements a keyboard protocol now, so the #99 F5 role="img" choice (conditioned on non-operability) no longer holds', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		expect(handle.getAttribute('role')).toBe('button');
		expect(handle.getAttribute('role')).not.toBe('img');
	});

	it('the handle carries an accessible name containing the section name, and is not aria-hidden', async () => {
		const container = await renderReady();
		for (const [id, name] of [
			['sec-sop', 'Soprano'],
			['sec-alto', 'Alto'],
			['sec-tenor', 'Tenor']
		] as const) {
			const handle = handleOf(container, id);
			expect(handle.getAttribute('aria-label'), `handle label for ${id}`).toContain(name);
			expect(handle.getAttribute('aria-hidden')).not.toBe('true');
		}
	});

	it('integration: rendered on the real /roster route (admin, sections collapsed), at least one handle sits in the Tab order — tabindex="0" flat or roving, but never every handle at "-1"', async () => {
		const container = await renderReady();
		const handles = ['sec-sop', 'sec-alto', 'sec-tenor'].map((id) => handleOf(container, id));
		// Every handle must carry a tabindex so it can take focus at all…
		for (const handle of handles) {
			expect(handle.getAttribute('tabindex'), 'every handle must carry a tabindex').not.toBeNull();
		}
		// …and at least one must be REACHABLE via Tab (roving tabindex keeps one
		// per composite; a flat tabindex="0" on all of them also satisfies this).
		expect(
			handles.some((handle) => handle.getAttribute('tabindex') === '0'),
			'no handle is in the Tab order — the keyboard path is unreachable'
		).toBe(true);
	});

	it('the handle takes programmatic focus (precondition for every protocol test below)', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		handle.focus();
		expect(document.activeElement).toBe(handle);
	});

	// #152 review F1 — role="button" is a PROMISE of activation, and a large
	// share of AT users deliver activation as a `click`, not a keydown:
	// NVDA/JAWS browse-mode Enter/Space on a role="button" synthesises a click
	// (and browse mode does not switch to focus mode for `button`, so the arrows
	// never reach the handler either), TalkBack/VoiceOver double-tap fires a
	// click, Voice Control / Dragon "click Reorder Soprano" fires a click.
	// Wiring only onkeydown made the branch's own new role a lie for all of
	// them. Synthetic/AT clicks carry `detail === 0`; real pointer clicks (and
	// the click that trails a drag release) carry `detail >= 1`.
	it('an AT-synthesised click (detail 0) GRABS and takes focus — role="button" promises activation, and NVDA/JAWS/TalkBack/Voice Control deliver it as a click', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		// Deliberately NOT focused first: a voice command ("click Reorder
		// Soprano") activates a handle the user never Tab'd to.
		await fireEvent.click(handle, { detail: 0 });

		expect(
			handle.getAttribute('aria-grabbed'),
			'a click-activated role="button" that does nothing is a broken control for every browse-mode / touch-AT / voice user'
		).toBe('true');
		expect(
			document.activeElement,
			'a grab on an UNFOCUSED handle can never be blur-cancelled — the provisional reorder would outlive the gesture'
		).toBe(handle);
	});

	it('an AT-synthesised click while grabbed DROPS and commits — the whole protocol is reachable click-only', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		await fireEvent.click(handle, { detail: 0 });
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		await waitFor(() => {
			expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-sop', 'sec-tenor']);
		});

		await fireEvent.click(handleOf(container, 'sec-sop'), { detail: 0 });

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, [
			'sec-alto',
			'sec-sop',
			'sec-tenor'
		]);
		expect(handleOf(container, 'sec-sop').getAttribute('aria-grabbed')).toBe('false');
	});

	it('a REAL mouse click (detail 1) does NOT grab — the pointer/drag gesture must never fall into the keyboard state machine', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');

		await fireEvent.click(handle, { detail: 1 });

		expect(
			handle.getAttribute('aria-grabbed'),
			'the click that trails a mouse drag release would otherwise leave the handle grabbed'
		).toBe('false');
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('the handle is DESCRIBED by the reorder protocol — Space/arrows/Escape is not guessable from a name that says "drag"', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		const describedBy = handle.getAttribute('aria-describedby');
		expect(describedBy, 'the handle carries no description at all').toBeTruthy();

		const description = container.ownerDocument.getElementById(describedBy!);
		expect(description, `aria-describedby="${describedBy}" points at nothing`).not.toBeNull();
		const text = description!.textContent ?? '';
		expect(text).toMatch(/space/i);
		expect(text).toMatch(/arrow/i);
		expect(text).toMatch(/escape/i);
	});

	it('guard: no drag handle renders for a non-admin — the keyboard path is admin-gated like every other reorder input', async () => {
		const container = await renderReady('not-admin');
		expect(container.querySelector('[data-testid^="section-drag-handle-"]')).toBeNull();
		// …and the protocol description goes with them — nothing references it,
		// and a non-admin should not be told about a control she never gets.
		expect(q(container, 'roster-reorder-instructions')).toBeNull();
	});

	// ── grab / drop protocol ────────────────────────────────────────────────

	it('Space on a focused handle GRABS (aria-grabbed="true" + a visible affordance); Space again drops it — and a no-move drop fires no write', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		const idleClass = handle.className;

		handle.focus();
		await fireEvent.keyDown(handle, { key: ' ' });
		expect(handle.getAttribute('aria-grabbed')).toBe('true');
		expect(
			handle.className,
			'the grabbed state needs a VISIBLE affordance — a class change, not aria alone'
		).not.toBe(idleClass);

		await fireEvent.keyDown(handle, { key: ' ' });
		expect(handle.getAttribute('aria-grabbed')).toBe('false');
		expect(reorderMock, 'a grab dropped in place must not write').not.toHaveBeenCalled();
	});

	it('Enter grabs and drops too — Space/Enter parity on a role="button"', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		handle.focus();
		await fireEvent.keyDown(handle, { key: 'Enter' });
		expect(handle.getAttribute('aria-grabbed')).toBe('true');
		await fireEvent.keyDown(handle, { key: 'Enter' });
		expect(handle.getAttribute('aria-grabbed')).toBe('false');
	});

	it('ArrowUp/ArrowDown on a focused but UNGRABBED handle move nothing — arrows only act inside a grab', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-alto');
		handle.focus();
		await fireEvent.keyDown(handle, { key: 'ArrowUp' });
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('ArrowDown while grabbed moves the section DOWN one position — provisional (no write yet), focus stays on the moved handle, and the move is announced', async () => {
		const container = await renderReady();
		const handle = await grab(container, 'sec-sop');

		await fireEvent.keyDown(handle, { key: 'ArrowDown' });

		await waitFor(() => {
			expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-sop', 'sec-tenor']);
		});
		expect(reorderMock, 'a provisional move must not write — only the drop commits').not.toHaveBeenCalled();
		expect(
			document.activeElement,
			'focus must travel WITH the moved handle (WCAG 2.4.3)'
		).toBe(handleOf(container, 'sec-sop'));
		await waitFor(() => {
			const status = q(container, 'roster-reorder-status') as HTMLElement;
			expect(status.textContent).toContain('Soprano');
			expect(status.textContent).toContain('2');
		});
	});

	it('ArrowUp while grabbed moves the section UP one position — provisional, no write', async () => {
		const container = await renderReady();
		const handle = await grab(container, 'sec-alto');

		await fireEvent.keyDown(handle, { key: 'ArrowUp' });

		await waitFor(() => {
			expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-sop', 'sec-tenor']);
		});
		expect(reorderMock).not.toHaveBeenCalled();
	});

	it('Space while grabbed DROPS: exactly one reorderSections write with the final order, aria-grabbed returns to "false", and the drop announces the final position', async () => {
		const container = await renderReady();
		const handle = await grab(container, 'sec-sop');
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });

		await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: ' ' });

		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, [
			'sec-alto',
			'sec-sop',
			'sec-tenor'
		]);
		expect(handleOf(container, 'sec-sop').getAttribute('aria-grabbed')).toBe('false');
		await waitFor(() => {
			const status = q(container, 'roster-reorder-status') as HTMLElement;
			expect(status.textContent).toContain('Soprano');
			expect(status.textContent).toContain('2');
		});
	});

	// #152 review F2 — the committed drop used to re-announce the byte-identical
	// `roster_section_moved` string the PROVISIONAL arrow press had already put
	// in the live region: a screen-reader user heard "Soprano moved to position 2
	// of 3" on the arrow and the same sentence again once the write landed, with
	// nothing separating "not saved" from "saved". Meanwhile the bespoke
	// `roster_section_dropped` string was reachable ONLY from the no-op drop
	// branch — the one case with nothing to confirm. The words are now split by
	// meaning: "moved" = provisional, "dropped" = written.
	it('the COMMITTED drop announces something different from the provisional arrow press — "saved" must not sound identical to "moved but not saved"', async () => {
		const container = await renderReady();
		const status = () => (q(container, 'roster-reorder-status') as HTMLElement).textContent ?? '';

		const handle = await grab(container, 'sec-sop');
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		let provisional = '';
		await waitFor(() => {
			provisional = status();
			expect(provisional).toContain('Soprano');
			expect(provisional).toContain('moved');
		});

		await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: ' ' });
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(
				status(),
				'the post-drop announcement is byte-identical to the pre-drop one — nothing tells the user the order was actually saved'
			).not.toBe(provisional);
		});
		expect(status()).toContain('Soprano');
		expect(status(), 'the committed drop still has to name the final position').toContain('2');
	});

	it('a FAILED drop does not claim the order was saved — the provisional wording stands and the error alert speaks', async () => {
		reorderMock.mockRejectedValue(new Error('403'));
		const container = await renderReady();
		const status = () => (q(container, 'roster-reorder-status') as HTMLElement).textContent ?? '';

		const handle = await grab(container, 'sec-sop');
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: ' ' });

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		expect(
			status(),
			'a rejected write must never produce a committed-drop announcement'
		).not.toMatch(/dropped/i);
	});

	it('Escape while grabbed CANCELS: the original order comes back, NO write ever fires, and the cancellation is announced naming the section', async () => {
		const container = await renderReady();
		const handle = await grab(container, 'sec-sop');
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		await waitFor(() => {
			expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-sop', 'sec-tenor']);
		});

		await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: 'Escape' });

		await waitFor(() => {
			expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
		});
		expect(reorderMock, 'a cancelled move must never write').not.toHaveBeenCalled();
		expect(handleOf(container, 'sec-sop').getAttribute('aria-grabbed')).toBe('false');
		await waitFor(() => {
			const status = q(container, 'roster-reorder-status') as HTMLElement;
			expect(status.textContent).toMatch(/cancel/i);
			expect(status.textContent).toContain('Soprano');
		});
	});

	// ── clamping ────────────────────────────────────────────────────────────

	it('ArrowUp on the grabbed TOP section is a no-op — clamp, no wrap to the bottom', async () => {
		const container = await renderReady();
		const handle = await grab(container, 'sec-sop');
		await fireEvent.keyDown(handle, { key: 'ArrowUp' });
		expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
		expect(handle.getAttribute('aria-grabbed'), 'the grab survives a clamped press').toBe('true');
	});

	it('ArrowDown on the grabbed BOTTOM section is a no-op — clamp, no wrap to the top', async () => {
		const container = await renderReady();
		const handle = await grab(container, 'sec-tenor');
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
		expect(handle.getAttribute('aria-grabbed')).toBe('true');
	});

	// ── in-flight guard ─────────────────────────────────────────────────────

	it('reorderPending refuses a NEW grab while a reorder write is in flight — and grabbing works again once it settles', async () => {
		let settle!: () => void;
		reorderMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					settle = res;
				})
		);
		const container = await renderReady();

		// Keyboard move + drop → the write is now outstanding.
		const sop = await grab(container, 'sec-sop');
		await fireEvent.keyDown(sop, { key: 'ArrowDown' });
		await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: ' ' });
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).not.toBeNull();
		});

		// A second grab while pending must be refused.
		const tenor = handleOf(container, 'sec-tenor');
		tenor.focus();
		await fireEvent.keyDown(tenor, { key: ' ' });
		expect(
			tenor.getAttribute('aria-grabbed'),
			'a grab while a write is in flight must be refused'
		).toBe('false');

		settle();
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).toBeNull();
		});

		// …and the refusal was the guard, not a broken handle.
		tenor.focus();
		await fireEvent.keyDown(tenor, { key: ' ' });
		expect(tenor.getAttribute('aria-grabbed')).toBe('true');
		await fireEvent.keyDown(tenor, { key: 'Escape' });
	});

	// ── coexistence with the drag path ──────────────────────────────────────

	it('integration: keyboard reorder and drag reorder coexist on the same handle — a keyboard commit then a drag commit both land, in order', async () => {
		const container = await renderReady();

		// Keyboard: Soprano down one, drop. Order: Alto, Soprano, Tenor.
		const sop = await grab(container, 'sec-sop');
		await fireEvent.keyDown(sop, { key: 'ArrowDown' });
		await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: ' ' });
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderMock).toHaveBeenLastCalledWith({ db: 'polyphony', token: 'jwt-abc' }, [
			'sec-alto',
			'sec-sop',
			'sec-tenor'
		]);

		// Drag: Tenor onto Alto (Tenor takes Alto's slot). Order: Tenor, Alto, Soprano.
		await dragAndDrop(container, 'sec-tenor', 'sec-alto');
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(2);
		});
		expect(reorderMock).toHaveBeenLastCalledWith({ db: 'polyphony', token: 'jwt-abc' }, [
			'sec-tenor',
			'sec-alto',
			'sec-sop'
		]);
		await waitFor(() => {
			expect(sectionOrder(container)).toEqual(['sec-tenor', 'sec-alto', 'sec-sop']);
		});
	});

	it('guard: a drag still announces its grab — the keyboard protocol must not break aria-grabbed on the pointer path', async () => {
		const container = await renderReady();
		const handle = handleOf(container, 'sec-sop');
		await fireEvent.dragStart(handle, { dataTransfer: makeDataTransfer() });
		expect(handle.getAttribute('aria-grabbed')).toBe('true');
		await fireEvent.dragEnd(handle);
		expect(handle.getAttribute('aria-grabbed')).toBe('false');
	});

	// ── #152 review F1 — the move indexes the RENDERED list, not the raw tree ──
	//
	// `listSections` is NOT org-scoped and sections are `_sharing: public`, so on
	// a multi-collective db the raw top level holds roots belonging to OTHER
	// collectives. #124/F3 filters those out of the render (`visibleSections`),
	// so a keyboard move that indexes the RAW sibling array is counting slots the
	// user can neither see nor reach: the press appears to do nothing, the live
	// region announces a phantom position/total, and the drop writes a
	// display_order renumbering over another collective's sections.
	describe('a foreign collective\'s root section is never a keyboard landing slot (#152 review F1)', () => {
		/** sec-foreign (org-2) sits BETWEEN Soprano and Alto in the raw tree — it
		 *  is filtered out of the render by #124/F3, so the screen shows
		 *  Soprano, Alto, Tenor. */
		function interleavedForeignTree(): SectionNode[] {
			return [
				{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, orgId: 'org-1', depth: 0, children: [] },
				{ id: 'sec-foreign', name: 'Foreign Bass', displayOrder: 2, parentId: null, orgId: 'org-2', depth: 0, children: [] },
				{ id: 'sec-alto', name: 'Alto', displayOrder: 3, parentId: null, orgId: 'org-1', depth: 0, children: [] },
				{ id: 'sec-tenor', name: 'Tenor', displayOrder: 4, parentId: null, orgId: 'org-1', depth: 0, children: [] }
			];
		}

		/** The foreign root sorts AFTER every visible one — the bottom clamp must
		 *  hold against the RENDERED list, not the raw one. */
		function trailingForeignTree(): SectionNode[] {
			return [
				{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, orgId: 'org-1', depth: 0, children: [] },
				{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, orgId: 'org-1', depth: 0, children: [] },
				{ id: 'sec-tenor', name: 'Tenor', displayOrder: 3, parentId: null, orgId: 'org-1', depth: 0, children: [] },
				{ id: 'sec-foreign', name: 'Foreign Bass', displayOrder: 4, parentId: null, orgId: 'org-2', depth: 0, children: [] }
			];
		}

		it('precondition: the foreign-org root is not rendered at all (#124/F3)', async () => {
			listSectionsMock.mockResolvedValue(interleavedForeignTree());
			const container = await renderReady();
			expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
			expect(q(container, 'section-drag-handle-sec-foreign')).toBeNull();
		});

		it('ArrowDown on the first VISIBLE root swaps it with the next VISIBLE root — the invisible foreign root is not a slot, and the announcement counts only what is on screen', async () => {
			listSectionsMock.mockResolvedValue(interleavedForeignTree());
			const container = await renderReady();
			const handle = await grab(container, 'sec-sop');

			await fireEvent.keyDown(handle, { key: 'ArrowDown' });

			await waitFor(() => {
				expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-sop', 'sec-tenor']);
			});
			const status = q(container, 'roster-reorder-status') as HTMLElement;
			expect(
				status.textContent,
				'position/total must describe the RENDERED list — "2 of 4" names a slot the user cannot see'
			).toContain('Soprano moved to position 2 of 3');
		});

		it('the drop writes only the VISIBLE sibling order — a keyboard reorder never renumbers another collective\'s sections', async () => {
			listSectionsMock.mockResolvedValue(interleavedForeignTree());
			const container = await renderReady();
			const handle = await grab(container, 'sec-sop');
			await fireEvent.keyDown(handle, { key: 'ArrowDown' });

			await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: ' ' });

			await waitFor(() => {
				expect(reorderMock).toHaveBeenCalledTimes(1);
			});
			expect(reorderMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, [
				'sec-alto',
				'sec-sop',
				'sec-tenor'
			]);
		});

		it('ArrowDown on the LAST VISIBLE root is a no-op even when a foreign root sorts after it — the clamp holds against the rendered list', async () => {
			listSectionsMock.mockResolvedValue(trailingForeignTree());
			const container = await renderReady();
			const handle = await grab(container, 'sec-tenor');

			await fireEvent.keyDown(handle, { key: 'ArrowDown' });

			expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
			expect(handle.getAttribute('aria-grabbed'), 'the grab survives a clamped press').toBe('true');
			const status = q(container, 'roster-reorder-status') as HTMLElement;
			expect(
				status.textContent ?? '',
				'a clamped press must announce nothing — not a move onto an invisible slot'
			).not.toMatch(/Tenor moved/);
		});
	});

	// ── #152 review F2 — a grab must not survive focus loss ───────────────────
	//
	// Nothing cancelled the grab when the handle lost focus, so `grabbedSectionId`
	// and the PROVISIONAL (unwritten) reorder outlived the user leaving the
	// control: the screen kept an order the server does not hold (this page never
	// refetches — the #98/F3 "the screen lies" failure mode), and the dangling
	// grab then hijacked the next handle the user pressed an arrow on.
	describe('a keyboard grab is cancelled when the handle loses focus (#152 review F2)', () => {
		it('blur while grabbed CANCELS: the pre-grab order comes back, aria-grabbed returns to "false", and nothing is written', async () => {
			const container = await renderReady();
			const handle = await grab(container, 'sec-sop');
			await fireEvent.keyDown(handle, { key: 'ArrowDown' });
			await waitFor(() => {
				expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-sop', 'sec-tenor']);
			});

			handleOf(container, 'sec-sop').blur();

			await waitFor(() => {
				expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
			});
			expect(handleOf(container, 'sec-sop').getAttribute('aria-grabbed')).toBe('false');
			expect(reorderMock, 'an abandoned grab must never write').not.toHaveBeenCalled();
			await waitFor(() => {
				const status = q(container, 'roster-reorder-status') as HTMLElement;
				expect(status.textContent).toMatch(/cancel/i);
				expect(status.textContent).toContain('Soprano');
			});
		});

		it('after that blur, an arrow press on a DIFFERENT handle moves nothing — no grab is left dangling to hijack it', async () => {
			const container = await renderReady();
			const handle = await grab(container, 'sec-sop');
			await fireEvent.keyDown(handle, { key: 'ArrowDown' });
			handleOf(container, 'sec-sop').blur();
			await waitFor(() => {
				expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
			});

			const tenor = handleOf(container, 'sec-tenor');
			expect(tenor.getAttribute('aria-grabbed')).toBe('false');
			tenor.focus();
			await fireEvent.keyDown(tenor, { key: 'ArrowUp' });

			expect(sectionOrder(container)).toEqual(['sec-sop', 'sec-alto', 'sec-tenor']);
			expect(reorderMock).not.toHaveBeenCalled();
		});

		it('a provisional ArrowUp/ArrowDown does NOT self-cancel — a real browser blurs the grabbed handle when the reorder relocates it in the DOM, and that blur is not the user leaving', async () => {
			const container = await renderReady();
			const handle = await grab(container, 'sec-sop');

			// A real browser blurs a focused element when it is relocated in the
			// DOM (the reorder does exactly that, which is why the handler
			// re-focuses afterwards); happy-dom does not, so dispatch it by hand,
			// synchronously inside the move — between the keydown dispatch and the
			// handler's post-tick re-focus. Without the guard this cancels the grab
			// and reverts the move the user just made.
			const moved = fireEvent.keyDown(handle, { key: 'ArrowDown' });
			handle.dispatchEvent(new FocusEvent('blur'));
			await moved;

			await waitFor(() => {
				expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-sop', 'sec-tenor']);
			});
			expect(
				handleOf(container, 'sec-sop').getAttribute('aria-grabbed'),
				'the grab survives its own re-homing of focus'
			).toBe('true');

			// …and the grab is still live enough to keep moving and to commit.
			await fireEvent.keyDown(handleOf(container, 'sec-sop'), { key: 'ArrowDown' });
			await waitFor(() => {
				expect(sectionOrder(container)).toEqual(['sec-alto', 'sec-tenor', 'sec-sop']);
			});
		});
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Tallis* — section 5, #152 keyboard-reorder RED)
// (*MVOX:Byrd* — #152 review F1/F2 RED: org-filtered sibling list, grab cancelled on blur)
