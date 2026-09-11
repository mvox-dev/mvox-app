// @vitest-environment happy-dom
//
// #275 RED — files on an edition: the /library page grows, PER EDITION (the
// #271 create-edition template one level down), the app's FIRST file list and
// FIRST upload affordance.
//
//   - FILES LIST (a NEW render path — at branch base `edition.files` renders
//     NOWHERE): [data-testid="library-edition-files-{editionId}"] inside the
//     EXPANDED edition region, one row
//     [data-testid="library-edition-file-{propertyId}"] per file showing
//     filename + human filesize (formatFileSize from the new
//     $lib/library/editionFiles module — stated: no other helper exists). The
//     list is a READ path, visible to everyone. Zero editions with files is
//     normal and unremarkable: NO empty-state noise.
//   - DOWNLOAD reuses the EXISTING mechanism: signFileUrl
//     ($lib/repertoire/fileUrls) mints the 60s URL AT CLICK TIME. The read
//     model carries no url field by design — nothing from the upload response
//     or the entity fetch is stored or rendered as a link.
//   - ATTACH ([data-testid="library-attach-file-{editionId}"]): librarian-only
//     (absent-not-disabled, $librarianStore idiom), a NATIVE
//     <input type=file multiple> — [TRIGGER-NATIVE-CONTROLS]. Selection needs
//     no seam in happy-dom: construct File objects, set input.files, dispatch
//     change. The upload itself goes through the new module's
//     uploadEditionFiles (mocked here; its wire contract — one POST, four-
//     header S3 PUT, phantom cleanup — is pinned in
//     src/lib/library/editionFiles.spec.ts).
//   - STATE IS KEYED PER EDITION (the createEditionPending Map/Set precedent):
//     uploading edition A's batch disables A's attach control only; PER-BATCH
//     pending state (stated choice), success announced via the sr-only
//     create-edition-status idiom, failures visible PER FILE (#253
//     says-exactly-what-landed), a delete-failed phantom rendered as a BROKEN
//     row — never as a normal attachment.
//   - GENERATION GUARD: captured before the upload chain; success-apply AND
//     failure-apply both gated on isCurrent (the #271 create-edition
//     precedent in the same file).
//   - LAYOUT (stated choice for GREEN): INLINE-IN-EDITION-BLOCK — the files
//     block renders inside the edition's existing expanded region without a
//     THIRD ml-4 nesting level (research: phone width at max-w-md). Sanity
//     pins: no ml-4 on the files container, filenames wrap (break-words/
//     break-all), never truncate/whitespace-nowrap.
//
// INTEGRATION (house rule): these tests render the ACTUAL /library route
// component (./library/+page.svelte), so the feature cannot go green as an
// isolated component that no page ever mounts.
//
// UNTOUCHED READ PATHS: the done-when's "existing read paths unchanged" means
// the AGENDA's work-link-pdf path — pinned green by the existing
// page.season-repertoire.spec.ts suite, which this slice must not touch.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		library_title: () => 'Library',
		library_no_collective: () => 'Select a collective to view the library.',
		library_load_error: () => 'Something went wrong loading the library.',
		library_retry: () => 'Retry',
		library_empty: () => 'Nothing in the library yet.',
		library_work_composer_unknown: () => 'Unknown composer',
		library_editions_empty: () => 'No editions yet.',
		library_edition_publisher_unknown: () => 'Unknown publisher',
		library_copies_empty: () => 'No copies yet.',
		library_copy_available: () => 'Available',
		library_copy_lent_to: (p: { name: string }) => `Out — ${p.name}`,
		library_borrower_unknown: () => 'an unnamed member',
		library_copy_name_unknown: () => 'Untitled copy',
		library_lent_since: (p: { date: string }) => `since ${p.date}`,
		library_node_load_error: () => 'Could not load.',
		library_node_retry: () => 'Retry',
		library_librarian_tools: () => 'Librarian tools',
		library_librarian_load_error: () => 'Could not check librarian access.',
		library_librarian_retry: () => 'Retry',
		library_my_loans_title: (p: { count: number }) => `My loans (${p.count})`,
		library_my_loans_copy_label: (p: { copyName: string }) => `${p.copyName}`,
		library_my_loans_overdue: () => 'Overdue',
		library_checkout_submit: () => 'Checkout',
		library_return: () => 'Return',
		library_bulk_checkout_title: () => 'Bulk checkout',
		library_bulk_checkout_edition_placeholder: () => 'Select edition',
		library_bulk_checkout_work_placeholder: () => 'Select work',
		library_bulk_checkout_availability: (p: { available: number; total: number }) =>
			`${p.available}/${p.total} available`,
		library_bulk_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_bulk_checkout_too_many: () => 'Not enough copies available',
		library_work_availability: (p: { available: number; total: number }) =>
			`${p.available}/${p.total}`,
		library_inline_checkout_placeholder: () => 'Select member',
		library_inline_checkout_already_lent: (p: { date: string }) => `Lent since ${p.date}`,
		library_inline_checkout_error: () => 'Checkout failed',
		library_copy_sort_label: () => 'Sort copies by',
		library_copy_sort_nr: () => 'Nr',
		library_copy_sort_member: () => 'Member',
		library_copy_sort_since: () => 'Since',
		library_available_summary: (p: { count: number }) => `${p.count} copies available for lending`,
		library_create_work_button: () => 'Add work',
		library_create_work_name_label: () => 'Title',
		library_create_work_composer_label: () => 'Composer',
		library_create_work_submit: () => 'Create work',
		library_create_work_cancel: () => 'Cancel',
		library_create_work_name_required: () => 'Work title is required.',
		library_create_work_created: (p: { name: string }) => `${p.name} created.`,
		library_create_work_error: () => 'Could not create the work.',
		library_create_edition_button: () => 'Add edition',
		library_create_edition_name_label: () => 'Name',
		library_create_edition_publisher_label: () => 'Publisher',
		library_create_edition_submit: () => 'Create edition',
		library_create_edition_cancel: () => 'Cancel',
		library_create_edition_name_required: () => 'Edition name is required.',
		library_create_edition_created: (p: { name: string }) => `${p.name} created.`,
		library_create_edition_error: () => 'Could not create the edition.',
		// #275 — edition-file affordance (engineering drafts, see the i18n spec)
		library_edition_file_attach: () => 'Attach files',
		library_edition_file_open: () => 'Open',
		library_edition_file_uploading: () => 'Uploading…',
		library_edition_file_uploaded: (p: { filenames: string }) => `${p.filenames} attached.`,
		library_edition_file_failed: (p: { filename: string }) => `Could not attach ${p.filename}.`,
		library_edition_file_broken: (p: { filename: string }) =>
			`${p.filename} failed and could not be cleaned up.`,
		library_edition_file_error: () => 'Could not attach files.',
		library_edition_file_not_created: (p: { filename: string }) =>
			`${p.filename} was not attached — the server returned nothing for it.`,
		library_edition_file_open_error: () => 'Could not open the file.'
	}
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
	const actual = await vi.importActual<typeof import('$lib/library/libraryData')>(
		'$lib/library/libraryData'
	);
	return {
		...actual, // keep the real, pure derive* helpers
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
	const actual = await vi.importActual<typeof import('$lib/library/librarianStore')>(
		'$lib/library/librarianStore'
	);
	return {
		...actual,
		resolveLibrarian: resolveLibrarianMock
	};
});

