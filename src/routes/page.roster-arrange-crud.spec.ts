// @vitest-environment happy-dom
//
// #155/S4 RED — section CRUD relocated EXCLUSIVELY into Arrange mode
// (integration, on the ACTUAL /roster page route). S1-S3 shipped the arrange
// shell, whole-row reorder, and indent/unindent; this file pins the LAST
// piece GH#155 describes:
//
//   "Tap section name to rename (inline edit)"
//   "Add section available" (already relocated — see
//     page.roster-create-section-entry.spec.ts)
//   "Delete section available"
//   "Other views (collapsed/expanded): Display only — all section management
//    controls removed. No drag handles, no add/rename/delete."
//
// Same integration discipline as page.roster-indent.spec.ts: the REAL page
// renders, only the fetch seams and the sectionActions WRITE seam are mocked.
//
// Pinned wiring contract (GREEN must implement):
//
//   TESTIDS
//     arrange-rename-<id>         rename trigger, per row, ALWAYS rendered
//     arrange-rename-input-<id>   the inline text input rename mode swaps to;
//                                 AUTO-FOCUSED + pre-filled with the current name
//     arrange-rename-error-<id>   role="alert" on a failed rename
//     roster-section-rename-status  role="status" live region, announces success
//     section-remove-<id>         delete trigger, per row, ALWAYS rendered,
//                                 `disabled` when the section has members or
//                                 sub-sections (never simply absent — #155/S4:
//                                 "Disable for sections with children/members")
//     section-remove-confirm-<id> / section-remove-cancel-<id>
//                                 the SAME two-step confirm TU.2/#110 shipped
//
//   RENAME — tap `arrange-rename-<id>` → the row's name becomes a text input
//     pre-filled with the CURRENT name, focused. Enter calls
//     renameSection(cfg, id, <trimmed value>); the local tree updates
//     immediately (optimistic); a rejection REVERTS the name and shows
//     `arrange-rename-error-<id>` (role="alert"). Escape cancels — no write,
//     reverts to display, nothing changed.
//
//   DELETE — reuses deleteSection/the two-step confirm VERBATIM. `disabled`
//     for a section with members or sub-sections; a confirmed delete on an
//     eligible section calls deleteSection(cfg, id) and removes the row.
//
//   STRIP — Collapsed and Expanded views carry NO section-remove-*,
//     arrange-rename-*, or section-drag-handle-* controls anywhere.
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
	deleteMock,
	reparentMock,
	renameMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	reparentMock: vi.fn(),
	renameMock: vi.fn()
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
	reparentSection: reparentMock,
	renameSection: renameMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
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
// Soprano (roll-up 2: Eva in Soprano 1 + Selma in Soprano 2, has children →
// never deletable); Alto (1 member, leaf → not deletable); Bass (0 members,
// leaf → DELETABLE, #155/S4's target).

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
		{ id: 'sec-bass', name: 'Bass', displayOrder: 3, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{ memberId: 'm-eva', personId: 'p-eva', name: 'Eva Green', email: 'eva@x.com', sectionIds: ['sec-sop1'] },
		{ memberId: 'm-sel', personId: 'p-sel', name: 'Selma Otsing', email: 'selma@x.com', sectionIds: ['sec-sop2'] },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: '', sectionIds: ['sec-alto'] }
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
	reparentMock.mockResolvedValue(undefined);
	renameMock.mockResolvedValue(undefined);
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
	renameMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderArrangeReady(admin: AdminState = 'admin') {
	setAuthedWithOneCollective();
	adminStore.set(admin);
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	const arrangeChip = q(container, 'roster-view-chip-arrange') as HTMLElement | null;
	if (arrangeChip) {
		await fireEvent.click(arrangeChip);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
	}
	return container;
}

// ── 1. RENAME ────────────────────────────────────────────────────────────────

