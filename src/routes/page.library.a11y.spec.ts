// @vitest-environment happy-dom
//
// #75/TL.4 — i18n + a11y coverage for all Lending 1.0 surfaces.
// RED tests: these assert a11y attributes and i18n practices that are not yet
// fully implemented. Existing functional tests in page.library.spec.ts remain
// unchanged and should still pass.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
		library_bulk_checkout_availability: (p: { available: number; total: number }) => `${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_bulk_return_title: () => 'Bulk return',
		library_bulk_return_edition_placeholder: () => 'Select edition',
		library_bulk_return_lent_count: (p: { count: number }) => `${p.count} lent`,
		library_work_availability: (p: { available: number; total: number }) => `${p.available}/${p.total}`
	}
}));

const { listWorksMock, listEditionsMock, listCopiesMock, listAllEditionsMock, listAllCopiesMock, listLendingsMock, resolveBorrowerNamesMock, resolveCopyNamesMock } =
	vi.hoisted(() => ({
		listWorksMock: vi.fn(),
		listAllEditionsMock: vi.fn(),
		listEditionsMock: vi.fn(),
		listCopiesMock: vi.fn(),
		listAllCopiesMock: vi.fn(),
		listLendingsMock: vi.fn(),
		resolveBorrowerNamesMock: vi.fn(),
		resolveCopyNamesMock: vi.fn()
	}));
vi.mock('$lib/library/libraryData', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
	return {
		...actual,
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllEditions: listAllEditionsMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock,
		resolveCopyNames: resolveCopyNamesMock
	};
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

const { listActiveMembersMock } = vi.hoisted(() => ({ listActiveMembersMock: vi.fn() }));
vi.mock('$lib/roster/rosterData', () => ({ listActiveMembers: listActiveMembersMock }));

const { resolveLibrarianMock } = vi.hoisted(() => ({ resolveLibrarianMock: vi.fn() }));
vi.mock('$lib/library/librarianStore', async () => {
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>('$lib/library/librarianStore');
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { collectiveState, selectedCollectiveDbStore, urlCollectiveDbStore } from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({ status: 'authenticated', personIdByDb: { polyphony: 'person-p' }, expMs: Date.now() + 100_000 });
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	listAllEditionsMock.mockResolvedValue([]);
	listAllCopiesMock.mockResolvedValue([]);
	listActiveMembersMock.mockResolvedValue([]);
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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ---------------------------------------------------------------------------
// Test 1: All user-facing strings come from Paraglide (no hardcoded strings)
// ---------------------------------------------------------------------------
describe('#75 — i18n: no hardcoded user-facing strings', () => {
	it('the library page component contains no hardcoded user-facing text outside m.* calls', () => {
		const src = readFileSync(resolve(process.cwd(), 'src/routes/library/+page.svelte'), 'utf-8');

		// Extract the template section (everything after </script>)
		const templateMatch = src.match(/<\/script>\s*([\s\S]*)$/);
		expect(templateMatch).not.toBeNull();
		const template = templateMatch![1];

		// Strategy: find text content between closing > and opening < that looks
		// like real user-facing prose (contains at least one alphabetic character
		// and isn't just Svelte expression residue).
		//
		// We first strip all Svelte expressions {…} (handling nested braces) so
		// the remaining text between tags is what actually renders as literal text.
		let stripped = template;
		// Repeatedly remove innermost { … } blocks until none remain
		let prev = '';
		while (prev !== stripped) {
			prev = stripped;
			stripped = stripped.replace(/\{[^{}]*\}/g, '');
		}

		const textNodePattern = />([^<]+)</g;
		const bareTextNodes: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = textNodePattern.exec(stripped)) !== null) {
			const text = match[1].trim();
			if (!text) continue;
			// Skip pure whitespace / punctuation / decorative unicode
			if (/^[▸▾·\s\-|]+$/.test(text)) continue;
			// Must contain at least one letter to be "user-facing prose"
			if (!/[a-zA-Z]/.test(text)) continue;
			bareTextNodes.push(text);
		}

		// There should be NO bare text nodes — all visible text must come from m.*
		expect(bareTextNodes).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Test 2: my-loans toggle has aria-expanded + aria-controls
// ---------------------------------------------------------------------------
describe('#75 — a11y: my-loans section', () => {
	it('the my-loans toggle has aria-expanded and aria-controls attributes', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
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
		// aria-controls must reference the collapsible content's id
		const controlsId = toggle.getAttribute('aria-controls');
		expect(controlsId).not.toBeNull();
		expect(controlsId).toBeTruthy();

		// The controlled element must exist when expanded
		await fireEvent.click(toggle);
		await waitFor(() => {
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
		});
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
		listLendingsMock.mockResolvedValue([]);
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
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
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
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
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
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: 'Ed1', publisher: 'Pub' }]);
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
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
		]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedLibrarian();
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Bärenreiter', workId: 'work-1' }
		]);
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 },
			{ id: 'copy-2', name: 'Copy #2', copyNumber: 2 }
		]);
		listActiveMembersMock.mockResolvedValue([
			{ memberId: 'member-a' }
		]);

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

	it('bulk return section contains checkboxes with aria-label or associated <label>', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-1', copyId: 'copy-1', memberId: 'member-a', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a', 'Ada']]));
		setAuthedLibrarian();
		listAllEditionsMock.mockResolvedValue([
			{ id: 'edition-1', name: 'Urtext edition', publisher: 'Bärenreiter' }
		]);
		listAllCopiesMock.mockResolvedValue([{ id: 'copy-1', name: 'Copy #1', copyNumber: 1, editionId: 'edition-1' }]);
		listActiveMembersMock.mockResolvedValue([{ memberId: 'member-a' }]);

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-edition-select"]')).not.toBeNull();
		});

		// Select an edition to reveal the loan checkboxes
		const select = container.querySelector('[data-testid="bulk-return-edition-select"]') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'edition-1' } });

		await waitFor(() => {
			expect(container.querySelector('[data-testid="bulk-return-loan-list"]')).not.toBeNull();
		});

		const loanList = container.querySelector('[data-testid="bulk-return-loan-list"]') as HTMLElement;
		const checkboxes = loanList.querySelectorAll('input[type="checkbox"]');
		// There should be checkboxes for selecting lendings to return in bulk
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
});

// ---------------------------------------------------------------------------
// Test 5: Interactive elements are keyboard-reachable
// ---------------------------------------------------------------------------
describe('#75 — a11y: keyboard reachability', () => {
	it('all buttons and form controls in the librarian-tools section are natively focusable (no negative tabIndex)', async () => {
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		setAuthedLibrarian();
		listAllCopiesMock.mockResolvedValue([
			{ id: 'copy-1', name: 'Copy #1', copyNumber: 1 }
		]);
		listActiveMembersMock.mockResolvedValue([{ memberId: 'member-a' }]);

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
		listWorksMock.mockResolvedValue([
			{ id: 'work-1', name: 'Spem', composer: 'Tallis' },
			{ id: 'work-2', name: 'Ave', composer: 'Byrd' }
		]);
		listLendingsMock.mockResolvedValue([]);
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
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue([]);
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
		listWorksMock.mockResolvedValue([{ id: 'work-1', name: 'Spem', composer: 'Tallis' }]);
		listLendingsMock.mockResolvedValue([]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		listEditionsMock.mockResolvedValue([{ id: 'edition-1', name: 'Ed1', publisher: 'Pub' }]);
		listCopiesMock.mockResolvedValue([]);
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
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
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
		listWorksMock.mockResolvedValue([]);
		listLendingsMock.mockResolvedValue([
			{ id: 'lend-mine', copyId: 'copy-1', memberId: 'member-mine', assignedAt: '2026-08-01', assignedUntil: '', returnedAt: '' }
		]);
		resolveBorrowerNamesMock.mockResolvedValue(new Map());
		resolveCopyNamesMock.mockResolvedValue(new Map());
		setAuthedWithOneCollective();
		findMyMemberIdMock.mockResolvedValue('member-mine');

		const { container } = render(Page);

		await waitFor(() => expect(container.querySelector('[data-testid="my-loans-toggle"]')).not.toBeNull());
		const toggle = container.querySelector('[data-testid="my-loans-toggle"]') as HTMLElement;
		const controlsId = toggle.getAttribute('aria-controls');
		expect(controlsId).not.toBeNull();
		expect(controlsId).toBeTruthy();

		// Expand and verify the controlled element exists
		await fireEvent.click(toggle);
		await waitFor(() => {
			const controlled = container.querySelector(`#${controlsId}`);
			expect(controlled).not.toBeNull();
		});
	});
});

// (*MVOX:Tallis*)