const { findMyMemberIdMock } = vi.hoisted(() => ({ findMyMemberIdMock: vi.fn() }));
vi.mock('$lib/rsvp/rsvpData', () => ({ findMyMemberId: findMyMemberIdMock }));

vi.mock('$lib/library/lendingActions', () => ({
	createLending: vi.fn(),
	returnLending: vi.fn(),
	bulkCheckout: vi.fn()
}));

const { listSeasonsMock } = vi.hoisted(() => ({ listSeasonsMock: vi.fn() }));
vi.mock('$lib/seasons/entuSeasons', async () => {
	const actual = await vi.importActual<typeof import('$lib/seasons/entuSeasons')>(
		'$lib/seasons/entuSeasons'
	);
	return {
		...actual,
		listSeasons: listSeasonsMock
	};
});
const { listRepertoireItemsMock } = vi.hoisted(() => ({ listRepertoireItemsMock: vi.fn() }));
vi.mock('$lib/repertoire/repertoireData', async () => {
	const actual = await vi.importActual<typeof import('$lib/repertoire/repertoireData')>(
		'$lib/repertoire/repertoireData'
	);
	return {
		...actual,
		listRepertoireItems: listRepertoireItemsMock
	};
});

vi.mock('$lib/entity/entityCreate', () => ({
	createWork: vi.fn(),
	createEdition: vi.fn()
}));

