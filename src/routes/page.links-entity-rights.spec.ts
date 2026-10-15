// @vitest-environment happy-dom
// /links row controls check the right on the link they write, not on the database entity.
import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
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
const pageStub = vi.hoisted(() => ({ url: new URL('https://dev.mvox.eu/links') }));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './links/+page.svelte';
import type { LinkRow } from '$lib/links/linkData';
import { dbEditRight } from '$lib/nav/dbRights';
import { listLinksMock } from '$lib/testing/mocks/links';
import { cleanupClearResetAdminOnLine, rowEls, setAuthed } from '$lib/testing/pages/links';
import { goOffline } from '$lib/testing/networkSignal';
import { q } from '$lib/testing/pages/dom';

const ME = 'person-p';
type Grant = 'owner' | 'editor' | 'none';

function withGrants(grants: Grant[]): LinkRow[] {
	return grants.map((_, i) => ({
		id: `l-${i}`,
		name: `Link ${i}`,
		url: `https://x.example/${i}`,
		description: null,
		displayOrder: i + 1,
		ownerIds: grants[i] === 'owner' ? [ME] : ['someone-else'],
		editorIds: grants[i] === 'editor' ? [ME] : []
	}));
}

async function renderWith(grants: Grant[], db: 'editor' | 'not-editor' = 'editor'): Promise<HTMLElement> {
	listLinksMock.mockResolvedValue(withGrants(grants));
	dbEditRight.set(db);
	const { container } = render(Page);
	await waitFor(() => expect(rowEls(container).length).toBe(3));
	return container;
}

function controlsPerRow(container: HTMLElement, testid: string): boolean[] {
	return rowEls(container).map((r) => r.querySelector(`[data-testid="${testid}"]`) !== null);
}

beforeEach(setAuthed);
afterEach(cleanupClearResetAdminOnLine);

describe('#914 — each link control shows only to a person Entu lets write that link', () => {
	it('a db editor with no right on any link: the add form shows, no row has edit, remove or move', async () => {
		const container = await renderWith(['none', 'none', 'none']);
		expect(q(container, 'links-add-form')).not.toBeNull();
		for (const id of ['links-edit', 'links-remove', 'links-move-up', 'links-move-down']) {
			expect(controlsPerRow(container, id)).toEqual([false, false, false]);
		}
	});

	it('edit shows on exactly the links the person can edit (_owner or _editor)', async () => {
		const container = await renderWith(['owner', 'editor', 'none']);
		expect(controlsPerRow(container, 'links-edit')).toEqual([true, true, false]);
	});

	it('remove shows only on links the person owns: an _editor sees edit there, not remove', async () => {
		const container = await renderWith(['owner', 'editor', 'none']);
		expect(controlsPerRow(container, 'links-remove')).toEqual([true, false, false]);
	});

	it('move shows only when the person can edit every link the renumber writes', async () => {
		const some = await renderWith(['owner', 'editor', 'none']);
		expect(controlsPerRow(some, 'links-move-up')).toEqual([false, false, false]);
		expect(controlsPerRow(some, 'links-move-down')).toEqual([false, false, false]);
		cleanupClearResetAdminOnLine();
		setAuthed();
		const all = await renderWith(['owner', 'editor', 'editor']);
		expect(controlsPerRow(all, 'links-move-up')).toEqual([true, true, true]);
		expect(controlsPerRow(all, 'links-move-down')).toEqual([true, true, true]);
	});

	it('rights that did not load (absent on the row) show no row control', async () => {
		const unread: LinkRow[] = [
			{ id: 'l-a', name: 'A', url: 'a', description: null, displayOrder: 1 },
			{ id: 'l-b', name: 'B', url: 'b', description: null, displayOrder: 2 },
			{ id: 'l-c', name: 'C', url: 'c', description: null, displayOrder: 3 }
		];
		listLinksMock.mockResolvedValue(unread);
		dbEditRight.set('editor');
		const { container } = render(Page);
		await waitFor(() => expect(rowEls(container).length).toBe(3));
		expect(container.querySelector('[data-testid="links-edit"]')).toBeNull();
		expect(container.querySelector('[data-testid="links-move-up"]')).toBeNull();
	});
	it('offline: the reason shows to a person who sees a disabled link control without the db right', async () => {
		const owner = await renderWith(['owner', 'none', 'none'], 'not-editor');
		await goOffline();
		expect(q(owner, 'links-add-form')).toBeNull();
		expect(q(owner, 'links-write-unavailable')).not.toBeNull();
		cleanupClearResetAdminOnLine();
		setAuthed();
		const member = await renderWith(['none', 'none', 'none'], 'not-editor');
		await goOffline();
		expect(q(member, 'links-write-unavailable')).toBeNull();
	});
});

// (*MVOX:Josquin*)
