// @vitest-environment happy-dom
//
// #321 review F2 — the LIBRARIAN PICKERS say when their own feed was truncated.
//
// THE RULING THIS PINS (PO, Gama, 2026-09-11): the test for an option list is
// REACHABILITY, not read-versus-pick. A closed-set picker's options are the whole
// reachable world, so a truncated feed does not read as a short list — it reads as
// an ABSENCE ("that copy isn't in the library", "that singer isn't a member") and
// the librarian acts on that. Worse than a truncated read-list, not lesser. And
// the statement goes INSIDE the open picker, where the eyes are, not on the page
// behind it: neither the page-level `library-partial-notice` (a different claim,
// about the browsing tree) nor /roster's notice (a different page) covers these.
//
// The three feeds, and where each one lands:
//   `listAllEditions` → the bulk-checkout EDITION select's options
//   `listAllCopies`   → the same select: a truncated copy read hides an edition's
//                       copies, so availability reads "none available" for an
//                       edition that has some — the same false absence one level
//                       down, hence one flag for both
//   `listActiveMembers` → the bulk-checkout member checkbox list AND every
//                       per-copy inline-checkout select
//
// TWO SHAPES, ONE MEANING (asserted here so a later edit cannot quietly split
// them): a native <select> cannot host a <p>/live region, so its notice is a
// trailing DISABLED option — unselectable, last, absent when the read is
// complete. A list-shaped picker (the member checkboxes) carries the shared
// visible <p role="status"> notice instead. Both render the same i18n keys
// (`picker_partial_options_notice` / `picker_partial_members_notice`, pinned
// per-locale in page.partial-notice-i18n.spec.ts).
//
// Harness: the librarian scaffolding of
// page.library-bulk-checkout-collective-switch.spec.ts (per-db data mocks, real
// route, real selects) with the key-echo message mock of
// page.library-partial-notice.spec.ts, so every assertion binds DOM to an i18n
// key rather than to English copy.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
	const actual =
		await vi.importActual<typeof import('$lib/library/libraryData')>('$lib/library/libraryData');
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
	const actual =
		await vi.importActual<typeof import('$lib/library/librarianStore')>(
			'$lib/library/librarianStore'
		);
	return { ...actual, resolveLibrarian: resolveLibrarianMock };
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';

const DB_A = 'polyphony';
const DB_B = 'other-choir';

const OPTIONS_OPTION = 'bulk-checkout-edition-partial-option';
const MEMBERS_NOTICE = 'bulk-checkout-members-partial-notice';

/** A read the server reported as PARTIAL (its count exceeded the rows returned). */
function truncated<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

// TWO works per collective, as page.library-bulk-checkout-collective-switch.spec.ts
// documents: with one work the #74 auto-select effect picks it, and these pins
// drive the work select by hand.
function worksFor(db: string) {
	return db === DB_A
		? [
				{ id: 'work-a1', name: 'Spem in alium', composer: 'Thomas Tallis' },
				{ id: 'work-a2', name: 'Ave verum corpus', composer: 'William Byrd' }
			]
		: [
				{ id: 'work-b1', name: 'Os justi', composer: 'Anton Bruckner' },
				{ id: 'work-b2', name: 'Locus iste', composer: 'Anton Bruckner' }
			];
}

function editionsFor(db: string) {
	return db === DB_A
		? [
				{
					id: 'edition-a1',
					name: 'Urtext A',
					publisher: 'Bärenreiter',
					workId: 'work-a1',
					externalLinks: [],
					files: []
				}
			]
		: [
				{
					id: 'edition-b1',
					name: 'Urtext B',
					publisher: 'Carus',
					workId: 'work-b1',
					externalLinks: [],
					files: []
				}
			];
}

function copiesFor(db: string) {
	return db === DB_A
		? [{ id: 'copy-a1', name: 'Copy A1', copyNumber: 1, editionId: 'edition-a1' }]
		: [{ id: 'copy-b1', name: 'Copy B1', copyNumber: 1, editionId: 'edition-b1' }];
}

function membersFor(db: string) {
	return db === DB_A
		? [{ memberId: 'member-a1', personId: 'person-a1', sectionIds: [] }]
		: [{ memberId: 'member-b1', personId: 'person-b1', sectionIds: [] }];
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
	// Defaults: the viewer is a librarian and every feed is COMPLETE; each pin
	// overrides the one read it is about.
	listWorksMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(worksFor(cfg.db)))
	);
	listLendingsMock.mockResolvedValue(toListRead([]));
	listEditionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(editionsFor(cfg.db)))
	);
	listCopiesMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(copiesFor(cfg.db)))
	);
	listAllEditionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(editionsFor(cfg.db)))
	);
	listAllCopiesMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(copiesFor(cfg.db)))
	);
	listActiveMembersMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(membersFor(cfg.db)))
	);
	resolveLibrarianMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve({ state: 'librarian', libraryId: cfg.db === DB_A ? 'lib-a' : 'lib-b' })
	);
	findMyMemberIdMock.mockResolvedValue(null);
	resolveBorrowerNamesMock.mockResolvedValue(new Map([['member-a1', 'Ada Lovelace']]));
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

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Render as collective A's librarian and open the EDITION step of the
 *  bulk-checkout picker (work → edition), sanity-asserting each step so no pin
 *  can pass because the picker never opened. */
async function openEditionStep(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'bulk-checkout-work-select')).not.toBeNull();
	});
	await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
		target: { value: 'work-a1' }
	});
	await waitFor(() => {
		expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
	});
	return container;
}

/** …and on to the member step, which the edition pick reveals. */
async function openMemberStep(): Promise<HTMLElement> {
	const container = await openEditionStep();
	await fireEvent.change(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement, {
		target: { value: 'edition-a1' }
	});
	await waitFor(() => {
		expect(q(container, 'bulk-checkout-member-list')).not.toBeNull();
	});
	return container;
}