// #275 — the two seams under test at the PAGE level. Factory-only mocks (no
// importActual): $lib/library/editionFiles is a RED-phase contract stub whose
// real bodies land in GREEN, and fileUrls' real signFileUrl would do network.
// formatFileSize is stubbed deterministically so the "human filesize" pins
// prove the page renders THROUGH the shared helper.
const { uploadEditionFilesMock, signFileUrlMock } = vi.hoisted(() => ({
	uploadEditionFilesMock: vi.fn(),
	signFileUrlMock: vi.fn()
}));
vi.mock('$lib/library/editionFiles', () => ({
	uploadEditionFiles: uploadEditionFilesMock,
	formatFileSize: (bytes: number) =>
		bytes === 1937 ? '1.9 KB' : bytes === 245678 ? '239.9 KB' : bytes === 2048 ? '2.0 KB' : `${bytes} B`
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));

import Page from './library/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
	listSeasonsMock.mockResolvedValue([]);
	listRepertoireItemsMock.mockResolvedValue([]);
}

/**
 * Baseline: ONE work with TWO editions — edition-1 CARRIES two files (the
 * read model's EditionFile[] shape, straight from listEditions), edition-2
 * has NONE. Two editions because the per-EDITION-keyed-state contract needs
 * two attach controls live at once; a zero-files edition because optionality
 * is a done-when.
 */
function mockBaselineLibrary() {
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listEditionsMock.mockResolvedValue(toListRead([
		{
			id: 'edition-1',
			name: 'Vocal score',
			publisher: 'Novello',
			externalLinks: [],
			files: [
				{ id: 'file-1', filename: 'spem-vocal.pdf', filesize: 1937, filetype: 'application/pdf' },
				{ id: 'file-2', filename: 'spem-rehearsal.mp3', filesize: 245678, filetype: 'audio/mpeg' }
			]
		},
		{
			id: 'edition-2',
			name: 'Full score',
			publisher: 'Carus',
			externalLinks: [],
			files: []
		}
	]));
	listCopiesMock.mockResolvedValue(toListRead([]));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
}

function mockLibrarian() {
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
}

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
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

/** Renders the route and waits for the work row. */
async function renderReady(): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
	});
	return container;
}

async function expandWork(container: HTMLElement, workId: string): Promise<void> {
	await fireEvent.click(
		container.querySelector(`[data-testid="library-work-toggle-${workId}"]`) as Element
	);
	await waitFor(() => {
		expect(container.querySelector(`#library-editions-${workId}`)).not.toBeNull();
	});
}

