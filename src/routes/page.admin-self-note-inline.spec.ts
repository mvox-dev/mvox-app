// @vitest-environment happy-dom
// The self-removal note renders inline in the viewer's own admin row.
import { toListRead } from '$lib/testing/listReadFixtures';
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
	resolveLibrarianMock: vi.fn(),
	loadRosterMock: vi.fn(),
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
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: h.loadRosterMock
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/invite/inviteData', () => ({
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
}));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
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
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';

const CFG = testCfg('sampledb', 'jwt-admin');
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
const BELA = {
	id: 'p-bela',
	name: 'Bela Brauer',
	role: 'editor' as const,
	valueIds: ['pv-ed-bela']
};

const ROSTER = [
	{ memberId: 'm-0', personId: 'admin-p', name: 'Mihkel Putrinš', email: '' },
	{ memberId: 'm-1', personId: 'p-dbroot', name: 'db-root (mvox dev admin)', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' }
];

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
}

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [DB_ROOT, SELF_OWNER], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	h.removeAdminMock.mockResolvedValue(undefined);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
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

beforeEach(() => {
	for (const mock of Object.values(h)) mock.mockReset();
	listSectionsMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
});

afterEach(() => {
	cleanup();
	resetAppState();
});

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
		h.listAdminsMock
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
			expect(h.removeAdminMock).toHaveBeenCalledWith(
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
