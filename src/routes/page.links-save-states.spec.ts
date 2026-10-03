// @vitest-environment happy-dom
// /links reorder: the four save states and the double-tap guard.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

vi.mock('$lib/links/linkData', async () =>
	(await import('$lib/testing/mocks/links')).linkDataModule()
);
vi.mock('$lib/links/linkActions', async () =>
	(await import('$lib/testing/mocks/links')).linkActionsModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

vi.mock('$app/state', async () =>
	(await import('$lib/testing/mocks/links')).linksPageStateModule()
);

import Page from './links/+page.svelte';
import type { LinkRow } from '$lib/links/linkData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import {
	createLinkMock,
	deleteLinkMock,
	listLinksMock,
	reorderLinksMock,
	updateLinkMock
} from '$lib/testing/mocks/links';

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

function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		]
	});
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	setAuthed();
	listLinksMock.mockResolvedValue(rows());
	createLinkMock.mockResolvedValue('l-new');
	updateLinkMock.mockResolvedValue(undefined);
	reorderLinksMock.mockResolvedValue(undefined);
	deleteLinkMock.mockResolvedValue(undefined);
	consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	consoleErrorSpy.mockRestore();
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetAdmin();
});

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
	await tick();
}

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

function arrowButtons(container: HTMLElement): HTMLButtonElement[] {
	return [...qa(container, 'links-move-up'), ...qa(container, 'links-move-down')].map(
		(el) => el as HTMLButtonElement
	);
}

function statusText(container: HTMLElement): string {
	return q(container, 'links-reorder-status')?.textContent?.trim() ?? '';
}

async function renderReadyAdmin() {
	adminStore.set('admin');
	const utils = render(Page);
	await waitFor(() => {
		expect(rowEls(utils.container).length).toBe(3);
	});
	return utils;
}

describe('#323 — NOT YET ATTEMPTED: untouched rows show no residue', () => {
	it('the persistent role="status" node exists from first render and is EMPTY; no alert node anywhere; non-boundary arrows enabled', async () => {
		const { container } = await renderReadyAdmin();

		const status = q(container, 'links-reorder-status');
		expect(status, 'links-reorder-status must exist BEFORE any attempt (persistent node)').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		expect(q(container, 'links-reorder-error')).toBeNull();
		expect(q(container, 'links-write-error')).toBeNull();
		expect(container.querySelector('[role="alert"]')).toBeNull();

		const [r0, r1, r2] = rowEls(container);
		expect(r0.querySelector<HTMLButtonElement>('[data-testid="links-move-up"]')!.disabled).toBe(true);
		expect(r0.querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!.disabled).toBe(false);
		expect(r1.querySelector<HTMLButtonElement>('[data-testid="links-move-up"]')!.disabled).toBe(false);
		expect(r1.querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!.disabled).toBe(false);
		expect(r2.querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!.disabled).toBe(true);
	});
});

describe('#323 — PENDING: a reorder in flight guards BOTH arrows of EVERY row (write guard, not boundary logic)', () => {
	it('while the write is in flight ALL six arrow buttons are disabled — including the non-boundary ones the boundary checks leave enabled', async () => {
		const held = deferred<void>();
		reorderLinksMock.mockReturnValue(held.promise);
		const { container } = await renderReadyAdmin();

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(reorderLinksMock).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			const arrows = arrowButtons(container);
			expect(arrows).toHaveLength(6);
			for (const b of arrows) {
				expect(b.disabled, 'every arrow must be disabled while a reorder is in flight').toBe(true);
			}
		});

		held.resolve();
		await waitFor(() => {
			expect(
				rowEls(container)[1].querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!
					.disabled
			).toBe(false);
		});
	});

	it('a second tap during flight fires NO second wire call — even a dispatched click on any arrow is a no-op', async () => {
		const held = deferred<void>();
		reorderLinksMock.mockReturnValue(held.promise);
		const { container } = await renderReadyAdmin();

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(reorderLinksMock).toHaveBeenCalledTimes(1);
		});

		for (const b of arrowButtons(container)) {
			await fireEvent.click(b);
		}
		expect(reorderLinksMock).toHaveBeenCalledTimes(1);

		held.resolve();
	});

	it('the status region is cleared at ATTEMPT START (a stale saved announcement never overlaps a new write)', async () => {
		const { container } = await renderReadyAdmin();

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(statusText(container)).toBe('links_reorder_saved');
		});

		const held = deferred<void>();
		reorderLinksMock.mockReturnValue(held.promise);
		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-up"]')!);
		await waitFor(() => {
			expect(statusText(container)).toBe('');
		});
		held.resolve();
	});
});