describe('/roster — inline RENAME in Arrange mode (#155/S4)', () => {
	it('arrange-rename-<id> renders on every row; tapping it swaps the name for a text input, pre-filled with the CURRENT name and auto-focused', async () => {
		const container = await renderArrangeReady();
		expect(q(container, 'arrange-rename-sec-alto')).not.toBeNull();

		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);

		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		expect(input).not.toBeNull();
		expect(input.value).toBe('Alto');
		await waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
		// The draggable row itself is gone while renaming (no nested-interactive
		// input inside a role="button" row).
		expect(q(container, 'arrange-row-sec-alto')).toBeNull();
	});

	it('Enter saves: renameSection(cfg, id, trimmed) fires, the row shows the NEW name immediately (optimistic, no refetch), and the success is ANNOUNCED', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: '  Alto Voices  ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(renameMock).toHaveBeenCalledTimes(1);
		});
		expect(renameMock).toHaveBeenCalledWith(
			{ db: 'polyphony', token: 'jwt-abc' },
			'sec-alto',
			'Alto Voices'
		);
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-alto')?.textContent).toContain('Alto Voices');
		});
		expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();

		const status = q(container, 'roster-section-rename-status');
		expect(status?.getAttribute('role')).toBe('status');
		await waitFor(() => {
			expect(status?.textContent?.trim()).not.toBe('');
		});
		// LOCAL update — no refetch.
		expect(listSectionsMock).toHaveBeenCalledTimes(1);
	});

	it('Escape cancels: no write, the row reverts to displaying the ORIGINAL name', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'Discarded Name' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-alto')).toBeNull();
		});
		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-row-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-row-sec-alto')?.textContent).not.toContain('Discarded');
	});

	it('a REJECTED rename REVERTS the optimistic name and shows arrange-rename-error-<id> (role="alert")', async () => {
		renameMock.mockRejectedValue(new Error('403'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'Alto Voices' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			const error = q(container, 'arrange-rename-error-sec-alto');
			expect(error).not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
		});
		// The name is back to what the server actually holds.
		expect(q(container, 'arrange-row-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-row-sec-alto')?.textContent).not.toContain('Alto Voices');
		consoleSpy.mockRestore();
	});

	it('a blank/whitespace-only value writes NOTHING and stays in edit mode (same "nothing written" refusal as a blank create)', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: '   ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(renameMock).not.toHaveBeenCalled();
		expect(q(container, 'arrange-rename-input-sec-alto')).not.toBeNull();
	});
});

// ── 2. DELETE ────────────────────────────────────────────────────────────────

describe('/roster — DELETE in Arrange mode is ALWAYS rendered, DISABLED when ineligible (#155/S4)', () => {
	it('Bass (0 members, leaf) — the ✕ is present and ENABLED', async () => {
		const container = await renderArrangeReady();
		const button = q(container, 'section-remove-sec-bass') as HTMLButtonElement;
		expect(button).not.toBeNull();
		expect(button.disabled).toBe(false);
	});

	it('Alto (1 member) — the ✕ is present but DISABLED (has members)', async () => {
		const container = await renderArrangeReady();
		const button = q(container, 'section-remove-sec-alto') as HTMLButtonElement;
		expect(button).not.toBeNull();
		expect(button.disabled).toBe(true);
	});

	it('Soprano (has children) — the ✕ is present but DISABLED (has sub-sections), even though it has no DIRECT members', async () => {
		const container = await renderArrangeReady();
		const button = q(container, 'section-remove-sec-sop') as HTMLButtonElement;
		expect(button).not.toBeNull();
		expect(button.disabled).toBe(true);
	});

	it('a DISABLED delete button ignores a click — no confirm step appears, deleteSection never fires', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-alto') as HTMLElement);
		expect(q(container, 'section-remove-confirm-sec-alto')).toBeNull();
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it('the two-step confirm on an ELIGIBLE section: tap ✕ arms it, tap confirm deletes and the row disappears', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledWith({ db: 'polyphony', token: 'jwt-abc' }, 'sec-bass');
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
	});

	it('cancel disarms the confirm — nothing written, the row stays', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-cancel-sec-bass')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'section-remove-cancel-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'section-remove-sec-bass')).not.toBeNull();
		});
		expect(deleteMock).not.toHaveBeenCalled();
	});
});

