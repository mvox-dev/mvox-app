// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		library_title: () => 'Library',
		library_no_collective: () => 'Select a collective to view the library.',
		library_load_error: () => 'Something went wrong loading the library.',
		library_retry: () => 'Retry',
		library_empty: () => 'Nothing in the library yet.',
		library_work_composer_unknown: () => 'Unknown composer',
		library_editions_empty: () => 'No editions yet.',
		library_edition_publisher_unknown: () => 'Unknown publisher',
		library_copies_empty: () => 'No copies yet.',
		library_copy_available: () => 'Available',
		library_copy_lent_to: (p: { name: string }) => `Out — ${p.name}`,
		library_borrower_unknown: () => 'an unnamed member',
		library_copy_name_unknown: () => 'Untitled copy',
		library_lent_since: (p: { date: string }) => `since ${p.date}`,
		library_node_load_error: () => 'Could not load.',
		library_node_retry: () => 'Retry',
		library_librarian_tools: () => 'Librarian tools',
		library_librarian_load_error: () => 'Could not check librarian access.',
		library_librarian_retry: () => 'Retry',
		library_my_loans_title: (p: { count: number }) => `My loans (${p.count})`,
		library_my_loans_copy_label: (p: { copyName: string }) => `${p.copyName}`,
		library_my_loans_overdue: () => 'Overdue',
		library_checkout_submit: () => 'Checkout',
		library_return: () => 'Return',
		library_bulk_checkout_title: () => 'Bulk checkout',
		library_bulk_checkout_edition_placeholder: () => 'Select edition',
		library_bulk_checkout_work_placeholder: () => 'Select work',
		library_bulk_checkout_availability: (p: { available: number; total: number }) =>
			`${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_work_availability: (p: { available: number; total: number }) =>
			`${p.available}/${p.total}`,
		library_inline_checkout_placeholder: () => 'Select member',
		library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_inline_checkout_error: () => 'Checkout failed',
		library_copy_sort_label: () => 'Sort copies by',
		library_copy_sort_nr: () => 'Nr',
		library_copy_sort_member: () => 'Member',
		library_copy_sort_since: () => 'Since',
		library_available_summary: (p: { count: number }) => `${p.count} copies available for lending`,
		library_create_work_button: () => 'Add work',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_cancel: () => 'Cancel',
		library_create_work_name_required: () => 'Work title is required.',
		library_create_work_created: (p: { name: string }) => `${p.name} created.`,
		library_create_work_error: () => 'Could not create the work.',
		library_create_edition_button: () => 'Add edition',
		library_create_edition_name_label: () => 'Name',
		library_create_edition_publisher_label: () => 'Publisher',
		library_create_edition_submit: () => 'Create edition',
		library_create_edition_cancel: () => 'Cancel',
		library_create_edition_name_required: () => 'Edition name is required.',
		library_create_edition_created: (p: { name: string }) => `${p.name} created.`,
		library_create_edition_error: () => 'Could not create the edition.'
	}
}));

const {
	listWorksMock,
	listEditionsMock,
	listCopiesMock,
	listAllEditionsMock,
	listAllCopiesMock,
	listLendingsMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock,
	resolveCopyChainsMock
} = vi.hoisted(() => ({
	listWorksMock: vi.fn(),
	listEditionsMock: vi.fn(),
	listCopiesMock: vi.fn(),
	listAllEditionsMock: vi.fn(),
	listAllCopiesMock: vi.fn(),
	listLendingsMock: vi.fn(),
	resolveBorrowerNamesMock: vi.fn(),
	resolveCopyNamesMock: vi.fn(),
	resolveCopyChainsMock: vi.fn()
}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>(
		'$lib/library/libraryData'
	);
	return {
		...actual, // keep the real, pure derive* helpers
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllEditions: listAllEditionsMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock,
		resolveCopyNames: resolveCopyNamesMock,
		resolveCopyChains: resolveCopyChainsMock
	};
});
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

const { resolveLibrarianMock } = vi.hoisted(() => ({ resolveLibrarianMock: vi.fn() }));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>(
		'$lib/library/librarianStore'
	);
	return {
		...actual, // keep the real writable stores + resetLibrarian
		resolveLibrarian: resolveLibrarianMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

vi.mock('$lib/library/lendingActions', () => ({
	createLending: vi.fn(),
	returnLending: vi.fn(),
	bulkCheckout: vi.fn()
}));

const { listSeasonsMock } = vi.hoisted(() => ({ listSeasonsMock: vi.fn() }));
vi.mock('$lib/seasons/entuSeasons', async () => {
	const actual = await vi.importActual<typeof import('$lib/seasons/entuSeasons')>(
		'$lib/seasons/entuSeasons'
	);
	return {
		...actual, // keep resolveTypeId etc. + the EntuCfg type surface
		listSeasons: listSeasonsMock
	};
});
const { listRepertoireItemsMock } = vi.hoisted(() => ({ listRepertoireItemsMock: vi.fn() }));
vi.mock('$lib/repertoire/repertoireData', async () => {
	const actual = await vi.importActual<typeof import('$lib/repertoire/repertoireData')>(
		'$lib/repertoire/repertoireData'
	);
	return {
		...actual,
		listRepertoireItems: listRepertoireItemsMock
	};
});

const { createEditionMock, createWorkMock } = vi.hoisted(() => ({
	createEditionMock: vi.fn(),
	createWorkMock: vi.fn()
}));
vi.mock('$lib/entity/entityCreate', async () => {
	const actual = await vi.importActual<typeof import('$lib/entity/entityCreate')>(
		'$lib/entity/entityCreate'
	);
	return {
		...actual,
		createWork: createWorkMock,
		createEdition: createEditionMock
	};
});

import Page from './library/+page.svelte';
import { clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function setAuthedWithOneCollective() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
	listSeasonsMock.mockResolvedValue([]);
	listRepertoireItemsMock.mockResolvedValue([]);
}

function mockBaselineLibrary() {
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' },
		{ id: 'work-2', name: 'Berliner Messe', composer: 'Arvo Pärt' }
	]));
	listEditionsMock.mockImplementation(async (_cfg: unknown, workId: string) =>
		toListRead(
			workId === 'work-1'
				? [
						{
							id: 'edition-1',
							name: 'Vocal score',
							publisher: 'Novello',
							externalLinks: [],
							files: []
						}
					]
				: []
		)
	);
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
}

function mockLibrarian() {
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
}

afterEach(() => {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveCopyNamesMock.mockReset();
	resolveCopyChainsMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	listSeasonsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	createWorkMock.mockReset();
	createEditionMock.mockReset();
	resetAppState();
});

async function renderReady(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="library-work-work-2"]')).not.toBeNull();
	});
	return container;
}

async function expandWork(container: HTMLElement, workId: string): Promise<void> {
	await fireEvent.click(
		container.querySelector(`[data-testid="library-work-toggle-${workId}"]`) as Element
	);
	await waitFor(() => {
		expect(container.querySelector(`#library-editions-${workId}`)).not.toBeNull();
	});
}

