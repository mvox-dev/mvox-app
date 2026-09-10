// @vitest-environment happy-dom
//
// #256 RED — the Lingikogu (link collection) page surface: src/routes/links/+page.svelte.
//
// Contract (operative scope = Gama's 2026-09-09 sign-off + 2026-09-10
// forward-marker close on issue #256):
//
//   1. A collective's links are listed in a STABLE ORDER members can read —
//      the page renders rows in the order the data module returns (which
//      sorts by display_order; see linkData.spec.ts), each as a REAL anchor:
//      href = the stored string VERBATIM (no scheme-guessing anywhere),
//      target="_blank", rel carrying BOTH noopener and noreferrer.
//   2. Admins (adminStore 'admin' — editor-or-owner tier on the DATABASE
//      entity, exactly the tier the type's `parent_right _editor` creators
//      rule names) can add, edit, reorder and remove. Members cannot: the
//      controls are ABSENT from the DOM, not disabled — the codebase-wide
//      idiom (roster record editor, library edition files, event convert).
//   3. A link with no description renders WITHOUT an empty line — the
//      description NODE is absent, not an empty element.
//   4. URLs stored AS GIVEN: the add/edit forms submit the url string
//      verbatim; name and url are required non-empty (no create/update call
//      fires on an empty one); description optional.
//   5. Reorder = NATIVE move up / move down buttons per row (native controls
//      only is standing law; no drag-drop). Boundary controls (up on first,
//      down on last) are disabled — a boundary tap never fires a write.
//
// Testids are 'links-*' throughout — NEVER bare 'link' (the OAuth
// account-linking decoy, blast finding).
//
// Seams mocked at the module boundary (linkData/linkActions) — the wire-level
// integration (REAL data module driven from this page, entuFetch mocked) is
// page.links-wire.spec.ts's job.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — key + params echoed; structural assertions only.
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

const CFG = { db: 'polyphony', token: 'jwt-abc' };

