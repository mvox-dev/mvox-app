// @vitest-environment happy-dom
// The /admin role add/remove controls hold a pending state until the write lands.
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);

vi.mock('$lib/admin/roleManagement', async () =>
	(await import('$lib/testing/mocks/admin')).roleManagementModule({ errors: true })
);
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
vi.mock('$lib/invite/inviteData', async () =>
	(await import('$lib/testing/mocks/admin')).inviteDataModule({ errors: true })
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

import {
	addAdminMock,
	addLibrarianMock,
	listJoinStatesMock,
	removeAdminMock,
	removeLibrarianMock,
	resolveOwnerTierMock
} from '$lib/testing/mocks/admin';
import { loadOk, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupClearReset, q } from '$lib/testing/pages/dom';
import { renderReady } from '$lib/testing/pages/adminRolesRender';

// Defaults the hoisted handles carried before they moved to the shared mocks.
listJoinStatesMock.mockResolvedValue({});
resolveOwnerTierMock.mockResolvedValue('error');

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

afterEach(cleanupClearReset);

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
		addAdminMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		await pick(adminSelect(container), 'p-cilla');
		expect(addAdminMock).toHaveBeenCalledTimes(1);

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
		expect(addAdminMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'admin-remove-p-bela') as HTMLElement);
		expect(removeAdminMock).not.toHaveBeenCalled();

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
		expect(addAdminMock).toHaveBeenCalledTimes(2);
	});

	it('remove-admin double-tap fires EXACTLY ONE revoke write; while it is in flight a pick fires NO grant write; settle → saved announced', async () => {
		const d = deferred<undefined>();
		removeAdminMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		const removeBela = q<HTMLButtonElement>(container, 'admin-remove-p-bela') as HTMLButtonElement;
		await fireEvent.click(removeBela);
		await fireEvent.click(removeBela);
		expect(removeAdminMock).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});
		expect(adminSelect(container).disabled).toBe(true);

		await pick(adminSelect(container), 'p-cilla');
		expect(addAdminMock).not.toHaveBeenCalled();

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
		addLibrarianMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		await pick(librarianSelect(container), 'p-anna');
		expect(addLibrarianMock).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});
		expect(librarianSelect(container).disabled).toBe(true);
		expect(
			(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla') as HTMLButtonElement).disabled
		).toBe(true);

		await pick(librarianSelect(container), 'p-dora');
		expect(addLibrarianMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'librarian-remove-p-cilla') as HTMLElement);
		expect(removeLibrarianMock).not.toHaveBeenCalled();

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
		addAdminMock.mockReturnValueOnce(d.promise);
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
		expect(addAdminMock).toHaveBeenCalledTimes(2);
	});
});

// (*MVOX:Tallis*)
