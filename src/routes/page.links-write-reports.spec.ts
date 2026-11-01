// @vitest-environment happy-dom
// #1049: each failed links write keeps one report, filed under the collective the write started
// in, and a late failure never shows on the next.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/paraglide/messages.js', async () =>
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
import { AuthExpiredError } from '$lib/entu/auth-expired';
import type { LinkRow } from '$lib/links/linkData';
import { dbEditRight } from '$lib/nav/dbRights';
import { selectedCollectiveDbStore, selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { deferred } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import {
	createLinkMock,
	deleteLinkMock,
	listLinksMock,
	reorderLinksMock,
	updateLinkMock
} from '$lib/testing/mocks/links';
import { cleanupClearAdmin } from '$lib/testing/pages/links';
import { q } from '$lib/testing/pages/dom';
import { signIn } from '$lib/testing/session';

useKeptProblems();

const A = { db: 'org-a', name: 'Org A', personId: 'person-p' };
const B = { db: 'org-b', name: 'Org B', personId: 'person-p' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// B reuses A's row ids, so a stale error keyed by id would show on B.
function rowsFor(db: string): LinkRow[] {
	const tag = db === A.db ? 'A' : 'B';
	return [1, 2].map((n) => ({
		id: `link-${n}`,
		name: `${tag}-link-${n}`,
		url: `https://${tag}.example/${n}`,
		description: null,
		displayOrder: n,
		ownerIds: ['person-p'],
		editorIds: ['person-p']
	}));
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	signIn({ collectives: [A, B], selected: A.db });
	dbEditRight.set('editor');
	listLinksMock.mockImplementation(async (cfg: { db: string }) => rowsFor(cfg.db));
	createLinkMock.mockResolvedValue('l-new');
	updateLinkMock.mockResolvedValue(undefined);
	reorderLinksMock.mockResolvedValue(undefined);
	deleteLinkMock.mockResolvedValue(undefined);
});

afterEach(() => {
	for (const mock of [createLinkMock, updateLinkMock, reorderLinksMock, deleteLinkMock]) {
		mock.mockReset();
	}
	listLinksMock.mockReset();
	vi.restoreAllMocks();
	cleanupClearAdmin();
});

async function renderPage(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'links-row')).not.toBeNull());
	return container;
}

async function click(c: HTMLElement, id: string): Promise<void> {
	await fireEvent.click(c.querySelector(`[data-testid="${id}"]`) as HTMLElement);
}

async function addLink(c: HTMLElement): Promise<void> {
	await fireEvent.input(q(c, 'links-add-name')!, { target: { value: 'New link' } });
	await fireEvent.input(q(c, 'links-add-url')!, { target: { value: 'new.example' } });
	await click(c, 'links-add-submit');
}

async function editLink(c: HTMLElement): Promise<void> {
	await click(c, 'links-edit');
	await waitFor(() => expect(q(c, 'links-edit-name')).not.toBeNull());
	await fireEvent.input(q(c, 'links-edit-name')!, { target: { value: 'Renamed' } });
	await click(c, 'links-edit-save');
}

const alerts = (c: HTMLElement) =>
	Array.from(c.querySelectorAll('[role="alert"]'), (el) => el.textContent?.trim());

interface Row {
	site: string;
	write: () => Mock;
	act: (c: HTMLElement) => Promise<void>;
	error: string;
	shown: string;
	action: string;
	detail?: string;
}

const ROWS: Row[] = [
	{
		site: 'create',
		write: () => createLinkMock,
		act: addLink,
		error: 'links-write-error',
		shown: 'links_create_failed',
		action: 'creating a link'
	},
	{
		site: 'update',
		write: () => updateLinkMock,
		act: editLink,
		error: 'links-write-error',
		shown: 'links_update_failed',
		action: 'updating a link'
	},
	{
		site: 'remove',
		write: () => deleteLinkMock,
		act: (c) => click(c, 'links-remove'),
		error: 'links-write-error',
		shown: 'links_remove_failed',
		action: 'removing a link'
	},
	{
		site: 'reorder',
		write: () => reorderLinksMock,
		act: (c) => click(c, 'links-move-down'),
		error: 'links-reorder-error',
		shown: 'links_reorder_failed',
		action: 'reordering the links'
	}
];

const kept = (row: Row) => [{ area: 'links', action: row.action, detail: row.detail ?? 'Error: boom-a' }];

