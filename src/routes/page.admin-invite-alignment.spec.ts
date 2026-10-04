// @vitest-environment happy-dom
import { toListRead } from '$lib/testing/listReadFixtures';
import { render, waitFor } from '@testing-library/svelte';
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

import AdminPage from './admin/+page.svelte';
import InvitePage from './admin/invite/+page.svelte';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	listAdminsMock,
	listJoinStatesMock,
	listLibrariansMock,
	resolveAdminMock,
	resolveCollectiveNameMarkerMock,
	resolveInviteParentMock,
	resolveLibrarianMock,
	resolveOwnerTierMock,
	resolveParentMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { resetAdminMocks, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupReset } from '$lib/testing/pages/dom';

// Defaults the hoisted handles carried before they moved to the shared mocks.
listJoinStatesMock.mockResolvedValue({});
resolveOwnerTierMock.mockResolvedValue('error');

const STANDALONE_ROOT_CLASSES = 'mx-auto flex w-full max-w-md flex-col gap-4';
const EMBEDDED_ROOT_CLASSES = 'flex w-full flex-col gap-4';

function loadOk() {
	resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	listAdminsMock.mockResolvedValue({
		persons: [{ id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] }],
		canManage: true
	});
	listLibrariansMock.mockResolvedValue({
		persons: [{ id: 'p-cilla', name: 'Cilla Cane', role: 'editor' as const, valueIds: ['pv-ed-cilla'] }],
		canManage: true
	});
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
		{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' }
	]));
	listSectionsMock.mockResolvedValue([]);
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	updateCollectiveNameMock.mockResolvedValue(undefined);
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
}

function inviteSurfaceRoot(scope: ParentNode, headingLevel: 'h1' | 'h2'): HTMLElement {
	const headings = Array.from(scope.querySelectorAll(headingLevel)).filter(
		(el) => el.textContent?.trim() === 'Invite a new member'
	);
	expect(headings, `expected exactly one ${headingLevel} "Invite a new member"`).toHaveLength(1);
	const root = headings[0].parentElement as HTMLElement;
	expect(root).not.toBeNull();
	expect(root.tagName).toBe('DIV');
	return root;
}

beforeEach(resetAdminMocks);

afterEach(cleanupReset);

describe('#235 — embedded InviteSurface on /admin (integration: real route page)', () => {
	async function renderAdminReady() {
		selectSampledb();
		loadOk();
		const { container } = render(AdminPage);
		const section = await waitFor(() => {
			const el = container.querySelector<HTMLElement>('[data-testid="admin-invite-section"]');
			expect(el, 'expected the embedded invite section to render').not.toBeNull();
			return el!;
		});
		return { container, section };
	}

	it('root div drops BOTH centering tokens — full class string is exactly the standalone string minus mx-auto/max-w-md', async () => {
		const { section } = await renderAdminReady();
		const root = inviteSurfaceRoot(section, 'h2');

		expect(Array.from(root.classList)).not.toContain('mx-auto');
		expect(Array.from(root.classList)).not.toContain('max-w-md');
		expect(Array.from(root.classList).filter((c) => c.startsWith('max-w-'))).toEqual([]);

		expect(root.getAttribute('class')).toBe(EMBEDDED_ROOT_CLASSES);
	});

	it('aligns like its siblings: Administrators/Librarians sections carry no width/centering of their own, and neither does the invite section wrapper', async () => {
		const { container, section } = await renderAdminReady();

		for (const testid of ['admin-roles-admins', 'admin-roles-librarians']) {
			const sibling = container.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
			expect(sibling, `expected [data-testid="${testid}"]`).not.toBeNull();
			expect(sibling!.getAttribute('class')).toBe('flex flex-col gap-3');
		}
		expect(section.getAttribute('class')).toBe('flex flex-col gap-3');
		expect(section.querySelector('.mx-auto')).toBeNull();
		expect(section.querySelector('.max-w-md')).toBeNull();
	});
});

describe('#235 — standalone /admin/invite stays pixel-identical (integration: real route page)', () => {
	it("root div class string is byte-identical to today's — the component's own classes remain the sole centering mechanism on the full-bleed route", async () => {
		selectSampledb();
		resolveParentMock.mockResolvedValue('parent-1');
		resolveInviteParentMock.mockResolvedValue('org-1');

		const { container } = render(InvitePage);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-admin-submit"]')).not.toBeNull();
		});

		const root = inviteSurfaceRoot(container, 'h1');
		expect(root.getAttribute('class')).toBe(STANDALONE_ROOT_CLASSES);

		const main = container.querySelector('main');
		expect(main).not.toBeNull();
		expect(main!.getAttribute('class')).toBe('min-h-screen bg-paper px-6 py-10 text-ink');
	});
});

// (*MVOX:Tallis* — #235 RED: class contract for InviteSurface per mount site)
