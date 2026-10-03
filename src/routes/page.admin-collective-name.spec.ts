// @vitest-environment happy-dom
// The editable collective name on /admin, stored on the mvox_collective marker.
import { toListRead } from '$lib/testing/listReadFixtures';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

const h = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	addAdminMock: vi.fn(),
	removeAdminMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	addLibrarianMock: vi.fn(),
	removeLibrarianMock: vi.fn(),
	resolveAdminMock: vi.fn(),
	resolveLibrarianMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	resolveParentMock: vi.fn(),
	resolveInviteParentMock: vi.fn(),
	createInviteMock: vi.fn(),
	resolveCollectiveNameMarkerMock: vi.fn(),
	updateCollectiveNameMock: vi.fn()
}));
vi.mock('$lib/admin/roleManagement', () => ({
	fetchRights: vi.fn(),
	listAdmins: h.listAdminsMock,
	addAdmin: h.addAdminMock,
	removeAdmin: h.removeAdminMock,
	listLibrarians: h.listLibrariansMock,
	addLibrarian: h.addLibrarianMock,
	removeLibrarian: h.removeLibrarianMock
}));
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: h.resolveAdminMock
}));
vi.mock('$lib/library/librarianStore', () => ({
	resolveLibrarian: h.resolveLibrarianMock
}));
vi.mock('$lib/collective/databaseEntity', () => ({
	resolveDatabaseEntityId: h.resolveDatabaseEntityIdMock
}));
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: h.loadRosterMock
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: h.listSectionsMock
}));
vi.mock('$lib/invite/inviteData', () => ({
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
}));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './admin/+page.svelte';
import { selectedCollectiveStore } from '$lib/collectives/store';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const CFG = testCfg('sampledb', 'jwt-admin');

const MARKER = { markerId: 'marker-1', name: 'Koor Sampledb' };

const ROSTER = [{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }];
const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own'] };

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	h.listSectionsMock.mockResolvedValue([]);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ ...MARKER });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
	});
	return rendered;
}

async function renderWithName() {
	const { container } = await renderReady();
	await waitFor(() => {
		expect(q(container, 'admin-collective-name')).not.toBeNull();
		expect(q(container, 'admin-collective-name-edit')).not.toBeNull();
	});
	return {
		container,
		nameEl: q<HTMLElement>(container, 'admin-collective-name')!,
		pencil: q<HTMLButtonElement>(container, 'admin-collective-name-edit')!
	};
}

async function openEditor(container: HTMLElement): Promise<HTMLInputElement> {
	const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit')!;
	await fireEvent.click(pencil);
	let input: HTMLInputElement | null = null;
	await waitFor(() => {
		input = q<HTMLInputElement>(container, 'admin-collective-name-input');
		expect(input).not.toBeNull();
	});
	return input!;
}

beforeEach(() => {
	for (const mock of Object.values(h)) mock.mockReset();
});

afterEach(() => {
	cleanup();
	resetAppState();
});

describe('/admin — collective name display', () => {
	it('READY renders the MARKER resolution\'s name with a pencil button — the real admin route, not an isolated component', async () => {
		selectSampledb();
		loadOk();

		const { container, nameEl, pencil } = await renderWithName();

		expect(nameEl.textContent).toContain('Koor Sampledb');
		expect(h.resolveCollectiveNameMarkerMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG)
		);
		expect(pencil.disabled).toBe(false);
		const accessible = (pencil.getAttribute('aria-label') ?? '') + (pencil.textContent ?? '');
		expect(accessible.trim()).not.toBe('');
		const classes = Array.from(pencil.classList);
		expect(classes, 'the rename control must reserve a 44px-tall touch target').toContain(
			'min-h-11'
		);
		expect(classes, 'the WHOLE field is the target, not the ✎ glyph').toContain('w-full');
		expect(pencil.querySelector('#admin-collective-name-value')?.textContent).toBe(
			'Koor Sampledb'
		);
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});

	it('no marker in the db (resolution → null): neither name nor pencil — nothing to edit', async () => {
		selectSampledb();
		loadOk();
		h.resolveCollectiveNameMarkerMock.mockResolvedValue(null);

		const { container } = await renderReady();

		expect(h.resolveCollectiveNameMarkerMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG)
		);
		expect(q(container, 'admin-collective-name')).toBeNull();
		expect(q(container, 'admin-collective-name-edit')).toBeNull();
	});

	it('an empty-name marker renders a labelled, non-blank placeholder control — never a blank heading', async () => {
		selectSampledb();
		loadOk();
		h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: '' });

		const { container } = await renderReady();

		const nameEl = q<HTMLElement>(container, 'admin-collective-name')!;
		expect(nameEl).not.toBeNull();
		const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit')!;
		expect(pencil).not.toBeNull();
		const value = pencil.querySelector('#admin-collective-name-value');
		expect(value?.textContent?.trim()).not.toBe('');
		expect(value?.textContent).toBe('[admin_collective_name_unnamed]');
		expect(pencil.disabled).toBe(false);
	});

	it('a FAILED marker read lands in load-error + retry — never rendered as "no name" (house rule)', async () => {
		selectSampledb();
		loadOk();
		h.resolveCollectiveNameMarkerMock.mockRejectedValueOnce(new Error('marker query 500'));

		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'admin-roles-load-error')).not.toBeNull();
		});

		const retry = q<HTMLButtonElement>(container, 'admin-roles-retry-load')!;
		await fireEvent.click(retry);
		await waitFor(() => {
			expect(q(container, 'admin-collective-name')).not.toBeNull();
		});
	});
});