describe('#271 — create-edition control placement on /library (integration)', () => {
	it('a POPULATED work offers it: the button renders INSIDE #library-editions-{workId}, alongside the edition list (sibling after the list, not a replacement of it)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const container = await renderReady();
		await expandWork(container, 'work-1');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
			expect(
				container.querySelector('[data-testid="create-edition-button-work-1"]')
			).not.toBeNull();
		});
		const wrapper = container.querySelector('#library-editions-work-1') as HTMLElement;
		expect(wrapper.querySelector('[data-testid="create-edition-button-work-1"]')).not.toBeNull();
		const button = container.querySelector(
			'[data-testid="create-edition-button-work-1"]'
		) as HTMLButtonElement;
		expect(button.tagName).toBe('BUTTON');
		expect(button.textContent).toContain('Add edition');
	});

	it('a ZERO-EDITIONS work offers it TOO — the empty message and the button render together (the empty branch is mutually exclusive with the list branch, so an in-branch insert would hide the control exactly when a new work needs it most)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const container = await renderReady();
		await expandWork(container, 'work-2');

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="create-edition-button-work-2"]')
			).not.toBeNull();
		});
		const wrapper = container.querySelector('#library-editions-work-2') as HTMLElement;
		expect(wrapper.textContent).toContain('No editions yet.');
		expect(wrapper.querySelector('[data-testid="create-edition-button-work-2"]')).not.toBeNull();
	});

	it('a work whose editions are still LOADING does not offer it', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		listEditionsMock.mockImplementation((_cfg: unknown, workId: string) =>
			workId === 'work-2'
				? new Promise(() => {})
				: Promise.resolve(
						toListRead([
							{
								id: 'edition-1',
								name: 'Vocal score',
								publisher: 'Novello',
								externalLinks: [],
								files: []
							}
						])
					)
		);

		const container = await renderReady();
		await expandWork(container, 'work-2');

		expect(container.querySelector('[data-testid="create-edition-button-work-2"]')).toBeNull();
	});

	it('a work whose edition read ERRORED does not offer it — the retry affordance owns that state', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		listEditionsMock.mockImplementation((_cfg: unknown, workId: string) =>
			workId === 'work-2' ? Promise.reject(new Error('boom')) : Promise.resolve(toListRead([]))
		);

		const container = await renderReady();
		await expandWork(container, 'work-2');

		await waitFor(() => {
			expect(container.querySelector('#library-editions-work-2')?.textContent).toContain(
				'Could not load.'
			);
		});
		expect(container.querySelector('[data-testid="create-edition-button-work-2"]')).toBeNull();
	});

	it('ABSENT (not disabled) for a non-librarian — the editions still render (inline gate on the tree, fail-closed)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const container = await renderReady();
		await expandWork(container, 'work-1');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid^="create-edition-"]')).toHaveLength(0);
	});

	it('hidden while resolveLibrarian is still pending (hidden-if-undeterminable)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockReturnValue(new Promise(() => {}));

		const container = await renderReady();
		await expandWork(container, 'work-1');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid^="create-edition-"]')).toHaveLength(0);
	});
});

