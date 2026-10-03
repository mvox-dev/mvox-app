// @vitest-environment happy-dom

// #75/TL.4 — i18n + a11y coverage for all Lending 1.0 surfaces.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bareTextNodes } from '$lib/testing/bareText';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
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
		library_create_work_button: () => 'Add work',
		library_edition_file_attach: () => 'Attach files',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_error: () => 'Could not create the work.',
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
		library_bulk_checkout_availability: (p: { available: number; total: number }) => `${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_work_availability: (p: { available: number; total: number }) => `${p.available}/${p.total}`
	})
);

vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/mocks/library')).libraryReadsModule({ chains: false })
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
	(await import('$lib/testing/mocks/library')).librarianOverRealModule({ libraryId: false })
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

import Page from './library/+page.svelte';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { surfacesUnder } from '$lib/testing/svelteSurfaces';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import {
	listAllCopiesMock,
	listAllEditionsMock,
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock,
	resolveCopyNamesMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';

const LIBRARY_SURFACES = surfacesUnder('src/routes/library/', 'src/lib/library/');

function setAuthedWithOneCollective() {
	signIn();
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
}

function setAuthedLibrarian() {
	setAuthedWithOneCollective();
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
}

afterEach(() => {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	resetAppState();
});

// ---------------------------------------------------------------------------
// Test 1: All user-facing strings come from Paraglide (no hardcoded strings)
// ---------------------------------------------------------------------------
describe('#75 — i18n: no hardcoded user-facing strings', () => {
	it('the derived LIBRARY_SURFACES list is not empty (a moved folder would scan nothing)', () => {
		expect(LIBRARY_SURFACES.length).toBeGreaterThanOrEqual(8);
	});

	it.each(LIBRARY_SURFACES)('%s contains no hardcoded user-facing text outside m.* calls', (file) => {
		expect(bareTextNodes(readFileSync(resolve(process.cwd(), file), 'utf-8'))).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Test 2: my-loans toggle has aria-expanded + aria-controls
// ---------------------------------------------------------------------------
describe('#75 — a11y: my-loans section', () => {
	it('the my-loans toggle has aria-expanded and aria-controls attributes', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		resolveCopyNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="my-loans"]')).not.toBeNull();
		});

		const toggle = container.querySelector('[data-testid="my-loans-toggle"]') as HTMLElement;
		expect(toggle).not.toBeNull();
		// aria-expanded should be present (false when collapsed)
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		// Collapsed, the loans list is not in the DOM: aria-controls is absent or
		// resolves, never a dangling IDREF (#86 ruling, applied here in #93).
		const collapsedControls = toggle.getAttribute('aria-controls');
		if (collapsedControls !== null) {
			expect(container.querySelector(`#${collapsedControls}`)).not.toBeNull();
		}

		// Expanded, the relationship must be there and must resolve.
		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
		});
		const controlsId = toggle.getAttribute('aria-controls');
		expect(controlsId).toBeTruthy();
		const controlledEl = container.querySelector(`#${controlsId}`);
		expect(controlledEl).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Test 3: Error states have role="alert"
// ---------------------------------------------------------------------------
describe('#75 — a11y: error states use role="alert"', () => {
	it('the library load-error container has role="alert"', async () => {
		listWorksMock.mockRejectedValue(new Error('boom'));
		listLendingsMock.mockResolvedValue(toListRead([]));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-load-error"]')).not.toBeNull();
		});
		const errorEl = container.querySelector('[data-testid="library-load-error"]') as HTMLElement;
		expect(errorEl.getAttribute('role')).toBe('alert');
		consoleSpy.mockRestore();
	});

	it('the librarian-load-error container has role="alert"', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'error', libraryId: null });

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-load-error"]')).not.toBeNull();
		});
		const errorEl = container.querySelector('[data-testid="librarian-load-error"]') as HTMLElement;
		expect(errorEl.getAttribute('role')).toBe('alert');
	});

	it('the node-level edition load error has role="alert"', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockRejectedValue(new Error('edition load fail'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);

		await waitFor(() => {
			const errorNode = container.querySelector('[data-testid="library-work-work-1"]');
			// Find the error text inside the expanded work
			const errorText = errorNode?.querySelector('[role="alert"]');
			expect(errorText).not.toBeNull();
		});
		consoleSpy.mockRestore();
	});

	it('the node-level copy load error has role="alert"', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: 'Ed1', publisher: 'Pub' }]));
		listCopiesMock.mockRejectedValue(new Error('copy load fail'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);
		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element);

		await waitFor(() => {
			const editionNode = container.querySelector('[data-testid="library-edition-edition-1"]');
			const errorText = editionNode?.querySelector('[role="alert"]');
			expect(errorText).not.toBeNull();
		});
		consoleSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Test 4: Bulk checkout/return checkboxes are labeled