function rows(): LinkRow[] {
	return [
		{
			id: 'l-rec',
			name: 'Salvestused',
			url: 'https://f.io/GCkGMr5J',
			description: 'Crede recordings',
			displayOrder: 1
		},
		// NO scheme, NO description — the verbatim-url and no-empty-line pins.
		{ id: 'l-scores', name: 'Scores', url: 'example.com/x', description: null, displayOrder: 2 },
		{
			id: 'l-site',
			name: 'Website',
			url: 'https://crede.ee',
			description: 'Choir website',
			displayOrder: 3
		}
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
	listLinksMock.mockResolvedValue(rows());
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

function qa(container: HTMLElement, testid: string): HTMLElement[] {
	return Array.from(container.querySelectorAll(`[data-testid="${testid}"]`));
}

function rowEls(container: HTMLElement): HTMLElement[] {
	return qa(container, 'links-row');
}

function rowNames(container: HTMLElement): string[] {
	return rowEls(container).map(
		(r) => r.querySelector('[data-testid="links-row-name"]')?.textContent?.trim() ?? ''
	);
}

async function renderReady(tier: 'admin' | 'not-admin') {
	adminStore.set(tier);
	const utils = render(Page);
	await waitFor(() => {
		expect(rowEls(utils.container).length).toBeGreaterThan(0);
	});
	return utils;
}

// ── the readable list (member view) ─────────────────────────────────────────

describe('#256 — the list members read: stable order, real anchors, urls verbatim', () => {
	it('renders every link as a row inside links-list, in the order the data module returns (the stable display_order order)', async () => {
		const { container } = await renderReady('not-admin');
		expect(q(container, 'links-list')).not.toBeNull();
		expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);
	});

	it('each row carries a REAL anchor: href is the stored string VERBATIM (a schemeless url stays schemeless — no https:// prepended), target=_blank, rel has noopener AND noreferrer', async () => {
		const { container } = await renderReady('not-admin');
		const anchors = rowEls(container).map((r) =>
			r.querySelector<HTMLAnchorElement>('[data-testid="links-row-url"]')
		);
		expect(anchors.map((a) => a?.tagName)).toEqual(['A', 'A', 'A']);
		expect(anchors.map((a) => a?.getAttribute('href'))).toEqual([
			'https://f.io/GCkGMr5J',
			'example.com/x',
			'https://crede.ee'
		]);
		for (const a of anchors) {
			expect(a?.getAttribute('target')).toBe('_blank');
			const rel = (a?.getAttribute('rel') ?? '').split(/\s+/);
			expect(rel).toContain('noopener');
			expect(rel).toContain('noreferrer');
		}
	});

	it('a link with NO description renders NO description node at all — not an empty element (#256 done-when 3)', async () => {
		const { container } = await renderReady('not-admin');
		const [rec, scores, site] = rowEls(container);
		expect(
			rec.querySelector('[data-testid="links-row-description"]')?.textContent?.trim()
		).toBe('Crede recordings');
		// The no-description row: the NODE is absent, not empty.
		expect(scores.querySelector('[data-testid="links-row-description"]')).toBeNull();
		expect(
			site.querySelector('[data-testid="links-row-description"]')?.textContent?.trim()
		).toBe('Choir website');
	});

	it('an empty collection renders the links-empty state; a failed load renders links-load-error', async () => {
		listLinksMock.mockResolvedValue([]);
		adminStore.set('not-admin');
		const empty = render(Page);
		await waitFor(() => {
			expect(q(empty.container, 'links-empty')).not.toBeNull();
		});
		cleanup();

		listLinksMock.mockRejectedValue(new Error('boom'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failed = render(Page);
		await waitFor(() => {
			expect(q(failed.container, 'links-load-error')).not.toBeNull();
		});
		consoleError.mockRestore();
	});
});

// ── tier gating: absent, not disabled ───────────────────────────────────────

describe('#256 — members cannot mutate: admin controls ABSENT from the DOM, not disabled', () => {
	it('member tier: no add form, no per-row edit/remove/move controls, and links-list contains NO button element at all', async () => {
		const { container } = await renderReady('not-admin');
		for (const testid of [
			'links-add-form',
			'links-add-name',
			'links-add-url',
			'links-add-description',
			'links-add-submit',
			'links-edit',
			'links-remove',
			'links-move-up',
			'links-move-down'
		]) {
			expect(qa(container, testid), testid).toEqual([]);
		}
		expect(q(container, 'links-list')?.querySelectorAll('button').length).toBe(0);
	});

	it("adminStore 'loading' fails CLOSED — no admin control renders before the tier is known", async () => {
		adminStore.set('loading');
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowEls(container).length).toBeGreaterThan(0);
		});
		expect(qa(container, 'links-add-form')).toEqual([]);
		expect(qa(container, 'links-edit')).toEqual([]);
	});

	it('admin tier: the add form and per-row edit/remove/move controls are present — every one a native button/input', async () => {
		const { container } = await renderReady('admin');
		expect(q(container, 'links-add-form')).not.toBeNull();
		expect(q(container, 'links-add-name')?.tagName).toBe('INPUT');
		expect(q(container, 'links-add-url')?.tagName).toBe('INPUT');
		expect(qa(container, 'links-edit')).toHaveLength(3);
		expect(qa(container, 'links-remove')).toHaveLength(3);
		expect(qa(container, 'links-move-up')).toHaveLength(3);
		expect(qa(container, 'links-move-down')).toHaveLength(3);
		for (const testid of ['links-edit', 'links-remove', 'links-move-up', 'links-move-down']) {
			for (const el of qa(container, testid)) {
				expect(el.tagName, testid).toBe('BUTTON');
			}
		}
	});
});

// ── add ─────────────────────────────────────────────────────────────────────

describe('#256 — add: name+url required non-empty, description optional, url submitted VERBATIM', () => {
	it('submits createLink with the typed values verbatim and displayOrder = max existing + 1, then refreshes the list', async () => {
		const { container } = await renderReady('admin');
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, {
			target: { value: 'example.com/uus' }
		});
		const listCallsBefore = listLinksMock.mock.calls.length;
		await fireEvent.click(q(container, 'links-add-submit')!);

		await waitFor(() => {
			expect(createLinkMock).toHaveBeenCalledTimes(1);
		});
		const [cfgArg, inputArg] = createLinkMock.mock.calls[0];
		expect(cfgArg).toEqual(CFG);
		// FULL-shape toEqual — url verbatim (no scheme guessed), no description
		// (none typed), displayOrder appends at the end of the stable order.
		expect(inputArg).toEqual({
			name: 'Uus link',
			url: 'example.com/uus',
			description: null,
			displayOrder: 4
		});
		await waitFor(() => {
			expect(listLinksMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
	});

	it('a typed description rides along verbatim', async () => {
		const { container } = await renderReady('admin');
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'A' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'https://a.ee' } });
		await fireEvent.input(q(container, 'links-add-description')!, {
			target: { value: 'One line' }
		});
		await fireEvent.click(q(container, 'links-add-submit')!);
		await waitFor(() => {
			expect(createLinkMock).toHaveBeenCalledTimes(1);
		});
		expect(createLinkMock.mock.calls[0][1]).toEqual({
			name: 'A',
			url: 'https://a.ee',
			description: 'One line',
			displayOrder: 4
		});
	});

	it('empty url → NO create call; empty name → NO create call (non-empty is the ONLY validation — nothing checks what a url looks like)', async () => {
		const { container } = await renderReady('admin');
		// name only, url empty
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'A' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		// url only, name cleared
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: '   ' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'https://a.ee' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		expect(createLinkMock).not.toHaveBeenCalled();
	});
});