describe('#271 — form state is keyed per work (expandedWorks is a Set: several works open at once)', () => {
	it('opening the form under work-2 leaves work-1 formless, and what was typed under work-2 never appears under work-1', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const container = await renderReady();
		await expandWork(container, 'work-1');
		await expandWork(container, 'work-2');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="create-edition-button-work-1"]')
			).not.toBeNull();
			expect(
				container.querySelector('[data-testid="create-edition-button-work-2"]')
			).not.toBeNull();
		});

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-button-work-2"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="create-edition-form-work-1"]')).toBeNull();

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Chorbuch a cappella' } }
		);

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-button-work-1"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-1"]')).not.toBeNull();
		});
		expect(
			(container.querySelector('[data-testid="create-edition-name-work-1"]') as HTMLInputElement)
				.value
		).toBe('');
	});
});

async function renderWithFormOpen(workId = 'work-2'): Promise<HTMLElement> {
	mockBaselineLibrary();
	setAuthedWithOneCollective();
	mockLibrarian();
	const container = await renderReady();
	await expandWork(container, workId);
	await waitFor(() => {
		expect(
			container.querySelector(`[data-testid="create-edition-button-${workId}"]`)
		).not.toBeNull();
	});
	await fireEvent.click(
		container.querySelector(`[data-testid="create-edition-button-${workId}"]`) as Element
	);
	await waitFor(() => {
		expect(container.querySelector(`[data-testid="create-edition-form-${workId}"]`)).not.toBeNull();
	});
	return container;
}

describe('#271 — inline create-edition form', () => {
	it('no form in the DOM until the button is clicked; clicking reveals the inline form with a name input and a publisher input, both labelled, plus a submit control', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const container = await renderReady();
		await expandWork(container, 'work-2');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="create-edition-button-work-2"]')
			).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		expect(container.querySelector('[data-testid="create-edition-name-work-2"]')).toBeNull();

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-button-work-2"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).not.toBeNull();
		});
		const nameInput = container.querySelector(
			'[data-testid="create-edition-name-work-2"]'
		) as HTMLInputElement;
		const publisherInput = container.querySelector(
			'[data-testid="create-edition-publisher-work-2"]'
		) as HTMLInputElement;
		expect(nameInput).not.toBeNull();
		expect(publisherInput).not.toBeNull();
		expect(nameInput.tagName).toBe('INPUT');
		expect(publisherInput.tagName).toBe('INPUT');
		expect(nameInput.getAttribute('aria-label') || nameInput.labels?.length).toBeTruthy();
		expect(publisherInput.getAttribute('aria-label') || publisherInput.labels?.length).toBeTruthy();
		expect(container.querySelector('[data-testid="create-edition-submit-work-2"]')).not.toBeNull();
	});

	it('auto-focuses the name input the instant the form opens', async () => {
		const container = await renderWithFormOpen();
		const nameInput = container.querySelector(
			'[data-testid="create-edition-name-work-2"]'
		) as HTMLInputElement;
		await waitFor(() => {
			expect(document.activeElement).toBe(nameInput);
		});
	});

	it('the inline form is a group, not a dialog — it implements no dialog focus contract', async () => {
		const container = await renderWithFormOpen();

		const form = container.querySelector('[data-testid="create-edition-form-work-2"]') as HTMLElement;
		expect(form.getAttribute('role')).toBe('group');
		expect(form.getAttribute('aria-label')).toBeTruthy();
	});
});