async function expandEdition(container: HTMLElement, editionId: string): Promise<void> {
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

/** Route rendered, work-1 and the given edition expanded. */
async function renderWithEditionOpen(editionId: string): Promise<HTMLElement> {
	const container = await renderReady();
	await expandWork(container, 'work-1');
	await expandEdition(container, editionId);
	return container;
}

function attachInput(container: HTMLElement, editionId: string): HTMLInputElement {
	return container.querySelector(
		`[data-testid="library-attach-file-${editionId}"]`
	) as HTMLInputElement;
}

/** Selects files on the native input — happy-dom needs no seam: File objects
 *  constructed directly, input.files set, change dispatched. */
async function selectFiles(input: HTMLInputElement, files: File[]): Promise<void> {
	await fireEvent.change(input, { target: { files } });
}

function makeFile(name: string, bytes: number, type: string): File {
	return new File([new Uint8Array(bytes)], name, { type });
}

// ---------------------------------------------------------------------------
// FILES LIST — the NEW render path (edition.files rendered nowhere before)
// ---------------------------------------------------------------------------

describe('#275 — the files list renders inside the expanded edition (integration)', () => {
	it('an edition WITH files shows one row per file — filename AND human filesize (via the shared formatFileSize) — inside the expanded edition block', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-edition-1"]')
			).not.toBeNull();
		});
		// The list lives WITH its edition — inside that edition's block.
		const editionBlock = container.querySelector(
			'[data-testid="library-edition-edition-1"]'
		) as HTMLElement;
		const list = editionBlock.querySelector(
			'[data-testid="library-edition-files-edition-1"]'
		) as HTMLElement;
		expect(list).not.toBeNull();

		const row1 = list.querySelector('[data-testid="library-edition-file-file-1"]') as HTMLElement;
		const row2 = list.querySelector('[data-testid="library-edition-file-file-2"]') as HTMLElement;
		expect(row1).not.toBeNull();
		expect(row2).not.toBeNull();
		expect(row1.textContent).toContain('spem-vocal.pdf');
		expect(row1.textContent).toContain('1.9 KB');
		expect(row2.textContent).toContain('spem-rehearsal.mp3');
		expect(row2.textContent).toContain('239.9 KB');
	});

	it('the list renders only in the EXPANDED edition — present after expanding, gone again after collapsing', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderReady();
		await expandWork(container, 'work-1');
		// edition-1 visible but NOT expanded: no file rows yet.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-edition-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="library-edition-files-edition-1"]')).toBeNull();

		// Expanded: the list is there (the positive control that makes the
		// absence pins above and below non-vacuous).
		await expandEdition(container, 'edition-1');
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-edition-1"]')
			).not.toBeNull();
		});

		// Collapsed again: gone.
		await fireEvent.click(
			container.querySelector('[data-testid="library-edition-toggle-edition-1"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-files-edition-1"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="library-edition-file-file-1"]')).toBeNull();
	});

	it('zero files is normal and UNREMARKABLE: the zero-files edition renders NO files list, NO empty-state message — for a non-librarian, exactly as today (no #275 testid exists under it at all), while the SIBLING edition with files shows its list (the absence is not vacuous)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');
		await expandEdition(container, 'edition-2');

		// Positive control first: edition-1's list exists, so a base build with
		// NO files feature at all cannot pass this test.
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-edition-1"]')
			).not.toBeNull();
		});

		const editionBlock = container.querySelector(
			'[data-testid="library-edition-edition-2"]'
		) as HTMLElement;
		expect(editionBlock.querySelector('[data-testid^="library-edition-files-"]')).toBeNull();
		expect(editionBlock.querySelector('[data-testid^="library-edition-file-"]')).toBeNull();
		expect(editionBlock.querySelector('[data-testid^="library-attach-file-"]')).toBeNull();
		// The existing copies-empty read path is untouched.
		expect(editionBlock.textContent).toContain('No copies yet.');
	});

	it('the files list is a READ path — it renders for the non-librarian member too', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		// resolveLibrarian default: not-librarian.

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-file-file-1"]')
			).not.toBeNull();
		});
	});

	it('LAYOUT sanity at phone width (class contract; happy-dom computes no layout): the files container adds NO third ml-4 indent level, and filenames WRAP — break-words/break-all present, truncate/whitespace-nowrap absent throughout the rows', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		const list = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-files-edition-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		// Stated layout choice: inline-in-edition-block — the block rides the
		// edition's EXISTING indent, no third ml-4 level under max-w-md.
		expect(Array.from(list.classList)).not.toContain('ml-4');

		const row = list.querySelector('[data-testid="library-edition-file-file-1"]') as HTMLElement;
		const everything = [row, ...Array.from(row.querySelectorAll<HTMLElement>('*'))];
		for (const el of everything) {
			const classes = Array.from(el.classList);
			expect(classes, 'filenames must never truncate').not.toContain('truncate');
			expect(classes, 'filenames must wrap, not overflow').not.toContain('whitespace-nowrap');
		}
		expect(
			everything.some((el) => el.classList.contains('break-words') || el.classList.contains('break-all')),
			'a long filename needs an explicit wrap class somewhere in its row'
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// DOWNLOAD — the existing signFileUrl mechanism, minted AT CLICK TIME
// ---------------------------------------------------------------------------

describe('#275 — opening a file signs its URL at click time (60s TTL — never stored)', () => {
	it('no URL is rendered or pre-signed: at render, signFileUrl has NOT been called, the row holds no <a href>, and the open control is a BUTTON', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		const row = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(row.querySelector('a[href]')).toBeNull();
		const open = row.querySelector(
			'[data-testid="library-edition-file-open-file-1"]'
		) as HTMLElement;
		expect(open).not.toBeNull();
		expect(open.tagName).toBe('BUTTON');
	});

	it('clicking Open signs THAT file — signFileUrl called once with the file PROPERTY id, only then', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		vi.stubGlobal('open', vi.fn(() => null));
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');

		const container = await renderWithEditionOpen('edition-1');
		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		await fireEvent.click(open);

		await waitFor(() => expect(signFileUrlMock).toHaveBeenCalledTimes(1));
		expect(signFileUrlMock.mock.calls[0][1]).toBe('file-1');
	});

	// Review YELLOW: the rejection path used to console.error and close the
	// blank tab — the click looked like nothing happened at all.
	it('a REJECTED signing shows a visible error on that file, for the NON-LIBRARIAN too (Open is a read affordance every member has, so the message must live outside the librarian gate)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective(); // default: not-librarian
		const close = vi.fn();
		vi.stubGlobal('open', vi.fn(() => ({ opener: {}, location: { href: '' }, close })));
		signFileUrlMock.mockRejectedValue(new Error('sign failed'));

		const container = await renderWithEditionOpen('edition-1');
		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		await fireEvent.click(open);

		const alert = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-error-file-1"]');
			expect(el, 'a failed open must SAY so on the page').not.toBeNull();
			return el as HTMLElement;
		});
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent?.trim()).toBe('Could not open the file.');
		// Non-librarian really is the case under test: no attach control exists.
		expect(container.querySelector('[data-testid="library-attach-file-edition-1"]')).toBeNull();
		// Only the clicked file is marked — its sibling stays clean.
		expect(
			container.querySelector('[data-testid="library-edition-file-open-error-file-2"]')
		).toBeNull();
	});

	it('the next SUCCESSFUL open of that same file clears the error', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		vi.stubGlobal('open', vi.fn(() => ({ opener: {}, location: { href: '' }, close: vi.fn() })));
		signFileUrlMock.mockRejectedValueOnce(new Error('sign failed'));

		const container = await renderWithEditionOpen('edition-1');
		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-file-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});

		await fireEvent.click(open);
		await waitFor(() =>
			expect(
				container.querySelector('[data-testid="library-edition-file-open-error-file-1"]')
			).not.toBeNull()
		);

		signFileUrlMock.mockResolvedValue('https://s3.example/signed-1');
		await fireEvent.click(open);

		await waitFor(() =>
			expect(
				container.querySelector('[data-testid="library-edition-file-open-error-file-1"]')
			).toBeNull()
		);
	});
});

