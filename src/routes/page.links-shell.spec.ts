// @vitest-environment happy-dom
//
// #339 RED — the Links page gets the house shell: three layers, library idiom.
//
// Contract (issue #339, AMENDED 2026-09-12 09:53, before dispatch):
//
//   The library page (src/routes/library/+page.svelte) is THE reference,
//   matched character-for-character — NOT admin (admin shares the main and
//   h1 strings but its column is max-w-2xl gap-6):
//
//     <main class="min-h-screen bg-paper px-6 py-10 text-ink">
//         <div class="mx-auto flex w-full max-w-md flex-col gap-4">
//             <h1 class="font-display text-2xl">{m.links_title()}</h1>
//
//   1. Page root is a <main> whose class is EXACTLY the shell string —
//      string equality, not substring; character-for-character is the
//      acceptance.                                              [RED at HEAD]
//   2. Directly inside it, a column div whose class is EXACTLY the column
//      string.                                                  [RED at HEAD]
//   3. The h1 renders {m.links_title()} with class EXACTLY
//      'font-display text-2xl' (HEAD's 'text-lg font-semibold' is the
//      failing state).                                          [RED at HEAD]
//   4. data-testid="links-page" still present (issue scope 2). Whether it
//      rides the new main or stays on an inner div is GREEN's choice; the
//      five existing links suites key on it and must pass unchanged.
//                                                          [fence — HEAD-green]
//   5. The empty state (links-empty) and the add-form rows render INSIDE
//      the column div — the "floating" Mihkel called out.       [RED at HEAD]
//   6. FENCES: every control keeps its #335 classes byte-identical
//      (spot-pinned: links-add-name input, links-edit-save button); the
//      admin-gated blocks stay inside the wrapped tree; m.links_title
//      untouched (the h1 pins it).                         [fence — HEAD-green]
//
// Testids are 'links-*' throughout — NEVER bare 'link' (the OAuth
// account-linking decoy, blast finding).
//
// Seams mocked at the module boundary (linkData/linkActions), same as
// page.links.spec.ts — this suite renders the REAL route component
// src/routes/links/+page.svelte, so the shell assertions hold against the
// actual page, not an isolated fragment.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — key echoed; structural assertions only.
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
vi.mock('$lib/paraglide/messages', () => ({
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

const { listLinksMock, createLinkMock, updateLinkMock, reorderLinksMock, deleteLinkMock } =
	vi.hoisted(() => ({
		listLinksMock: vi.fn(),
		createLinkMock: vi.fn(),
		updateLinkMock: vi.fn(),
		reorderLinksMock: vi.fn(),
		deleteLinkMock: vi.fn()
	}));
vi.mock('$lib/links/linkData', () => ({ listLinks: listLinksMock }));
vi.mock('$lib/links/linkActions', () => ({
	createLink: createLinkMock,
	updateLink: updateLinkMock,
	reorderLinks: reorderLinksMock,
	deleteLink: deleteLinkMock
}));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './links/+page.svelte';
import type { LinkRow } from '$lib/links/linkData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// The library idiom, character-for-character (library/+page.svelte:1198-1200).
const SHELL_CLASS = 'min-h-screen bg-paper px-6 py-10 text-ink';
const COLUMN_CLASS = 'mx-auto flex w-full max-w-md flex-col gap-4';
const H1_CLASS = 'font-display text-2xl';

// #335 control classes, byte-identical (links/+page.svelte at #335 GREEN).
const ADD_NAME_INPUT_CLASS = 'rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50';
const EDIT_SAVE_BUTTON_CLASS = 'rounded-md border border-ink px-2 py-1 text-xs disabled:opacity-50';

function rowsFixture(): LinkRow[] {
	return [
		{
			id: 'l-rec',
			name: 'Salvestused',
			url: 'https://f.io/GCkGMr5J',
			description: 'Crede recordings',
			displayOrder: 1
		},
		{ id: 'l-scores', name: 'Scores', url: 'example.com/x', description: null, displayOrder: 2 }
	];
}

function setAuthed() {
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
	setAuthed();
	listLinksMock.mockResolvedValue(rowsFixture());
	createLinkMock.mockResolvedValue('l-new');
	updateLinkMock.mockResolvedValue(undefined);
	reorderLinksMock.mockResolvedValue(undefined);
	deleteLinkMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

// The one <main> the page root must be. Returns null at HEAD (RED).
function shellMain(container: HTMLElement): HTMLElement | null {
	const first = container.firstElementChild;
	return first instanceof HTMLElement && first.tagName === 'MAIN' ? first : null;
}

// The centred column: a DIRECT child of the shell main carrying the exact
// library column string. Character-for-character — getAttribute, not classList.
function columnDiv(container: HTMLElement): HTMLElement | null {
	const main = shellMain(container);
	if (!main) return null;
	const hit = Array.from(main.children).find(
		(el) => el.tagName === 'DIV' && el.getAttribute('class') === COLUMN_CLASS
	);
	return hit instanceof HTMLElement ? hit : null;
}

async function renderReady(tier: 'admin' | 'not-admin') {
	adminStore.set(tier);
	const utils = render(Page);
	await waitFor(() => {
		expect(q(utils.container, 'links-list')).not.toBeNull();
	});
	return utils;
}

describe('#339 — layer 1: the page shell', () => {
	it("the page root is a <main> whose class is EXACTLY '" + SHELL_CLASS + "'", async () => {
		const { container } = await renderReady('not-admin');
		const root = container.firstElementChild;
		expect(root).not.toBeNull();
		// HEAD's root is <div data-testid="links-page" class="flex flex-col gap-4"> — RED.
		expect(root?.tagName).toBe('MAIN');
		expect(root?.getAttribute('class')).toBe(SHELL_CLASS);
	});

	it('there is exactly ONE main — the shell is a wrapper, not a duplicate', async () => {
		const { container } = await renderReady('not-admin');
		expect(container.querySelectorAll('main').length).toBe(1);
	});
});

describe('#339 — layer 2: the centred column', () => {
	it("directly inside the main, a div whose class is EXACTLY '" + COLUMN_CLASS + "'", async () => {
		const { container } = await renderReady('not-admin');
		const main = shellMain(container);
		expect(main).not.toBeNull();
		const directColumnDivs = Array.from(main?.children ?? []).filter(
			(el) => el.tagName === 'DIV' && el.getAttribute('class') === COLUMN_CLASS
		);
		// max-w-md gap-4 — the LIBRARY column, not admin's max-w-2xl gap-6.
		expect(directColumnDivs.length).toBe(1);
	});
});

describe('#339 — layer 3: the heading', () => {
	it("the h1 renders m.links_title() with class EXACTLY '" + H1_CLASS + "'", async () => {
		const { container } = await renderReady('not-admin');
		const h1 = container.querySelector('h1');
		expect(h1).not.toBeNull();
		// HEAD: 'text-lg font-semibold' — the failing state.
		expect(h1?.getAttribute('class')).toBe(H1_CLASS);
		// m.links_title untouched — the lenient mock echoes the key verbatim.
		expect(h1?.textContent?.trim()).toBe('links_title');
	});

	it('the h1 sits inside the column div, not floating beside it', async () => {
		const { container } = await renderReady('not-admin');
		const col = columnDiv(container);
		expect(col).not.toBeNull();
		const h1 = container.querySelector('h1');
		expect(h1).not.toBeNull();
		expect(col?.contains(h1)).toBe(true);
	});
});

describe('#339 — scope 2: links-page testid survives the wrap', () => {
	it('data-testid="links-page" is still present (main or inner div — GREEN\'s choice)', async () => {
		const { container } = await renderReady('not-admin');
		expect(q(container, 'links-page')).not.toBeNull();
	});
});

describe('#339 — scope 3: nothing floats outside the column', () => {
	it('the empty state (links-empty) renders INSIDE the column div — "No links yet." is what he called out as floating', async () => {
		listLinksMock.mockResolvedValue([]);
		adminStore.set('not-admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'links-empty')).not.toBeNull();
		});
		const col = columnDiv(container);
		expect(col).not.toBeNull();
		expect(col?.contains(q(container, 'links-empty'))).toBe(true);
	});

	it('the admin add-form rows render INSIDE the column div', async () => {
		const { container } = await renderReady('admin');
		const col = columnDiv(container);
		expect(col).not.toBeNull();
		const addForm = q(container, 'links-add-form');
		expect(addForm).not.toBeNull();
		expect(col?.contains(addForm)).toBe(true);
		expect(col?.contains(q(container, 'links-add-name'))).toBe(true);
	});

	it('the list itself renders INSIDE the column div', async () => {
		const { container } = await renderReady('not-admin');
		const col = columnDiv(container);
		expect(col).not.toBeNull();
		expect(col?.contains(q(container, 'links-list'))).toBe(true);
	});

	it('the admin-gated #323 reorder status node stays inside the wrapped tree', async () => {
		const { container } = await renderReady('admin');
		const col = columnDiv(container);
		expect(col).not.toBeNull();
		const status = q(container, 'links-reorder-status');
		expect(status).not.toBeNull();
		expect(col?.contains(status)).toBe(true);
	});
});

describe('#339 — scope 4 fences: #335 control classes byte-identical', () => {
	it("links-add-name input keeps '" + ADD_NAME_INPUT_CLASS + "'", async () => {
		const { container } = await renderReady('admin');
		const input = q(container, 'links-add-name');
		expect(input).not.toBeNull();
		expect(input?.getAttribute('class')).toBe(ADD_NAME_INPUT_CLASS);
	});

	it("links-edit-save button keeps '" + EDIT_SAVE_BUTTON_CLASS + "'", async () => {
		const { container } = await renderReady('admin');
		const editBtn = container
			.querySelectorAll('[data-testid="links-row"]')[0]
			?.querySelector<HTMLElement>('[data-testid="links-edit"]');
		expect(editBtn).not.toBeNull();
		if (!editBtn) return;
		await fireEvent.click(editBtn);
		await waitFor(() => {
			expect(q(container, 'links-edit-save')).not.toBeNull();
		});
		expect(q(container, 'links-edit-save')?.getAttribute('class')).toBe(EDIT_SAVE_BUTTON_CLASS);
	});
});

// (*MVOX:Tallis* — #339 RED)