describe('#271 — the form is escapable, and open/close CLEAR state', () => {
	it('cancel closes the form and restores the entry-point button — no write', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-cancel-work-2"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="create-edition-button-work-2"]')).not.toBeNull();
		expect(createEditionMock).not.toHaveBeenCalled();
	});

	it('cancel discards what was typed — reopening starts from empty fields with no stale error', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Chorbuch' } }
		);
		await fireEvent.input(
			container.querySelector(
				'[data-testid="create-edition-publisher-work-2"]'
			) as HTMLInputElement,
			{ target: { value: 'Carus' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-cancel-work-2"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-button-work-2"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-button-work-2"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-name-work-2"]')).not.toBeNull();
		});
		expect(
			(container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement)
				.value
		).toBe('');
		expect(
			(
				container.querySelector(
					'[data-testid="create-edition-publisher-work-2"]'
				) as HTMLInputElement
			).value
		).toBe('');
		expect(container.querySelector('[data-testid="create-edition-error-work-2"]')).toBeNull();
	});

	it('reopening after a validation error starts clean — the error does not survive the close', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-error-work-2"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-cancel-work-2"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-button-work-2"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-button-work-2"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="create-edition-error-work-2"]')).toBeNull();
	});

	it('opening the form clears the previous success announcement — a fresh attempt owns the live region', async () => {
		const container = await renderWithFormOpen();
		createEditionMock.mockResolvedValue('edition-new');

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Chorbuch' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);
		await waitFor(() => {
			const status = container.querySelector(
				'[data-testid="create-edition-status-work-2"]'
			) as HTMLElement;
			expect(status?.textContent?.trim()).toBe('Chorbuch created.');
		});

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-button-work-2"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).not.toBeNull();
		});
		const status = container.querySelector(
			'[data-testid="create-edition-status-work-2"]'
		) as HTMLElement;
		expect(status.textContent?.trim()).toBe('');
	});

	it('Escape in the name input closes the form', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ key: 'Escape' }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		});
		expect(createEditionMock).not.toHaveBeenCalled();
	});

	it('Escape in the publisher input closes the form too', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector(
				'[data-testid="create-edition-publisher-work-2"]'
			) as HTMLInputElement,
			{ key: 'Escape' }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		});
		expect(createEditionMock).not.toHaveBeenCalled();
	});

	it('Escape works while focus is on the Submit button, not just the inputs', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as HTMLButtonElement,
			{ key: 'Escape', bubbles: true }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		});
		expect(createEditionMock).not.toHaveBeenCalled();
	});

	it('Escape works while focus is on the Cancel button, not just the inputs', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-edition-cancel-work-2"]') as HTMLButtonElement,
			{ key: 'Escape', bubbles: true }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		});
		expect(createEditionMock).not.toHaveBeenCalled();
	});
});

function expectTouchTarget(container: HTMLElement, testid: string): void {
	const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
	expect(el, `${testid} must be in the DOM`).not.toBeNull();
	expect(
		Array.from((el as HTMLElement).classList),
		`${testid} must reserve a 44px-tall touch target (min-h-11)`
	).toContain('min-h-11');
}

