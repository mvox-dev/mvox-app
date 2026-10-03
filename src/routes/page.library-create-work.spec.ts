// @vitest-environment happy-dom
// #198 — the librarian's inline create-work form, driven through the real /library route.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
// Same $env/dynamic/public fix as page.library.spec.ts.
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).activeMembersModule()
);

// The new work's `_parent` is resolved live at submit time (`resolveMyLibraryId`), not read
// off a store the cache-backed librarian resolution filled.
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/library')).librarianOverRealModule()
);

vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('member')
);

vi.mock('$lib/library/lendingActions', async () =>
	(await import('$lib/testing/mocks/library')).lendingModule()
);

// Quiet seams for the #92 repertoire-badge side reads (not under test here).
vi.mock('$lib/seasons/entuSeasons', async () =>
	(await import('$lib/testing/mocks/seasons')).entuSeasonsModule()
);
vi.mock('$lib/repertoire/repertoireData', async () =>
	(await import('$lib/testing/mocks/seasons')).repertoireOverRealModule()
);

// #198 — the write seam under test: the shared entity CREATE layer. The page
// must call THIS module's createWork (same layer as createSeason), never roll
// its own POST.
const { createWorkMock } = vi.hoisted(() => ({ createWorkMock: vi.fn() }));
vi.mock('$lib/entity/entityCreate', async () => {
	const actual = await vi.importActual<typeof import('$lib/entity/entityCreate')>(
		'$lib/entity/entityCreate'
	);
	return {
		...actual,
		createWork: createWorkMock
	};
});

import Page from './library/+page.svelte';
import { clearAll } from '$lib/auth/storage';
import { toListRead } from '$lib/testing/listReadFixtures.js';
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
	resolveCopyNamesMock,
	resolveMyLibraryIdMock
} from '$lib/testing/mocks/library';
import { listActiveMembersMock } from '$lib/testing/mocks/roster';
import { listRepertoireItemsMock, listSeasonsMock } from '$lib/testing/mocks/seasons';
import { resolveLibrarianMock } from '$lib/testing/mocks/admin';
import { mockLibrarian } from '$lib/testing/pages/library';
import { expectTouchTarget } from '$lib/testing/pages/dom';

function setAuthedWithOneCollective() {
	signIn();
	// Defaults; tests override resolveLibrarianMock per case.
	resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	// The live write-path resolution.
	resolveMyLibraryIdMock.mockResolvedValue('lib-1');
	findMyMemberIdMock.mockResolvedValue(null);
	resolveCopyNamesMock.mockResolvedValue(new Map());
	resolveCopyChainsMock.mockResolvedValue(new Map());
	listAllEditionsMock.mockResolvedValue(toListRead([]));
	listAllCopiesMock.mockResolvedValue(toListRead([]));
	listActiveMembersMock.mockResolvedValue(toListRead([]));
	listSeasonsMock.mockResolvedValue([]);
	listRepertoireItemsMock.mockResolvedValue([]);
}

/** Baseline data: one existing work, no lendings. */
function mockBaselineLibrary() {
	listWorksMock.mockResolvedValue(toListRead([
		{ id: 'work-1', name: 'Spem in alium', composer: 'Thomas Tallis' }
	]));
	listLendingsMock.mockResolvedValue(toListRead([]));
	resolveBorrowerNamesMock.mockResolvedValue(new Map());
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
	resolveMyLibraryIdMock.mockReset();
	findMyMemberIdMock.mockReset();
	listAllEditionsMock.mockReset();
	listAllCopiesMock.mockReset();
	listActiveMembersMock.mockReset();
	listSeasonsMock.mockReset();
	listRepertoireItemsMock.mockReset();
	createWorkMock.mockReset();
	resetAppState();
});

// ---------------------------------------------------------------------------
// Integration: the create button lives on the /library route, librarian-gated
// ---------------------------------------------------------------------------

