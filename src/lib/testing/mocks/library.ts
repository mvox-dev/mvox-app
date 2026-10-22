// Library read, librarian and lending mocks; spec and vi.mock factory share one handle each.
import { vi } from 'vitest';
import { resolveLibraryEditRightMock } from './admin';
import type { LoanCopy, SettledReads } from '$lib/library/libraryData';

export { resolveLibraryEditRightMock };

export const listWorksMock = vi.fn();
export const listEditionsMock = vi.fn();
export const listCopiesMock = vi.fn();
export const listAllEditionsMock = vi.fn();
export const listAllCopiesMock = vi.fn();
export const listLendingsMock = vi.fn();
export const resolveBorrowerNamesMock = vi.fn();
// Every loaned copy unresolved unless a spec seeds one; mockReset keeps this answer.
export const resolveLoanCopiesMock = vi.fn(
	async (): Promise<SettledReads<LoanCopy>> => loanCopiesRead([])
);
export const resolveMyLibraryIdMock = vi.fn();
export const createLendingMock = vi.fn();
export const returnLendingMock = vi.fn();
export const bulkCheckoutMock = vi.fn();

export function loanCopiesRead(
	entries: [string, LoanCopy][],
	failed: unknown[] = []
): SettledReads<LoanCopy> {
	return { resolved: new Map(entries), failed };
}

// Keeps the real, pure derive* and loan label helpers.
export async function libraryReadsModule() {
	const actual = await vi.importActual<object>('$lib/library/libraryData');
	return {
		...actual,
		listWorks: listWorksMock,
		listEditions: listEditionsMock,
		listCopies: listCopiesMock,
		listAllEditions: listAllEditionsMock,
		listAllCopies: listAllCopiesMock,
		listLendings: listLendingsMock,
		resolveBorrowerNames: resolveBorrowerNamesMock,
		resolveLoanCopies: resolveLoanCopiesMock
	};
}

// Keeps the real writable store and resetLibraryEditRight.
// libraryId: false leaves resolveMyLibraryId to the real module.
export async function librarianOverRealModule(opts: { libraryId?: boolean } = {}) {
	const actual = await vi.importActual<object>('$lib/library/libraryRights');
	return {
		...actual,
		resolveLibraryEditRight: resolveLibraryEditRightMock,
		...(opts.libraryId === false ? {} : { resolveMyLibraryId: resolveMyLibraryIdMock })
	};
}

export function lendingModule() {
	return {
		createLending: createLendingMock,
		returnLending: returnLendingMock,
		bulkCheckout: bulkCheckoutMock
	};
}

export function libraryCreateModule() {
	return { createWork: vi.fn(), createEdition: vi.fn() };
}

// Over the real store: the caller is a ready librarian of lib-1.
export async function readyLibrarianModule(importOriginal: () => Promise<unknown>) {
	return {
		...((await importOriginal()) as object),
		resolveMyLibraryId: vi.fn().mockResolvedValue('lib-1'),
		resolveLibraryEditRight: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
	};
}

// (*MVOX:Josquin*)
