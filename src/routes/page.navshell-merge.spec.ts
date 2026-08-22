// @vitest-environment happy-dom
//
// #140/S3 RED — NavShell tab merge: the separate "Invite" and "Admin" nav
// entries collapse into a SINGLE admin-only "Admin" tab (Mihkel ruling). Nav
// goes 7 → 6 top-level entries, fixing the narrow-viewport overflow by design.
// Contract:
//
// - NAV_ENTRIES (the REAL list the root layout hands to NavShell) carries no
//   'invite' entry any more: 6 entries total, exactly one of them admin-only
//   and routing to /admin
// - NavShell (the ACTUAL component, fed the ACTUAL entries — integration, not
//   fixtures) renders exactly 6 entries for a full-context admin
//   (isAdmin + hasMultipleCollectives) and never an /admin/invite entry
// - non-admins see neither Admin nor any invite affordance (4 entries:
//   agenda, roster, profile, library)
// - active-route matching: the Admin tab is the single highlighted entry on
//   BOTH /admin and /admin/invite (longest-wins prefix matching — previously
//   the separate Invite entry stole /admin/invite)
// - the /admin route (actual page component) contains BOTH the role-management
//   surface (#134) AND the invite functionality, the latter inside a
//   data-testid="admin-invite-section" wrapper whose create affordance is the
//   existing invite-admin-submit control — and it is LIVE (a submit reaches
//   createInvite and surfaces the minted /invite/<token> link), not a
//   skin-only placeholder
// - non-admin / no-access renders NO invite functionality on /admin either
// - backward compat: externally-held invite links live at /invite/<token>
//   (buildInviteUrl — covered standalone by page.invite-landing.spec.ts) and
//   are NOT this merge's to move; the old admin surface URL /admin/invite must
//   not dead-end — it either redirects to /admin or still renders the invite
//   surface standalone
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── paraglide: ONE factory for BOTH import shapes ──────────────────────────────
// entries.ts does `import * as m from '$lib/paraglide/messages'` (namespace →
// needs real named exports); the admin + invite pages do
// `import { m } from '$lib/paraglide/messages.js'` (an `m` object). The nav
// labels are pinned (they are asserted on); everything else answers through a
// Proxy so this spec does not have to enumerate two pages' message catalogs.
const msgs = vi.hoisted(() => {
	const nav = {
		nav_agenda: () => 'Agenda',
		nav_roster: () => 'Roster',
		nav_profile: () => 'Profile',
		nav_library: () => 'Library',
		nav_invite: () => 'Invite',
		nav_admin: () => 'Admin',
		nav_collectives: () => 'Collectives'
	};
	const anyMessage = new Proxy({} as Record<string, (...args: unknown[]) => string>, {
		get: (_t, prop) => {
			if (prop in nav) return nav[prop as keyof typeof nav];
			return () => `[${String(prop)}]`;
		}
	});
	return { nav, anyMessage };
});
vi.mock('$lib/paraglide/messages', () => ({ ...msgs.nav, m: msgs.anyMessage }));
vi.mock('$lib/paraglide/messages.js', () => ({ ...msgs.nav, m: msgs.anyMessage }));

// ── data seams, mocked at their module boundaries ──────────────────────────────
// Same discipline as page.admin.spec.ts + page.admin-invite.spec.ts — this spec
// renders BOTH surfaces (the merged /admin page must carry both), so it mocks
// the union of their seams. Error classes live INSIDE the hoisted block so the
// pages' `instanceof` checks match.
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
		// role management (#134)
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
		// invite (#31/T4.5)
		resolveParentMock: vi.fn(),
		resolveOrgMock: vi.fn(),
		createInviteMock: vi.fn(),
		// #165 — the merged /admin page's `load()` also resolves the
		// collective-name marker. Mocked here purely as scaffolding.
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
// #165 scaffolding (see the hoisted mock's comment above).
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/invite/inviteData', () => ({
	InviteCreateError: h.InviteCreateError,
	resolvePersonParentId: h.resolveParentMock,
	resolveOrgId: h.resolveOrgMock,
	createInvite: h.createInviteMock
}));
// Sever the $env chain the collectives store pulls in (discover → marker →
// entu-config) and the store's `goto` import.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { goto } from '$app/navigation';
import NavShell from '$lib/components/nav/NavShell.svelte';
import { NAV_ENTRIES } from '$lib/nav/entries';
import { buildInviteUrl } from '$lib/invite/invite-links';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import AdminPage from './admin/+page.svelte';
import AdminInvitePage from './admin/invite/+page.svelte';

// `children` is a required Snippet prop on NavShell — same stand-in as
// NavShell.spec.ts.
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

