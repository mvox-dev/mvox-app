// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
	nav_agenda: () => 'Agenda',
	nav_roster: () => 'Roster',
	nav_profile: () => 'Profile',
	nav_library: () => 'Library',
	nav_invite: () => 'Invite',
	nav_links: () => 'Links'
}));
vi.mock('$lib/paraglide/messages', async (importOriginal) =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', nav, await importOriginal())
);
vi.mock('$lib/paraglide/messages.js', async (importOriginal) =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', nav, await importOriginal())
);

const h = vi.hoisted(() => {
	class RoleLockoutError extends Error {
		readonly code = 'role-lockout';
	}
	class RoleGrantMissingError extends Error {
		readonly code = 'role-grant-missing';
	}
	return {
		RoleLockoutError,
		RoleGrantMissingError,
		listAdminsMock: vi.fn(),
		addAdminMock: vi.fn(),
		removeAdminMock: vi.fn(),
		listLibrariansMock: vi.fn(),
		addLibrarianMock: vi.fn(),
		removeLibrarianMock: vi.fn(),
	};
});
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
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
vi.mock('$lib/nav/dbRights', async () =>
	(await import('$lib/testing/mocks/admin')).dbRightsModule('dbEditRight')
);
vi.mock('$lib/library/libraryRights', async () =>
	(await import('$lib/testing/mocks/admin')).libraryRightsModule()
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

import { goto } from '$app/navigation';
import NavShell from '$lib/components/nav/NavShell.svelte';
import { NAV_ENTRIES } from '$lib/nav/entries';
import { existsSync } from 'node:fs';
import AdminPage from './admin/+page.svelte';
import ProfilePage from './profile/+page.svelte';
import AdminInvitePage from './admin/invite/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	createInviteMock,
	sendInviteMock,
	resolveDbEditRightMock,
	resolveCollectiveNameMarkerMock,
	resolveInviteParentMock,
	resolveLibraryEditRightMock,
	resolveParentMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { ANNA } from '$lib/testing/pages/admin';
import { dbEditRight } from '$lib/nav/dbRights';
import { listMyProfilesMock } from '$lib/testing/mocks/session';

const testChildren = createRawSnippet(() => ({
	render: () => '<div data-testid="page-content">Page Content</div>'
}));

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

function renderShell(opts: {
	activeRoute?: string;
	hasMultipleCollectives?: boolean;
}) {
	return render(NavShell, {
		props: {
			children: testChildren,
			entries: NAV_ENTRIES,
			activeRoute: opts.activeRoute ?? '/',
			hasMultipleCollectives: opts.hasMultipleCollectives ?? false
		}
	});
}

function navAnchors(container: HTMLElement): HTMLAnchorElement[] {
	return Array.from(container.querySelectorAll<HTMLAnchorElement>('nav a.nav-entry'));
}

function selectSampledb() {
	signIn({
		token: 'jwt-admin',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }]
	});
}

function loadOk() {
	resolveDbEditRightMock.mockResolvedValue('editor');
	dbEditRight.set('editor');
	listMyProfilesMock.mockResolvedValue([]);
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibraryEditRightMock.mockResolvedValue({ state: 'editor', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }
	]));
	listSectionsMock.mockResolvedValue([]);
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
	createInviteMock.mockResolvedValue({ personId: 'p-new', memberId: 'm-new' });
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	updateCollectiveNameMock.mockResolvedValue(undefined);
}

beforeEach(() => {
	for (const mock of [
		h.listAdminsMock,
		h.addAdminMock,
		h.removeAdminMock,
		h.listLibrariansMock,
		h.addLibrarianMock,
		h.removeLibrarianMock,
		resolveDbEditRightMock,
		resolveLibraryEditRightMock,
		resolveDatabaseEntityIdMock,
		loadRosterMock,
		listSectionsMock,
		resolveParentMock,
		resolveInviteParentMock,
		createInviteMock,
		resolveCollectiveNameMarkerMock,
		updateCollectiveNameMock
	]) {
		mock.mockReset();
	}
	vi.mocked(goto).mockReset();
});

afterEach(() => {
	cleanup();
	resetAppState();
});