// ---------------------------------------------------------------------------
describe('#75 — a11y: bulk checkout/return checkboxes are labeled', () => {
	it('bulk checkout section contains checkboxes with aria-label or associated <label>', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedLibrarian();
		listAllEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Bärenreiter', workId: 'work-1' }
		]));
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([
			{ memberId: 'member-a' }
		]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-edition-select"]')).not.toBeNull();
		});

		// Select an edition to reveal the member checkboxes
		const select = container.querySelector('[data-testid="bulk-checkout-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-checkout-member-list"]')).not.toBeNull();
		});

		const memberList = container.querySelector('[data-testid="bulk-checkout-member-list"]') as HTMLElement;
		const checkboxes = memberList.querySelectorAll('input[type="checkbox"]');
		// There should be checkboxes for selecting members in bulk
		expect(checkboxes.length).toBeGreaterThan(0);

		// Each checkbox must have either an aria-label, an associated label[for], or be inside a <label>
		checkboxes.forEach((cb) => {
			const hasAriaLabel = cb.getAttribute('aria-label') !== null && cb.getAttribute('aria-label') !== '';
			const id = cb.getAttribute('id');
			const hasExplicitLabel = id ? container.querySelector(`label[for="${id}"]`) !== null : false;
			const hasImplicitLabel = cb.closest('label') !== null;
			expect(hasAriaLabel || hasExplicitLabel || hasImplicitLabel).toBe(true);
		});
	});

	// #76 removed the bulk-return section; inline Return buttons are the only return
	// surface, covered in page.library.spec.ts ('#76 correction 8').
});

// ---------------------------------------------------------------------------
// Test 5: Interactive elements are keyboard-reachable
// ---------------------------------------------------------------------------
describe('#75 — a11y: keyboard reachability', () => {
	it('all buttons and form controls in the librarian-tools section are natively focusable (no negative tabIndex)', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedLibrarian();
		listAllCopiesMock.mockResolvedValue(toListRead([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }
		]));
		listActiveMembersMock.mockResolvedValue(toListRead([{ memberId: 'member-a' }]));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-tools"]')).not.toBeNull();
		});

		const librarianSection = container.querySelector('[data-testid="librarian-tools"]') as HTMLElement;
		const interactives = librarianSection.querySelectorAll('button, input, select, textarea, a[href]');

		expect(interactives.length).toBeGreaterThan(0);
		interactives.forEach((el) => {
			const tabIndex = (el as HTMLElement).tabIndex;
			// tabIndex >= 0 means keyboard-reachable; -1 means removed from tab order
			expect(tabIndex).toBeGreaterThanOrEqual(0);
		});
	});

	it('all work toggle buttons in the work list are keyboard-reachable', async () => {
		listWorksMock.mockResolvedValue(toListRead([
			{ id: 'work-1', name: 'Spem', composer: 'Tallis' },
			{ id: 'work-2', name: 'Ave', composer: 'Byrd' }
		]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-list"]')).not.toBeNull();
		});

		const toggles = container.querySelectorAll('[data-testid^="library-work-toggle-"]');
		expect(toggles.length).toBe(2);
		toggles.forEach((el) => {
			expect((el as HTMLElement).tabIndex).toBeGreaterThanOrEqual(0);
		});
	});
});

// ---------------------------------------------------------------------------
// Test 6: Expandable sections use aria-expanded correctly
// ---------------------------------------------------------------------------
describe('#75 — a11y: aria-expanded on expandable sections', () => {
	it('work toggle starts with aria-expanded="false" and flips to "true" on click', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue(toListRead([]));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull());
		const toggle = container.querySelector('[data-testid="library-work-toggle-work-1"]') as HTMLElement;
		expect(toggle.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
		});
	});

	it('edition toggle starts with aria-expanded="false" and flips to "true" on click', async () => {
		listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue(toListRead([{ id: 'edition-1', name: 'Ed1', publisher: 'Pub' }]));
		listCopiesMock.mockResolvedValue(toListRead([]));
		setAuthedWithOneCollective();

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="library-work-toggle-work-1"]')).not.toBeNull());
		await fireEvent.click(container.querySelector('[data-testid="library-work-toggle-work-1"]') as Element);

		await waitFor(() => expect(container.querySelector('[data-testid="library-edition-toggle-edition-1"]')).not.toBeNull());
		const edToggle = container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as HTMLElement;
		expect(edToggle.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(edToggle);
		await waitFor(() => {
			expect(edToggle.getAttribute('aria-expanded')).toBe('true');
		});
	});

	it('my-loans toggle starts with aria-expanded="false" and flips to "true" on click', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		resolveCopyNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="my-loans-toggle"]')).not.toBeNull());
		const toggle = container.querySelector('[data-testid="my-loans-toggle"]') as HTMLElement;
		expect(toggle.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
		});
	});

	it('my-loans toggle has aria-controls linking to the loans list element', async () => {
		listWorksMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		resolveCopyNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="my-loans-toggle"]')).not.toBeNull());
		const toggle = container.querySelector('[data-testid="my-loans-toggle"]') as HTMLElement;
		// Collapsed: absent or resolving, never dangling (see the note above).
		const collapsedControls = toggle.getAttribute('aria-controls');
		if (collapsedControls !== null) {
			expect(container.querySelector(`#${collapsedControls}`)).not.toBeNull();
		}

		// Expand and verify the aria-controls IDREF resolves to the loans list
		await fireEvent.click(toggle);
		await waitFor(() => {
			const controlsId = toggle.getAttribute('aria-controls');
			expect(controlsId).toBeTruthy();
			expect(container.querySelector(`#${controlsId}`)).not.toBeNull();
		});
	});
});

// (*MVOX:Tallis*)
