// @vitest-environment happy-dom
//
// #198 — create works from within the mvox app (Noodikogu). The /library page
// grows a librarian-only "create work" affordance:
//
//   - [data-testid="create-work-button"] renders ONLY when $librarianStore
//     resolves 'librarian' (same fail-closed gating as every other librarian
//     tool on this page — hidden while loading, hidden for not-librarian).
//   - Clicking it opens an INLINE form [data-testid="create-work-form"] with a
//     name input [data-testid="create-work-name"] (required) and a composer
//     input [data-testid="create-work-composer"] (optional). No form in the
//     DOM until the button is clicked.
//   - Submitting calls createWork ($lib/entity/entityCreate — the shared
//     entity CREATE write layer, same module as createSeason) with the
//     library entity id from libraryEntityIdStore (resolveLibrarian's
//     libraryId — the work's v4E parent is the LIBRARY entity, NOT the
//     database entity), then adds the created work to the LOCAL works list —
//     no listWorks refetch.
//
// INTEGRATION (house rule): these tests render the ACTUAL /library route
// component (./library/+page.svelte), so the feature cannot go green as an
// isolated component that no page ever mounts.
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
		library_checkout_copy_placeholder: () => 'Select copy',
		library_checkout_member_placeholder: () => 'Select member',
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
		// #198 — create-work affordance
		library_create_work_button: () => 'Add work',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_cancel: () => 'Cancel',
		library_create_work_name_required: () => 'Work title is required.',
		library_create_work_created: (p: { name: string }) => `${p.name} created.`,
		library_create_work_error: () => 'Could not create the work.'
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
// Same $env/dynamic/public fix as page.library.spec.ts.
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

// Quiet seams for the #92 repertoire-badge side reads (not under test here).
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

// #198 — the write seam under test: the shared entity CREATE layer. The page
// must call THIS module's createWork (same layer as createSeason), never roll
// its own POST.
const { createWorkMock } = vi.hoisted(() => ({ createWorkMock: vi.fn() }));
vi.mock('$lib/entity/entityCreate', async () => {
	const actual = await vi.importActual<typeof import('$lib/entity/entityCreate')>(
		'$lib/entity/entityCreate'
	);
	return {
		...actual,
		createWork: createWorkMock
	};
});

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function setAuthedWithOneCollective() {
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
	// Defaults; tests override resolveLibrarianMock per case.
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue([]);
	listAllCopiesMock.mockResolvedValue([]);
	listActiveMembersMock.mockResolvedValue([]);
	listSeasonsMock.mockResolvedValue([]);
	listRepertoireItemsMock.mockResolvedValue([]);
}