function selectPolyphony() {
	setToken('jwt-admin');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'admin-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] };

function loadOk() {
	// role management ready
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue([
		{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }
	]);
	// invite prerequisites ready
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveOrgMock.mockResolvedValue('org-1');
	h.createInviteMock.mockResolvedValue({ inviteToken: 'tok-123' });
	// #165 scaffolding — benign resolution, see the hoisted mock's comment.
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
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
		h.resolveParentMock,
		h.resolveOrgMock,
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
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

// ── the entry list itself ───────────────────────────────────────────────────────

describe('#140 — NAV_ENTRIES after the merge', () => {
	it('carries exactly 6 entries — the separate invite entry is gone', () => {
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

// ── NavShell rendering the REAL entries (integration) ───────────────────────────

describe('#140 — NavShell × real NAV_ENTRIES', () => {
	it('renders exactly 6 top-level nav entries for a full-context admin (not 7)', () => {
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

	it('hides the Admin entry from non-admins — 4 member entries, no admin affordance', () => {
		const { container, queryByText } = renderShell({ isAdmin: false });
		expect(queryByText('Admin')).toBeNull();
		expect(queryByText('Invite')).toBeNull();
		expect(navAnchors(container).map((a) => a.getAttribute('href'))).toEqual([
			'/',
			'/roster',
			'/profile',
			'/library'
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

// ── the merged /admin surface (actual page component — integration) ─────────────

describe('#140 — /admin carries BOTH role management AND invite functionality', () => {
	async function renderMergedReady() {
		selectPolyphony();
		loadOk();
		const rendered = render(AdminPage);
		await waitFor(() => {
			// role management (#134) is still there…
			expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
			expect(q(rendered.container, 'admin-roles-librarians')).not.toBeNull();
			// …and the invite surface now lives INSIDE the same page.
			expect(q(rendered.container, 'admin-invite-section')).not.toBeNull();
		});
		return rendered;
	}

	it('ready: the invite section renders inside /admin, carrying the invite create affordance', async () => {
		const { container } = await renderMergedReady();
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		// The create control lives INSIDE the invite section — the existing
		// invite-admin-submit contract, now reachable from /admin.
		expect(q(inviteSection, 'invite-admin-submit')).not.toBeNull();
	});

	it('the embedded invite heading sits UNDER the page h1 — a section h2, not a second page title (review F2)', async () => {
		const { container } = await renderMergedReady();
		expect(container.querySelectorAll('h1')).toHaveLength(1);
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		expect(inviteSection.querySelector('h1')).toBeNull();
		expect(inviteSection.querySelector('h2')).not.toBeNull();
	});

	it('the embedded invite surface is LIVE: submitting mints an invite via createInvite and shows the /invite/<token> link', async () => {
		const { container } = await renderMergedReady();
		const inviteSection = q<HTMLElement>(container, 'admin-invite-section')!;
		const submit = q<HTMLButtonElement>(inviteSection, 'invite-admin-submit')!;
		await waitFor(() => {
			expect(submit.disabled).toBe(false);
		});

		await fireEvent.click(submit);

		await waitFor(() => {
			expect(h.createInviteMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'polyphony' }),
				expect.objectContaining({ orgId: expect.any(String) })
			);
		});
		// The minted link surfaces — the external URL shape /invite/<token> is
		// untouched by the merge.
		await waitFor(() => {
			const link = q<HTMLInputElement>(container, 'invite-link');
			expect(link).not.toBeNull();
			expect(link!.value).toContain('/invite/tok-123');
		});
	});

	it('non-admin (no-access): NO invite functionality renders on /admin either', async () => {
		selectPolyphony();
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

// ── multi-collective: the embedded surface may not re-target its db ────────────
//
// Review F1 — the embedded (controlled) invite surface used to render its own
// collective picker while blocking the org re-resolution that picker depends
// on: switching it moved the write's `db` to collective B while `orgId` stayed
// the parent's org of collective A, minting a member parented under an entity
// id that does not exist in B (silently orphaned — the TU.1/#109 failure
// class). Multi-collective is first class (NAV_ENTRIES carries a
// hasMultipleCollectives-gated 'collectives' entry), so it gets a spec.

function selectRamkoorOfTwo() {
	setToken('jwt-admin');
	collectiveState.set({
		status: 'ready',
		collectives: [
			{ db: 'polyphony', name: 'Polyphony', personId: 'admin-p' },
			{ db: 'ramkoor', name: 'RAM Koor', personId: 'admin-p2' }
		],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('ramkoor');
}

describe('#140 — embedded invite surface with MULTIPLE collectives', () => {
	async function renderMergedReadyMulti() {
		selectRamkoorOfTwo();
		loadOk();
		// Org ids are per-database — an org id from one collective is meaningless
		// (and unresolvable) in another.
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

	it('submits against the SELECTED collective — db and orgId always come from the same collective', async () => {
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
			expect.objectContaining({ orgId: 'org-ram' })
		);
		// Never the OTHER collective's org — the mismatched pair that silently
		// orphans the created member.
		expect(h.createInviteMock).not.toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ orgId: 'org-poly' })
		);
	});

	it('the embedded surface never self-resolves the org — it adopts the page-resolved pair', async () => {
		await renderMergedReadyMulti();
		expect(h.resolveOrgMock).not.toHaveBeenCalled();
		expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalledWith(
			expect.objectContaining({ db: 'ramkoor' })
		);
	});
});

// ── backward compat ─────────────────────────────────────────────────────────────

describe('#140 — backward compat for existing invite URLs', () => {
	it('externally-held invite links stay at /invite/<token> — the merge does not move the landing URL space', () => {
		// Minted links (the only invite URLs that leave the app) are built by
		// buildInviteUrl; the landing route itself is covered by
		// page.invite-landing.spec.ts. This pins the URL shape the merge must
		// not touch.
		expect(buildInviteUrl('https://mvox.app', 'tok-1')).toBe('https://mvox.app/invite/tok-1');
	});

	it('/admin/invite does not dead-end: it redirects to /admin OR still renders the invite surface standalone', async () => {
		selectPolyphony();
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
