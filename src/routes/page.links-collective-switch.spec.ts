// @vitest-environment happy-dom
// /links resets on a collective switch and drops the old collective's late reads.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

function rowsA(): LinkRow[] {
	return [
		{ id: 'la-1', name: 'A-Archive', url: 'https://a.example/one', description: null, displayOrder: 1 },
		{ id: 'la-2', name: 'A-Scores', url: 'a.example/two', description: 'from A', displayOrder: 2 }
	];
}

function rowsB(): LinkRow[] {
	return [
		{ id: 'lb-1', name: 'B-Website', url: 'https://b.example', description: null, displayOrder: 1 }
	];
}

function setAuthedWithTwoCollectives() {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'other-choir', name: 'Other Choir', personId: 'person-q' }
		]
	});
}

beforeEach(() => {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
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

function rowNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('[data-testid="links-row"]')).map(
		(r) => r.querySelector('[data-testid="links-row-name"]')?.textContent?.trim() ?? ''
	);
}

describe('#256 pin 6 — a stale list read never repopulates the new collective (hold → switch → settle)', () => {
	it("collective A's read, settling AFTER a switch to B, leaves B's rows (and ONLY B's) on screen", async () => {
		const heldA = deferred<LinkRow[]>();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'sampledb' ? heldA.promise : Promise.resolve(rowsB())
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(listLinksMock).toHaveBeenCalled();
		});
		expect(rowNames(container)).toEqual([]);

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});

		heldA.resolve(rowsA());
		await Promise.resolve();
		await Promise.resolve();
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect(container.textContent).not.toContain('A-Archive');
		expect(container.textContent).not.toContain('A-Scores');
	});

	it("a stale read REJECTING after the switch neither surfaces an error over B's list nor clears it", async () => {
		const heldA = deferred<LinkRow[]>();
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'sampledb' ? heldA.promise : Promise.resolve(rowsB())
		);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { container } = render(Page);
		await waitFor(() => {
			expect(listLinksMock).toHaveBeenCalled();
		});
		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});

		heldA.reject(new Error('stale wire failure'));
		await Promise.resolve();
		await Promise.resolve();
		expect(rowNames(container)).toEqual(['B-Website']);
		expect(q(container, 'links-load-error')).toBeNull();
		consoleError.mockRestore();
	});
});

describe('#256 pin 6 — page state resets on a collective switch', () => {
	it("typed add-form draft from collective A does not survive into B (a cross-collective draft is the #299 bug class)", async () => {
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'sampledb' ? rowsA() : rowsB())
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['A-Archive', 'A-Scores']);
		});

		await fireEvent.input(q(container, 'links-add-name')!, { target: { value: 'Draft name' } });
		await fireEvent.input(q(container, 'links-add-url')!, { target: { value: 'draft.example' } });

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect((q(container, 'links-add-name') as HTMLInputElement).value).toBe('');
		expect((q(container, 'links-add-url') as HTMLInputElement).value).toBe('');
	});

	it('an OPEN edit form from collective A is not left open over B rows', async () => {
		listLinksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'sampledb' ? rowsA() : rowsB())
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['A-Archive', 'A-Scores']);
		});
		await fireEvent.click(
			container
				.querySelectorAll('[data-testid="links-row"]')[0]
				.querySelector('[data-testid="links-edit"]')!
		);
		expect(q(container, 'links-edit-name')).not.toBeNull();

		selectedCollectiveDbStore.set('other-choir');
		await waitFor(() => {
			expect(rowNames(container)).toEqual(['B-Website']);
		});
		expect(q(container, 'links-edit-name')).toBeNull();
	});
});

describe('#256 structural — the NEW page uses the extracted route-load machine', () => {
	it('src/routes/links/+page.svelte imports createRouteLoadMachine from $lib/loading/routeLoad (not a hand-rolled in-file counter)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/routes/links/+page.svelte'),
			'utf-8'
		);
		expect(source).toContain('createRouteLoadMachine');
		expect(source).toContain('$lib/loading/routeLoad');
	});
});

// (*MVOX:Tallis*)