describe('#323 — SAVED: announced on the persistent role="status" node (#267 shape)', () => {
	it('a settled reorder announces links_reorder_saved on the SAME node that was empty before — saved is distinguishable from never-touched', async () => {
		const { container } = await renderReadyAdmin();
		const nodeBefore = q(container, 'links-reorder-status');
		expect(nodeBefore).not.toBeNull();
		expect(nodeBefore!.textContent?.trim()).toBe('');

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(statusText(container)).toBe('links_reorder_saved');
		});
		expect(q(container, 'links-reorder-status')).toBe(nodeBefore);
		expect(q(container, 'links-reorder-error')).toBeNull();
	});
});

describe('#323 — FAILED: truthful alert, retry available, screen restored to the SERVER order', () => {
	it('a rejected reorder surfaces role="alert" links_reorder_failed, RE-READS the list (mid-loop throw leaves the server half-renumbered) and renders the server order — arrows re-enabled for retry', async () => {
		const { container } = await renderReadyAdmin();
		expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);

		const serverAfterFailure: LinkRow[] = [
			{ id: 'l-scores', name: 'Scores', url: 'example.com/x', description: null, displayOrder: 1 },
			{
				id: 'l-site',
				name: 'Website',
				url: 'https://crede.ee',
				description: 'Choir website',
				displayOrder: 2
			},
			{
				id: 'l-rec',
				name: 'Salvestused',
				url: 'https://f.io/GCkGMr5J',
				description: 'Crede recordings',
				displayOrder: 3
			}
		];
		reorderLinksMock.mockRejectedValue(new Error('renumber failed mid-loop'));
		listLinksMock.mockResolvedValue(serverAfterFailure);
		const listCallsBefore = listLinksMock.mock.calls.length;

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);

		const alert = await waitFor(() => {
			const el = q(container, 'links-reorder-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('links_reorder_failed');

		expect(listLinksMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['Scores', 'Website', 'Salvestused']);
		});

		expect(statusText(container)).toBe('');
		await waitFor(() => {
			expect(
				rowEls(container)[1].querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!
					.disabled
			).toBe(false);
		});
	});

	it('when the post-failure re-read ALSO fails, the alert drops the "order the server holds" claim', async () => {
		const { container } = await renderReadyAdmin();
		expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);

		reorderLinksMock.mockRejectedValue(new Error('renumber failed mid-loop'));
		listLinksMock.mockRejectedValue(new Error('list read failed too'));

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);

		const alert = await waitFor(() => {
			const el = q(container, 'links-reorder-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent?.trim()).toBe('links_reorder_failed_stale');

		expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);
		expect(statusText(container)).toBe('');
		expect(
			rowEls(container)[1].querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!
				.disabled
		).toBe(false);
	});

	it('when the post-failure re-read SUCCEEDS, the alert keeps the plain wording', async () => {
		const { container } = await renderReadyAdmin();
		reorderLinksMock.mockRejectedValue(new Error('renumber failed mid-loop'));

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);

		const alert = await waitFor(() => {
			const el = q(container, 'links-reorder-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.textContent?.trim()).toBe('links_reorder_failed');
	});

	it('the retry clears the alert at attempt start and a successful retry announces saved', async () => {
		const { container } = await renderReadyAdmin();
		reorderLinksMock.mockRejectedValueOnce(new Error('boom'));

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(q(container, 'links-reorder-error')).not.toBeNull();
		});

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(q(container, 'links-reorder-error')).toBeNull();
			expect(statusText(container)).toBe('links_reorder_saved');
		});
	});
});

