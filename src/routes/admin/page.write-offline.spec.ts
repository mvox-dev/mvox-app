// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	resolveOwnerTierMock: vi.fn(),
	resolveLibrarianMock: vi.fn(),
	loadRosterMock: vi.fn(),
	resolveParentMock: vi.fn(),
	resolveInviteParentMock: vi.fn(),
	createInviteMock: vi.fn(),
	listJoinStatesMock: vi.fn(),
	resolveCollectiveNameMarkerMock: vi.fn(),
	updateCollectiveNameMock: vi.fn()
}));
vi.mock('$lib/admin/roleManagement', () => ({
	RoleLockoutError: class extends Error {},
	RoleGrantMissingError: class extends Error {},
	fetchRights: vi.fn(),
	listAdmins: h.listAdminsMock,
	addAdmin: h.addAdminMock,
	removeAdmin: h.removeAdminMock,
	listLibrarians: h.listLibrariansMock,
	addLibrarian: h.addLibrarianMock,
	removeLibrarian: h.removeLibrarianMock
}));
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: h.resolveAdminMock,
	resolveOwnerTier: h.resolveOwnerTierMock
}));
vi.mock('$lib/library/librarianStore', () => ({ resolveLibrarian: h.resolveLibrarianMock }));
vi.mock('$lib/profile/linkedIdentities', () => ({ listJoinStates: h.listJoinStatesMock }));
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: class extends Error {},
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures';
import {
	goOffline,
	goOnline,
	resetOnLine,
	settle,
	isWriteDisabled,
	expectVisibleReason,
	exerciseEveryEnabledControl
} from '$lib/testing/networkSignal';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';

const REASON = '[write_unavailable_no_signal]';
const HELD = '[write_held_no_signal]';

const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-a'] };
const BELA = { id: 'p-bela', name: 'Bela Brauer', role: 'editor' as const, valueIds: ['pv-b'] };
const CILLA = { id: 'p-cilla', name: 'Cilla Cane', role: 'editor' as const, valueIds: ['pv-c'] };
const ROSTER = [
	{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' },
	{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' },
	{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '' }
];

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA, BELA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [CILLA], canManage: true });
	h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	h.addAdminMock.mockResolvedValue(undefined);
	h.addLibrarianMock.mockResolvedValue(undefined);
	h.removeAdminMock.mockResolvedValue(undefined);
	h.removeLibrarianMock.mockResolvedValue(undefined);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
	h.resolveOwnerTierMock.mockResolvedValue('error');
	h.listJoinStatesMock.mockResolvedValue({});
}

beforeEach(async () => {
	for (const mock of Object.values(h)) mock.mockReset();
	loadOk();
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
	await goOnline();
});

afterEach(() => {
	cleanup();
	resetAppState();
	resetOnLine();
});

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

async function renderReadyOnline() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
		expect(q(rendered.container, 'admin-add-admin-select')).not.toBeNull();
		expect(q(rendered.container, 'admin-collective-name-edit')).not.toBeNull();
	});
	return rendered;
}

function writeControls(container: HTMLElement): HTMLElement[] {
	return [
		q<HTMLElement>(container, 'admin-add-admin-select')!,
		q<HTMLElement>(container, 'admin-add-librarian-select')!,
		q<HTMLElement>(container, 'admin-collective-name-edit')!,
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="admin-remove-"]')),
		...Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="librarian-remove-"]'))
	].filter((el) => el !== null);
}

function noWriteSeamCalled() {
	expect(h.addAdminMock).not.toHaveBeenCalled();
	expect(h.removeAdminMock).not.toHaveBeenCalled();
	expect(h.addLibrarianMock).not.toHaveBeenCalled();
	expect(h.removeLibrarianMock).not.toHaveBeenCalled();
	expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
	expect(h.createInviteMock).not.toHaveBeenCalled();
}

describe('/admin — writes while offline (#434 slice 6 review F1)', () => {
	it('offline: every write control is disabled and the reason is visible once', async () => {
		const { container } = await renderReadyOnline();
		expect(writeControls(container).length).toBeGreaterThanOrEqual(5);
		await goOffline();

		await waitFor(() => {
			for (const c of writeControls(container)) {
				expect(isWriteDisabled(c), c.dataset.testid).toBe(true);
			}
		});
		expectVisibleReason(container, 'admin-write-unavailable', REASON);
		expect(container.querySelectorAll('[data-testid="admin-write-unavailable"]')).toHaveLength(1);
	});

	it('offline: picking a person or tapping a remove writes nothing', async () => {
		const { container } = await renderReadyOnline();
		await goOffline();
		await settle();

		await fireEvent.change(q<HTMLSelectElement>(container, 'admin-add-admin-select')!, {
			target: { value: 'p-dora' }
		});
		await fireEvent.change(q<HTMLSelectElement>(container, 'admin-add-librarian-select')!, {
			target: { value: 'p-dora' }
		});
		const remove = container.querySelector<HTMLElement>('[data-testid^="admin-remove-"]');
		if (remove) await fireEvent.click(remove);
		await settle();

		noWriteSeamCalled();
	});

	it('offline: a name confirm KEEPS the typed draft and says nothing was saved', async () => {
		const { container } = await renderReadyOnline();
		await fireEvent.click(q(container, 'admin-collective-name-edit')!);
		const input = await waitFor(() => {
			const el = q<HTMLInputElement>(container, 'admin-collective-name-input');
			expect(el).not.toBeNull();
			return el!;
		});
		await fireEvent.input(input, { target: { value: 'Uus nimi' } });
		await goOffline();

		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();

		const still = q<HTMLInputElement>(container, 'admin-collective-name-input');
		expect(still, 'the editor stays open on her text').not.toBeNull();
		expect(still!.value).toBe('Uus nimi');
		expect(h.updateCollectiveNameMock).not.toHaveBeenCalled();
		expectVisibleReason(container, 'admin-name-held-offline', HELD);
	});

	it('offline: nothing operable is left, and operating what there is calls no write seam', async () => {
		const { container } = await renderReadyOnline();
		const enabledOnline = Array.from(
			container.querySelectorAll<HTMLElement>('button, select, input, textarea')
		).filter((el) => !isWriteDisabled(el));
		expect(enabledOnline.length).toBeGreaterThan(2);

		await goOffline();
		await settle();
		for (const mock of Object.values(h)) mock.mockClear();

		const touched = await exerciseEveryEnabledControl(container);

		expect(touched).toEqual([]);
		noWriteSeamCalled();
	});

	it('back online: the controls enable again, the sentence goes, and a grant writes', async () => {
		const { container } = await renderReadyOnline();
		await goOffline();
		await goOnline();

		await waitFor(() => {
			expect(isWriteDisabled(q(container, 'admin-add-admin-select')!)).toBe(false);
		});
		expect(q(container, 'admin-write-unavailable')).toBeNull();

		await fireEvent.change(q<HTMLSelectElement>(container, 'admin-add-admin-select')!, {
			target: { value: 'p-dora' }
		});
		await waitFor(() => expect(h.addAdminMock).toHaveBeenCalledTimes(1));
	});
});

// (*MVOX:Josquin*)