describe('#271 — create-edition controls are focusable, labelled 44px touch targets', () => {
	it('the entry-point button reserves min-h-11, is keyboard-reachable (no negative tabindex) and carries its accessible name as text', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const container = await renderReady();
		await expandWork(container, 'work-2');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="create-edition-button-work-2"]')
			).not.toBeNull();
		});
		expectTouchTarget(container, 'create-edition-button-work-2');
		const button = container.querySelector(
			'[data-testid="create-edition-button-work-2"]'
		) as HTMLButtonElement;
		expect(button.getAttribute('tabindex')).not.toBe('-1');
		expect(button.textContent?.trim()).toBeTruthy();
	});

	it('every control inside the open form reserves min-h-11 (both inputs, submit, cancel)', async () => {
		const container = await renderWithFormOpen();

		expectTouchTarget(container, 'create-edition-name-work-2');
		expectTouchTarget(container, 'create-edition-publisher-work-2');
		expectTouchTarget(container, 'create-edition-submit-work-2');
		expectTouchTarget(container, 'create-edition-cancel-work-2');
	});

	it('the long lv/uk strings must WRAP inside the ml-4-indented tree under max-w-md — no whitespace-nowrap / truncate on the button labels (class contract; happy-dom computes no layout)', async () => {
		const container = await renderWithFormOpen();

		await expandWork(container, 'work-1');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="create-edition-button-work-1"]')
			).not.toBeNull();
		});
		for (const testid of [
			'create-edition-button-work-1',
			'create-edition-submit-work-2',
			'create-edition-cancel-work-2'
		]) {
			const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
			const classes = Array.from(el.classList);
			expect(
				classes,
				`${testid}: long lv/uk copy must wrap, not overflow the indented tree column`
			).not.toContain('whitespace-nowrap');
			expect(classes, `${testid}: label text must never be truncated`).not.toContain('truncate');
		}
	});
});

describe('#271 — blank name is a field error naming the field, never a write', () => {
	it('submitting an empty name shows the required-field message and never calls createEdition', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-error-work-2"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-edition-error-work-2"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Edition name is required.');
		expect(err.textContent).not.toContain('Could not create the edition.');
		expect(createEditionMock).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).not.toBeNull();
	});

	it('a whitespace-only name is blank too', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: '   ' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-error-work-2"]')).not.toBeNull();
		});
		expect(createEditionMock).not.toHaveBeenCalled();
	});
});

describe('#271 — submitting calls createEdition with THE WORK id and appends locally', () => {
	it('calls createEdition with the loop-context work id (NEVER libraryEntityId), appends the new edition under the ZERO-EDITIONS work, announces, closes — no listEditions refetch', async () => {
		const container = await renderWithFormOpen('work-2');
		createEditionMock.mockResolvedValue('edition-new');
		const editionReadsBefore = listEditionsMock.mock.calls.length;

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Missa brevis' } }
		);
		await fireEvent.input(
			container.querySelector(
				'[data-testid="create-edition-publisher-work-2"]'
			) as HTMLInputElement,
			{ target: { value: 'Carus-Verlag' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);

		await waitFor(() => expect(createEditionMock).toHaveBeenCalledTimes(1));
		const [cfgArg, payload] = createEditionMock.mock.calls[0];
		expect(cfgArg).toEqual({ db: 'sampledb', token: 'jwt-abc' });
		expect(payload).toEqual({
			name: 'Missa brevis',
			publisher: 'Carus-Verlag',
			workId: 'work-2'
		});

		await waitFor(() => {
			const row = container.querySelector('[data-testid="library-edition-edition-new"]');
			expect(row).not.toBeNull();
			expect(row?.textContent).toContain('Missa brevis');
			expect(row?.textContent).toContain('Carus-Verlag');
		});
		const wrapper = container.querySelector('#library-editions-work-2') as HTMLElement;
		expect(wrapper.querySelector('[data-testid="library-edition-edition-new"]')).not.toBeNull();
		expect(wrapper.textContent).not.toContain('No editions yet.');
		expect(listEditionsMock.mock.calls.length).toBe(editionReadsBefore);

		const status = container.querySelector(
			'[data-testid="create-edition-status-work-2"]'
		) as HTMLElement;
		expect(status.getAttribute('role')).toBe('status');
		expect(status.textContent?.trim()).toBe('Missa brevis created.');

		expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		expect(container.querySelector('[data-testid="create-edition-button-work-2"]')).not.toBeNull();
	});

	it('on a POPULATED work the new edition is appended AT THE END — the existing edition stays, order [existing, new] (no ordering spec exists; listEditions applies no sort)', async () => {
		const container = await renderWithFormOpen('work-1');
		createEditionMock.mockResolvedValue('edition-new');

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-1"]') as HTMLInputElement,
			{ target: { value: 'Full score' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-1"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-new"]')).not.toBeNull();
		});
		const wrapper = container.querySelector('#library-editions-work-1') as HTMLElement;
		const rows = Array.from(
			wrapper.querySelectorAll(':scope > [data-testid^="library-edition-"]')
		).map((r) => r.getAttribute('data-testid'));
		expect(rows).toEqual(['library-edition-edition-1', 'library-edition-edition-new']);
	});

	it('an omitted publisher still submits — blank stays blank on the payload (the data layer, not the page, owns omit-when-blank), and the row falls back to the publisher-unknown label', async () => {
		const container = await renderWithFormOpen('work-2');
		createEditionMock.mockResolvedValue('edition-new');

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Missa brevis' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);

		await waitFor(() => expect(createEditionMock).toHaveBeenCalledTimes(1));
		const [, payload] = createEditionMock.mock.calls[0];
		expect(payload).toEqual({
			name: 'Missa brevis',
			publisher: '',
			workId: 'work-2'
		});
		await waitFor(() => {
			const row = container.querySelector('[data-testid="library-edition-edition-new"]');
			expect(row).not.toBeNull();
			expect(row?.textContent).toContain('Unknown publisher');
		});
	});
});