describe('#198 — create-work button on /library (librarian gating, integration)', () => {
	it('renders [data-testid="create-work-button"] on the actual /library route when resolveLibrarian resolves librarian', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		const button = container.querySelector('[data-testid="create-work-button"]') as HTMLButtonElement;
		expect(button.tagName).toBe('BUTTON');
		expect(button.textContent).toContain('Add work');
	});

	it('does NOT render the create-work button for a not-librarian — the browse tree still renders (fail-closed gating on the real route)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });

		const { container } = render(Page);

		// The page is fully ready (the work list rendered) — so the button's
		// absence is a gating decision, not an unfinished load.
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="create-work-button"]')).toBeNull();
	});

	it('does NOT render the create-work button while resolveLibrarian is still pending (hidden-if-undeterminable)', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		resolveLibrarianMock.mockReturnValue(new Promise(() => {}));

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="create-work-button"]')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// The inline form: opens on click, name + composer fields
// ---------------------------------------------------------------------------

describe('#198 — inline create-work form', () => {
	it('no form in the DOM until the button is clicked; clicking reveals the inline form with a name input and a composer input', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		// Closed by default — inline, not always-on.
		expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		expect(container.querySelector('[data-testid="create-work-name"]')).toBeNull();

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-button"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
		});
		const nameInput = container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement;
		const composerInput = container.querySelector(
			'[data-testid="create-work-composer"]'
		) as HTMLInputElement;
		expect(nameInput).not.toBeNull();
		expect(composerInput).not.toBeNull();
		// Both are text inputs with an accessible name (same discipline as the
		// bulk-checkout pickers).
		expect(nameInput.tagName).toBe('INPUT');
		expect(composerInput.tagName).toBe('INPUT');
		expect(
			nameInput.getAttribute('aria-label') || nameInput.labels?.length
		).toBeTruthy();
		expect(
			composerInput.getAttribute('aria-label') || composerInput.labels?.length
		).toBeTruthy();
		// And a submit control.
		expect(container.querySelector('[data-testid="create-work-submit"]')).not.toBeNull();
	});

	it('submitting calls createWork with the LIBRARY entity id (resolved LIVE at submit time, #434 slice 4 review round 2 finding 2) + name + composer, and appends the created work to the LOCAL list — no listWorks refetch', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();
		createWorkMock.mockResolvedValue('work-new');

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-button"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-name"]')).not.toBeNull();
		});

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.input(
			container.querySelector('[data-testid="create-work-composer"]') as HTMLInputElement,
			{ target: { value: 'Arvo Pärt' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => expect(createWorkMock).toHaveBeenCalledTimes(1));
		const [cfgArg, payload] = createWorkMock.mock.calls[0];
		expect(cfgArg).toEqual({ db: 'sampledb', token: 'jwt-abc' });
		// Full-shape (no objectContaining): the parent is the LIBRARY entity id
		// resolveLibrarian returned — 'lib-1' — never the database entity.
		expect(payload).toEqual({
			name: 'Ave Maria',
			composer: 'Arvo Pärt',
			libraryEntityId: 'lib-1'
		});

		// The new work joins the browse list LOCALLY: its row renders, and the
		// page did not re-issue the listWorks read (still just the initial one).
		await waitFor(() => {
			const row = container.querySelector('[data-testid="library-work-work-new"]');
			expect(row).not.toBeNull();
			expect(row?.textContent).toContain('Ave Maria');
			expect(row?.textContent).toContain('Arvo Pärt');
		});
		expect(listWorksMock).toHaveBeenCalledTimes(1);
		// The existing work is still there — appended, not replaced.
		expect(container.querySelector('[data-testid="library-work-work-1"]')).not.toBeNull();

		// The live region announces a LOCALIZED sentence, not the bare title —
		// a screen reader must hear that something was created.
		const status = container.querySelector('[data-testid="create-work-status"]') as HTMLElement;
		expect(status.getAttribute('role')).toBe('status');
		expect(status.textContent?.trim()).toBe('Ave Maria created.');
	});
});

// ---------------------------------------------------------------------------
// Review fixes: touch targets, cancel affordance, blank-name validation
// ---------------------------------------------------------------------------

