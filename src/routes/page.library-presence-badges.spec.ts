// @vitest-environment happy-dom
// Library edition-file rows show whether the part is on this device.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
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

import Page from './library/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures.js';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { resetAppState } from '$lib/testing/appReset';
import { findMyMemberIdMock } from '$lib/testing/moduleHandles';
import { signFileUrlMock } from '$lib/testing/mocks/files';
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
import { listRepertoireItemsMock, listSeasonsMock } from '$lib/testing/mocks/seasons';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import {
	expandEdition,
	expandWork,
	renderReady,
	signInLibraryReader
} from '$lib/testing/pages/library';
import { pdfData } from '$lib/testing/pages/event';

let fakeByteStore: FakeByteStore;

type PresenceQuery = (db: string, personId: string) => Promise<string[]>;

function installPresence(impl?: PresenceQuery) {
	const spy = vi.fn<PresenceQuery>(
		impl ?? (async (db, personId) => fakeByteStore.heldFor(db, personId))
	);
	(fakeByteStore as unknown as { heldFileIds: PresenceQuery }).heldFileIds = spy;
	return spy;
}

const IDENTITY = { db: 'sampledb', personId: 'person-p' };

function mockBaselineLibrary() {
	listWorksMock.mockResolvedValue(
		toListRead([{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }])
	);
	listEditionsMock.mockResolvedValue(
		toListRead([
			{
				id: 'edition-1',
				name: 'Vocal score',
				publisher: 'Novello',
				externalLinks: [],
				files: [
					{ id: 'file-held', filename: 'spem-vocal.pdf', filesize: 1937, filetype: 'application/pdf' },
					{ id: 'file-absent', filename: 'spem-full.pdf', filesize: 2048, filetype: 'application/pdf' }
				]
			}
		])
	);
	listCopiesMock.mockResolvedValue(toListRead([]));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
});

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
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	listSeasonsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	uploadEditionFilesMock.mockReset();
	signFileUrlMock.mockReset();
	vi.unstubAllGlobals();
	resetAppState();
});

async function renderWithFilesVisible(): Promise<HTMLElement> {
	const container = await renderReady();
	await expandWork(container, 'work-1');
	await expandEdition(container, 'edition-1');
	await waitFor(() => {
		expect(
			container.querySelector('[data-testid="library-edition-file-file-held"]')
		).not.toBeNull();
	});
	return container;
}

describe('#351 — /library: one indicator, two states, on every file row (integration)', () => {
	it('a held file badges on-device, an unheld file badges needs-network — both states in the SAME render, each INSIDE its own file row', async () => {
		mockBaselineLibrary();
		signInLibraryReader({ chains: true, seasons: true });
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();

		const container = await renderWithFilesVisible();

		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="file-presence-file-absent"]')).not.toBeNull();
		});
		const held = container.querySelector('[data-testid="file-presence-file-held"]')!;
		const absent = container.querySelector('[data-testid="file-presence-file-absent"]')!;
		expect(held.textContent).toContain('[file_presence_on_device]');
		expect(held.textContent).not.toContain('[file_presence_needs_network]');
		expect(absent.textContent).toContain('[file_presence_needs_network]');
		expect(absent.textContent).not.toContain('[file_presence_on_device]');
		expect(held.closest('[data-testid="library-edition-file-file-held"]')).not.toBeNull();
		expect(absent.closest('[data-testid="library-edition-file-file-absent"]')).not.toBeNull();
	});

	it('THE trap: rendering asks presence ONCE for the whole list — never get() — and asks for the CURRENT identity partition', async () => {
		mockBaselineLibrary();
		signInLibraryReader({ chains: true, seasons: true });
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		const presenceSpy = installPresence();
		const getSpy = vi.spyOn(fakeByteStore, 'get');

		const container = await renderWithFilesVisible();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
		});

		expect(presenceSpy.mock.calls).toEqual([['sampledb', 'person-p']]);
		expect(getSpy).not.toHaveBeenCalled();
	});

	it('while the store has NOT answered, NEITHER badge renders — no default-then-correct', async () => {
		mockBaselineLibrary();
		signInLibraryReader({ chains: true, seasons: true });
		const pending = deferred<string[]>();
		installPresence(() => pending.promise);

		const container = await renderWithFilesVisible();

		expect(container.querySelectorAll('[data-testid^="file-presence-"]').length).toBe(0);
		const filesBlock = container.querySelector(
			'[data-testid="library-edition-files-edition-1"]'
		)!;
		expect(filesBlock.textContent).not.toContain('[file_presence_needs_network]');
		expect(filesBlock.textContent).not.toContain('[file_presence_on_device]');

		pending.resolve(['file-held']);
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="file-presence-file-held"]')!.textContent
			).toContain('[file_presence_on_device]');
			expect(
				container.querySelector('[data-testid="file-presence-file-absent"]')!.textContent
			).toContain('[file_presence_needs_network]');
		});
	});

	it('the badge is NOT a control: no button/link semantics, and clicking it signs nothing and opens nothing — the row Open affordance is untouched beside it', async () => {
		mockBaselineLibrary();
		signInLibraryReader({ chains: true, seasons: true });
		fakeByteStore.seed(IDENTITY, 'file-held', pdfData());
		installPresence();
		const openSpy = vi.spyOn(window, 'open');

		const container = await renderWithFilesVisible();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="file-presence-file-held"]')).not.toBeNull();
		});

		for (const fileId of ['file-held', 'file-absent']) {
			const badge = container.querySelector(`[data-testid="file-presence-${fileId}"]`)!;
			expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']).not.toContain(
				badge.tagName
			);
			expect(badge.hasAttribute('role')).toBe(false);
			expect(badge.hasAttribute('tabindex')).toBe(false);
			expect(badge.closest('button, a, [role="button"]')).toBeNull();
			await fireEvent.click(badge);
		}
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(openSpy).not.toHaveBeenCalled();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-file-held"]')
		).not.toBeNull();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-file-absent"]')
		).not.toBeNull();
	});

});

describe('#351 — wording honesty (byteStore.ts:8 — a correctness boundary, NOT a security boundary)', () => {
	const localeFiles = ['en', 'et', 'lv', 'uk'] as const;
	const BADGE_KEYS = ['file_presence_on_device', 'file_presence_needs_network'] as const;
	const FORBIDDEN = [
		/priv/i,
		/secur/i,
		/protect/i,
		/kaitst/i,
		/turval/i,
		/aizsarg/i,
		/droš/i,
		/захищ/i,
		/прив/i,
		/безпеч/i
	];

	it('both badge keys exist, non-empty, in all four locales', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			for (const key of BADGE_KEYS) {
				expect(messages[key], `${locale}: ${key}`).toBeTruthy();
			}
		}
	});

	it('no badge value in any locale implies the bytes are private, secure or protected — on-device is a statement about AVAILABILITY', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, string>;
			for (const key of BADGE_KEYS) {
				const value = messages[key] ?? '';
				for (const pattern of FORBIDDEN) {
					expect(value, `${locale}: ${key} = "${value}" matches ${pattern}`).not.toMatch(pattern);
				}
			}
		}
	});
});

// (*MVOX:Tallis*)