describe('#271 — a missing precondition fails LOUDLY, never silently', () => {
	it('a librarian whose token vanished gets the 401 handling: the error, the form open with the typed values', async () => {
		const container = await renderWithFormOpen('work-2');
	createEditionMock.mockImplementation(async (cfg: { token: string }) => {
		if (cfg.token) return 'edition-new';
		throw Object.assign(new Error('no token'), { name: 'AuthExpiredError' });
	});

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Missa brevis' } }
		);
		clearAll({ preserveProvider: false });

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-error-work-2"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-edition-error-work-2"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Could not create the edition.');
		expect(createEditionMock).toHaveBeenCalledTimes(1);
		expect(createEditionMock.mock.calls[0][0]).toEqual({ db: 'sampledb', token: '' });
		expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).not.toBeNull();
		expect(
			(container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement)
				.value
		).toBe('Missa brevis');
	});
});

describe('#271 — the create write can fail in transport', () => {
	it('a rejected createEdition surfaces the error, keeps the form open with what was typed, and inserts NOTHING locally', async () => {
		const container = await renderWithFormOpen('work-2');
		createEditionMock.mockRejectedValue(new Error('HTTP 403'));

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Missa brevis' } }
		);
		await fireEvent.input(
			container.querySelector(
				'[data-testid="create-edition-publisher-work-2"]'
			) as HTMLInputElement,
			{ target: { value: 'Carus-Verlag' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-error-work-2"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-edition-error-work-2"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Could not create the edition.');

		expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).not.toBeNull();
		expect(
			(container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement)
				.value
		).toBe('Missa brevis');
		expect(
			(
				container.querySelector(
					'[data-testid="create-edition-publisher-work-2"]'
				) as HTMLInputElement
			).value
		).toBe('Carus-Verlag');

		expect(container.querySelector('[data-testid="library-edition-edition-new"]')).toBeNull();
		expect(container.querySelector('#library-editions-work-2')?.textContent).toContain(
			'No editions yet.'
		);
		const status = container.querySelector(
			'[data-testid="create-edition-status-work-2"]'
		) as HTMLElement;
		expect(status.textContent?.trim()).toBe('');
	});
});

describe('#271 — the create is not double-submittable', () => {
	it('a second click while the first create is in flight issues no second POST, and the submit control is disabled meanwhile', async () => {
		const container = await renderWithFormOpen('work-2');
		let resolveCreate: (id: string) => void = () => {};
		createEditionMock.mockReturnValue(
			new Promise<string>((resolve) => {
				resolveCreate = resolve;
			})
		);

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Missa brevis' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);

		await waitFor(() => expect(createEditionMock).toHaveBeenCalledTimes(1));
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="create-edition-submit-work-2"]'
			) as HTMLButtonElement;
			expect(submit.disabled).toBe(true);
		});

		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-2"]') as Element
		);
		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ key: 'Enter' }
		);
		expect(createEditionMock).toHaveBeenCalledTimes(1);

		resolveCreate('edition-new');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-new"]')).not.toBeNull();
		});
		expect(createEditionMock).toHaveBeenCalledTimes(1);
	});
});