// ── 3. STRIP: Collapsed/Expanded are display-only ────────────────────────────

describe('/roster — Collapsed and Expanded views carry NO section-management controls (#155/S4)', () => {
	it('Collapsed (the default): no rename/delete/drag-handle control anywhere on the page', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'roster-view-chip-collapsed') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-groups')).not.toBeNull();
		});

		for (const prefix of ['section-remove-', 'arrange-rename-', 'section-drag-handle-']) {
			expect(
				container.querySelectorAll(`[data-testid^="${prefix}"]`),
				`no "${prefix}*" control anywhere in Collapsed view`
			).toHaveLength(0);
		}
		// #155/S4 review F4 — the SECOND create path, asserted rather than left
		// invisible to this gate. Collapsed renders no member rows, so the
		// member→section picker (and with it its inline create entry) is absent
		// here for free — nothing on this page can create a section in Collapsed.
		expect(container.querySelectorAll('[data-testid^="section-picker"]')).toHaveLength(0);
		expect(q(container, 'section-create-form')).toBeNull();
		// The section header + member count still show (display-only, not gone).
		expect(q(container, 'section-header-sec-bass')?.textContent).toContain('Bass');
	});

	it('Expanded: no rename/delete/drag-handle control anywhere, but member rows still show', async () => {
		const container = await renderArrangeReady();
		await fireEvent.click(q(container, 'roster-view-chip-expanded') as HTMLElement);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});

		for (const prefix of ['section-remove-', 'arrange-rename-', 'section-drag-handle-']) {
			expect(
				container.querySelectorAll(`[data-testid^="${prefix}"]`),
				`no "${prefix}*" control anywhere in Expanded view`
			).toHaveLength(0);
		}
		expect(q(container, 'roster-row-m-bea')).not.toBeNull();

		// #155/S4 review F4 — SCOPE, pinned so it stops being invisible to this
		// gate. "Display only — no add/rename/delete" is about the SECTION-TREE
		// management controls that used to hang off every section header, plus the
		// page-level "+ New section"; all of those moved to Arrange. The
		// member→section PICKER is a different concern (assignment), it has no home
		// in arrange mode at all (arrange renders no member rows), and its inline
		// create entry stays WITH it so an admin assigning a member to a
		// not-yet-existing section can make it in place (#111/#120). See the scope
		// comment at the `<SectionPicker>` render site in roster/+page.svelte.
		expect(
			q(container, 'section-picker-trigger-m-bea'),
			'the member→section picker stays on the member row in Expanded view'
		).not.toBeNull();
		// …and its inline create entry opens from inside it (the picker menu is
		// closed until the trigger is tapped).
		await fireEvent.click(q(container, 'section-picker-trigger-m-bea') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-picker-new')).not.toBeNull();
		});
		// The PAGE-LEVEL add entry, by contrast, is arrange-only.
		expect(q(container, 'roster-new-section')).toBeNull();
	});

	it('non-admin never sees any arrange chip or management control, in either display mode', async () => {
		const container = await renderArrangeReady('not-admin');
		expect(q(container, 'roster-view-chip-arrange')).toBeNull();

		for (const prefix of ['section-remove-', 'arrange-rename-', 'section-drag-handle-', 'roster-new-section']) {
			expect(container.querySelectorAll(`[data-testid^="${prefix}"]`)).toHaveLength(0);
		}
	});
});

