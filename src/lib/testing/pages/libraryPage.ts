// Library page specs: the setup their files share.
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';
import { resetAppState } from '$lib/testing/appReset';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
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
	resolveMyLibraryIdMock,
	returnLendingMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';

export function useLibraryPage(): void {
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
		resolveMyLibraryIdMock.mockReset();
		findMyMemberIdMock.mockReset();
		listAllEditionsMock.mockReset();
		listAllCopiesMock.mockReset();
		listActiveMembersMock.mockReset();
		createLendingMock.mockReset();
		returnLendingMock.mockReset();
		bulkCheckoutMock.mockReset();
		resetAppState();
	});
}

// (*MVOX:Tallis*) (*MVOX:Josquin*)