// ── edit ────────────────────────────────────────────────────────────────────

describe('#256 — edit: whole-field, prefilled, url verbatim', () => {
	it('opens the row prefilled, submits updateLink with the full field set — an emptied description goes as null', async () => {
		const { container } = await renderReady('admin');
		const scoresRow = rowEls(container)[1];
		await fireEvent.click(scoresRow.querySelector('[data-testid="links-edit"]')!);

		const nameInput = q(container, 'links-edit-name') as HTMLInputElement;
		const urlInput = q(container, 'links-edit-url') as HTMLInputElement;
		const descInput = q(container, 'links-edit-description') as HTMLInputElement;
		expect(nameInput?.value).toBe('Scores');
		expect(urlInput?.value).toBe('example.com/x');
		expect(descInput?.value ?? '').toBe('');

		await fireEvent.input(urlInput, { target: { value: 'f.io/abc' } });
		await fireEvent.click(q(container, 'links-edit-save')!);

		await waitFor(() => {
			expect(updateLinkMock).toHaveBeenCalledTimes(1);
		});
		expect(updateLinkMock.mock.calls[0][0]).toEqual(CFG);
		expect(updateLinkMock.mock.calls[0][1]).toBe('l-scores');
		// url stays schemeless — VERBATIM; description stays absent (null).
		expect(updateLinkMock.mock.calls[0][2]).toEqual({
			name: 'Scores',
			url: 'f.io/abc',
			description: null
		});
	});

	it('emptying the url blocks the save — no update call', async () => {
		const { container } = await renderReady('admin');
		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-edit"]')!);
		await fireEvent.input(q(container, 'links-edit-url')!, { target: { value: '   ' } });
		await fireEvent.click(q(container, 'links-edit-save')!);
		expect(updateLinkMock).not.toHaveBeenCalled();
	});
});

// ── remove ──────────────────────────────────────────────────────────────────

describe('#256 — remove', () => {
	it('the row control calls deleteLink with THAT row id and refreshes the list', async () => {
		const { container } = await renderReady('admin');
		const listCallsBefore = listLinksMock.mock.calls.length;
		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-remove"]')!);
		await waitFor(() => {
			expect(deleteLinkMock).toHaveBeenCalledTimes(1);
		});
		expect(deleteLinkMock.mock.calls[0][0]).toEqual(CFG);
		expect(deleteLinkMock.mock.calls[0][1]).toBe('l-rec');
		await waitFor(() => {
			expect(listLinksMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
	});
});

// ── reorder ─────────────────────────────────────────────────────────────────

describe('#256 — reorder: native move up / move down per row, persisted via reorderLinks', () => {
	it('move-down on the middle row calls reorderLinks with the FULL new id order', async () => {
		const { container } = await renderReady('admin');
		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(reorderLinksMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderLinksMock.mock.calls[0][0]).toEqual(CFG);
		expect(reorderLinksMock.mock.calls[0][1]).toEqual(['l-rec', 'l-site', 'l-scores']);
	});

	it('move-up on the middle row calls reorderLinks with the swap toward the front', async () => {
		const { container } = await renderReady('admin');
		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-up"]')!);
		await waitFor(() => {
			expect(reorderLinksMock).toHaveBeenCalledTimes(1);
		});
		expect(reorderLinksMock.mock.calls[0][1]).toEqual(['l-scores', 'l-rec', 'l-site']);
	});

	it('boundary controls are disabled: move-up on the FIRST row and move-down on the LAST row fire NO write', async () => {
		const { container } = await renderReady('admin');
		const first = rowEls(container)[0].querySelector<HTMLButtonElement>(
			'[data-testid="links-move-up"]'
		)!;
		const last = rowEls(container)[2].querySelector<HTMLButtonElement>(
			'[data-testid="links-move-down"]'
		)!;
		expect(first.disabled).toBe(true);
		expect(last.disabled).toBe(true);
		await fireEvent.click(first);
		await fireEvent.click(last);
		expect(reorderLinksMock).not.toHaveBeenCalled();
	});

	it('once the reorder settles the rows render in the new order', async () => {
		const { container } = await renderReady('admin');
		const reordered = [rows()[1], rows()[0], rows()[2]].map((r, i) => ({
			...r,
			displayOrder: i + 1
		}));
		listLinksMock.mockResolvedValue(reordered);
		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['Scores', 'Salvestused', 'Website']);
		});
	});
});

// (*MVOX:Tallis* — #256 RED)
