// @vitest-environment happy-dom
// #1049: each library upload error the librarian sees is kept as one report, with its reason.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/libraryCopy')).libraryMessages()
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

vi.mock('$lib/library/libraryRights', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule({ libraryId: false })
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);

vi.mock('$lib/seasons/entuSeasons', async () =>
	(await import('$lib/testing/mocks/seasons')).entuSeasonsModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireOverRealModule()
);

vi.mock('$lib/entity/entityCreate', async () =>
	(await import('$lib/testing/mocks/library')).libraryCreateModule()
);

const { uploadEditionFilesMock } = vi.hoisted(() => ({
	uploadEditionFilesMock: vi.fn(),
}));
vi.mock('$lib/library/editionFiles', () => ({
	uploadEditionFiles: uploadEditionFilesMock,
	formatFileSize: (bytes: number) => `${bytes} B`
}));
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', async () =>
	(await import('$lib/testing/mocks/files')).appLabelStoreModule()
);

import { IDBFactory } from 'fake-indexeddb';
import { AuthExpiredError } from '$lib/entu/auth-expired';
import { get } from 'svelte/store';
import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
import { getProblemLog, resetProblemLog, setProblemOwner } from '$lib/problems/problemLog';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import {
	listCopiesMock,
	listEditionsMock,
	listLendingsMock,
	listWorksMock,
	resolveBorrowerNamesMock
} from '$lib/testing/mocks/library';
import { resolveLibraryEditRightMock } from '$lib/testing/mocks/admin';
import {
	expandEdition,
	expandWork,
	mockLibrarian,
	renderReady,
	signInLibraryReader
} from '$lib/testing/pages/library';

let fakeByteStore: FakeByteStore;

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	vi.stubGlobal('indexedDB', new IDBFactory());
	resetProblemLog();
	setProblemOwner(selectedCollectiveIdentityStore);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	listWorksMock.mockResolvedValue(toListRead([{ id: 'work-1', name: 'Epitaaf', composer: 'Tormis' }]));
	listEditionsMock.mockResolvedValue(
		toListRead([{ id: 'edition-1', name: 'Epitaaf 2', publisher: '', externalLinks: [], files: [] }])
	);
	listCopiesMock.mockResolvedValue(toListRead([]));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
	signInLibraryReader({ seasons: true });
	mockLibrarian();
});

afterEach(() => {
	cleanup();
	resolveLibraryEditRightMock.mockReset();
	uploadEditionFilesMock.mockReset();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetProblemLog();
	setProblemOwner(null);
	resetAppState();
});

// The background IndexedDB write must have had its chance before "nothing kept" means anything.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function kept() {
	const rows = await getProblemLog()!.list(get(selectedCollectiveIdentityStore)!);
	return rows.map(({ area, action, detail }) => ({ area, action, detail }));
}

async function attach(names: string[]): Promise<HTMLElement> {
	const container = await renderReady();
	await expandWork(container, 'work-1');
	await expandEdition(container, 'edition-1');
	const input = await waitFor(() => {
		const el = container.querySelector('[data-testid="library-attach-file-edition-1"]');
		expect(el).not.toBeNull();
		return el as HTMLInputElement;
	});
	const files = names.map((n) => new File([new Uint8Array(4)], n, { type: 'application/pdf' }));
	await fireEvent.change(input, { target: { files } });
	return container;
}

describe('#1049 a failed library upload sends one report per error shown, with its reason', () => {
	it('step 1 refused: the batch error shows and one report carries the HTTP status', async () => {
		uploadEditionFilesMock.mockRejectedValue(
			new Error('uploadEditionFiles: step-1 create failed: HTTP 403')
		);

		const container = await attach(['Epitaaf202.pdf', 'Epitaaf203.pdf']);

		await waitFor(() => expect(container.textContent).toContain('Could not attach files.'));
		await vi.waitFor(async () =>
			expect(await kept()).toEqual([
				{
					area: 'library',
					action: 'attaching files',
					detail: 'Error: uploadEditionFiles: step-1 create failed: HTTP 403'
				}
			])
		);
	});

	it('the PUT fails and so does the cleanup (Joosep, 2026-10-31): the broken note shows, one report says both', async () => {
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [],
			failed: [
				{
					propertyId: 'prop-new-1',
					filename: 'Epitaaf202.pdf',
					cleanup: 'delete-failed',
					reason: 'the PUT threw TypeError: Load failed; the cleanup DELETE answered HTTP 500'
				}
			]
		});

		const container = await attach(['Epitaaf202.pdf']);

		await waitFor(() =>
			expect(
				container.querySelector('[data-testid="library-edition-file-broken-prop-new-1"]')?.textContent
			).toContain('Epitaaf202.pdf failed and could not be cleaned up.')
		);
		await vi.waitFor(async () =>
			expect(await kept()).toEqual([
				{
					area: 'library',
					action: 'attaching a file',
					detail: 'the PUT threw TypeError: Load failed; the cleanup DELETE answered HTTP 500'
				}
			])
		);
	});

	it('a batch with two failed files and one that landed: two messages, two reports, none for the landed one', async () => {
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'a.pdf', filesize: 4, filetype: 'application/pdf' }
			],
			failed: [
				{ propertyId: 'prop-new-2', filename: 'b.pdf', cleanup: 'deleted', reason: 'the PUT answered HTTP 403' },
				{ propertyId: null, filename: 'c.pdf', cleanup: 'not-created', reason: 'step 1 returned no property for this file' }
			]
		});

		const container = await attach(['a.pdf', 'b.pdf', 'c.pdf']);

		const shown = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-files-error-edition-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(shown.textContent).toContain('Could not attach b.pdf.');
		expect(shown.textContent).toContain('c.pdf was not attached — the server returned nothing for it.');
		await vi.waitFor(async () =>
			expect(await kept()).toEqual([
				{ area: 'library', action: 'attaching a file', detail: 'the PUT answered HTTP 403' },
				{ area: 'library', action: 'attaching a file', detail: 'step 1 returned no property for this file' }
			])
		);
	});

	it('the session expired during the cleanup: the broken note shows, and the one report names it', async () => {
		const reason = 'the PUT answered HTTP 403; the cleanup DELETE could not run: the session expired';
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [],
			failed: [{ propertyId: 'prop-new-1', filename: 'Epitaaf202.pdf', cleanup: 'delete-failed', reason }]
		});

		const container = await attach(['Epitaaf202.pdf']);

		await waitFor(() =>
			expect(
				container.querySelector('[data-testid="library-edition-file-broken-prop-new-1"]')?.textContent
			).toContain('Epitaaf202.pdf failed and could not be cleaned up.')
		);
		await vi.waitFor(async () =>
			expect(await kept()).toEqual([{ area: 'library', action: 'attaching a file', detail: reason }])
		);
	});

	it('the session expired at step 1: the batch error shows and nothing is reported (#756)', async () => {
		uploadEditionFilesMock.mockRejectedValue(new AuthExpiredError());

		const container = await attach(['Epitaaf202.pdf']);

		await waitFor(() => expect(container.textContent).toContain('Could not attach files.'));
		await settle();
		expect(await kept()).toEqual([]);
	});

	it('a clean upload sends no report', async () => {
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'a.pdf', filesize: 4, filetype: 'application/pdf' }
			],
			failed: []
		});

		const container = await attach(['a.pdf']);

		await waitFor(() =>
			expect(container.querySelector('[data-testid="library-edition-file-prop-new-1"]')).not.toBeNull()
		);
		await settle();
		expect(await kept()).toEqual([]);
	});
});

// (*MVOX:Josquin*)