// ── 4. SINGLE-FLIGHT: rename/delete join reorder/reparent's one-at-a-time set ──
//
// #155/S4 review F1 — before S4, delete rendered only in collapsed/expanded and
// indent/unindent only in arrange, so no two structural controls could be on
// screen together and each write's private in-flight flag was enough. S4 puts
// rename, delete, indent and unindent on the SAME row: every one of them must
// now refuse while ANY of the others is outstanding, and every failure path must
// reconcile against the SERVER rather than restore a pre-write snapshot that
// cannot know what landed in the meantime.

function deferred(): { promise: Promise<void>; settle: () => void; reject: (e: unknown) => void } {
	let settle!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		settle = () => res();
		reject = rej;
	});
	return { promise, settle, reject };
}

describe('/roster — arrange-mode structural writes are SINGLE-FLIGHT (#155/S4 review F1)', () => {
	it('while a DELETE is in flight, rename/indent/unindent on every OTHER row are disabled and the rows are undraggable', async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect((q(container, 'arrange-rename-sec-alto') as HTMLButtonElement).disabled).toBe(true);
		});
		expect((q(container, 'arrange-indent-sec-alto') as HTMLButtonElement).disabled).toBe(true);
		expect((q(container, 'arrange-unindent-sec-sop1') as HTMLButtonElement).disabled).toBe(true);
		expect(q(container, 'arrange-row-sec-alto')?.getAttribute('draggable')).toBe('false');

		gate.settle();
		await waitFor(() => {
			expect((q(container, 'arrange-rename-sec-alto') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(q(container, 'arrange-row-sec-alto')?.getAttribute('draggable')).toBe('true');
	});

	it('while a REPARENT is in flight, rename and delete are disabled — and section-reorder-pending is on screen with aria-busy, clearing once it settles', async () => {
		const gate = deferred();
		reparentMock.mockImplementation(() => gate.promise);
		const container = await renderArrangeReady();
		expect(q(container, 'section-reorder-pending')).toBeNull();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);

		await waitFor(() => {
			const pending = q(container, 'section-reorder-pending');
			expect(pending).not.toBeNull();
			expect(pending!.getAttribute('role')).toBe('status');
			expect(pending!.getAttribute('aria-busy')).toBe('true');
		});
		expect((q(container, 'arrange-rename-sec-sop') as HTMLButtonElement).disabled).toBe(true);
		expect((q(container, 'section-remove-sec-bass') as HTMLButtonElement).disabled).toBe(true);

		gate.settle();
		await waitFor(() => {
			expect(q(container, 'section-reorder-pending')).toBeNull();
		});
		expect((q(container, 'section-remove-sec-bass') as HTMLButtonElement).disabled).toBe(false);
	});

	it('section-reorder-pending clears when the structural write FAILS too (not only on success)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		reparentMock.mockRejectedValue(new Error('403'));
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'section-reorder-error')).not.toBeNull();
		});
		expect(q(container, 'section-reorder-pending')).toBeNull();
		expect((q(container, 'arrange-rename-sec-sop') as HTMLButtonElement).disabled).toBe(false);
		consoleSpy.mockRestore();
	});

	it('a FAILED rename re-derives the tree from the SERVER (listSections) instead of restoring a stale pre-write snapshot', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		renameMock.mockRejectedValue(new Error('403'));
		const container = await renderArrangeReady();

		// The server tree moved on while the rename was in flight — a section the
		// PRE-WRITE snapshot cannot possibly know about. A blind `sections = before`
		// would discard it; the reconcile keeps it.
		listSectionsMock.mockResolvedValue([
			...fixtureTree(),
			{ id: 'sec-ten', name: 'Tenor', displayOrder: 4, parentId: null, depth: 0, children: [] }
		] satisfies SectionNode[]);

		await fireEvent.click(q(container, 'arrange-rename-sec-alto') as HTMLElement);
		const input = q(container, 'arrange-rename-input-sec-alto') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Alto Voices' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(listSectionsMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-ten')).not.toBeNull();
		});
		// …and the optimistic name is still gone, the server's is what shows.
		expect(q(container, 'arrange-row-sec-alto')?.textContent).toContain('Alto');
		expect(q(container, 'arrange-row-sec-alto')?.textContent).not.toContain('Voices');
		consoleSpy.mockRestore();
	});

	it('a FAILED delete re-derives the tree from the SERVER too', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue(new Error('500'));
		const container = await renderArrangeReady();

		listSectionsMock.mockResolvedValue([
			...fixtureTree(),
			{ id: 'sec-ten', name: 'Tenor', displayOrder: 4, parentId: null, depth: 0, children: [] }
		] satisfies SectionNode[]);

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(listSectionsMock).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-ten')).not.toBeNull();
		});
		// The optimistically-removed row is back, because the server still holds it.
		expect(q(container, 'arrange-row-sec-bass')).not.toBeNull();
		consoleSpy.mockRestore();
	});
});