/** Expand work → edition in the browsing tree, where the per-copy
 *  inline-checkout select lives (librarian-only, available copies only). */
async function openInlineCheckout(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'library-work-work-a1')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'library-work-toggle-work-a1') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'library-edition-edition-a1')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'library-edition-toggle-edition-a1') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'inline-checkout-copy-a1')).not.toBeNull();
	});
	return container;
}

describe('#321 review F2 — the bulk-checkout EDITION picker states a truncated feed', () => {
	it('a truncated listAllEditions puts the notice INSIDE the open select, as a trailing disabled option', async () => {
		listAllEditionsMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(truncated(editionsFor(cfg.db), 900))
		);
		const container = await openEditionStep();

		await waitFor(() => {
			expect(q(container, OPTIONS_OPTION)).not.toBeNull();
		});
		// Inside the picker the librarian is scanning — not on the page behind it —
		// and LAST, so it never competes with a real edition. Read off the select's
		// own `options` collection rather than by node identity: happy-dom hands
		// back non-identical wrappers for one node, so `contains`/`toBe` compare
		// false on nodes that ARE the same (probed while writing this pin).
		const select = q(container, 'bulk-checkout-edition-select') as HTMLSelectElement;
		const options = Array.from(select.options);
		const last = options[options.length - 1];
		expect(last.getAttribute('data-testid')).toBe(OPTIONS_OPTION);
		expect(last.tagName).toBe('OPTION');
		expect(last.disabled).toBe(true);
		expect(last.textContent?.trim()).toBe('picker_partial_options_notice');
		// The page-level browse notice is a DIFFERENT claim and stays down.
		expect(q(container, 'library-partial-notice')).toBeNull();
	});

	it('a truncated listAllCopies raises the same option — a hidden copy reads as "none available"', async () => {
		listAllCopiesMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(truncated(copiesFor(cfg.db), 4000))
		);
		const container = await openEditionStep();

		await waitFor(() => {
			expect(q(container, OPTIONS_OPTION)).not.toBeNull();
		});
	});

	it('with both feeds complete the option is ABSENT from the select (not disabled-and-present)', async () => {
		const container = await openEditionStep();
		expect(
			(q(container, 'bulk-checkout-edition-select') as HTMLSelectElement).textContent
		).toContain('Urtext A');

		expect(q(container, OPTIONS_OPTION)).toBeNull();
	});

	it('a collective switch does not carry A’s truncation into B’s picker', async () => {
		listAllEditionsMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === DB_A
				? Promise.resolve(truncated(editionsFor(DB_A), 900))
				: Promise.resolve(toListRead(editionsFor(DB_B)))
		);
		const container = await openEditionStep();
		await waitFor(() => {
			expect(q(container, OPTIONS_OPTION)).not.toBeNull();
		});

		selectedCollectiveDbStore.set(DB_B);
		await waitFor(() => {
			expect(q(container, 'bulk-checkout-work-select')?.textContent).toContain('Os justi');
		});
		await fireEvent.change(q(container, 'bulk-checkout-work-select') as HTMLSelectElement, {
			target: { value: 'work-b1' }
		});

		await waitFor(() => {
			expect(q(container, 'bulk-checkout-edition-select')).not.toBeNull();
		});
		expect(q(container, OPTIONS_OPTION)).toBeNull();
	});
});

describe('#321 review F2 — the borrower pickers state a truncated member feed', () => {
	it('a truncated listActiveMembers renders the shared VISIBLE role="status" notice inside the member list', async () => {
		listActiveMembersMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(truncated(membersFor(cfg.db), 500))
		);
		const container = await openMemberStep();

		await waitFor(() => {
			expect(q(container, MEMBERS_NOTICE)).not.toBeNull();
		});
		const notice = q(container, MEMBERS_NOTICE) as HTMLElement;
		// A list-shaped picker CAN host a live region, so it gets the shared shape.
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
		expect(notice.textContent?.trim()).toBe('picker_partial_members_notice');
		// Inside the picker it is about, with the members it describes.
		expect(
			q(container, 'bulk-checkout-member-list')!.querySelector(`[data-testid="${MEMBERS_NOTICE}"]`)
		).not.toBeNull();
	});

	it('a complete member read leaves that notice ABSENT from the DOM', async () => {
		const container = await openMemberStep();
		expect(q(container, 'bulk-checkout-member-list')!.textContent).toContain('Ada Lovelace');

		expect(q(container, MEMBERS_NOTICE)).toBeNull();
	});

	it('the per-copy INLINE checkout select carries the same claim, as its own trailing disabled option', async () => {
		listActiveMembersMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(truncated(membersFor(cfg.db), 500))
		);
		const container = await openInlineCheckout();

		const select = q(container, 'inline-checkout-copy-a1') as HTMLSelectElement;
		const options = Array.from(select.options);
		const last = options[options.length - 1];
		expect(last.getAttribute('data-testid')).toBe('inline-checkout-partial-option-copy-a1');
		expect(last.disabled).toBe(true);
		expect(last.textContent?.trim()).toBe('picker_partial_members_notice');
	});

	it('a complete member read leaves the inline select’s option absent too', async () => {
		const container = await openInlineCheckout();
		expect(q(container, 'inline-checkout-copy-a1')!.textContent).toContain('Ada Lovelace');

		expect(q(container, 'inline-checkout-partial-option-copy-a1')).toBeNull();
	});
});

// (*MVOX:Josquin* — #321 review F2: the librarian pickers, per the PO's
// reachability ruling — closed set, so a missing option is a false absence)