describe('#323 adjacent — createLink failure surfaces as role="alert"; no saved cue for the explicit-submit form', () => {
	it('a rejected create shows links-write-error (role=alert, links_create_failed), keeps the typed draft for retry, and leaves the status region empty', async () => {
		createLinkMock.mockRejectedValue(new Error('create failed'));
		const { container } = await renderReadyAdmin();

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Uus link' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'example.com/uus' } });
		await fireEvent.click(q(container, 'links-add-submit')!);

		const alert = await waitFor(() => {
			const el = q(container, 'links-write-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('links_create_failed');

		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('Uus link');
		expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe('example.com/uus');

		expect(statusText(container)).toBe('');
	});

	it('a successful create clears the alert at attempt start and produces NO saved announcement (saved is self-evident on explicit submit)', async () => {
		createLinkMock.mockRejectedValueOnce(new Error('create failed'));
		const { container } = await renderReadyAdmin();

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'A' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'https://a.ee' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		await waitFor(() => {
			expect(q(container, 'links-write-error')).not.toBeNull();
		});

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'A' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'https://a.ee' } });
		await fireEvent.click(q(container, 'links-add-submit')!);
		await waitFor(() => {
			expect(createLinkMock).toHaveBeenCalledTimes(2);
			expect(q(container, 'links-write-error')).toBeNull();
		});
		expect(statusText(container)).toBe('');
	});
});

describe('#323 adjacent — updateLink failure surfaces as role="alert", edit form stays open for retry', () => {
	it('a rejected save shows links_update_failed and the in-situ edit form remains open with its values', async () => {
		updateLinkMock.mockRejectedValue(new Error('update failed'));
		const { container } = await renderReadyAdmin();

		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-edit"]')!);
		await fireEvent.input(q(container, 'links-edit-url')!, { target: { value: 'f.io/changed' } });
		await fireEvent.click(q(container, 'links-edit-save')!);

		const alert = await waitFor(() => {
			const el = q(container, 'links-write-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('links_update_failed');

		expect(q(container, 'links-edit-name')).not.toBeNull();
		expect((q(container, 'links-edit-url') as HTMLInputElement).value).toBe('f.io/changed');
	});
});

describe('#323 adjacent — deleteLink failure surfaces as role="alert", the row stays for retry', () => {
	it('a rejected remove shows links_remove_failed and all three rows remain on screen', async () => {
		deleteLinkMock.mockRejectedValue(new Error('remove failed'));
		const { container } = await renderReadyAdmin();

		await fireEvent.click(rowEls(container)[0].querySelector('[data-testid="links-remove"]')!);

		const alert = await waitFor(() => {
			const el = q(container, 'links-write-error');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('links_remove_failed');
		expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);
	});
});

describe('#323 — a collective switch resets failure/saved residue (routeLoad reset is the guard idiom)', () => {
	function rowsB(): LinkRow[] {
		return [
			{ id: 'lb-1', name: 'B-Website', url: 'https://b.example', description: null, displayOrder: 1 }
		];
	}

	it("collective A's reorder FAILURE alert does not survive the switch to B", async () => {
		setAuthedWithTwoCollectives();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'sampledb' ? rows() : rowsB())
		);
		reorderLinksMock.mockRejectedValue(new Error('boom'));
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);
		});

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(q(container, 'links-reorder-error')).not.toBeNull();
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect(q(container, 'links-reorder-error')).toBeNull();
		expect(statusText(container)).toBe('');
	});

	it("collective A's SAVED announcement does not survive the switch to B", async () => {
		setAuthedWithTwoCollectives();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'sampledb' ? rows() : rowsB())
		);
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);
		});

		await fireEvent.click(rowEls(container)[1].querySelector('[data-testid="links-move-down"]')!);
		await waitFor(() => {
			expect(statusText(container)).toBe('links_reorder_saved');
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect(statusText(container)).toBe('');
	});
});