describe('#916 — NAV_ENTRIES: five tabs, Admin lives under Profile', () => {
	it('carries exactly 5 entries in order, none routing under /admin (#916; invite #140, links #256, collectives #338)', () => {
		expect(NAV_ENTRIES.map((e) => e.key)).toEqual(['agenda', 'roster', 'profile', 'library', 'links']);
		expect(NAV_ENTRIES.find((e) => e.route.startsWith('/admin'))).toBeUndefined();
	});
});

describe('#916 — NavShell × real NAV_ENTRIES', () => {
	it.each([
		['an admin with several collectives', true],
		['a member with one collective', false]
	])('renders the same 5 top-level entries for %s', (_who, hasMultipleCollectives) => {
		const { container, queryByText } = renderShell({ hasMultipleCollectives });
		expect(navAnchors(container).map((a) => a.getAttribute('href'))).toEqual([
			'/',
			'/roster',
			'/profile',
			'/library',
			'/links'
		]);
		expect(queryByText('Admin')).toBeNull();
		expect(queryByText('Invite')).toBeNull();
	});

	it.each(['/profile', '/admin', '/admin/invite'])(
		'highlights the Profile tab on %s — the single aria-current entry',
		(activeRoute) => {
			const { container } = renderShell({ activeRoute });
			const active = Array.from(container.querySelectorAll('a[aria-current="page"]'));
			expect(active.map((a) => a.getAttribute('href'))).toEqual(['/profile']);
		}
	);

	it('does not highlight Profile on a sibling route sharing a string prefix', () => {
		const { container } = renderShell({ activeRoute: '/administrivia' });
		expect(container.querySelectorAll('a[aria-current="page"]')).toHaveLength(0);
	});
});

describe('#140 — the admin section carries BOTH role management AND invite functionality (on /profile, #916)', () => {
	async function renderMergedReady() {
		selectSampledb();
		loadOk();
		const rendered = render(ProfilePage);
		await waitFor(() => {
			expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
			expect(q(rendered.container, 'admin-roles-librarians')).not.toBeNull();
			expect(q(rendered.container, 'admin-invite-section')).not.toBeNull();
		});
		return rendered;
	}

	it('ready: the invite section renders inside /admin, carrying the invite create affordance', async () => {
		const { container } = await renderMergedReady();
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		expect(q(inviteSection, 'invite-admin-submit')).not.toBeNull();
	});

	it('the embedded invite heading sits UNDER the section h2 — an h3, not a second page title (review F2, #916)', async () => {
		const { container } = await renderMergedReady();
		expect(container.querySelectorAll('h1')).toHaveLength(1);
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		expect(inviteSection.querySelector('h1')).toBeNull();
		expect(inviteSection.querySelector('h2')).toBeNull();
		expect(inviteSection.querySelector('h3')).not.toBeNull();
	});

	it('the embedded invite surface is LIVE: submitting creates via createInvite, sends, and says where it went', async () => {
		sendInviteMock.mockResolvedValue({ sent: true, email: 'mari@example.com' });
		const { container } = await renderMergedReady();
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		const submit = q<HTMLButtonElement>(inviteSection, 'invite-admin-submit')!;
		await waitFor(() => {
			expect(submit.disabled).toBe(false);
		});

		await fireEvent.input(q(inviteSection, 'invite-email')!, { target: { value: 'mari@example.com' } });
		await fireEvent.click(submit);

		await waitFor(() => {
			expect(createInviteMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'sampledb' }),
				expect.objectContaining({ dbEntityId: expect.any(String) })
			);
		});
		await waitFor(() => {
			expect(q(inviteSection, 'invite-send-status')?.textContent).toContain('[roster_member_invite_sent]');
		});
		expect(q(container, 'invite-copy')).toBeNull();
	});

	it('non-admin: NO invite functionality renders on /profile either', async () => {
		selectSampledb();
		loadOk();
		dbEditRight.set('not-editor');

		const { container } = render(ProfilePage);
		await waitFor(() => {
			expect(q(container, 'profile-name-edit')).not.toBeNull();
		});
		expect(q(container, 'profile-collective-admin')).toBeNull();
		expect(q(container, 'admin-invite-section')).toBeNull();
		expect(q(container, 'invite-admin-submit')).toBeNull();
		expect(createInviteMock).not.toHaveBeenCalled();
	});
});

function selectRamkoorOfTwo() {
	signIn({
		token: 'jwt-admin',
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' },
			{ db: 'ramkoor', name: 'RAM Koor', personId: 'admin-p2' }
		],
		selected: 'ramkoor'
	});
}

