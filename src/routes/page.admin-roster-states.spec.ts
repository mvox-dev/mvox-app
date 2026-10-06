// @vitest-environment happy-dom
// #617: the /admin member pickers while the roster read is in flight, and after it fails.
import { waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/adminCopy')).adminMessages()
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

import { toListRead } from '$lib/testing/listReadFixtures';
import { listAdminsMock, listJoinStatesMock, resolveOwnerTierMock } from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { ROSTER, listing, loadOk, resetAdminMocks, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupReset, q } from '$lib/testing/pages/dom';
import { promptOption } from '$lib/testing/pages/seasonPanel';
import { renderReady } from '$lib/testing/pages/adminRolesRender';

listJoinStatesMock.mockResolvedValue({});
resolveOwnerTierMock.mockResolvedValue('error');

const PICKERS = ['admin-add-admin-select', 'admin-add-librarian-select'];

function promptTexts(container: HTMLElement): Array<string | undefined> {
	return PICKERS.map((testid) => {
		const select = q<HTMLSelectElement>(container, testid);
		expect(select, `expected [data-testid="${testid}"]`).not.toBeNull();
		return promptOption(select!).textContent?.trim();
	});
}

beforeEach(() => {
	resetAdminMocks();
	selectSampledb();
	loadOk();
});

afterEach(cleanupReset);

describe('/admin — the member pickers say when the roster is loading or unavailable (#617)', () => {
	it('while the roster read is in flight, the page is usable and both pickers say "Loading members…"', async () => {
		loadRosterMock.mockReset().mockReturnValue(new Promise(() => {}));

		const { container } = await renderReady();

		expect(q(container, 'admin-entry-p-anna')).not.toBeNull();
		expect(q(container, 'admin-invite-section')).not.toBeNull();
		expect(promptTexts(container)).toEqual(['Loading members…', 'Loading members…']);
	});

	it('a failed roster read leaves the rest of /admin working, both pickers say "Member list unavailable", and the failure is reported once', async () => {
		const boom = new Error('roster boom');
		loadRosterMock.mockReset().mockRejectedValue(boom);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { container } = await renderReady();
		await waitFor(() => {
			expect(promptTexts(container)).toEqual(['Member list unavailable', 'Member list unavailable']);
		});

		expect(q(container, 'admin-roles-load-error')).toBeNull();
		expect(q(container, 'admin-entry-p-anna')).not.toBeNull();
		expect(q(container, 'librarian-entry-p-cilla')).not.toBeNull();
		expect(q(container, 'admin-remove-p-bela')).not.toBeNull();
		expect(q(container, 'admin-invite-section')).not.toBeNull();
		expect(consoleSpy.mock.calls).toEqual([['admin: loading members failed', boom]]);
		consoleSpy.mockRestore();
	});

	it('a roster that lands after the role lists still names their rows', async () => {
		let land!: (read: unknown) => void;
		loadRosterMock.mockReset().mockReturnValue(new Promise((resolve) => (land = resolve)));
		listAdminsMock.mockReset().mockResolvedValue(
			listing([{ id: 'p-anna', name: 'p-anna', role: 'owner', valueIds: ['pv-own-anna'] }])
		);

		const { container } = await renderReady();
		land(toListRead(ROSTER));

		await waitFor(() => {
			expect(q(container, 'admin-entry-p-anna')?.textContent).toContain('Anna Arro');
		});
	});
});

// (*MVOX:Josquin*)
