// @vitest-environment happy-dom
// The links list renders through ListOfStuff, with no filter or view control (#863).
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
import { adminStore } from '$lib/nav/adminStore';
import { listLinksMock } from '$lib/testing/mocks/links';
import { cleanupClearAdmin, rowEls, rows, setAuthed } from '$lib/testing/pages/links';
import { q } from '$lib/testing/pages/dom';

beforeEach(() => {
	setAuthed();
	listLinksMock.mockResolvedValue(rows());
});

afterEach(cleanupClearAdmin);

describe('/links — list of stuff', () => {
	it('puts the links list inside the list body, with no filter or view slot and no button for a member', async () => {
		adminStore.set('not-admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(rowEls(container).length).toBeGreaterThan(0);
		});

		expect(q(container, 'list-of-stuff-body')!.contains(q(container, 'links-list'))).toBe(true);
		expect(q(container, 'list-of-stuff-filter')).toBeNull();
		expect(q(container, 'list-of-stuff-view')).toBeNull();
		expect(q(container, 'list-of-stuff')!.querySelectorAll('button')).toHaveLength(0);
	});
});