describe('#323 review F1 — a write started in A settles silently once the user is on B', () => {
	function rowsBPair(): LinkRow[] {
		return [
			{
				id: 'lb-1',
				name: 'B-Website',
				url: 'https://b.example',
				description: null,
				displayOrder: 1
			},
			{ id: 'lb-2', name: 'B-Scores', url: 'https://b.example/s', description: null, displayOrder: 2 }
		];
	}

	async function renderAWithHeldReorder() {
		setAuthedWithTwoCollectives();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'sampledb' ? rows() : rowsBPair())
		);
		const held = deferred();
		reorderLinksMock.mockReturnValue(held.promise);
		adminStore.set('admin');
		const utils = render(Page);
		await waitFor(() => {
			expect(rowNames(utils.container)).toEqual(['Salvestused', 'Scores', 'Website']);
		});

		await fireEvent.click(
			rowEls(utils.container)[1].querySelector('[data-testid="links-move-down"]')!
		);
		await waitFor(() => {
			expect(reorderLinksMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(utils.container)).toEqual(['B-Website', 'B-Scores']);
		});
		return { ...utils, held };
	}

	it("A's reorder REJECTING after the switch paints no alert on B and fires no re-read against A", async () => {
		const { container, held } = await renderAWithHeldReorder();
		const listCallsOnB = listLinksMock.mock.calls.length;

		held.reject(new Error('A boom'));
		await flush();

		expect(q(container, 'links-reorder-error')).toBeNull();
		expect(statusText(container)).toBe('');
		expect(listLinksMock.mock.calls.length).toBe(listCallsOnB);
		expect(rowNames(container)).toEqual(['B-Website', 'B-Scores']);
	});

	it("A's reorder RESOLVING after the switch announces nothing on B", async () => {
		const { container, held } = await renderAWithHeldReorder();
		const listCallsOnB = listLinksMock.mock.calls.length;

		held.resolve();
		await flush();

		expect(statusText(container)).toBe('');
		expect(q(container, 'links-reorder-error')).toBeNull();
		expect(listLinksMock.mock.calls.length).toBe(listCallsOnB);
		expect(rowNames(container)).toEqual(['B-Website', 'B-Scores']);
	});

	it("the pending guard is released on B either way — B's arrows are usable", async () => {
		const { container, held } = await renderAWithHeldReorder();

		held.reject(new Error('A boom'));
		await flush();

		expect(
			rowEls(container)[0].querySelector<HTMLButtonElement>('[data-testid="links-move-down"]')!
				.disabled
		).toBe(false);
	});

	it("A's createLink REJECTING after the switch paints no write alert on B", async () => {
		setAuthedWithTwoCollectives();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'sampledb' ? rows() : rowsBPair())
		);
		const held = deferred<string>();
		createLinkMock.mockReturnValue(held.promise);
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);
		});

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'A link' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'https://a.example' } });
		await fireEvent.submit(q(container, 'links-add-form')!);
		await waitFor(() => {
			expect(createLinkMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website', 'B-Scores']);
		});
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'B draft' } });

		held.reject(new Error('A create boom'));
		await flush();

		expect(q(container, 'links-write-error')).toBeNull();
		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('B draft');
	});

	it("A's createLink RESOLVING after the switch does not wipe B's draft", async () => {
		setAuthedWithTwoCollectives();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'sampledb' ? rows() : rowsBPair())
		);
		const held = deferred<string>();
		createLinkMock.mockReturnValue(held.promise);
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['Salvestused', 'Scores', 'Website']);
		});

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'A link' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'https://a.example' } });
		await fireEvent.submit(q(container, 'links-add-form')!);
		await waitFor(() => {
			expect(createLinkMock).toHaveBeenCalledTimes(1);
		});

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website', 'B-Scores']);
		});
		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'B draft' } });
		const listCallsOnB = listLinksMock.mock.calls.length;

		held.resolve('l-new');
		await flush();

		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('B draft');
		expect(q(container, 'links-write-error')).toBeNull();
		expect(listLinksMock.mock.calls.length).toBe(listCallsOnB);
	});
});

// (*MVOX:Tallis*)