/** Opens the inline create form on a librarian-ready /library route. */
async function renderWithFormOpen(): Promise<HTMLElement> {
	mockBaselineLibrary();
	setAuthedWithOneCollective();
	mockLibrarian();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
	});
	await fireEvent.click(container.querySelector('[data-testid="create-work-button"]') as Element);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
	});
	return container;
}

describe('#198 — create-work controls are 44px touch targets', () => {
	it('the entry-point button reserves min-h-11', async () => {
		mockBaselineLibrary();
		setAuthedWithOneCollective();
		mockLibrarian();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		expectTouchTarget(container, 'create-work-button');
	});

	it('every control inside the open form reserves min-h-11 (both inputs, submit, cancel)', async () => {
		const container = await renderWithFormOpen();

		expectTouchTarget(container, 'create-work-name');
		expectTouchTarget(container, 'create-work-composer');
		expectTouchTarget(container, 'create-work-submit');
		expectTouchTarget(container, 'create-work-cancel');
	});
});

describe('#198 — the form is escapable', () => {
	it('cancel closes the form and restores the entry-point button — no write', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-cancel"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		});
		expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		expect(createWorkMock).not.toHaveBeenCalled();
	});

	it('cancel discards what was typed — reopening starts from an empty name', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-cancel"]') as Element
		);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-button"]')).not.toBeNull();
		});
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-button"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-name"]')).not.toBeNull();
		});
		const nameInput = container.querySelector(
			'[data-testid="create-work-name"]'
		) as HTMLInputElement;
		expect(nameInput.value).toBe('');
	});

	it('Escape in the name input closes the form', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ key: 'Escape' }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		});
		expect(createWorkMock).not.toHaveBeenCalled();
	});

	it('Escape works while focus is on the Cancel button, not just the inputs', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-work-cancel"]') as HTMLButtonElement,
			{ key: 'Escape', bubbles: true }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		});
		expect(createWorkMock).not.toHaveBeenCalled();
	});

	it('auto-focuses the name input the instant the form opens', async () => {
		const container = await renderWithFormOpen();
		const nameInput = container.querySelector(
			'[data-testid="create-work-name"]'
		) as HTMLInputElement;
		await waitFor(() => {
			expect(document.activeElement).toBe(nameInput);
		});
	});

	it('the inline form is a group, not a dialog — it implements no dialog focus contract', async () => {
		const container = await renderWithFormOpen();

		const form = container.querySelector('[data-testid="create-work-form"]') as HTMLElement;
		expect(form.getAttribute('role')).toBe('group');
		expect(form.getAttribute('aria-label')).toBeTruthy();
	});
});

describe('#198 — blank name is a field error, not a transport failure', () => {
	it('submitting an empty title shows the required-field message and never calls createWork', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-work-error"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Work title is required.');
		// NOT the generic "Could not create the work." transport message.
		expect(err.textContent).not.toContain('Could not create the work.');
		expect(createWorkMock).not.toHaveBeenCalled();
		// The form stays open so the librarian can fix the title in place.
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
	});

	it('a whitespace-only title is blank too', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: '   ' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		expect(createWorkMock).not.toHaveBeenCalled();
	});
});

// Fail loudly, transport failure, double-submit.

describe('#198 — a missing precondition fails LOUDLY, never silently', () => {
	it('a librarian whose token vanished gets the 401 handling: the error, the form open, the seam refused', async () => {
		const container = await renderWithFormOpen();
	createWorkMock.mockImplementation(async (cfg: { token: string }) => {
		if (cfg.token) return 'work-new';
		throw Object.assign(new Error('no token'), { name: 'AuthExpiredError' });
	});

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		clearAll({ preserveProvider: false });

		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-work-error"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Could not create the work.');
		expect(createWorkMock).toHaveBeenCalledTimes(1);
		expect(createWorkMock.mock.calls[0][0]).toEqual({ db: 'sampledb', token: '' });
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
	});
});

