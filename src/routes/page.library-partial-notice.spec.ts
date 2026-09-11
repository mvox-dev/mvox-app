// @vitest-environment happy-dom
//
// #321 RED — the /library NOTICE surface: when any of the page's library list
// reads (works / lendings — the reads fired on every load; editions/copies
// join on expand) comes back TRUNCATED (count > returned rows, the detection
// pinned in libraryData.truncation.spec.ts), the page states that the list is
// partial. A silent prefix is the one thing the issue forbids.
//
// THE NOTICE PATTERN (new — research-321 surf confirmed no existing pattern
// fits: role="alert" is for failures, sr-only role="status" is for transient
// action confirmations):
//   - PERSISTENT and VISIBLE: ordinary rendered text, present for as long as
//     the truncation holds. NOT `sr-only`, NOT a transient toast.
//   - role="status" (informational, not an error).
//   - data-testid="library-partial-notice" (per-feature testid).
//   - copy through the i18n layer (asserted via the key-echo message mock) —
//     it MAY state real numbers ("showing N of M", probe-proven leak-safe);
//     the exact sentence is GREEN's, pinned only as a non-empty i18n string.
//   - when nothing is truncated the notice is ABSENT from the DOM — not
//     hidden, not empty: absent.
//   - multi-collective: the truncation fact belongs to the collective that
//     produced it — a switch to a collective whose reads are complete removes
//     the notice (the #287/#296/#299 stale-state bug class).
//
// Data mocks return the #321 result shape { items, total, truncated } — the
// contract the data specs pin; this file pins that the page actually consumes
// it on the real route.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_t, key) => () => String(key) })
}));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy({}, { get: (_t, key) => () => String(key) })
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
import { toListRead } from '$lib/testing/listReadFixtures';

const DB_A = 'polyphony';
const DB_B = 'other-choir';

/** #321 result-shape builders (the contract the data layer now returns). */
function complete<T>(items: T[]) {
	return { items, total: items.length, truncated: false };
}
function truncated<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

function worksFor(db: string) {
	return db === DB_A
		? [{ id: 'work-a1', name: 'Spem in alium', composer: 'Thomas Tallis' }]
		: [{ id: 'work-b1', name: 'Os justi', composer: 'Anton Bruckner' }];
}

function setAuthedWithTwoCollectives() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { [DB_A]: 'person-p', [DB_B]: 'person-q' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: DB_A, name: 'Polyphony', personId: 'person-p' },
			{ db: DB_B, name: 'Other Choir', personId: 'person-q' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(DB_A);
}

beforeEach(() => {
	setAuthedWithTwoCollectives();
	// Defaults: everything COMPLETE. Individual tests override per read.
	listWorksMock.mockImplementation((cfg: { db: string }) => Promise.resolve(complete(worksFor(cfg.db))));
	listLendingsMock.mockResolvedValue(complete([]));
	listEditionsMock.mockResolvedValue(complete([]));
	listCopiesMock.mockResolvedValue(complete([]));
	listAllEditionsMock.mockResolvedValue(complete([]));
	listAllCopiesMock.mockResolvedValue(complete([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

function notice(container: HTMLElement): HTMLElement | null {
	return container.querySelector('[data-testid="library-partial-notice"]');
}

describe('#321 — /library states when its list is partial', () => {
	it('a truncated WORKS read renders a persistent, visible partial notice (role=status, i18n copy, never sr-only)', async () => {
		listWorksMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(truncated(worksFor(cfg.db), 612))
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(notice(container)).not.toBeNull();
		});
		const el = notice(container)!;
		// Informational live region, not an error.
		expect(el.getAttribute('role')).toBe('status');
		// VISIBLE text — the existing sr-only status idiom is for transient
		// action confirmations; a partial list is a standing fact sighted users
		// must see too.
		expect(el.className).not.toMatch(/sr-only|hidden/);
		expect(el.getAttribute('aria-hidden')).not.toBe('true');
		// Copy comes from the i18n layer (key-echo mock renders the key name).
		expect(el.textContent).toContain('library_partial_notice');
		// The list itself still renders — a notice is not an error state.
		expect(container.textContent).toContain('Spem in alium');
		expect(container.querySelector('[data-testid="library-load-error"]')).toBeNull();
	});

	it('a truncated LENDINGS read (the collective-lifetime log) also raises the notice', async () => {
		listLendingsMock.mockResolvedValue(truncated([], 730));

		const { container } = render(Page);
		await waitFor(() => {
			expect(notice(container)).not.toBeNull();
		});
		expect(notice(container)!.getAttribute('role')).toBe('status');
	});

	it('with every read COMPLETE the notice is ABSENT from the DOM (not hidden — absent)', async () => {
		const { container } = render(Page);
		// Wait for the page to actually render collective A's library.
		await waitFor(() => {
			expect(container.textContent).toContain('Spem in alium');
		});
		expect(notice(container)).toBeNull();
	});

	it('the truncation fact does not leak across a collective switch: A truncated → switch to B (complete) → notice gone', async () => {
		listWorksMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === DB_A
				? Promise.resolve(truncated(worksFor(DB_A), 612))
				: Promise.resolve(complete(worksFor(DB_B)))
		);

		const { container } = render(Page);
		await waitFor(() => {
			expect(notice(container)).not.toBeNull();
		});

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => {
			expect(container.textContent).toContain('Os justi');
		});
		expect(notice(container)).toBeNull();
	});
});

// (*MVOX:Tallis* — RED spec, #321)
