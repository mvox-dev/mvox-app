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
	nav_admin: () => 'Admin',
	nav_links: () => 'Links'
}));
vi.mock('$lib/paraglide/messages', async (importOriginal) =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', nav, await importOriginal())
);
vi.mock('$lib/paraglide/messages.js', async (importOriginal) =>
	(await import('$lib/testing/messageMocks')).echoMessages('bracket', nav, await importOriginal())
);

const h = vi.hoisted(() => {
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
	class RoleLockoutError extends Error {
		readonly code = 'role-lockout';
	}
	class RoleGrantMissingError extends Error {
		readonly code = 'role-grant-missing';
	}
	return {
		InviteCreateError,
		RoleLockoutError,
		RoleGrantMissingError,
		listAdminsMock: vi.fn(),
		addAdminMock: vi.fn(),
		removeAdminMock: vi.fn(),
		listLibrariansMock: vi.fn(),
		addLibrarianMock: vi.fn(),
		removeLibrarianMock: vi.fn(),
		resolveAdminMock: vi.fn(),
		resolveLibrarianMock: vi.fn(),
		resolveDatabaseEntityIdMock: vi.fn(),
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		resolveParentMock: vi.fn(),
		resolveInviteParentMock: vi.fn(),
		createInviteMock: vi.fn(),
		resolveCollectiveNameMarkerMock: vi.fn(),
		updateCollectiveNameMock: vi.fn()
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
vi.mock('$lib/nav/adminStore', () => ({
	resolveAdmin: h.resolveAdminMock
}));
vi.mock('$lib/library/librarianStore', () => ({
	resolveLibrarian: h.resolveLibrarianMock
}));
vi.mock('$lib/collective/databaseEntity', () => ({
	resolveDatabaseEntityId: h.resolveDatabaseEntityIdMock
}));
vi.mock('$lib/roster/rosterData', () => ({
	loadRoster: h.loadRosterMock
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: h.listSectionsMock
}));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { goto } from '$app/navigation';
import NavShell from '$lib/components/nav/NavShell.svelte';
import { NAV_ENTRIES } from '$lib/nav/entries';
import { buildInviteUrl } from '$lib/invite/invite-links';
import AdminPage from './admin/+page.svelte';
import AdminInvitePage from './admin/invite/+page.svelte';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const testChildren = createRawSnippet(() => ({
	render: () => '<div data-testid="page-content">Page Content</div>'
}));

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

function renderShell(opts: {
	activeRoute?: string;
	isAdmin?: boolean;
	hasMultipleCollectives?: boolean;
}) {
	return render(NavShell, {
		props: {
			children: testChildren,
			entries: NAV_ENTRIES,
			activeRoute: opts.activeRoute ?? '/',
			isAdmin: opts.isAdmin ?? false,
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

const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] };

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(toListRead([
		{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }
	]));
	h.listSectionsMock.mockResolvedValue([]);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.createInviteMock.mockResolvedValue({ inviteToken: 'tok-123' });
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
}

beforeEach(() => {
	for (const mock of [
		h.listAdminsMock,
		h.addAdminMock,
		h.removeAdminMock,
		h.listLibrariansMock,
		h.addLibrarianMock,
		h.removeLibrarianMock,
		h.resolveAdminMock,
		h.resolveLibrarianMock,
		h.resolveDatabaseEntityIdMock,
		h.loadRosterMock,
		h.listSectionsMock,
		h.resolveParentMock,
		h.resolveInviteParentMock,
		h.createInviteMock,
		h.resolveCollectiveNameMarkerMock,
		h.updateCollectiveNameMock
	]) {
		mock.mockReset();
	}
	vi.mocked(goto).mockReset();
});

afterEach(() => {
	cleanup();
	resetAppState();
});

describe('#140 — NAV_ENTRIES after the merge', () => {
	it('carries exactly 6 entries — the separate invite entry is gone; links joined (#256); collectives left with its page (#338)', () => {
		expect(NAV_ENTRIES.map((e) => e.key)).toHaveLength(6);
		expect(NAV_ENTRIES.find((e) => e.key === 'invite')).toBeUndefined();
		expect(NAV_ENTRIES.find((e) => e.route === '/admin/invite')).toBeUndefined();
	});

	it('keeps a single admin-only entry routing to /admin (visible ⇔ ctx.isAdmin)', () => {
		const adminEntries = NAV_ENTRIES.filter((e) => e.route.startsWith('/admin'));
		expect(adminEntries).toHaveLength(1);
		const admin = adminEntries[0];
		expect(admin.route).toBe('/admin');
		expect(admin.visible({ isAdmin: true, hasMultipleCollectives: false })).toBe(true);
		expect(admin.visible({ isAdmin: false, hasMultipleCollectives: false })).toBe(false);
		expect(admin.visible({ isAdmin: false, hasMultipleCollectives: true })).toBe(false);
	});
});

describe('#140 — NavShell × real NAV_ENTRIES', () => {
	it('renders exactly 6 top-level nav entries for a full-context admin (#256 added links; #338 removed collectives)', () => {
		const { container } = renderShell({ isAdmin: true, hasMultipleCollectives: true });
		expect(navAnchors(container)).toHaveLength(6);
	});

	it('renders an Admin entry for admins — and NO separate Invite entry', () => {
		const { container, getByText, queryByText } = renderShell({ isAdmin: true });
		const adminLink = getByText('Admin').closest('a');
		expect(adminLink?.getAttribute('href')).toBe('/admin');
		expect(queryByText('Invite')).toBeNull();
		expect(
			navAnchors(container).filter((a) => a.getAttribute('href') === '/admin/invite')
		).toHaveLength(0);
	});

	it('hides the Admin entry from non-admins — 5 member entries (#256: links is member-visible, members READ the collection), no admin affordance', () => {
		const { container, queryByText } = renderShell({ isAdmin: false });
		expect(queryByText('Admin')).toBeNull();
		expect(queryByText('Invite')).toBeNull();
		expect(navAnchors(container).map((a) => a.getAttribute('href'))).toEqual([
			'/',
			'/roster',
			'/profile',
			'/library',
			'/links'
		]);
	});

	it('highlights the Admin tab on /admin — the single aria-current entry', () => {
		const { container, getByText } = renderShell({ activeRoute: '/admin', isAdmin: true });
		const adminLink = getByText('Admin').closest('a');
		expect(adminLink?.getAttribute('aria-current')).toBe('page');
		expect(container.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
	});

	it('highlights the Admin tab on /admin/invite too (prefix match — the merged tab owns the whole /admin subtree)', () => {
		const { container, getByText } = renderShell({
			activeRoute: '/admin/invite',
			isAdmin: true
		});
		const adminLink = getByText('Admin').closest('a');
		expect(adminLink?.getAttribute('aria-current')).toBe('page');
		const active = Array.from(container.querySelectorAll('a[aria-current="page"]'));
		expect(active.map((a) => a.getAttribute('href'))).toEqual(['/admin']);
		expect(container.querySelectorAll('.nav-entry--active')).toHaveLength(1);
	});
});

describe('#140 — /admin carries BOTH role management AND invite functionality', () => {
	async function renderMergedReady() {
		selectSampledb();
		loadOk();
		const rendered = render(AdminPage);
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

	it('the embedded invite heading sits UNDER the page h1 — a section h2, not a second page title (review F2)', async () => {
		const { container } = await renderMergedReady();
		expect(container.querySelectorAll('h1')).toHaveLength(1);
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		expect(inviteSection.querySelector('h1')).toBeNull();
		expect(inviteSection.querySelector('h2')).not.toBeNull();
	});

	it('the embedded invite surface is LIVE: submitting mints an invite via createInvite and surfaces the copy-only result panel', async () => {
		const { container } = await renderMergedReady();
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		const submit = q<HTMLButtonElement>(inviteSection, 'invite-admin-submit')!;
		await waitFor(() => {
			expect(submit.disabled).toBe(false);
		});

		await fireEvent.click(submit);

		await waitFor(() => {
			expect(h.createInviteMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'sampledb' }),
				expect.objectContaining({ dbEntityId: expect.any(String) })
			);
		});
		await waitFor(() => {
			expect(q(container, 'invite-copy')).not.toBeNull();
		});
		expect(q(container, 'invite-link')).toBeNull();
		expect(container.textContent).not.toContain('tok-123');
	});

	it('non-admin (no-access): NO invite functionality renders on /admin either', async () => {
		selectSampledb();
		loadOk();
		h.resolveAdminMock.mockResolvedValue('not-admin');

		const { container } = render(AdminPage);
		await waitFor(() => {
			expect(q(container, 'admin-roles-no-access')).not.toBeNull();
		});
		expect(q(container, 'admin-invite-section')).toBeNull();
		expect(q(container, 'invite-admin-submit')).toBeNull();
		expect(h.createInviteMock).not.toHaveBeenCalled();
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
		h.resolveDatabaseEntityIdMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(cfg.db === 'ramkoor' ? 'org-ram' : 'org-poly')
		);
		const rendered = render(AdminPage);
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

		await fireEvent.click(submit);

		await waitFor(() => {
			expect(h.createInviteMock).toHaveBeenCalledTimes(1);
		});
		expect(h.createInviteMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'ramkoor' }),
			expect.objectContaining({ dbEntityId: 'org-ram' })
		);
		expect(h.createInviteMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ dbEntityId: 'org-poly' })
		);
	});

	it('the embedded surface never self-resolves the org — it adopts the page-resolved pair', async () => {
		await renderMergedReadyMulti();
		expect(h.resolveInviteParentMock).not.toHaveBeenCalled();
		expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'ramkoor' })
		);
	});
});

describe('#140 — backward compat for existing invite URLs', () => {
	it('externally-held invite links stay at /invite/<token> — the merge does not move the landing URL space', () => {
		expect(buildInviteUrl('https://mvox.app', 'tok-1')).toBe('https://mvox.app/invite/tok-1');
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
