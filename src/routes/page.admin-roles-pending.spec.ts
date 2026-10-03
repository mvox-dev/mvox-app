// @vitest-environment happy-dom
// The /admin role add/remove controls hold a pending state until the write lands.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);

const h = vi.hoisted(() => {
	class RoleLockoutError extends Error {
		readonly code = 'role-lockout';
		constructor(entityId: string, personId: string) {
			super(`lockout ${entityId}/${personId}`);
			this.name = 'RoleLockoutError';
		}
	}
	class RoleGrantMissingError extends Error {
		readonly code = 'role-grant-missing';
		constructor(entityId: string, personId: string) {
			super(`missing ${entityId}/${personId}`);
			this.name = 'RoleGrantMissingError';
		}
	}
	class InviteCreateError extends Error {
		readonly phase: string;
		readonly reason: string;
		readonly personId?: string;
		constructor(message: string, opts: { phase: string; reason: string; personId?: string }) {
			super(message);
			this.name = 'InviteCreateError';
			this.phase = opts.phase;
			this.reason = opts.reason;
			this.personId = opts.personId;
		}
	}
	return {
		RoleLockoutError,
		RoleGrantMissingError,
		InviteCreateError,
		listAdminsMock: vi.fn(),
		addAdminMock: vi.fn(),
		removeAdminMock: vi.fn(),
		listLibrariansMock: vi.fn(),
		addLibrarianMock: vi.fn(),
		removeLibrarianMock: vi.fn(),
		resolveOwnerTierMock: vi.fn().mockResolvedValue('error'),
		resolveParentMock: vi.fn(),
		resolveInviteParentMock: vi.fn(),
		createInviteMock: vi.fn(),
		listJoinStatesMock: vi.fn().mockResolvedValue({}),
	};
});
vi.mock('$lib/admin/roleManagement', () => ({
	RoleLockoutError: h.RoleLockoutError,
	RoleGrantMissingError: h.RoleGrantMissingError,
	fetchRights: vi.fn(),
	listAdmins: h.listAdminsMock,
	addAdmin: h.addAdminMock,
	removeAdmin: h.removeAdminMock,
	listLibrarians: h.listLibrariansMock,
	addLibrarian: h.addLibrarianMock,
	removeLibrarian: h.removeLibrarianMock
}));
vi.mock('$lib/nav/adminStore', async () =>
	(await import('$lib/testing/mocks/admin')).adminStoreModule()
);
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/admin')).librarianStoreModule()
);
vi.mock('$lib/profile/linkedIdentities', async () =>
	(await import('$lib/testing/mocks/admin')).joinStatesModule()
);
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', async () =>
	(await import('$lib/testing/mocks/admin')).collectiveNameModule()
);
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
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

import Page from './admin/+page.svelte';
import type { RolePerson } from '$lib/admin/roleManagement';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	listJoinStatesMock,
	resolveAdminMock,
	resolveCollectiveNameMarkerMock,
	resolveLibrarianMock,
	resolveOwnerTierMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';

const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] };
const BELA = {
	id: 'p-bela',
	name: 'Bela Brauer',
	role: 'editor' as const,
	valueIds: ['pv-ed-bela']
};
const CILLA = {
	id: 'p-cilla',
	name: 'Cilla Cane',
	role: 'editor' as const,
	valueIds: ['pv-ed-cilla']
};

function listing(persons: RolePerson[], canManage = true) {
	return { persons, canManage };
}

const ROSTER = [
	{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' },
	{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' },
	{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '' }
];

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

function loadOk() {
	resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue(listing([ANNA, BELA]));
	h.listLibrariansMock.mockResolvedValue(listing([CILLA]));
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	h.addAdminMock.mockResolvedValue(undefined);
	h.addLibrarianMock.mockResolvedValue(undefined);
	h.removeAdminMock.mockResolvedValue(undefined);
	h.removeLibrarianMock.mockResolvedValue(undefined);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	updateCollectiveNameMock.mockResolvedValue(undefined);
	resolveOwnerTierMock.mockResolvedValue('error');
	listJoinStatesMock.mockResolvedValue({});
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
		expect(q(rendered.container, 'admin-roles-librarians')).not.toBeNull();
	});
	return rendered;
}

function adminSelect(container: HTMLElement): HTMLSelectElement {
	const select = q<HTMLSelectElement>(container, 'admin-add-admin-select');
	expect(select, 'expected admin-add-admin-select').not.toBeNull();
	return select!;
}

function librarianSelect(container: HTMLElement): HTMLSelectElement {
	const select = q<HTMLSelectElement>(container, 'admin-add-librarian-select');
	expect(select, 'expected admin-add-librarian-select').not.toBeNull();
	return select!;
}

async function pick(select: HTMLSelectElement, personId: string): Promise<void> {
	await fireEvent.change(select, { target: { value: personId } });
}