describe('/admin — collective name editing', () => {
	it('tapping the pencil opens an inline text input PRE-FILLED with the current name, carrying its own aria-label', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);

		expect(input.value).toBe('Koor Sampledb');
		expect((input.getAttribute('aria-label') ?? '').trim()).not.toBe('');
		expect(q(container, 'admin-collective-name-edit')).toBeNull();
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('Enter confirms: updateCollectiveName(cfg, markerId, draft) fires ONCE and the display shows the new name without a reload', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(h.updateCollectiveNameMock).toHaveBeenCalledTimes(1);
		});
		expect(h.updateCollectiveNameMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'marker-1',
			'Uus Koorinimi'
		);

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
			expect(q(container, 'admin-collective-name')!.textContent).toContain('Uus Koorinimi');
		});
	});

	it('a successful write renames the selected collective in the STORE — picker + agenda header reflect it without reload (#165 AC)', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(get(selectedCollectiveStore)?.name).toBe('Uus Koorinimi');
		});
		expect(get(selectedCollectiveStore)?.db).toBe('sampledb');
		expect(container).toBeTruthy();
	});

	it('the draft is TRIMMED before it reaches the wire and the store', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: '   Uus Koorinimi   ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(h.updateCollectiveNameMock).toHaveBeenCalledTimes(1);
		});
		expect(h.updateCollectiveNameMock).toHaveBeenCalledWith(
			expect.objectContaining(CFG),
			'marker-1',
			'Uus Koorinimi'
		);
		await waitFor(() => {
			expect(get(selectedCollectiveStore)?.name).toBe('Uus Koorinimi');
		});
	});

	it('a whitespace-only edit of an UNCHANGED name writes nothing — trimming makes it the no-change case', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Koor Sampledb   ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
		});
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Sampledb');
	});

	it('Enter hands focus back to the pencil once the write settles — a keyboard admin is never stranded on <body>', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit');
			expect(pencil).not.toBeNull();
			expect(pencil!.disabled).toBe(false);
			expect(document.activeElement).toBe(pencil);
		});
	});

	it('Enter on an UNCHANGED name restores focus too (the no-write branch owes it the same)', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit');
			expect(pencil).not.toBeNull();
			expect(document.activeElement).toBe(pencil);
		});
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('Escape dismisses: editor closes, the OLD name stands, NOTHING is written', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Peaaegu Muudetud' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
		});
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Sampledb');
		expect(q(container, 'admin-collective-name')!.textContent).not.toContain('Peaaegu Muudetud');
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('blur dismisses too — #165 pins blur-cancels for THIS surface (unlike the event page\'s blur-confirms)', async () => {
		selectSampledb();
		loadOk();
		const { container } = await renderWithName();

		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Peaaegu Muudetud' } });
		await fireEvent.blur(input);

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-input')).toBeNull();
		});
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Sampledb');
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	});

	it('the pencil is DISABLED while the write is in flight, re-enabled when it settles (#165 AC)', async () => {
		selectSampledb();
		loadOk();
		const gate = deferred<void>();
		h.updateCollectiveNameMock.mockReturnValue(gate.promise);

		const { container } = await renderWithName();
		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			const pencil = q<HTMLButtonElement>(container, 'admin-collective-name-edit');
			expect(pencil).not.toBeNull();
			expect(pencil!.disabled).toBe(true);
		});

		gate.resolve();
		await waitFor(() => {
			expect(q<HTMLButtonElement>(container, 'admin-collective-name-edit')!.disabled).toBe(
				false
			);
		});
	});

	it('a FAILED write reverts the display to the pre-edit name and shows a visible alert — never a silent success', async () => {
		selectSampledb();
		loadOk();
		h.updateCollectiveNameMock.mockRejectedValue(new Error('POST failed: 403'));

		const { container } = await renderWithName();
		const input = await openEditor(container);
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		await waitFor(() => {
			expect(q(container, 'admin-collective-name-error')).not.toBeNull();
		});
		const error = q<HTMLElement>(container, 'admin-collective-name-error')!;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).not.toContain('403');
		expect(q(container, 'admin-collective-name')!.textContent).toContain('Koor Sampledb');
		expect(q(container, 'admin-collective-name')!.textContent).not.toContain('Uus Koorinimi');
		expect(get(selectedCollectiveStore)?.name).toBe('Sampledb');
	});
});

// (*MVOX:Tallis*)