/** Baseline data: one existing work, no lendings. */
function mockBaselineLibrary() {
	listWorksMock.mockResolvedValue([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]);
	listLendingsMock.mockResolvedValue([]);
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ---------------------------------------------------------------------------
// Integration: the create button lives on the /library route, librarian-gated
// ---------------------------------------------------------------------------

describe('#198 — create-work button on /library (librarian gating, integration)', () => {
	it('renders [data-testid="create-work-button"] on the actual /library route when resolveLibrarian resolves librarian', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		const button = container.querySelector('[data-testid="create-work-button"]') as HTMLButtonElement;
		expect(button.tagName).toBe('BUTTON');
		expect(button.textContent).toContain('Add work');
	});

	it('does NOT render the create-work button for a not-librarian — the browse tree still renders (fail-closed gating on the real route)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		// The page is fully ready (the work list rendered) — so the button's
		// absence is a gating decision, not an unfinished load.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="create-work-button"]')).toBeNull();
	});

	it('does NOT render the create-work button while resolveLibrarian is still pending (hidden-if-undeterminable)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockReturnValue(new Promise(() => {}));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="create-work-button"]')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// The inline form: opens on click, name + composer fields
// ---------------------------------------------------------------------------

describe('#198 — inline create-work form', () => {
	it('no form in the DOM until the button is clicked; clicking reveals the inline form with a name input and a composer input', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		// Closed by default — inline, not always-on.
		expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		expect(container.querySelector('[data-testid="create-work-name"]')).toBeNull();

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-button"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
		});
		const nameInput = container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement;
		const composerInput = container.querySelector(
			'[data-testid="create-work-composer"]'
		) as HTMLInputElement;
		expect(nameInput).not.toBeNull();
		expect(composerInput).not.toBeNull();
		// Both are text inputs with an accessible name (same discipline as the
		// bulk-checkout pickers).
		expect(nameInput.tagName).toBe('INPUT');
		expect(composerInput.tagName).toBe('INPUT');
		expect(
			nameInput.getAttribute('aria-label') || nameInput.labels?.length
		).toBeTruthy();
		expect(
			composerInput.getAttribute('aria-label') || composerInput.labels?.length
		).toBeTruthy();
		// And a submit control.
		expect(container.querySelector('[data-testid="create-work-submit"]')).not.toBeNull();
	});

	it('submitting calls createWork with the LIBRARY entity id (from resolveLibrarian, via libraryEntityIdStore) + name + composer, and appends the created work to the LOCAL list — no listWorks refetch', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		createWorkMock.mockResolvedValue('work-new');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-button"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-name"]')).not.toBeNull();
		});

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.input(
			container.querySelector('[data-testid="create-work-composer"]') as HTMLInputElement,
			{ target: { value: 'Arvo Pärt' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => expect(createWorkMock).toHaveBeenCalledTimes(1));
		const [cfgArg, payload] = createWorkMock.mock.calls[0];
		expect(cfgArg).toEqual({ db: 'polyphony', token: 'jwt-abc' });
		// Full-shape (no objectContaining): the parent is the LIBRARY entity id
		// resolveLibrarian returned — 'lib-1' — never the database entity.
		expect(payload).toEqual({
			name: 'Ave Maria',
			composer: 'Arvo Pärt',
			libraryEntityId: 'lib-1'
		});

		// The new work joins the browse list LOCALLY: its row renders, and the
		// page did not re-issue the listWorks read (still just the initial one).
		await waitFor(() => {
			const row = container.querySelector('[data-testid="library-work-work-new"]');
			expect(row).not.toBeNull();
			expect(row?.textContent).toContain('Ave Maria');
			expect(row?.textContent).toContain('Arvo Pärt');
		});
		expect(listWorksMock).toHaveBeenCalledTimes(1);
		// The existing work is still there — appended, not replaced.
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();

		// The live region announces a LOCALIZED sentence, not the bare title —
		// a screen reader must hear that something was created.
		const status = container.querySelector('[data-testid="create-work-status"]') as HTMLElement;
		expect(status.getAttribute('role')).toBe('status');
		expect(status.textContent?.trim()).toBe('Ave Maria created.');
	});
});

// ---------------------------------------------------------------------------
// Review fixes: touch targets, cancel affordance, blank-name validation
// ---------------------------------------------------------------------------

/** Opens the inline create form on a librarian-ready /library route. */
async function renderWithFormOpen(): Promise<HTMLElement> {
	mockBaselineLibrary();
	setAuthedWithOneCollective();
	mockLibrarian();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="create-work-button"]') as Element);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
	});
	return container;
}

// happy-dom computes no layout, so the testable truth is the CLASS contract —
// Tailwind spacing 11 = 2.75rem = 44px (WCAG 2.5.5). Same helper shape as
// page.agenda-admin.spec.ts's expectTouchTarget.
function expectTouchTarget(container: HTMLElement, testid: string): void {
	const el = container.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
	expect(el, `${testid} must be in the DOM`).not.toBeNull();
	expect(
		Array.from((el as HTMLElement).classList),
		`${testid} must reserve a 44px-tall touch target (min-h-11)`
	).toContain('min-h-11');
}

describe('#198 — create-work controls are 44px touch targets', () => {
	it('the entry-point button reserves min-h-11', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		expectTouchTarget(container, 'create-work-button');
	});

	it('every control inside the open form reserves min-h-11 (both inputs, submit, cancel)', async () => {
		const container = await renderWithFormOpen();

		expectTouchTarget(container, 'create-work-name');
		expectTouchTarget(container, 'create-work-composer');
		expectTouchTarget(container, 'create-work-submit');
		expectTouchTarget(container, 'create-work-cancel');
	});
});

