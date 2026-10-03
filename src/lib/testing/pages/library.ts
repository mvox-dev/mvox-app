// Library page harness: the setup its specs had word for word. Specs import what they use.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { expect, vi } from 'vitest';
import Page from '../../../routes/library/+page.svelte';
import { install401Recovery } from '$lib/auth/install-401-recovery';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { resetAppState } from '$lib/testing/appReset';
import { toListRead } from '$lib/testing/listReadFixtures';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import { gotoMock } from '$lib/testing/routeMocks';
import { signIn } from '$lib/testing/session';
import { surfacesUnder } from '$lib/testing/svelteSurfaces';
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
	resolveCopyChainsMock,
	resolveCopyNamesMock,
	resolveLibrarianMock,
	resolveMyLibraryIdMock,
	returnLendingMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { listRepertoireItemsMock, listSeasonsMock } from '$lib/testing/mocks/seasons';

export const LIBRARY_SURFACES = surfacesUnder('src/routes/library/', 'src/lib/library/');

export function cleanupClearReset(): void {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
}

export function resetCopyListMocks(): void {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveCopyNamesMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	createLendingMock.mockReset();
	returnLendingMock.mockReset();
	bulkCheckoutMock.mockReset();
	resetAppState();
}

export function resetRepertoireBadgeMocks(): void {
	cleanup();
	listWorksMock.mockReset();
	listEditionsMock.mockReset();
	listCopiesMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listLendingsMock.mockReset();
	resolveBorrowerNamesMock.mockReset();
	resolveCopyNamesMock.mockReset();
	resolveLibrarianMock.mockReset();
	findMyMemberIdMock.mockReset();
	listActiveMembersMock.mockReset();
	listSeasonsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	resetAppState();
}

export function armLibraryRecovery(): void {
	install401Recovery();
	gotoMock.mockReset();
	resetTypeIdCache();
	history.replaceState({}, '', '/library');
}

export interface ReaderOpts {
	librarian?: boolean;
	myLibraryId?: string;
	chains?: boolean;
	seasons?: boolean;
}

// One collective, empty reads. Each option is a seed some specs add; none is on by default.
export function signInLibraryReader(opts: ReaderOpts = {}): void {
	signIn();
	resolveLibrarianMock.mockResolvedValue(
		opts.librarian
			? { state: 'librarian', libraryId: 'lib-1' }
			: { state: 'not-librarian', libraryId: null }
	);
	if (opts.myLibraryId) resolveMyLibraryIdMock.mockResolvedValue(opts.myLibraryId);
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	if (opts.chains) resolveCopyChainsMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
	if (opts.seasons) {
		listSeasonsMock.mockResolvedValue([]);
		listRepertoireItemsMock.mockResolvedValue([]);
	}
}

export function mockLibrarian(): void {
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
}

export const DB_A = 'sampledb';
export const DB_B = 'other-choir';

export function setAuthedWithTwoCollectives(): void {
	signIn({
		collectives: [
			{ db: DB_A, name: 'Sampledb', personId: 'person-p' },
			{ db: DB_B, name: 'Other Choir', personId: 'person-q' }
		]
	});
}

export function worksFor(db: string) {
	return db === DB_A
		? [
				{ id: 'work-a1', name: 'Spem in alium', composer: 'Thomas Tallis' },
				{ id: 'work-a2', name: 'Ave verum corpus', composer: 'William Byrd' }
			]
		: [
				{ id: 'work-b1', name: 'Cantique de Jean Racine', composer: 'Gabriel Fauré' },
				{ id: 'work-b2', name: 'Os justi', composer: 'Anton Bruckner' }
			];
}

export function editionsFor(db: string) {
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

export function copiesFor(db: string) {
	return db === DB_A
		? [
				{ id: 'copy-a1', name: 'Copy A1', copyNumber: 1, editionId: 'edition-a1' },
				{ id: 'copy-a2', name: 'Copy A2', copyNumber: 2, editionId: 'edition-a1' }
			]
		: [{ id: 'copy-b1', name: 'Copy B1', copyNumber: 1, editionId: 'edition-b1' }];
}

export function membersFor(db: string) {
	return db === DB_A
		? [
				{ memberId: 'member-a1', personId: 'person-a1', sectionIds: [] },
				{ memberId: 'member-a2', personId: 'person-a2', sectionIds: [] }
			]
		: [{ memberId: 'member-b1', personId: 'person-b1', sectionIds: [] }];
}

export function borrowerNamesFor(db: string) {
	return db === DB_A
		? new Map([
				['member-a1', 'Ada Lovelace'],
				['member-a2', 'Bea Noe']
			])
		: new Map([['member-b1', 'Bob Bass']]);
}

// Both collectives librarian-wired, each answering with its own fixtures.
export function seedTwoLibraries(): void {
	listWorksMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(worksFor(cfg.db)))
	);
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(borrowerNamesFor(cfg.db))
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
	resolveMyLibraryIdMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === DB_A ? 'lib-a' : 'lib-b')
	);
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
}

export function truncated<T>(items: T[], total: number) {
	return { items, total, truncated: true };
}

// Renders and waits for work-1's row.
export async function renderReady(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
	});
	return container;
}

export async function expandWork(container: HTMLElement, workId: string): Promise<void> {
	await fireEvent.click(
		container.querySelector(`[data-testid="library-work-toggle-${workId}"]`) as Element
	);
	await waitFor(() => {
		expect(container.querySelector(`#library-editions-${workId}`)).not.toBeNull();
	});
}

export async function expandEdition(container: HTMLElement, editionId: string): Promise<void> {
	await waitFor(() => {
		expect(
			container.querySelector(`[data-testid="library-edition-toggle-${editionId}"]`)
		).not.toBeNull();
	});
	await fireEvent.click(
		container.querySelector(`[data-testid="library-edition-toggle-${editionId}"]`) as Element
	);
	await waitFor(() => {
		expect(container.querySelector(`#library-copies-${editionId}`)).not.toBeNull();
	});
}

export const sortBtn = (key: 'nr' | 'member' | 'since') =>
	`[data-testid="copy-sort-${key}-edition-1"]`;

export function copyOrder(container: HTMLElement): string[] {
	return [
		...container.querySelectorAll(
			'[data-testid="library-edition-edition-1"] [data-testid^="library-copy-"]'
		)
	].map((el) => el.getAttribute('data-testid')!.replace('library-copy-', ''));
}

// (*MVOX:Josquin*)
