// @vitest-environment happy-dom
// /admin: a role row with no name shows the person as an EntuRef link (#841).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { RolePerson } from '$lib/admin/roleManagement';
import {
	listAdminsMock,
	listJoinStatesMock,
	listLibrariansMock,
	resolveOwnerTierMock
} from '$lib/testing/mocks/admin';
import { ANNA, CILLA, listing, loadOk, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupClearReset, q } from '$lib/testing/pages/dom';
import { renderReady } from '$lib/testing/pages/adminRolesRender';

listJoinStatesMock.mockResolvedValue({});
resolveOwnerTierMock.mockResolvedValue('error');

const GHOST_ADMIN_ID = '69c7f8688489bfcb0e8ab0a1';
const GHOST_LIBRARIAN_ID = '69c7f8688489bfcb0e8ac0c2';

function nameless(id: string): RolePerson {
	return { id, name: null, role: 'editor', valueIds: [`pv-${id}`] };
}

function entuLink(row: Element | null): HTMLAnchorElement | null {
	return row?.querySelector<HTMLAnchorElement>('a[href^="https://entu.app/"]') ?? null;
}

beforeEach(() => {
	selectSampledb();
	loadOk();
	listAdminsMock.mockResolvedValue(listing([ANNA, nameless(GHOST_ADMIN_ID)]));
	listLibrariansMock.mockResolvedValue(listing([CILLA, nameless(GHOST_LIBRARIAN_ID)]));
});

afterEach(cleanupClearReset);

describe('/admin — a role row with no name (#841)', () => {
	it('a nameless admin row shows the last 6 characters, linking to the person in entu.app', async () => {
		const { container } = await renderReady();

		const row = q(container, `admin-entry-${GHOST_ADMIN_ID}`);
		const link = entuLink(row);
		expect(link?.getAttribute('href')).toBe(`https://entu.app/sampledb/${GHOST_ADMIN_ID}`);
		expect(link?.textContent?.trim()).toBe('8ab0a1');
		expect(row?.textContent).not.toContain(GHOST_ADMIN_ID);
	});

	it('a nameless librarian row shows the last 6 characters, linking to the person in entu.app', async () => {
		const { container } = await renderReady();

		const row = q(container, `librarian-entry-${GHOST_LIBRARIAN_ID}`);
		const link = entuLink(row);
		expect(link?.getAttribute('href')).toBe(`https://entu.app/sampledb/${GHOST_LIBRARIAN_ID}`);
		expect(link?.textContent?.trim()).toBe('8ac0c2');
		expect(row?.textContent).not.toContain(GHOST_LIBRARIAN_ID);
	});

	it('a named row is unchanged: the name, no Entu link', async () => {
		const { container } = await renderReady();

		const admin = q(container, 'admin-entry-p-anna');
		expect(admin?.textContent).toContain('Anna Arro');
		expect(entuLink(admin)).toBeNull();
		const librarian = q(container, 'librarian-entry-p-cilla');
		expect(librarian?.textContent).toContain('Cilla Cane');
		expect(entuLink(librarian)).toBeNull();
	});
});

// (*MVOX:Josquin*)
