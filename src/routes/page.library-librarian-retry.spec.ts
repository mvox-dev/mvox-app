// @vitest-environment happy-dom
// A late librarian answer from a retry must not overwrite a newer load (#546).
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
);

vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).activeMembersModule()
);

vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);

import Page from './library/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { get } from 'svelte/store';
import { librarianStore } from '$lib/library/librarianStore';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import {
	DB_A,
	DB_B,
	cleanupClearReset,
	seedTwoLibraries,
	setAuthedWithTwoCollectives
} from '$lib/testing/pages/library';
import { q } from '$lib/testing/pages/dom';

beforeEach(seedTwoLibraries);

afterEach(cleanupClearReset);

type Answer = { state: string; libraryId: string | null };

function answersForA(queue: Array<Promise<Answer>>) {
	resolveLibrarianMock.mockImplementation((cfg: { db: string }) =>
		cfg.db === DB_A
			? (queue.shift() ?? Promise.resolve({ state: 'librarian', libraryId: 'lib-a' }))
			: Promise.resolve({ state: 'librarian', libraryId: 'lib-b' })
	);
}

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

async function renderWithLibrarianError(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'librarian-retry-load')).not.toBeNull());
	return container;
}

describe('/library — #546 the librarian retry ignores a late answer', () => {
	it('a retry for A that answers after a switch to B leaves B\'s pickers', async () => {
		const retryA = deferred<Answer>();
		answersForA([Promise.resolve({ state: 'error', libraryId: null }), retryA.promise]);
		const container = await renderWithLibrarianError();

		await fireEvent.click(q(container, 'librarian-retry-load') as HTMLButtonElement);
		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() =>
			expect(q(container, 'bulk-checkout-work-select')?.textContent).toContain(
				'Cantique de Jean Racine'
			)
		);

		retryA.resolve({ state: 'librarian', libraryId: 'lib-a' });
		await settle();

		await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
			target: { value: 'work-b1' }
		});
		await waitFor(() => expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull());
		const editionSelect = q(container, 'bulk-checkout-edition-select') as HTMLSelectElement;
		expect([...editionSelect.options].map((o) => o.value)).toEqual(['', 'edition-b1']);
		await fireEvent.change(editionSelect, { target: { value: 'edition-b1' } });
		await waitFor(() => expect(q(container, 'bulk-checkout-member-list')).not.toBeNull());
		const members = container.querySelectorAll(
			'[data-testid="bulk-checkout-member-list"] input[type="checkbox"]'
		);
		expect(members.length).toBe(1);
		expect(get(librarianStore)).toBe('librarian');
	});

	it('of two retries, the first answering last is ignored', async () => {
		const first = deferred<Answer>();
		const second = deferred<Answer>();
		answersForA([
			Promise.resolve({ state: 'error', libraryId: null }),
			first.promise,
			second.promise
		]);
		const container = await renderWithLibrarianError();

		await fireEvent.click(q(container, 'librarian-retry-load') as HTMLButtonElement);
		await fireEvent.click(q(container, 'librarian-retry-load') as HTMLButtonElement);
		second.resolve({ state: 'librarian', libraryId: 'lib-a' });
		await waitFor(() => expect(q(container, 'librarian-tools')).not.toBeNull());

		first.resolve({ state: 'error', libraryId: null });
		await settle();

		expect(get(librarianStore)).toBe('librarian');
		expect(q(container, 'librarian-tools')).not.toBeNull();
		expect(q(container, 'librarian-retry-load')).toBeNull();
	});
});