// ---------------------------------------------------------------------------
// ATTACH AFFORDANCE — librarian-only, native input, per-edition keyed
// ---------------------------------------------------------------------------

describe('#275 — the attach control: librarian-only native <input type=file multiple>', () => {
	it('for the librarian it renders inside the expanded edition — a NATIVE file input, multiple, labelled — on the zero-files edition too (attach is how files ever appear)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const container = await renderWithEditionOpen('edition-2');

		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		expect(input.tagName).toBe('INPUT');
		expect(input.type).toBe('file');
		expect(input.multiple).toBe(true);
		expect(input.getAttribute('aria-label') || input.labels?.length).toBeTruthy();
		// Inside THIS edition's block.
		const editionBlock = container.querySelector(
			'[data-testid="library-edition-edition-2"]'
		) as HTMLElement;
		expect(editionBlock.querySelector('[data-testid="library-attach-file-edition-2"]')).not.toBeNull();
	});

	it('ABSENT — not disabled — for the non-librarian: no attach control exists anywhere, while the files list still renders', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-file-file-1"]')).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid^="library-attach-file-"]')).toHaveLength(0);
	});

	it('hidden while resolveLibrarian is still pending (hidden-if-undeterminable)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockReturnValue(new Promise(() => {}));

		const container = await renderWithEditionOpen('edition-1');

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-edition-file-file-1"]')).not.toBeNull();
		});
		expect(container.querySelectorAll('[data-testid^="library-attach-file-"]')).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// THE UPLOAD FLOW — select, in-flight per edition, local append, announce
// ---------------------------------------------------------------------------