describe('#271 — the local insert is generation-guarded against a mid-flight collective switch', () => {
	it('a create that resolves AFTER the collective switched inserts NOTHING into the new tree and announces nothing — the switched-to work re-fetches its editions instead of serving a phantom cache', async () => {
		signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }, { db: 'secondchoir', name: 'Second Choir', personId: 'person-s' }] });
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		findMyMemberIdMock.mockResolvedValue(null);
		resolveCopyNamesMock.mockResolvedValue(new Map());
		resolveCopyChainsMock.mockResolvedValue(new Map());
		listAllEditionsMock.mockResolvedValue(toListRead([]));
		listAllCopiesMock.mockResolvedValue(toListRead([]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));
		listSeasonsMock.mockResolvedValue([]);
		listRepertoireItemsMock.mockResolvedValue([]);
		listWorksMock.mockImplementation(async (cfg: { db: string }) =>
			toListRead([
				{
					id: 'work-1',
					name: cfg.db === 'sampledb' ? 'Erste Messe' : 'Zweite Messe',
					composer: ''
				}
			])
		);
		listEditionsMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')?.textContent).toContain(
				'Erste Messe'
			);
		});
		await expandWork(container, 'work-1');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="create-edition-button-work-1"]')
			).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-button-work-1"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-name-work-1"]')).not.toBeNull();
		});
		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-1"]') as HTMLInputElement,
			{ target: { value: 'Chorpartitur' } }
		);

		let resolveCreate: (id: string) => void = () => {};
		createEditionMock.mockReturnValue(
			new Promise<string>((resolve) => {
				resolveCreate = resolve;
			})
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-edition-submit-work-1"]') as Element
		);
		await waitFor(() => expect(createEditionMock).toHaveBeenCalledTimes(1));
		expect(createEditionMock.mock.calls[0][0]).toEqual({ db: 'sampledb', token: 'jwt-abc' });

		selectedCollectiveDbStore.set('secondchoir');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')?.textContent).toContain(
				'Zweite Messe'
			);
		});
		const editionReadsBeforeResolve = listEditionsMock.mock.calls.length;

		resolveCreate('edition-new');
		await new Promise((r) => setTimeout(r, 0));

		await expandWork(container, 'work-1');
		await waitFor(() => {
			expect(container.querySelector('#library-editions-work-1')?.textContent).toContain(
				'No editions yet.'
			);
		});
		expect(container.querySelector('[data-testid="library-edition-edition-new"]')).toBeNull();
		expect(container.textContent).not.toContain('Chorpartitur');
		expect(listEditionsMock.mock.calls.length).toBeGreaterThan(editionReadsBeforeResolve);

		const statuses = Array.from(
			container.querySelectorAll('[data-testid^="create-edition-status-"]')
		);
		for (const s of statuses) {
			expect(s.textContent?.trim()).toBe('');
		}
		expect(container.textContent).not.toContain('created.');
	});
});

describe('#560 — one key listener on the edition form', () => {
	it('Escape fired at the form wrapper closes it', async () => {
		const container = await renderWithFormOpen('work-2');

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-edition-form-work-2"]') as HTMLElement,
			{ key: 'Escape' }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-edition-form-work-2"]')).toBeNull();
		});
		expect(createEditionMock).not.toHaveBeenCalled();
	});

	it('Enter from the publisher field submits the form', async () => {
		const container = await renderWithFormOpen('work-2');
		createEditionMock.mockResolvedValue('edition-new');

		await fireEvent.input(
			container.querySelector('[data-testid="create-edition-name-work-2"]') as HTMLInputElement,
			{ target: { value: 'Missa brevis' } }
		);
		const second = container.querySelector(
			'[data-testid="create-edition-publisher-work-2"]'
		) as HTMLInputElement;
		await fireEvent.input(second, { target: { value: 'Carus-Verlag' } });
		await fireEvent.keyDown(second, { key: 'Enter' });

		await waitFor(() => expect(createEditionMock).toHaveBeenCalledTimes(1));
		expect(createEditionMock.mock.calls[0][1]).toEqual({
			name: 'Missa brevis',
			publisher: 'Carus-Verlag',
			workId: 'work-2'
		});
	});
});

// (*MVOX:Tallis* — #271 RED)
