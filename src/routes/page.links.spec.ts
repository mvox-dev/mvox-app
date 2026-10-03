// @vitest-environment happy-dom
// The /links page: the link collection list and its controls.
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const pageStub = vi.hoisted(() => ({ url: new URL('https://dev.mvox.eu/links') }));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './links/+page.svelte';
import type { LinkRow } from '$lib/links/linkData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const CFG = testCfg('sampledb', 'jwt-abc');

function rows(): LinkRow[] {
	return [
		{
			id: 'l-rec',
			name: 'Salvestused',
			url: 'https://f.io/GCkGMr5J',
			description: 'Crede recordings',
			displayOrder: 1
		},
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
	signIn();
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
	resetAppState();
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

describe('#374/#375 — add: url normalised at payload-build time, silently', () => {
	it('a schemeless url goes to createLink with https:// prepended (#374), displayOrder = max existing + 1, then refreshes — and the form renders NO hint about the change', async () => {
		const { container } = await renderReady('admin');
		const formTextBefore = q(container, 'links-add-form')!.textContent;
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, {
			target: { value: 'crede.ee/salvestused' }
		});
		const listCallsBefore = listLinksMock.mock.calls.length;
		await fireEvent.click(q(container, 'links-add-submit')!);

		await waitFor(() => {
			expect(createLinkMock).toHaveBeenCalledTimes(1);
		});
		const [cfgArg, inputArg] = createLinkMock.mock.calls[0];
		expect(cfgArg).toEqual(CFG);
		expect(inputArg).toEqual({
			name: 'Uus link',
			url: 'https://crede.ee/salvestused',
			description: null,
			displayOrder: 4
		});
		await waitFor(() => {
			expect(listLinksMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		});
		expect(q(container, 'links-add-form')!.textContent).toBe(formTextBefore);
	});

	it('an own-host url (page host dev.mvox.eu) goes to createLink as a relative path keeping query+fragment (#375) — and the bound input is NOT mutated while the write is in flight', async () => {
		let resolveCreate!: (id: string) => void;
		createLinkMock.mockImplementation(
			() =>
				new Promise<string>((res) => {
					resolveCreate = res;
				})
		);
		const { container } = await renderReady('admin');
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Salvestused' } });
		await fireEvent.input(q(container, 'links-add-url')!, {
			target: { value: 'https://dev.mvox.eu/salvestused?x=1#y' }
		});
		await fireEvent.click(q(container, 'links-add-submit')!);

		await waitFor(() => {
			expect(createLinkMock).toHaveBeenCalledTimes(1);
		});
		expect(createLinkMock.mock.calls[0][1]).toEqual({
			name: 'Salvestused',
			url: '/salvestused?x=1#y',
			description: null,
			displayOrder: 4
		});
		expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe(
			'https://dev.mvox.eu/salvestused?x=1#y'
		);
		resolveCreate('l-new');
		await waitFor(() => {
			expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe('');
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

	it('empty url → NO create call; empty name → NO create call (non-empty stays the ONLY validation, run on what was TYPED, before the normaliser)', async () => {
		const { container } = await renderReady('admin');
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'A' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: '   ' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'https://a.ee' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		expect(createLinkMock).not.toHaveBeenCalled();
	});
});

describe('#374/#375 — edit: whole-field, prefilled, url normalised at payload-build time', () => {
	it('opens the row prefilled, submits updateLink with the full field set — the typed schemeless url goes with https:// prepended (#374), an emptied description goes as null', async () => {
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
		expect(updateLinkMock.mock.calls[0][2]).toEqual({
			name: 'Scores',
			url: 'https://f.io/abc',
			description: null
		});
	});

	it('an own-host url (page host dev.mvox.eu) goes to updateLink as a relative path keeping query+fragment (#375) — and the bound editUrl input is NOT mutated while the write is in flight', async () => {
		let resolveUpdate!: () => void;
		updateLinkMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					resolveUpdate = res;
				})
		);
		const { container } = await renderReady('admin');
		const scoresRow = rowEls(container)[1];
		await fireEvent.click(scoresRow.querySelector('[data-testid="links-edit"]')!);
		await fireEvent.input(q(container, 'links-edit-url')!, {
			target: { value: 'https://dev.mvox.eu/salvestused?x=1#y' }
		});
		await fireEvent.click(q(container, 'links-edit-save')!);

		await waitFor(() => {
			expect(updateLinkMock).toHaveBeenCalledTimes(1);
		});
		expect(updateLinkMock.mock.calls[0][2]).toEqual({
			name: 'Scores',
			url: '/salvestused?x=1#y',
			description: null
		});
		expect((q(container, 'links-edit-url') as HTMLInputElement).value).toBe(
			'https://dev.mvox.eu/salvestused?x=1#y'
		);
		resolveUpdate();
		await waitFor(() => {
			expect(q(container, 'links-edit-url')).toBeNull();
		});
	});

	it('a row whose stored url is ALREADY relative re-saves with that SAME url when only the name changes — no https:// glued onto it', async () => {
		listLinksMock.mockResolvedValue([
			{
				id: 'l-own',
				name: 'Salvestused',
				url: '/salvestused?x=1#y',
				description: null,
				displayOrder: 1
			}
		]);
		const { container } = await renderReady('admin');
		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-edit"]')!);
		const urlInput = q(container, 'links-edit-url') as HTMLInputElement;
		expect(urlInput.value).toBe('/salvestused?x=1#y');

		await fireEvent.input(q(container, 'links-edit-name')!, {
			target: { value: 'Salvestused 2026' }
		});
		await fireEvent.click(q(container, 'links-edit-save')!);

		await waitFor(() => {
			expect(updateLinkMock).toHaveBeenCalledTimes(1);
		});
		expect(updateLinkMock.mock.calls[0][2]).toEqual({
			name: 'Salvestused 2026',
			url: '/salvestused?x=1#y',
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

describe('#335 — Links page controls are VISIBLE: every input and button carries a border class', () => {
	function expectBorder(container: HTMLElement, testid: string) {
		const el = q(container, testid);
		expect(el, testid).not.toBeNull();
		expect(el!.getAttribute('class') ?? '', `${testid} class`).toContain('border');
	}

	it("the add form's three inputs and its submit button carry a border class", async () => {
		const { container } = await renderReady('admin');
		for (const testid of ['links-add-name', 'links-add-url', 'links-add-description']) {
			expectBorder(container, testid);
		}
		expectBorder(container, 'links-add-submit');
	});

	it('every per-row button — move-up, move-down, edit, remove — carries a border class', async () => {
		const { container } = await renderReady('admin');
		for (const testid of ['links-move-up', 'links-move-down', 'links-edit', 'links-remove']) {
			for (const el of qa(container, testid)) {
				expect(el.getAttribute('class') ?? '', `${testid} class`).toContain('border');
			}
			expect(qa(container, testid).length, testid).toBeGreaterThan(0);
		}
	});

	it("the in-situ edit form's three inputs and its save/cancel buttons carry a border class", async () => {
		const { container } = await renderReady('admin');
		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-edit"]')!);
		for (const testid of [
			'links-edit-name',
			'links-edit-url',
			'links-edit-description',
			'links-edit-save',
			'links-edit-cancel'
		]) {
			expectBorder(container, testid);
		}
	});

	it('the load-error retry button carries a border class', async () => {
		listLinksMock.mockRejectedValue(new Error('boom'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'links-retry-load')).not.toBeNull();
		});
		expectBorder(container, 'links-retry-load');
		consoleError.mockRestore();
	});
});

// (*MVOX:Tallis*)