// ── 5. DELETE's live regions — re-homed from the retired collapsed-view specs ──
//
// #155/S4 review F5 — `roster-section-remove-status` (the role="status" success
// announcement, #113 review F1) and `section-remove-error` (the role="alert"
// failure banner, including the DISTINCT "section is not empty" refusal, #110
// review F1/F3) lost every test in the suite when page.roster-sections-ux and
// page.roster-ux-a11y were retired. Both still render — and both now fire from a
// DIFFERENT view than the one they were built in, which is exactly why they need
// pinning here rather than being assumed.

describe('/roster — the delete outcome is ANNOUNCED from arrange mode (#155/S4 review F5)', () => {
	it('a SUCCESSFUL delete announces into roster-section-remove-status (role="status", empty until then)', async () => {
		const container = await renderArrangeReady();
		const status = q(container, 'roster-section-remove-status');
		expect(status).not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(status!.textContent?.trim()).toContain('roster_section_removed');
		});
		// A success is a status, never an alert.
		expect(q(container, 'section-remove-error')).toBeNull();
	});

	it('a FAILED delete raises section-remove-error as role="alert" and the row comes back', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue(new Error('500'));
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			const error = q(container, 'section-remove-error');
			expect(error).not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
			expect(error!.textContent).toContain('roster_section_remove_failed');
		});
		expect(q(container, 'arrange-row-sec-bass')).not.toBeNull();
		// A failure is an alert, never a status.
		expect(q(container, 'roster-section-remove-status')?.textContent?.trim()).toBe('');
		consoleSpy.mockRestore();
	});

	it('a REFUSED delete ("that section is not empty") gets its OWN message, distinct from the generic write failure', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		// The server-side emptiness refusal — NOTHING was written (see
		// sectionErrors.ts): a different instruction to the user than "the delete
		// failed". Duck-typed on `code`, same as the real SectionNotEmptyError.
		deleteMock.mockRejectedValue({ code: 'section-not-empty' });
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-bass')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			const error = q(container, 'section-remove-error');
			expect(error).not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
			expect(error!.textContent).toContain('roster_section_remove_not_empty');
		});
		expect(q(container, 'section-remove-error')?.textContent).not.toContain(
			'roster_section_remove_failed'
		);
		consoleSpy.mockRestore();
	});
});

// ── 6. Keyboard/focus invariants the relocation put at risk ──────────────────