describe('#275 — selecting files uploads them through uploadEditionFiles', () => {
	it('a change with two Files calls uploadEditionFiles ONCE with (cfg, the edition id, the Files) — and no listEditions refetch afterwards; the new rows appear LOCALLY with the sr-only announcement naming exactly what landed', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' },
				{ propertyId: 'prop-new-2', filename: 'new-b.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: []
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		const editionReadsBefore = listEditionsMock.mock.calls.length;

		const fileA = makeFile('new-a.pdf', 2048, 'application/pdf');
		const fileB = makeFile('new-b.pdf', 2048, 'application/pdf');
		await selectFiles(input, [fileA, fileB]);

		await waitFor(() => expect(uploadEditionFilesMock).toHaveBeenCalledTimes(1));
		const call = uploadEditionFilesMock.mock.calls[0];
		expect(call[0]).toEqual({ db: 'polyphony', token: 'jwt-abc' });
		expect(call[1]).toBe('edition-2');
		const sent = call[2] as File[];
		expect(sent.map((f) => f.name)).toEqual(['new-a.pdf', 'new-b.pdf']);

		// LOCAL append — the rows render, keyed by the returned property ids,
		// with filename + human filesize; no refetch.
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-1"]')
			).not.toBeNull();
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-2"]')
			).not.toBeNull();
		});
		const row = container.querySelector(
			'[data-testid="library-edition-file-prop-new-1"]'
		) as HTMLElement;
		expect(row.textContent).toContain('new-a.pdf');
		expect(row.textContent).toContain('2.0 KB');
		expect(listEditionsMock.mock.calls.length).toBe(editionReadsBefore);

		// The sr-only live region announces EXACTLY what landed (#253) — the
		// create-edition-status idiom, per edition.
		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement;
		expect(status).not.toBeNull();
		expect(status.getAttribute('role')).toBe('status');
		expect(status.getAttribute('aria-live')).toBe('polite');
		expect(status.textContent?.trim()).toBe('new-a.pdf, new-b.pdf attached.');
	});

	it('a JUST-uploaded file opens the same way as an existing one — click its Open, signFileUrl gets the NEW property id at click time', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		vi.stubGlobal('open', vi.fn(() => null));
		signFileUrlMock.mockResolvedValue('https://s3.example/signed-new');
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: []
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		const open = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-file-open-prop-new-1"]');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		// Nothing pre-signed by the upload flow.
		expect(signFileUrlMock).not.toHaveBeenCalled();

		await fireEvent.click(open);

		await waitFor(() => expect(signFileUrlMock).toHaveBeenCalledTimes(1));
		expect(signFileUrlMock.mock.calls[0][1]).toBe('prop-new-1');
	});
});

