// @vitest-environment happy-dom
// #1049: each failed library write shows a translated message and is kept as one report.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('$lib/library/libraryRights', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);
vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);
vi.mock('$lib/seasons/entuSeasons', async () =>
	(await import('$lib/testing/mocks/seasons')).entuSeasonsModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireOverRealModule()
);

const { createEditionMock, createWorkMock } = vi.hoisted(() => ({
	createEditionMock: vi.fn(),
	createWorkMock: vi.fn()
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createWork: createWorkMock,
	createEdition: createEditionMock
}));

import Page from './library/+page.svelte';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { deferred } from '$lib/testing/entuFetchKit';
import { keptProblems, useKeptProblems } from '$lib/testing/keptProblems';
import { signIn } from '$lib/testing/session';
import {
	bulkCheckoutMock,
	createLendingMock,
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveMyLibraryIdMock,
	returnLendingMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { listRepertoireItemsMock, listSeasonsMock } from '$lib/testing/mocks/seasons';
import { DB_A, DB_B, expandEdition, expandWork, signInLibraryReader } from '$lib/testing/pages/library';
import { useLibraryPage } from '$lib/testing/pages/libraryPage';

useLibraryPage();
useKeptProblems();

// The background IndexedDB write must have had its chance before "nothing kept" means anything.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const copies = [
	{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' },
	{ id: 'copy-2', name: 'Copy #2', copyNumber: 2, editionId: 'edition-1' },
	{ id: 'copy-3', name: 'Copy #3', copyNumber: 3, editionId: 'edition-1' }
];
const lent = {
	id: 'lend-1',
	copyId: 'copy-2',
	memberId: 'member-a',
	assignedAt: '2026-07-01',
	assignedUntil: '',
	returnedAt: ''
};

function seedLibrarian(): void {
	listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Tallis' }]));
	listEditionsMock.mockResolvedValue(
		toListRead([{ id: 'edition-1', name: 'Urtext', publisher: 'B', externalLinks: [], files: [] }])
	);
	listCopiesMock.mockResolvedValue(toListRead(copies));
	listLendingsMock.mockResolvedValue(toListRead([lent]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada Lovelace']]));
	signInLibraryReader({ librarian: true, myLibraryId: 'lib-1', seasons: true });
	listAllEditionsMock.mockResolvedValue(
		toListRead([{ id: 'edition-1', name: 'Urtext', publisher: 'B', workId: 'work-1' }])
	);
	listAllCopiesMock.mockResolvedValue(toListRead(copies));
	listActiveMembersMock.mockResolvedValue(
		toListRead([
			{ memberId: 'member-a', personId: 'p-a', sectionIds: [] },
			{ memberId: 'member-b', personId: 'p-b', sectionIds: [] },
			{ memberId: 'member-c', personId: 'p-c', sectionIds: [] }
		])
	);
}

afterEach(() => {
	createWorkMock.mockReset();
	createEditionMock.mockReset();
	vi.restoreAllMocks();
});

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	seedLibrarian();
});

const q = (c: Element, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function openCopies(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => expect(q(container, 'library-work-work-1')).not.toBeNull());
	await expandWork(container, 'work-1');
	await expandEdition(container, 'edition-1');
	return container;
}

async function checkOutInline(container: HTMLElement): Promise<void> {
	const select = await waitFor(() => {
		const el = q(container, 'inline-checkout-copy-1') as HTMLSelectElement | null;
		expect(el?.querySelector('option[value="member-b"]')).not.toBeNull();
		return el!;
	});
	await fireEvent.change(select, { target: { value: 'member-b' } });
}

async function submitBulk(container: HTMLElement, count: number): Promise<void> {
	await waitFor(() => expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull());
	await fireEvent.change(q(container, 'bulk-checkout-edition-select')!, { target: { value: 'edition-1' } });
	const boxes = await waitFor(() => {
		const found = container.querySelectorAll('[data-testid="bulk-checkout-member-list"] input[type="checkbox"]');
		expect(found.length).toBeGreaterThanOrEqual(count);
		return [...found] as HTMLInputElement[];
	});
	for (const box of boxes.slice(0, count)) await fireEvent.click(box);
	await fireEvent.click(q(container, 'bulk-checkout-submit')!);
}

describe('#1049 checkout, return and bulk checkout: translated messages, one report each', () => {
	it('an inline checkout that fails shows the checkout message, not the raw error, and keeps one report', async () => {
		createLendingMock.mockRejectedValue(new Error('createLending POST failed: 500'));
		const container = await openCopies();

		await checkOutInline(container);

		await waitFor(() => expect(q(container, 'inline-checkout-error-copy-1')?.textContent).toBe('Checkout failed'));
		expect(container.textContent).not.toContain('createLending');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'checking out a copy', detail: 'Error: createLending POST failed: 500' }
			])
		);
	});

	it('a return that fails shows the return message, not the raw error, and keeps one report', async () => {
		returnLendingMock.mockRejectedValue(new Error('returnLending POST failed: 500'));
		const container = await openCopies();

		await waitFor(() => expect(q(container, 'library-return-copy-2')).not.toBeNull());
		await fireEvent.click(q(container, 'library-return-copy-2')!);

		await waitFor(() => expect(q(container, 'return-error')?.textContent?.trim()).toBe('Return failed'));
		expect(container.textContent).not.toContain('returnLending');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'returning a copy', detail: 'Error: returnLending POST failed: 500' }
			])
		);
	});

	it('an inline checkout written but not re-read says the list is stale, not that it failed', async () => {
		createLendingMock.mockResolvedValue(undefined);
		const container = await openCopies();
		listLendingsMock.mockRejectedValue(new Error('listLendings failed: HTTP 502'));

		await checkOutInline(container);

		await waitFor(() =>
			expect(q(container, 'inline-checkout-error-copy-1')?.textContent).toBe(
				'The loan list could not be refreshed. Reload the page.'
			)
		);
		expect(container.textContent).not.toContain('Checkout failed');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'refreshing the loans', detail: 'Error: listLendings failed: HTTP 502' }
			])
		);
	});

	it('a return written but not re-read says the list is stale, not that it failed', async () => {
		returnLendingMock.mockResolvedValue(undefined);
		const container = await openCopies();
		listLendingsMock.mockRejectedValue(new Error('listLendings failed: HTTP 502'));

		await waitFor(() => expect(q(container, 'library-return-copy-2')).not.toBeNull());
		await fireEvent.click(q(container, 'library-return-copy-2')!);

		await waitFor(() =>
			expect(q(container, 'return-error')?.textContent?.trim()).toBe(
				'The loan list could not be refreshed. Reload the page.'
			)
		);
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'refreshing the loans', detail: 'Error: listLendings failed: HTTP 502' }
			])
		);
	});

	it('a bulk checkout that throws shows the bulk message, not the raw error, and keeps one report', async () => {
		bulkCheckoutMock.mockRejectedValue(new Error('listCopies failed: HTTP 500'));
		const container = await openCopies();

		await submitBulk(container, 1);

		await waitFor(() => expect(q(container, 'bulk-checkout-error')?.textContent?.trim()).toBe('Bulk checkout failed'));
		expect(container.textContent).not.toContain('listCopies');
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'checking out copies', detail: 'Error: listCopies failed: HTTP 500' }
			])
		);
	});

	it('a bulk checkout where one copy fails says how many, and one report keeps that copy reason', async () => {
		bulkCheckoutMock.mockResolvedValue({
			succeeded: [{ ...lent, id: 'lend-2', copyId: 'copy-1', memberId: 'member-b' }],
			failed: [{ copyId: 'copy-3', error: 'createLending POST failed: 500' }]
		});
		const container = await openCopies();

		await submitBulk(container, 2);

		await waitFor(() =>
			expect(q(container, 'bulk-checkout-error')?.textContent?.trim()).toBe('Some checkouts failed: 1 of 2.')
		);
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{
					area: 'library',
					action: 'checking out copies',
					detail: '1 of 2 checkouts failed: copy-3: createLending POST failed: 500'
				}
			])
		);
	});

	it('a partial bulk failure whose loan re-read then throws shows both facts and keeps both reports', async () => {
		bulkCheckoutMock.mockResolvedValue({
			succeeded: [],
			failed: [{ copyId: 'copy-1', error: 'createLending POST failed: 500' }]
		});
		const container = await openCopies();
		listLendingsMock.mockRejectedValue(new Error('listLendings failed: HTTP 502'));

		await submitBulk(container, 1);

		await waitFor(() =>
			expect(q(container, 'bulk-checkout-error')?.textContent?.trim()).toBe(
				'Some checkouts failed: 1 of 1. The loan list could not be refreshed. Reload the page.'
			)
		);
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{
					area: 'library',
					action: 'checking out copies',
					detail: '1 of 1 checkouts failed: copy-1: createLending POST failed: 500'
				},
				{ area: 'library', action: 'refreshing the loans', detail: 'Error: listLendings failed: HTTP 502' }
			])
		);
	});

	it('a bulk copy refused for an expired session keeps no report', async () => {
		bulkCheckoutMock.mockResolvedValue({
			succeeded: [],
			failed: [{ copyId: 'copy-1', error: 'Entu returned 401 — session expired', expired: true }]
		});
		const container = await openCopies();

		await submitBulk(container, 1);

		await waitFor(() => expect(q(container, 'bulk-checkout-error')).not.toBeNull());
		await settle();
		expect(await keptProblems()).toEqual([]);
	});

	it('a return refused for an expired session keeps no report', async () => {
		returnLendingMock.mockRejectedValue(new AuthExpiredError());
		const container = await openCopies();

		await waitFor(() => expect(q(container, 'library-return-copy-2')).not.toBeNull());
		await fireEvent.click(q(container, 'library-return-copy-2')!);

		await waitFor(() => expect(q(container, 'return-error')).not.toBeNull());
		await settle();
		expect(await keptProblems()).toEqual([]);
	});
});