describe('#140 — embedded invite surface with MULTIPLE collectives', () => {
	async function renderMergedReadyMulti() {
		selectRamkoorOfTwo();
		loadOk();
		resolveDatabaseEntityIdMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'ramkoor' ? 'org-ram' : 'org-poly')
		);
		const rendered = render(ProfilePage);
		await waitFor(() => {
			expect(q(rendered.container, 'admin-invite-section')).not.toBeNull();
		});
		return rendered;
	}

	it('renders NO db picker inside the embedded surface — the page-selected collective is fixed and shown as text', async () => {
		const { container } = await renderMergedReadyMulti();
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		expect(q(inviteSection, 'invite-db')).toBeNull();
		expect(container.querySelector('[data-testid="invite-db"]')).toBeNull();
		const fixed = q<HTMLElement>(inviteSection, 'invite-db-fixed');
		expect(fixed).not.toBeNull();
		expect(fixed!.textContent).toContain('RAM Koor');
	});

	it('submits against the SELECTED collective — db and dbEntityId always come from the same collective', async () => {
		const { container } = await renderMergedReadyMulti();
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		const submit = q<HTMLButtonElement>(inviteSection, 'invite-admin-submit')!;
		await waitFor(() => {
			expect(submit.disabled).toBe(false);
		});

		await fireEvent.input(q(inviteSection, 'invite-email')!, { target: { value: 'mari@example.com' } });
		await fireEvent.click(submit);

		await waitFor(() => {
			expect(createInviteMock).toHaveBeenCalledTimes(1);
		});
		expect(createInviteMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'ramkoor' }),
			expect.objectContaining({ dbEntityId: 'org-ram' })
		);
		expect(createInviteMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ dbEntityId: 'org-poly' })
		);
	});

	it('the embedded surface never self-resolves the org — it adopts the page-resolved pair', async () => {
		await renderMergedReadyMulti();
		expect(resolveInviteParentMock).not.toHaveBeenCalled();
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'ramkoor' })
		);
	});
});

describe('#916 — /admin lands on the admin section of /profile', () => {
	it('/admin replaces itself with /profile#collective', async () => {
		render(AdminPage);
		await waitFor(() => {
			expect(goto).toHaveBeenCalledWith('/profile#collective', { replaceState: true });
		});
	});

	it('/profile#collective scrolls the section into view once it has rendered', async () => {
		const scrolled: Element[] = [];
		const spy = vi
			.spyOn(Element.prototype, 'scrollIntoView')
			.mockImplementation(function (this: Element) {
				scrolled.push(this);
			});
		history.replaceState({}, '', '/profile#collective');
		selectSampledb();
		loadOk();
		const { container } = render(ProfilePage);
		await waitFor(() => expect(q(container, 'admin-roles-admins')).not.toBeNull());
		await waitFor(() => expect(scrolled).toEqual([q(container, 'profile-collective-admin')]));
		history.replaceState({}, '', '/');
		spy.mockRestore();
	});

	it('/profile without the fragment does not scroll', async () => {
		const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
		history.replaceState({}, '', '/profile');
		selectSampledb();
		loadOk();
		const { container } = render(ProfilePage);
		await waitFor(() => expect(q(container, 'admin-roles-admins')).not.toBeNull());
		expect(spy).not.toHaveBeenCalled();
		history.replaceState({}, '', '/');
		spy.mockRestore();
	});
});

describe('#140 — backward compat for existing invite URLs', () => {
	it('externally-held invite links stay at /invite/<token> — the merge does not move the landing URL space', () => {
		expect(existsSync('src/routes/invite/[token]/+page.svelte')).toBe(true);
	});

	it('/admin/invite does not dead-end: it redirects to /admin OR still renders the invite surface standalone', async () => {
		selectSampledb();
		loadOk();

		const { container } = render(AdminInvitePage);
		await waitFor(() => {
			const redirected = vi
				.mocked(goto)
				.mock.calls.some(
					([path]) =>
						typeof path === 'string' && (path === '/admin' || path.startsWith('/admin?'))
				);
			const standalone = q(container, 'invite-admin-submit') !== null;
			expect(
				redirected || standalone,
				'expected /admin/invite to either redirect to /admin or keep rendering the invite surface'
			).toBe(true);
		});
	});
});

// (*MVOX:Tallis* — #140/S3 RED)