describe('#198 — the create write can fail in transport', () => {
	it('a rejected createWork surfaces the error, keeps the form open with what was typed, and inserts NOTHING locally', async () => {
		const container = await renderWithFormOpen();
		createWorkMock.mockRejectedValue(new Error('HTTP 403'));

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.input(
			container.querySelector('[data-testid="create-work-composer"]') as HTMLInputElement,
			{ target: { value: 'Arvo Pärt' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-error"]')).not.toBeNull();
		});
		const err = container.querySelector('[data-testid="create-work-error"]') as HTMLElement;
		expect(err.textContent?.trim()).toBe('Could not create the work.');

		// The form survives the failure, holding the typed values — a retry must
		// not start from an empty title.
		expect(container.querySelector('[data-testid="create-work-form"]')).not.toBeNull();
		expect(
			(container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement).value
		).toBe('Ave Maria');
		expect(
			(container.querySelector('[data-testid="create-work-composer"]') as HTMLInputElement).value
		).toBe('Arvo Pärt');

		// The local insert must NOT run on a rejected create: only the baseline
		// work is on the page, and the live region announced nothing.
		const rows = container.querySelectorAll('[data-testid^="library-work-work-"]');
		expect(Array.from(rows).map((r) => r.getAttribute('data-testid'))).toEqual([
			'library-work-work-1'
		]);
		const status = container.querySelector('[data-testid="create-work-status"]') as HTMLElement;
		expect(status.textContent?.trim()).toBe('');
	});
});

describe('#198 — the create is not double-submittable', () => {
	it('a second click while the first create is in flight issues no second POST, and the submit control is disabled meanwhile', async () => {
		const container = await renderWithFormOpen();
		let resolveCreate: (id: string) => void = () => {};
		createWorkMock.mockReturnValue(
			new Promise<string>((resolve) => {
				resolveCreate = resolve;
			})
		);

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Ave Maria' } }
		);
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);

		await waitFor(() => expect(createWorkMock).toHaveBeenCalledTimes(1));
		await waitFor(() => {
			const submit = container.querySelector(
				'[data-testid="create-work-submit"]'
			) as HTMLButtonElement;
			expect(submit.disabled).toBe(true);
		});

		// Both re-entry routes: a second click, and Enter in the name input.
		await fireEvent.click(
			container.querySelector('[data-testid="create-work-submit"]') as Element
		);
		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ key: 'Enter' }
		);
		expect(createWorkMock).toHaveBeenCalledTimes(1);

		resolveCreate('work-new');
		await waitFor(() => {
			expect(container.querySelector('[data-testid="library-work-work-new"]')).not.toBeNull();
		});
		// Exactly one work was created, not two.
		expect(createWorkMock).toHaveBeenCalledTimes(1);
	});
});

describe('#560 — one key listener on the work form', () => {
	it('Escape fired at the form wrapper closes it', async () => {
		const container = await renderWithFormOpen();

		await fireEvent.keyDown(
			container.querySelector('[data-testid="create-work-form"]') as HTMLElement,
			{ key: 'Escape' }
		);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="create-work-form"]')).toBeNull();
		});
		expect(createWorkMock).not.toHaveBeenCalled();
	});

	it('Enter from the composer field submits the form', async () => {
		const container = await renderWithFormOpen();
		createWorkMock.mockResolvedValue('work-new');

		await fireEvent.input(
			container.querySelector('[data-testid="create-work-name"]') as HTMLInputElement,
			{ target: { value: 'Missa brevis' } }
		);
		const second = container.querySelector(
			'[data-testid="create-work-composer"]'
		) as HTMLInputElement;
		await fireEvent.input(second, { target: { value: 'Arvo Pärt' } });
		await fireEvent.keyDown(second, { key: 'Enter' });

		await waitFor(() => expect(createWorkMock).toHaveBeenCalledTimes(1));
		expect(createWorkMock.mock.calls[0][1]).toEqual({
			name: 'Missa brevis',
			composer: 'Arvo Pärt',
			libraryEntityId: 'lib-1'
		});
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Byrd*)