describe('#275 — in-flight state is keyed PER EDITION (per-batch, the stated choice)', () => {
	it("while edition-2's batch uploads: ITS attach input is disabled and an uploading indicator shows — edition-1's attach input stays enabled; on settle the indicator clears and the input re-enables", async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		let resolveUpload: (r: unknown) => void = () => {};
		uploadEditionFilesMock.mockReturnValue(
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
		);

		const container = await renderWithEditionOpen('edition-1');
		await expandEdition(container, 'edition-2');
		const input2 = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		const input1 = attachInput(container, 'edition-1');
		expect(input1).not.toBeNull();

		await selectFiles(input2, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		await waitFor(() => {
			expect(attachInput(container, 'edition-2').disabled).toBe(true);
			expect(
				container.querySelector('[data-testid="library-edition-files-uploading-edition-2"]')
			).not.toBeNull();
		});
		// PER-EDITION: the other edition's control is untouched.
		expect(attachInput(container, 'edition-1').disabled).toBe(false);
		expect(
			container.querySelector('[data-testid="library-edition-files-uploading-edition-1"]')
		).toBeNull();
		// Uploading copy is visible, localized.
		expect(
			container.querySelector('[data-testid="library-edition-files-uploading-edition-2"]')
				?.textContent
		).toContain('Uploading…');

		resolveUpload({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: []
		});
		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-files-uploading-edition-2"]')
			).toBeNull();
			expect(attachInput(container, 'edition-2').disabled).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// FAILURE — visible, per file, phantom-free (#253 says-exactly-what-landed)
// ---------------------------------------------------------------------------

describe('#275 — a failed file is reported by NAME and never renders as an attachment', () => {
	it('file 2 of 3 fails (cleaned up): rows for 1 and 3 render, NO row for 2, and a visible per-file failure names it — while the announcement names what DID land', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' },
				{ propertyId: 'prop-new-3', filename: 'new-c.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: 'prop-new-2', filename: 'new-b.pdf', cleanup: 'deleted' }]
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [
			makeFile('new-a.pdf', 2048, 'application/pdf'),
			makeFile('new-b.pdf', 2048, 'application/pdf'),
			makeFile('new-c.pdf', 2048, 'application/pdf')
		]);

		await waitFor(() => {
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-1"]')
			).not.toBeNull();
			expect(
				container.querySelector('[data-testid="library-edition-file-prop-new-3"]')
			).not.toBeNull();
		});
		// NO phantom row for the cleaned-up failure.
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-2"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-prop-new-2"]')
		).toBeNull();

		// The failure is VISIBLE (role=alert) and names the file.
		const err = await waitFor(() => {
			const el = container.querySelector(
				'[data-testid="library-edition-files-error-edition-2"]'
			);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(err.getAttribute('role')).toBe('alert');
		expect(err.textContent).toContain('Could not attach new-b.pdf.');

		// Says exactly what landed: only the two that made it.
		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement;
		expect(status.textContent?.trim()).toBe('new-a.pdf, new-c.pdf attached.');
	});

	// Review YELLOW: the third cleanup state. Nothing was created for this file,
	// so it is neither an attachment nor a phantom — and it must not vanish.
	it('a "not-created" file is named in the visible error with its OWN message — distinct from the created-then-cleaned-up wording, and no row for it', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: null, filename: 'new-b.pdf', cleanup: 'not-created' }]
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [
			makeFile('new-a.pdf', 2048, 'application/pdf'),
			makeFile('new-b.pdf', 2048, 'application/pdf')
		]);

		const err = await waitFor(() => {
			const el = container.querySelector('[data-testid="library-edition-files-error-edition-2"]');
			expect(el, 'a file nothing came back for must still be reported').not.toBeNull();
			return el as HTMLElement;
		});
		expect(err.getAttribute('role')).toBe('alert');
		expect(err.textContent).toContain(
			'new-b.pdf was not attached — the server returned nothing for it.'
		);
		// NOT the created-then-cleaned wording — that would claim a cleanup that
		// never had a target.
		expect(err.textContent).not.toContain('Could not attach new-b.pdf.');
		// No attachment row, and no broken row either (there is no phantom).
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-2"]')).toBeNull();
		expect(container.querySelector('[data-testid^="library-edition-file-broken-"]')).toBeNull();
		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement;
		expect(status.textContent?.trim()).toBe('new-a.pdf attached.');
	});

	it('a delete-failed phantom renders as a BROKEN row — visibly failed, no Open control, never a normal attachment', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockResolvedValue({
			uploaded: [],
			failed: [{ propertyId: 'prop-new-1', filename: 'new-a.pdf', cleanup: 'delete-failed' }]
		});

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		const broken = await waitFor(() => {
			const el = container.querySelector(
				'[data-testid="library-edition-file-broken-prop-new-1"]'
			);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(broken.textContent).toContain('new-a.pdf failed and could not be cleaned up.');
		// NEVER a normal attachment: no plain row under the normal testid, no
		// Open control for it, and no success announcement.
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-1"]')).toBeNull();
		expect(
			container.querySelector('[data-testid="library-edition-file-open-prop-new-1"]')
		).toBeNull();
		const status = container.querySelector(
			'[data-testid="library-edition-files-status-edition-2"]'
		) as HTMLElement | null;
		expect(status?.textContent?.trim() ?? '').toBe('');
	});

	it('a REJECTED upload (step-1 transport failure — nothing created) shows the batch error, inserts nothing, and re-enables the attach control for a retry', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		uploadEditionFilesMock.mockRejectedValue(new Error('HTTP 403'));

		const container = await renderWithEditionOpen('edition-2');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-2');
			expect(el).not.toBeNull();
			return el;
		});
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);

		const err = await waitFor(() => {
			const el = container.querySelector(
				'[data-testid="library-edition-files-error-edition-2"]'
			);
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(err.getAttribute('role')).toBe('alert');
		expect(err.textContent).toContain('Could not attach files.');
		expect(container.querySelector('[data-testid^="library-edition-file-prop-"]')).toBeNull();
		expect(attachInput(container, 'edition-2').disabled).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// GENERATION GUARD — a mid-flight collective switch must not apply ANYTHING
// ---------------------------------------------------------------------------

describe('#275 — success-apply AND failure-apply are generation-guarded', () => {
	it('an upload that settles AFTER the collective switched applies NOTHING — no rows, no announcement, no error (a stale mixed result must not leak either half into the new collective)', async () => {
		// Two collectives, the #271 guard-test shape.
		setToken('jwt-abc');
		authStore.set({
			status: 'authenticated',
			personIdByDb: { polyphony: 'person-p', secondchoir: 'person-s' },
			expMs: Date.now() + 100_000
		});
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
				{ db: 'secondchoir', name: 'Second Choir', personId: 'person-s' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');
		resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		findMyMemberIdMock.mockResolvedValue(null);
		resolveCopyNamesMock.mockResolvedValue(new Map());
		resolveCopyChainsMock.mockResolvedValue(new Map());
		listAllEditionsMock.mockResolvedValue(toListRead([]));
		listAllCopiesMock.mockResolvedValue(toListRead([]));
		listActiveMembersMock.mockResolvedValue(toListRead([]));
		listSeasonsMock.mockResolvedValue([]);
		listRepertoireItemsMock.mockResolvedValue([]);
		listWorksMock.mockImplementation(async (cfg: { db: string }) =>
			toListRead([
				{ id: 'work-1', name: cfg.db === 'polyphony' ? 'Erste Messe' : 'Zweite Messe', composer: '' }
			])
		);
		listEditionsMock.mockResolvedValue(toListRead([
			{ id: 'edition-1', name: 'Vocal score', publisher: 'Novello', externalLinks: [], files: [] }
		]));
		listCopiesMock.mockResolvedValue(toListRead([]));
		listLendingsMock.mockResolvedValue(toListRead([]));
		resolveBorrowerNamesMock.mockResolvedValue(new Map());

		const { container } = render(Page);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')?.textContent).toContain(
				'Erste Messe'
			);
		});
		await expandWork(container, 'work-1');
		await expandEdition(container, 'edition-1');
		const input = await waitFor(() => {
			const el = attachInput(container, 'edition-1');
			expect(el).not.toBeNull();
			return el;
		});

		// Hold the upload in flight…
		let resolveUpload: (r: unknown) => void = () => {};
		uploadEditionFilesMock.mockReturnValue(
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
		);
		await selectFiles(input, [makeFile('new-a.pdf', 2048, 'application/pdf')]);
		await waitFor(() => expect(uploadEditionFilesMock).toHaveBeenCalledTimes(1));
		expect(uploadEditionFilesMock.mock.calls[0][0]).toEqual({ db: 'polyphony', token: 'jwt-abc' });

		// …switch the collective while it is pending…
		selectedCollectiveDbStore.set('secondchoir');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')?.textContent).toContain(
				'Zweite Messe'
			);
		});

		// …then let the stale upload settle with a MIXED result — one landed
		// file AND one failure, so BOTH apply paths are exercised.
		resolveUpload({
			uploaded: [
				{ propertyId: 'prop-new-1', filename: 'new-a.pdf', filesize: 2048, filetype: 'application/pdf' }
			],
			failed: [{ propertyId: 'prop-new-2', filename: 'new-b.pdf', cleanup: 'deleted' }]
		});
		await new Promise((r) => setTimeout(r, 0));

		// NOTHING applied in the new collective: re-open the tree and look.
		await expandWork(container, 'work-1');
		await expandEdition(container, 'edition-1');
		expect(container.querySelector('[data-testid="library-edition-file-prop-new-1"]')).toBeNull();
		expect(container.textContent).not.toContain('attached.');
		expect(container.querySelectorAll('[data-testid^="library-edition-files-error-"]')).toHaveLength(
			0
		);
		expect(container.textContent).not.toContain('Could not attach');
	});
});

// (*MVOX:Tallis* — #275 RED)