describe('#198 — the form is escapable', () => {
	it('cancel closes the form and restores the entry-point button — no write', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-cancel"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		expect(createWorkMock).not.toHaveBeenCalled();
	});

	it('cancel discards what was typed — reopening starts from an empty name', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-cancel"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-button"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-name"]')).not.toBeNull();
		});
		const nameInput = container.querySelector(
			'[data-testid="create-work-name"]'
		) as HTMLInputElement;
		expect(nameInput.value).toBe('');
	});

	it('Escape in the name input closes the form', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ key: 'Escape' }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		});
		expect(createWorkMock).not.toHaveBeenCalled();
	});

	it('Escape works while focus is on the Cancel button, not just the inputs', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-work-cancel"]') as HTMLButtonElement,
			{ key: 'Escape', bubbles: true }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		});
		expect(createWorkMock).not.toHaveBeenCalled();
	});

	it('the inline form is a group, not a dialog — it implements no dialog focus contract', async () => {
		const container = await renderWithFormOpen();

		const form = container.querySelector('[data-testid="create-work-form"]') as HTMLElement;
		expect(form.getAttribute('role')).toBe('group');
		expect(form.getAttribute('aria-label')).toBeTruthy();
	});
});

describe('#198 — blank name is a field error, not a transport failure', () => {
	it('submitting an empty title shows the required-field message and never calls createWork', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-work-error"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Work title is required.');
		// NOT the generic "Could not create the work." transport message.
		expect(err.textContent).not.toContain('Could not create the work.');
		expect(createWorkMock).not.toHaveBeenCalled();
		// The form stays open so the librarian can fix the title in place.
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
	});

	it('a whitespace-only title is blank too', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: '   ' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		expect(createWorkMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Review round 2: fail loudly, transport failure, double-submit
// ---------------------------------------------------------------------------

describe('#198 — a missing precondition fails LOUDLY, never silently', () => {
	it('a librarian whose token vanished (session expired under the open form) sees the error and no write is attempted', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		// The JWT is gone while the librarian tools are still on screen — the
		// page has a 'session-expired' branch, so this state is reachable.
		clearAll({ preserveProvider: false });

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-work-error"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Could not create the work.');
		expect(createWorkMock).not.toHaveBeenCalled();
		// The form stays open — nothing was written, nothing typed is lost.
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
	});
});

describe('#198 — the create write can fail in transport', () => {
	it('a rejected createWork surfaces the error, keeps the form open with what was typed, and inserts NOTHING locally', async () => {
		const container = await renderWithFormOpen();
		createWorkMock.mockRejectedValue(new Error('HTTP 403'));

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.input(
			container.querySelector('[data-testid="create-work-composer"]') as HTMLInputElement,
			{ target: { value: 'Arvo Pärt' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-work-error"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Could not create the work.');

		// The form survives the failure, holding the typed values — a retry must
		// not start from an empty title.
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
		expect(
			(container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement).value
		).toBe('Ave Maria');
		expect(
			(container.querySelector('[data-testid="create-work-composer"]') as HTMLInputElement).value
		).toBe('Arvo Pärt');

		// The local insert must NOT run on a rejected create: only the baseline
		// work is on the page, and the live region announced nothing.
		const rows = container.querySelectorAll('[data-testid^="library-work-work-"]');
		expect(Array.from(rows).map((r) => r.getAttribute('data-testid'))).toEqual([
			'library-work-work-1'
		]);
		const status = container.querySelector('[data-testid="create-work-status"]') as HTMLElement;
		expect(status.textContent?.trim()).toBe('');
	});
});

describe('#198 — the create is not double-submittable', () => {
	it('a second click while the first create is in flight issues no second POST, and the submit control is disabled meanwhile', async () => {
		const container = await renderWithFormOpen();
		let resolveCreate: (id: string) => void = () => {};
		createWorkMock.mockReturnValue(
			new Promise<string>((resolve) => {
				resolveCreate = resolve;
			})
		);

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => expect(createWorkMock).toHaveBeenCalledTimes(1));
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="create-work-submit"]'
			) as HTMLButtonElement;
			expect(submit.disabled).toBe(true);
		});

		// Both re-entry routes: a second click, and Enter in the name input.
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);
		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ key: 'Enter' }
		);
		expect(createWorkMock).toHaveBeenCalledTimes(1);

		resolveCreate('work-new');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-new"]')).not.toBeNull();
		});
		// Exactly one work was created, not two.
		expect(createWorkMock).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — #198 RED)
// (*MVOX:Byrd* — #198 review round 2)