describe('/roster — arrange-mode CRUD keeps the keyboard contract (#155/S4 review F2/F3)', () => {
	it('a SUCCESSFUL delete lands focus on the PREVIOUS SIBLING arrange row — never on the Collapsed view-mode chip', async () => {
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass')).toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-row-sec-alto'));
		});
		// The regression this pins: the chip fallback firing every time, so the
		// next Enter/Space silently left arrange mode.
		expect(document.activeElement).not.toBe(q(container, 'roster-view-chip-collapsed'));
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
		// The roving tab stop travelled with the focus.
		expect(q(container, 'arrange-row-sec-alto')?.getAttribute('tabindex')).toBe('0');
	});

	// #155/S4 review F1 (follow-up) — re-homed from the retired
	// page.roster-ux-a11y.spec.ts ("a REFUSED remove returns focus to the restored
	// ✕"). S4 made the ✕ `disabled` while a structural write is in flight and when
	// the section is ineligible, and a disabled <button> cannot take focus — so the
	// failure landing has to be placed AFTER `removePending` clears, and it has to
	// step over a candidate that is disabled rather than stopping at it. Without
	// both, `.focus()` is a silent no-op and focus drops to <body> (WCAG 2.4.3).
	it('a FAILED delete returns focus to the RESTORED ✕ — never <body>', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue(new Error('500'));
		const container = await renderArrangeReady();

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'section-remove-error')).not.toBeNull();
		});
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-sec-bass'));
		});
		expect(document.activeElement).not.toBe(document.body);
		consoleSpy.mockRestore();
	});

	it('a REFUSED delete whose refetched tree makes the ✕ INELIGIBLE lands focus on the row, not <body>', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		deleteMock.mockRejectedValue({ code: 'section-not-empty' });
		const container = await renderArrangeReady();

		// The refusal's whole point: the server holds a child this tree never knew
		// about. The reconcile reveals it, so `canDelete` goes false and the ✕ comes
		// back DISABLED — the row itself is then the honest landing.
		listSectionsMock.mockResolvedValue([
			{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [] },
			{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] },
			{
				id: 'sec-bass',
				name: 'Bass',
				displayOrder: 3,
				parentId: null,
				depth: 0,
				children: [
					{ id: 'sec-bass1', name: 'Bass 1', displayOrder: 1, parentId: 'sec-bass', depth: 1, children: [] }
				]
			}
		] satisfies SectionNode[]);

		await fireEvent.click(q(container, 'section-remove-sec-bass') as HTMLElement);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'section-remove-confirm-sec-bass'));
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-bass') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-bass1')).not.toBeNull();
		});
		expect((q(container, 'section-remove-sec-bass') as HTMLButtonElement).disabled).toBe(true);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'arrange-row-sec-bass'));
		});
		expect(document.activeElement).not.toBe(document.body);
		// The roving tab stop travelled with the focus — a focused row at
		// tabindex="-1" would leave the widget's Tab entry point somewhere else.
		expect(q(container, 'arrange-row-sec-bass')?.getAttribute('tabindex')).toBe('0');
		consoleSpy.mockRestore();
	});

	it('the arrange list keeps EXACTLY ONE roving tab stop while a row is in rename mode', async () => {
		const container = await renderArrangeReady();
		const renderedRows = () => [
			...container.querySelectorAll<HTMLElement>('[data-testid^="arrange-row-"]')
		];
		expect(renderedRows().filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);

		// The FIRST row — the one that holds the tab stop — goes into rename mode,
		// and therefore stops rendering an `arrange-row-*` element at all.
		await fireEvent.click(q(container, 'arrange-rename-sec-sop') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-rename-input-sec-sop')).not.toBeNull();
		});
		expect(q(container, 'arrange-row-sec-sop')).toBeNull();

		const zeroTab = renderedRows().filter((r) => r.getAttribute('tabindex') === '0');
		expect(
			zeroTab,
			'the reorder widget must stay reachable by Tab while a row is renaming'
		).toHaveLength(1);
		expect(zeroTab[0]).toBe(q(container, 'arrange-row-sec-sop1'));

		// …and Escape hands it straight back.
		await fireEvent.keyDown(q(container, 'arrange-rename-input-sec-sop') as HTMLElement, {
			key: 'Escape'
		});
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-sop')).not.toBeNull();
		});
		expect(renderedRows().filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
	});
});

// (*MVOX:Palestrina* — #155/S4)
