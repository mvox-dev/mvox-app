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
// chains: false leaves resolveCopyChains out, as the older specs had it.
export async function libraryReadsModule(opts: { chains?: boolean } = {}) {
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
		...(opts.chains === false ? {} : { resolveCopyChains: resolveCopyChainsMock })
	};
}

// Keeps the real writable store and resetLibrarian.
// libraryId: false leaves resolveMyLibraryId to the real module.
export async function librarianOverRealModule(opts: { libraryId?: boolean } = {}) {
	const actual = await vi.importActual<object>('$lib/library/librarianStore');
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock,
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
		resolveLibrarian: vi.fn().mockResolvedValue({ state: 'ready', libraryId: 'lib-1' })
	};
}

// (*MVOX:Josquin*)
