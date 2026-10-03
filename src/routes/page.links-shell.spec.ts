// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

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
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

vi.mock('$app/state', () => ({ page: { url: new URL('https://dev.mvox.eu/links') } }));

import Page from './links/+page.svelte';
import type { LinkRow } from '$lib/links/linkData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const SHELL_CLASS = 'min-h-screen bg-paper px-6 py-10 text-ink';
const COLUMN_CLASS = 'mx-auto flex w-full max-w-md flex-col gap-4';
const H1_CLASS = 'font-display text-2xl';

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
	signIn();
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
	resetAppState();
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function shellMain(container: HTMLElement): HTMLElement | null {
	const first = container.firstElementChild;
	return first instanceof HTMLElement && first.tagName === 'MAIN' ? first : null;
}

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
		expect(directColumnDivs.length).toBe(1);
	});
});

describe('#339 — layer 3: the heading', () => {
	it("the h1 renders m.links_title() with class EXACTLY '" + H1_CLASS + "'", async () => {
		const { container } = await renderReady('not-admin');
		const h1 = container.querySelector('h1');
		expect(h1).not.toBeNull();
		expect(h1?.getAttribute('class')).toBe(H1_CLASS);
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
