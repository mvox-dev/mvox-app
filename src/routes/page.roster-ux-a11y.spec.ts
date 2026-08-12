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
//     WCAG 2.4.3 defect class this page already fixed for the ▲/▼ buttons
//     (#99 F3) and the picker (closeMenu). Focus must land on the confirm
//     button on arm, and back on the restored ✕ on cancel.
//
//   Guards (what TU.2 already carries, so GREEN can't regress it):
//   - remove/confirm/cancel are native <button>s (Enter/Space for free) with
//     contextual m.* aria-labels naming the section;
//   - collapse-all/expand-all is a native <button> whose visible label and
//     aria-label flip truthfully with state;
//   - section headers stay proper disclosures (native <button>,
//     aria-expanded);
//   - the dashed drop-target hint is aria-hidden decoration, the hovered
//     header announces aria-dropeffect="move", the handle announces
//     aria-grabbed, and the labelled ▲/▼ buttons remain the keyboard
//     alternative to the drag;
//   - the reorder result live region (roster-reorder-status) is present from
//     first render with role="status" + aria-live="polite".
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
		roster_section_move_up: (p) => `Move ${p?.name} up`,
		roster_section_move_down: (p) => `Move ${p?.name} down`,
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
			`${p?.name} still has members or sub-sections — nothing was removed.`
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
		await fireEvent.click(q(container, 'section-move-down-sec-sop')!);
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
// 4 — drag-reorder affordances (TU.2 finding #11 + the #99 keyboard path)
// ---------------------------------------------------------------------------
describe('#113 — a11y: drag-reorder (drop-target hint, ARIA drag state, keyboard alternative)', () => {
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

	it('guard: the labelled ▲/▼ buttons remain the keyboard alternative to the drag — native <button>s with contextual m.* labels', async () => {
		const container = await renderReady();
		for (const [testid, label] of [
			['section-move-up-sec-alto', 'Move Alto up'],
			['section-move-down-sec-alto', 'Move Alto down']
		] as const) {
			const btn = q(container, testid) as HTMLElement;
			expect(btn, testid).not.toBeNull();
			expect(btn.tagName).toBe('BUTTON');
			expect(btn.getAttribute('aria-label')).toBe(label);
		}
	});

	it('guard: the reorder result live region is present from first render with role="status" + aria-live="polite"', async () => {
		const container = await renderReady();
		const region = q(container, 'roster-reorder-status') as HTMLElement;
		expect(region).not.toBeNull();
		expect(region.getAttribute('role')).toBe('status');
		expect(region.getAttribute('aria-live')).toBe('polite');
	});
});

// (*MVOX:Tallis*)