describe('#1049 create work and create edition: the message stays, one report each', () => {
	it('a create-work write that fails shows its message and keeps one report', async () => {
		createWorkMock.mockRejectedValue(new Error('createWork POST failed: 403'));
		const { container } = render(Page);
		await waitFor(() => expect(q(container, 'create-work-button')).not.toBeNull());
		await fireEvent.click(q(container, 'create-work-button')!);
		await fireEvent.input(q(container, 'create-work-name')!, { target: { value: 'Ave Maria' } });
		await fireEvent.click(q(container, 'create-work-submit')!);

		await waitFor(() => expect(q(container, 'create-work-error')?.textContent?.trim()).toBe('Could not create the work.'));
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'creating a work', detail: 'Error: createWork POST failed: 403' }
			])
		);
	});

	async function openEditionForm(container: HTMLElement): Promise<void> {
		await expandWork(container, 'work-1');
		await waitFor(() => expect(q(container, 'create-edition-button-work-1')).not.toBeNull());
		await fireEvent.click(q(container, 'create-edition-button-work-1')!);
		await waitFor(() => expect(q(container, 'create-edition-name-work-1')).not.toBeNull());
		await fireEvent.input(q(container, 'create-edition-name-work-1')!, { target: { value: 'Chorpartitur' } });
	}

	it('a create-edition write that fails shows its message and keeps one report', async () => {
		createEditionMock.mockRejectedValue(new Error('createEdition POST failed: 403'));
		const { container } = render(Page);
		await waitFor(() => expect(q(container, 'library-work-work-1')).not.toBeNull());
		await openEditionForm(container);
		await fireEvent.click(q(container, 'create-edition-submit-work-1')!);

		await waitFor(() =>
			expect(q(container, 'create-edition-error-work-1')?.textContent?.trim()).toBe('Could not create the edition.')
		);
		await vi.waitFor(async () =>
			expect(await keptProblems()).toEqual([
				{ area: 'library', action: 'creating an edition', detail: 'Error: createEdition POST failed: 403' }
			])
		);
	});

	it("a create-edition write failing after a switch shows nothing on the new page and files under the old collective", async () => {
		signIn({
			collectives: [
				{ db: DB_A, name: 'Sampledb', personId: 'person-p' },
				{ db: DB_B, name: 'Other Choir', personId: 'person-q' }
			]
		});
		listSeasonsMock.mockResolvedValue([]);
		listRepertoireItemsMock.mockResolvedValue([]);
		resolveMyLibraryIdMock.mockResolvedValue('lib-1');
		let rejectCreate: (e: Error) => void = () => {};
		createEditionMock.mockReturnValue(new Promise<string>((_, reject) => (rejectCreate = reject)));
		const { container } = render(Page);
		await waitFor(() => expect(q(container, 'library-work-work-1')).not.toBeNull());
		await openEditionForm(container);
		await fireEvent.click(q(container, 'create-edition-submit-work-1')!);
		await waitFor(() => expect(createEditionMock).toHaveBeenCalledTimes(1));

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => expect(listWorksMock.mock.calls.some(([cfg]) => cfg.db === DB_B)).toBe(true));
		await waitFor(() => expect(q(container, 'library-work-work-1')).not.toBeNull());
		await expandWork(container, 'work-1');
		const reopen = q(container, 'create-edition-button-work-1');
		if (reopen) await fireEvent.click(reopen);
		await waitFor(() => expect(q(container, 'create-edition-form-work-1')).not.toBeNull());
		rejectCreate(new Error('createEdition POST failed: 500'));

		await vi.waitFor(async () =>
			expect(await keptProblems({ db: DB_A, personId: 'person-p' })).toEqual([
				{ area: 'library', action: 'creating an edition', detail: 'Error: createEdition POST failed: 500' }
			])
		);
		expect(await keptProblems({ db: DB_B, personId: 'person-q' })).toEqual([]);
		expect(q(container, 'create-edition-error-work-1')).toBeNull();
	});
});