beforeEach(() => {
	loadOk();
	selectSampledb();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
});

describe('#325 admin/librarian — four states at rest (not yet attempted)', () => {
	it('ready page: PERSISTENT empty role="status" region (admin-roles-status, #267 same-node shape), NO pending notice, NO action error', async () => {
		const { container } = await renderReady();

		const status = q(container, 'admin-roles-status');
		expect(status, 'expected the persistent admin-roles-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		expect(q(container, 'admin-roles-action-error')).toBeNull();

		expect(adminSelect(container).disabled).toBe(false);
		expect(librarianSelect(container).disabled).toBe(false);
		expect((q<HTMLButtonElement>(container, 'admin-remove-p-bela') as HTMLButtonElement).disabled).toBe(
			false
		);
	});
});

describe('#325 admin/librarian — a grant write in flight disables the surface (ER-6/ER-9 race closed)', () => {
	it('add-admin in flight: BOTH selects and the remove buttons disable; the visible saving notice (caveat-slot paragraph, role="status") shows; a second pick fires NO second grant write; settle → re-enabled, notice gone, saved announced', async () => {
		const d = deferred<undefined>();
		h.addAdminMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		await pick(adminSelect(container), 'p-cilla');
		expect(h.addAdminMock).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			const notice = q(container, 'admin-roles-pending-notice');
			expect(notice, 'expected the visible pending notice while the write is in flight').not.toBeNull();
			expect(notice!.getAttribute('role')).toBe('status');
			expect(notice!.textContent).toContain('admin_roles_saving');
		});

		expect(adminSelect(container).disabled).toBe(true);
		expect(librarianSelect(container).disabled).toBe(true);
		expect(
			(q<HTMLButtonElement>(container, 'admin-remove-p-bela') as HTMLButtonElement).disabled
		).toBe(true);
		expect(
			(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla') as HTMLButtonElement).disabled
		).toBe(true);

		await pick(adminSelect(container), 'p-dora');
		expect(h.addAdminMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'admin-remove-p-bela') as HTMLElement);
		expect(h.removeAdminMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		});
		expect(adminSelect(container).disabled).toBe(false);
		expect(librarianSelect(container).disabled).toBe(false);

		await waitFor(() => {
			expect(q(container, 'admin-roles-status')?.textContent).toContain('admin_roles_saved');
		});

		await pick(adminSelect(container), 'p-dora');
		expect(h.addAdminMock).toHaveBeenCalledTimes(2);
	});

	it('remove-admin double-tap fires EXACTLY ONE revoke write; while it is in flight a pick fires NO grant write; settle → saved announced', async () => {
		const d = deferred<undefined>();
		h.removeAdminMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		const removeBela = q<HTMLButtonElement>(container, 'admin-remove-p-bela') as HTMLButtonElement;
		await fireEvent.click(removeBela);
		await fireEvent.click(removeBela);
		expect(h.removeAdminMock).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});
		expect(adminSelect(container).disabled).toBe(true);

		await pick(adminSelect(container), 'p-cilla');
		expect(h.addAdminMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'admin-roles-status')?.textContent).toContain('admin_roles_saved');
		});
	});

	it('librarian half carries the SAME guard: add-librarian in flight disables its select and remove button, a second pick fires no second write, saved announced on settle', async () => {
		const d = deferred<undefined>();
		h.addLibrarianMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		await pick(librarianSelect(container), 'p-anna');
		expect(h.addLibrarianMock).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});
		expect(librarianSelect(container).disabled).toBe(true);
		expect(
			(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla') as HTMLButtonElement).disabled
		).toBe(true);

		await pick(librarianSelect(container), 'p-dora');
		expect(h.addLibrarianMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'librarian-remove-p-cilla') as HTMLElement);
		expect(h.removeLibrarianMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'admin-roles-status')?.textContent).toContain('admin_roles_saved');
		});
	});
});

describe('#325 admin/librarian — failure text kept, controls re-enabled for retry', () => {
	it('a rejected add keeps the EXISTING admin-roles-action-error role="alert" (admin_roles_action_error), drops the pending notice, announces NO saved, and re-enables the controls — a retry write fires', async () => {
		const d = deferred<undefined>();
		h.addAdminMock.mockReturnValueOnce(d.promise);
		const { container } = await renderReady();

		await pick(adminSelect(container), 'p-cilla');
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});

		d.reject(new Error('grant rejected'));
		await waitFor(() => {
			const alert = q(container, 'admin-roles-action-error');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('admin_roles_action_error');
		});
		expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		expect(q(container, 'admin-roles-status')?.textContent ?? '').not.toContain(
			'admin_roles_saved'
		);
		expect(adminSelect(container).disabled).toBe(false);

		await pick(adminSelect(container), 'p-cilla');
		expect(h.addAdminMock).toHaveBeenCalledTimes(2);
	});
});

// (*MVOX:Tallis*)
