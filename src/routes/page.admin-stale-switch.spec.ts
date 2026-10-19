// @vitest-environment happy-dom
// A collective switch mid-load or mid-write drops the old collective's late answer on /profile.
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('raw')
);

vi.mock('$lib/admin/roleManagement', async () =>
	(await import('$lib/testing/mocks/admin')).roleManagementModule({ errors: true })
);
vi.mock('$lib/nav/dbRights', async () =>
	(await import('$lib/testing/mocks/admin')).dbRightsModule()
);
vi.mock('$lib/library/libraryRights', async () =>
	(await import('$lib/testing/mocks/admin')).libraryRightsModule()
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
import { get } from 'svelte/store';
import { deferred } from '$lib/testing/entuFetchKit';
import Page from './profile/+page.svelte';
import { createLatest } from '$lib/async/latest';
import AdminRoles from '$lib/admin/AdminRoles.svelte';
import { collectiveState, selectedCollectiveDbStore, selectedCollectiveStore } from '$lib/collectives/store';
import {
	listAdminsMock,
	removeAdminMock,
	listJoinStatesMock,
	resolveDbRightMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { ANNA, BELA, CFG, ROSTER, listing, loadOk } from '$lib/testing/pages/admin';
import { cleanupClearReset, q } from '$lib/testing/pages/dom';
import { renderReady } from '$lib/testing/pages/adminRolesRender';
import { signIn } from '$lib/testing/session';

listJoinStatesMock.mockResolvedValue({});
resolveDbRightMock.mockResolvedValue('error');

function twoCollectives(): void {
	signIn({
		token: 'jwt-admin',
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' },
			{ db: 'otherdb', name: 'Otherdb', personId: 'admin-o' }
		],
		selected: 'sampledb'
	});
}

beforeEach(() => {
	loadOk();
	twoCollectives();
});

afterEach(cleanupClearReset);

describe('/profile — a switch drops the old collective’s late answers', () => {
	it('the role lists: the first collective’s list answering after the switch is not shown', async () => {
		const first = deferred<ReturnType<typeof listing>>();
		listAdminsMock.mockReturnValueOnce(first.promise).mockResolvedValue(listing([BELA]));
		const { container } = render(Page);
		await waitFor(() => expect(listAdminsMock).toHaveBeenCalledTimes(1));

		selectedCollectiveDbStore.set('otherdb');
		await waitFor(() => expect(listAdminsMock).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(q(container, 'admin-entry-p-bela')).not.toBeNull());
		first.resolve(listing([ANNA]));
		await new Promise((r) => setTimeout(r, 0));

		expect(q(container, 'admin-entry-p-anna')).toBeNull();
		expect(q(container, 'admin-entry-p-bela')).not.toBeNull();
	});

	it('a role write settling after the switch announces nothing on the new collective', async () => {
		const write = deferred<undefined>();
		removeAdminMock.mockReturnValue(write.promise);
		const { container } = await renderReady();

		await fireEvent.click(q<HTMLButtonElement>(container, 'admin-remove-p-bela')!);
		await waitFor(() => expect(removeAdminMock).toHaveBeenCalledTimes(1));
		selectedCollectiveDbStore.set('otherdb');
		await waitFor(() => expect(listAdminsMock.mock.calls.length).toBeGreaterThan(1));
		write.resolve(undefined);
		await new Promise((r) => setTimeout(r, 0));

		expect(q(container, 'admin-roles-status')?.textContent ?? '').not.toContain('admin_roles_saved');
	});

	it('a name write settling after the switch does not rename the collective in the store', async () => {
		const write = deferred<undefined>();
		updateCollectiveNameMock.mockReturnValue(write.promise);
		const { container } = await renderReady();
		await waitFor(() => expect(q(container, 'admin-collective-name-edit')).not.toBeNull());

		await fireEvent.click(q<HTMLButtonElement>(container, 'admin-collective-name-edit')!);
		const input = q<HTMLInputElement>(container, 'admin-collective-name-input')!;
		await fireEvent.input(input, { target: { value: 'Uus Koorinimi' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await waitFor(() => expect(updateCollectiveNameMock).toHaveBeenCalledTimes(1));
		selectedCollectiveDbStore.set('otherdb');
		await waitFor(() => expect(get(selectedCollectiveStore)?.db).toBe('otherdb'));
		write.resolve(undefined);
		await new Promise((r) => setTimeout(r, 0));

		const sampledb = get(collectiveState);
		expect(sampledb.status === 'ready' && sampledb.collectives.find((c) => c.db === 'sampledb')?.name).toBe('Sampledb');
	});

	it('AdminRoles: a grant settling after its load was replaced announces nothing', async () => {
		const write = deferred<undefined>();
		const load = createLatest();
		const { container } = render(AdminRoles, {
			cfg: CFG,
			dbEntityId: 'org-1',
			libraryId: 'lib-1',
			viewerId: 'p-anna',
			admins: [],
			librarians: [],
			canManageAdmins: true,
			canManageLibrarians: true,
			roster: ROSTER,
			rosterPartial: false,
			rosterLoading: false,
			rosterFailed: false,
			sections: [],
			sectionsError: false,
			isOffline: false,
			loadCurrent: load.whileCurrent,
			refreshRole: vi.fn().mockResolvedValue(undefined),
			writes: {
				addAdmin: vi.fn().mockReturnValue(write.promise),
				removeAdmin: vi.fn(),
				addLibrarian: vi.fn(),
				removeLibrarian: vi.fn()
			}
		});

		await fireEvent.change(q<HTMLSelectElement>(container, 'admin-add-admin-select')!, {
			target: { value: 'p-bela' }
		});
		load.cancel();
		write.resolve(undefined);
		await new Promise((r) => setTimeout(r, 0));

		expect(q(container, 'admin-roles-status')?.textContent ?? '').not.toContain('admin_roles_saved');
	});
});

// (*MVOX:Josquin*)