describe('#1049 a library write settling after a collective switch leaves the new page alone', () => {
	const A = { db: DB_A, personId: 'person-p' };
	const B = { db: DB_B, personId: 'person-q' };

	// Both collectives use the same ids, so anything stale from A lands visibly on B's rows.
	function seedTwo(): void {
		signIn({
			collectives: [
				{ db: DB_A, name: 'Sampledb', personId: 'person-p' },
				{ db: DB_B, name: 'Other Choir', personId: 'person-q' }
			]
		});
		listWorksMock.mockImplementation(async (cfg: { db: string }) =>
			toListRead([{ id: 'work-1', name: cfg.db === DB_A ? 'Erste Messe' : 'Zweite Messe', composer: '' }])
		);
		listLendingsMock.mockImplementation(async (cfg: { db: string }) =>
			toListRead(cfg.db === DB_A ? [lent] : [])
		);
		resolveMyLibraryIdMock.mockResolvedValue('lib-1');
	}

	async function onB(container: HTMLElement): Promise<void> {
		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => expect(q(container, 'library-work-work-1')?.textContent).toContain('Zweite Messe'));
		await expandWork(container, 'work-1');
		await expandEdition(container, 'edition-1');
		await waitFor(() => expect(q(container, 'library-copy-copy-1')).not.toBeNull());
	}

	async function keptUnderAOnly(action: string, detail: string): Promise<void> {
		await vi.waitFor(async () => expect(await keptProblems(A)).toEqual([{ area: 'library', action, detail }]));
		expect(await keptProblems(B)).toEqual([]);
	}

	it('a late inline checkout error shows nothing on the new page and files under the old collective', async () => {
		seedTwo();
		const write = deferred<void>();
		createLendingMock.mockReturnValue(write.promise);
		const container = await openCopies();
		await checkOutInline(container);
		await waitFor(() => expect(createLendingMock).toHaveBeenCalledTimes(1));

		await onB(container);
		write.reject(new Error('createLending POST failed: 500'));

		await keptUnderAOnly('checking out a copy', 'Error: createLending POST failed: 500');
		expect(q(container, 'inline-checkout-error-copy-1')).toBeNull();
	});

	it('a late return error shows nothing on the new page and files under the old collective', async () => {
		seedTwo();
		const write = deferred<void>();
		returnLendingMock.mockReturnValue(write.promise);
		const container = await openCopies();
		await waitFor(() => expect(q(container, 'library-return-copy-2')).not.toBeNull());
		await fireEvent.click(q(container, 'library-return-copy-2')!);
		await waitFor(() => expect(returnLendingMock).toHaveBeenCalledTimes(1));

		await onB(container);
		write.reject(new Error('returnLending POST failed: 500'));

		await keptUnderAOnly('returning a copy', 'Error: returnLending POST failed: 500');
		expect(q(container, 'return-error')).toBeNull();
	});

	it('a late bulk checkout error is not waiting in the new page panel', async () => {
		seedTwo();
		const write = deferred<never>();
		bulkCheckoutMock.mockReturnValue(write.promise);
		const container = await openCopies();
		await submitBulk(container, 1);
		await waitFor(() => expect(bulkCheckoutMock).toHaveBeenCalledTimes(1));

		await onB(container);
		write.reject(new Error('createLending POST failed: 500'));
		await keptUnderAOnly('checking out copies', 'Error: createLending POST failed: 500');
		await fireEvent.change(q(container, 'bulk-checkout-edition-select')!, { target: { value: 'edition-1' } });

		await waitFor(() => expect(q(container, 'bulk-checkout-member-list')).not.toBeNull());
		expect(q(container, 'bulk-checkout-error')).toBeNull();
	});

	it("a checkout landing after a switch does not paint the old collective's loans on the new page", async () => {
		seedTwo();
		const write = deferred<void>();
		createLendingMock.mockReturnValue(write.promise);
		const container = await openCopies();
		await checkOutInline(container);
		await waitFor(() => expect(createLendingMock).toHaveBeenCalledTimes(1));

		await onB(container);
		const out = { ...lent, id: 'lend-2', copyId: 'copy-1', memberId: 'member-b' };
		listLendingsMock.mockImplementation(async (cfg: { db: string }) =>
			toListRead(cfg.db === DB_A ? [lent, out] : [])
		);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-b', 'Ben Jonson']]));
		write.resolve();
		await settle();

		expect(q(container, 'library-copy-copy-1')?.textContent).not.toContain('Ben Jonson');
		expect(q(container, 'library-copy-copy-2')?.textContent).not.toContain('Out');
	});

	it('a late create-work error shows nothing on the new page and files under the old collective', async () => {
		seedTwo();
		const write = deferred<string>();
		createWorkMock.mockReturnValue(write.promise);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, 'create-work-button')).not.toBeNull());
		await fireEvent.click(q(container, 'create-work-button')!);
		await fireEvent.input(q(container, 'create-work-name')!, { target: { value: 'Ave Maria' } });
		await fireEvent.click(q(container, 'create-work-submit')!);
		await waitFor(() => expect(createWorkMock).toHaveBeenCalledTimes(1));

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => expect(q(container, 'library-work-work-1')?.textContent).toContain('Zweite Messe'));
		write.reject(new Error('createWork POST failed: 500'));

		await keptUnderAOnly('creating a work', 'Error: createWork POST failed: 500');
		expect(q(container, 'create-work-error')).toBeNull();
	});

	it('a work created after a switch is not inserted into the new collective list', async () => {
		seedTwo();
		const write = deferred<string>();
		createWorkMock.mockReturnValue(write.promise);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, 'create-work-button')).not.toBeNull());
		await fireEvent.click(q(container, 'create-work-button')!);
		await fireEvent.input(q(container, 'create-work-name')!, { target: { value: 'Ave Maria' } });
		await fireEvent.click(q(container, 'create-work-submit')!);
		await waitFor(() => expect(createWorkMock).toHaveBeenCalledTimes(1));

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => expect(q(container, 'library-work-work-1')?.textContent).toContain('Zweite Messe'));
		write.resolve('work-new');
		await settle();

		expect(q(container, 'library-work-work-new')).toBeNull();
		expect(container.textContent).not.toContain('Ave Maria created.');
	});
});

// (*MVOX:Josquin*)
