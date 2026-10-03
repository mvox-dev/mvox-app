// @vitest-environment happy-dom
// The self-removal note renders inline in the viewer's own admin row.
import { toListRead } from '$lib/testing/listReadFixtures';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/admin/roleManagement', async () =>
	(await import('$lib/testing/mocks/admin')).roleManagementModule()
);
vi.mock('$lib/nav/adminStore', async () =>
	(await import('$lib/testing/mocks/admin')).adminStoreModule('admin')
);
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/admin')).librarianStoreModule()
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
vi.mock('$lib/invite/inviteData', async () =>
	(await import('$lib/testing/mocks/admin')).inviteDataModule()
);
vi.mock('$lib/collectives/collectiveName', async () =>
	(await import('$lib/testing/mocks/admin')).collectiveNameModule()
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

import Page from './admin/+page.svelte';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	listAdminsMock,
	listLibrariansMock,
	removeAdminMock,
	resolveAdminMock,
	resolveCollectiveNameMarkerMock,
	resolveInviteParentMock,
	resolveLibrarianMock,
	resolveParentMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { BELA, CFG, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupReset, q } from '$lib/testing/pages/dom';

const SELF_HINT_KEY = '[admin_roles_remove_self_hint]';

const SELF_OWNER = {
	id: 'admin-p',
	name: 'Mihkel Putrinš',
	role: 'owner' as const,
	valueIds: ['pv-own-self']
};
const DB_ROOT = {
	id: 'p-dbroot',
	name: 'db-root (mvox dev admin)',
	role: 'owner' as const,
	valueIds: ['pv-own-dbroot']
};

const ROSTER = [
	{ memberId: 'm-0', personId: 'admin-p', name: 'Mihkel Putrinš', email: '' },
	{ memberId: 'm-1', personId: 'p-dbroot', name: 'db-root (mvox dev admin)', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' }
];

function loadOk() {
	resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	listAdminsMock.mockResolvedValue({ persons: [DB_ROOT, SELF_OWNER], canManage: true });
	listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	removeAdminMock.mockResolvedValue(undefined);
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	updateCollectiveNameMock.mockResolvedValue(undefined);
}

async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
	});
	return rendered;
}

beforeEach(() => {
	listAdminsMock.mockReset();
	listLibrariansMock.mockReset();
	loadRosterMock.mockReset();
	removeAdminMock.mockReset();
	resolveAdminMock.mockReset();
	resolveCollectiveNameMarkerMock.mockReset();
	resolveInviteParentMock.mockReset();
	resolveLibrarianMock.mockReset();
	resolveParentMock.mockReset();
	updateCollectiveNameMock.mockReset();
	listSectionsMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
});

afterEach(cleanupReset);

describe('/admin — #175 self-removal note renders inline in the own row', () => {
	it("route integration — the note sits INSIDE the viewer's own <li> (the same {#each} iteration as the other Remove buttons), where the button would otherwise be", async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();

		const selfRow = q<HTMLElement>(container, 'admin-entry-admin-p');
		expect(selfRow, "expected the viewer's own admin row to render").not.toBeNull();

		const hint = q<HTMLElement>(container, 'admin-roles-admins-self-hint');
		expect(hint, 'expected the self-removal note to render').not.toBeNull();
		expect(
			hint!.closest('li'),
			"expected the note to sit inside the viewer's own <li> — not outside the list"
		).toBe(selfRow);

		expect(hint!.closest('ul'), 'expected the note to live inside the admin <ul>').not.toBeNull();
	});

	it('route integration — NO separate note below the admin list: the section renders no direct-child paragraph carrying the self-hint message', async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();

		const adminsSection = q<HTMLElement>(container, 'admin-roles-admins');
		expect(adminsSection).not.toBeNull();

		const carriers = Array.from(adminsSection!.querySelectorAll<HTMLElement>('*')).filter(
			(el) => el.children.length === 0 && (el.textContent ?? '').includes(SELF_HINT_KEY)
		);
		expect(
			carriers.length,
			'expected the self-hint message to render somewhere in the admins section'
		).toBeGreaterThan(0);
		for (const el of carriers) {
			expect(
				el.closest('li'),
				`expected every self-hint occurrence to sit inside a list item, found one outside: <${el.tagName.toLowerCase()}>`
			).not.toBeNull();
		}

		const directChildrenWithHint = Array.from(adminsSection!.children).filter((el) =>
			(el.textContent ?? '').includes(SELF_HINT_KEY) && el.tagName !== 'UL'
		);
		expect(
			directChildrenWithHint,
			'expected no separate note element below the admin list'
		).toEqual([]);
	});

	it("route integration — the note text shares the ROW with the admin's own name (one <li> holds both), and the row still offers no Remove control", async () => {
		selectSampledb();
		loadOk();

		const { container } = await renderReady();

		const selfRow = q<HTMLElement>(container, 'admin-entry-admin-p');
		expect(selfRow).not.toBeNull();

		expect(selfRow!.textContent).toContain('Mihkel Putrinš');
		expect(selfRow!.textContent).toContain(SELF_HINT_KEY);

		expect(q(selfRow!, 'admin-remove-admin-p')).toBeNull();
		expect(selfRow!.querySelector('button')).toBeNull();
	});

	it("route integration — other admins' rows keep their working Remove button next to the note-bearing own row: rendered, enabled, click reaches removeAdmin", async () => {
		selectSampledb();
		loadOk();
		listAdminsMock
			.mockReset()
			.mockResolvedValueOnce({ persons: [DB_ROOT, SELF_OWNER, BELA], canManage: true })
			.mockResolvedValueOnce({ persons: [DB_ROOT, SELF_OWNER], canManage: true });

		const { container } = await renderReady();
		await waitFor(() => {
			expect(q(container, 'admin-entry-p-bela')).not.toBeNull();
		});

		const belaRow = q<HTMLElement>(container, 'admin-entry-p-bela')!;
		expect(belaRow.textContent).not.toContain(SELF_HINT_KEY);
		const removeBela = q<HTMLButtonElement>(belaRow, 'admin-remove-p-bela');
		expect(removeBela, "expected Bela's Remove button inside her own row").not.toBeNull();
		expect(removeBela!.disabled).toBe(false);
		const removeDbRoot = q<HTMLButtonElement>(container, 'admin-remove-p-dbroot');
		expect(removeDbRoot).not.toBeNull();
		expect(removeDbRoot!.disabled).toBe(false);

		await fireEvent.click(removeBela!);
		await waitFor(() => {
			expect(removeAdminMock).toHaveBeenCalledWith(
				expect.objectContaining(CFG),
				'org-1',
				'p-bela'
			);
		});

		await waitFor(() => {
			expect(q(container, 'admin-entry-p-bela')).toBeNull();
		});
		const selfRow = q<HTMLElement>(container, 'admin-entry-admin-p')!;
		expect(selfRow.textContent).toContain(SELF_HINT_KEY);
		expect(selfRow.querySelector('button')).toBeNull();
	});
});

// (*MVOX:Tallis*)