describe('links — a failed write keeps one report (#1049)', () => {
	it.each(ROWS.map((row) => [row.site, row] as const))('%s', async (_, row) => {
		const c = await renderPage();
		row.write().mockRejectedValueOnce(new Error('boom-a'));

		await row.act(c);

		await waitFor(() => expect(q(c, row.error)?.textContent?.trim()).toBe(row.shown));
		await waitFor(async () => expect(await keptProblems()).toEqual(kept(row)));
	});

	it.each(ROWS.map((row) => [row.site, row] as const))(
		'%s, settling after a switch: kept under the collective it started in, nothing on the new one',
		async (_, row) => {
			const held = deferred<null>();
			const c = await renderPage();
			row.write().mockImplementationOnce(() => held.promise);
			const identityA = get(selectedCollectiveIdentityStore);
			await row.act(c);
			await waitFor(() => expect(row.write()).toHaveBeenCalledTimes(1));

			selectedCollectiveDbStore.set(B.db);
			await waitFor(() => expect(q(c, 'links-row-name')?.textContent).toBe('B-link-1'));
			const identityB = get(selectedCollectiveIdentityStore);
			const alertsOnB = alerts(c);
			held.reject(new Error('boom-a'));
			await settle();

			expect(await keptProblems(identityA)).toEqual(kept(row));
			expect(await keptProblems(identityB)).toEqual([]);
			expect(q(c, row.error)).toBeNull();
			expect(alerts(c)).toEqual(alertsOnB);
			expect(q(c, 'links-row-name')?.textContent).toBe('B-link-1');
		}
	);

	it.each([
		['an HTTP failure', () => Promise.resolve(new Response('{}', { status: 500 })), '500'],
		['a network throw', () => Promise.reject(new TypeError('Failed to fetch')), 'Failed to fetch']
	])('an update failing at its lookup step by %s keeps the step in the report', async (_, wire, tail) => {
		const c = await renderPage();
		const real = await vi.importActual<typeof import('$lib/links/linkActions')>(
			'$lib/links/linkActions'
		);
		updateLinkMock.mockImplementationOnce((cfg, id, fields) =>
			real.updateLink(cfg, id, fields, wire as unknown as typeof fetch)
		);

		await editLink(c);

		await waitFor(async () => {
			const [problem] = await keptProblems();
			expect(problem.action).toBe('updating a link');
			expect(problem.detail).toMatch(new RegExp(`^Error: updateLink lookup failed: .*${tail}`));
		});
	});

	it('a failed reorder whose re-read fails too keeps both, each once, and shows the stale alert', async () => {
		const c = await renderPage();
		reorderLinksMock.mockRejectedValueOnce(new Error('boom-a'));
		listLinksMock.mockRejectedValueOnce(new Error('reread-a'));

		await click(c, 'links-move-down');

		await waitFor(() =>
			expect(q(c, 'links-reorder-error')?.textContent?.trim()).toBe('links_reorder_failed_stale')
		);
		await waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'links', action: 'reordering the links', detail: 'Error: boom-a' },
				{ area: 'links', action: 'loading the links', detail: 'Error: reread-a' }
			])
		);
	});

	it('a re-read failing after a switch is kept under the collective it was read for', async () => {
		const held = deferred<LinkRow[]>();
		const c = await renderPage();
		const identityA = get(selectedCollectiveIdentityStore);
		listLinksMock.mockImplementationOnce(() => held.promise);
		await addLink(c);
		await waitFor(() => expect(listLinksMock).toHaveBeenCalledTimes(2));

		selectedCollectiveDbStore.set(B.db);
		await waitFor(() => expect(q(c, 'links-row-name')?.textContent).toBe('B-link-1'));
		const identityB = get(selectedCollectiveIdentityStore);
		held.reject(new Error('reread-a'));
		await settle();

		expect(await keptProblems(identityA)).toEqual([
			{ area: 'links', action: 'loading the links', detail: 'Error: reread-a' }
		]);
		expect(await keptProblems(identityB)).toEqual([]);
		expect(alerts(c)).toEqual([]);
	});

	it('a write refused for an expired session shows its error and keeps nothing', async () => {
		const c = await renderPage();
		createLinkMock.mockRejectedValueOnce(new AuthExpiredError());

		await addLink(c);

		await waitFor(() => expect(q(c, 'links-write-error')).not.toBeNull());
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('writes that succeed keep nothing', async () => {
		const c = await renderPage();

		await addLink(c);
		await waitFor(() => expect(createLinkMock).toHaveBeenCalledTimes(1));
		await settle();

		expect(q(c, 'links-write-error')).toBeNull();
		expect(await keptProblems()).toEqual([]);
	});
});
