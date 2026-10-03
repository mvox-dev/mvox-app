// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
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
	(await import('$lib/testing/mocks/library')).librarianOverRealModule({ libraryId: false })
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

import Page from './library/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
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
	resolveCopyChainsMock,
	resolveCopyNamesMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';

const DB_A = 'sampledb';
const DB_B = 'other-choir';

const OPTIONS_OPTION = 'bulk-checkout-edition-partial-option';
const MEMBERS_NOTICE = 'bulk-checkout-members-partial-notice';

function truncated<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

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
	signIn({
		collectives: [
			{ db: DB_A, name: 'Sampledb', personId: 'person-p' },
			{ db: DB_B, name: 'Other Choir', personId: 'person-q' }
		]
	});
}

beforeEach(() => {
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
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

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
		const select = q(container, 'bulk-checkout-edition-select') as HTMLSelectElement;
		const options = Array.from(select.options);
		const last = options[options.length - 1];
		expect(last.getAttribute('data-testid')).toBe(OPTIONS_OPTION);
		expect(last.tagName).toBe('OPTION');
		expect(last.disabled).toBe(true);
		expect(last.textContent?.trim()).toBe('picker_partial_options_notice');
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
		expect(notice.getAttribute('role')).toBe('status');
		expect(notice.className).not.toMatch(/sr-only|hidden/);
		expect(notice.textContent?.trim()).toBe('picker_partial_members_notice');
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
