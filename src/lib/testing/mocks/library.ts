// Library read, librarian and lending mocks; spec and vi.mock factory share one handle each.
import { vi } from 'vitest';
import { resolveLibrarianMock } from './admin';

export { resolveLibrarianMock };

export const listWorksMock = vi.fn();
export const listEditionsMock = vi.fn();
export const listCopiesMock = vi.fn();
export const listAllEditionsMock = vi.fn();
export const listAllCopiesMock = vi.fn();
export const listLendingsMock = vi.fn();
export const resolveBorrowerNamesMock = vi.fn();
export const resolveCopyNamesMock = vi.fn();
export const resolveCopyChainsMock = vi.fn();
export const resolveMyLibraryIdMock = vi.fn();
export const createLendingMock = vi.fn();
export const returnLendingMock = vi.fn();
export const bulkCheckoutMock = vi.fn();

// Keeps the real, pure derive* / formatLoanChainLabel helpers.
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
		resolveCopyNames: resolveCopyNamesMock,
		resolveCopyChains: resolveCopyChainsMock
	};
}

// Keeps the real writable store and resetLibrarian.
export async function librarianOverRealModule() {
	const actual = await vi.importActual<object>('$lib/library/librarianStore');
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock,
		resolveMyLibraryId: resolveMyLibraryIdMock
	};
}

export function lendingModule() {
	return {
		createLending: createLendingMock,
		returnLending: returnLendingMock,
		bulkCheckout: bulkCheckoutMock
	};
}

// (*MVOX:Josquin*)
