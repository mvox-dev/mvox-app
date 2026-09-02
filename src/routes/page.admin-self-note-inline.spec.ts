// @vitest-environment happy-dom
//
// #175 RED — the self-removal note renders INLINE in the viewer's own admin
// row, not as a separate paragraph below the list.
//
// Mihkel's follow-up to #164 (2026-08-22): #164 removed the Remove button from
// the viewer's own row, but the explanatory note ("Enda õigusi ei saa
// eemaldada") renders as a separate <p> BELOW the <ul> — visually detached
// from the row it explains. The note must sit WHERE THE BUTTON WOULD BE:
// inside the viewer's own <li>, in the same {#each} iteration that renders
// every other admin's Remove button.
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   src/routes/admin/+page.svelte, admins section, ready state:
//     • admin-roles-admins-self-hint — SAME testid as today (so the #147
//       visible-reason coverage in page.admin.spec.ts keeps holding), but its
//       POSITION changes: it lives INSIDE the viewer's own list item
//       (admin-entry-<viewerId>), i.e. hint.closest('li') IS the own row.
//     • NO separate note below the list: the admins section renders no
//       direct-child <p> carrying the self-hint message — the only place the
//       text appears is inside the own <li>.
//     • the note occupies the button slot: the own row holds the note and no
//       <button>; every OTHER admin's row keeps its working Remove button.
//
// Route integration on purpose — renders the REAL /admin route component so
// the note cannot pass by existing only in an isolated snippet.
//
// Assertions match on testids + message KEYS (full-fallback paraglide proxy
// renders `[key]`), never translated sentences — same posture as
// page.admin-collective-name.spec.ts.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Full-fallback paraglide mock — every key renders `[key {params}]`.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

// Mock every data seam at its module boundary — same scaffolding as
// page.admin.spec.ts / page.admin-collective-name.spec.ts.
const h = vi.hoisted(() => ({
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
	// #209 — the section tree behind ROSTER ORDER; this file has no opinion on
	// picker ordering, so [] (every person Unassigned) keeps it out of the way.
	listSectionsMock: vi.fn(),
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
vi.mock('$lib/invite/inviteData', () => ({
	resolvePersonParentId: h.resolveParentMock,
	resolveInviteParentId: h.resolveInviteParentMock,
	createInvite: h.createInviteMock
}));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
// Sever the $env chain + goto — same discipline as page.admin.spec.ts.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './admin/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const CFG = { db: 'polyphony', token: 'jwt-admin' };
const SELF_HINT_KEY = '[admin_roles_remove_self_hint]';

// selectPolyphony() gives the viewer personId 'admin-p' — a row carrying that
// same id is HER OWN grant. Mihkel's live scenario: TWO owners (db-root +
// himself), so the last-owner guard stays out of the picture entirely.
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

function loadOk() {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	h.listAdminsMock.mockResolvedValue({ persons: [DB_ROOT, SELF_OWNER], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(ROSTER);
	h.listSectionsMock.mockResolvedValue([]);
	h.removeAdminMock.mockResolvedValue(undefined);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
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
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('/admin — #175 self-removal note renders inline in the own row', () => {
	it("route integration — the note sits INSIDE the viewer's own <li> (the same {#each} iteration as the other Remove buttons), where the button would otherwise be", async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();

		const selfRow = q<HTMLElement>(container, 'admin-entry-admin-p');
		expect(selfRow, "expected the viewer's own admin row to render").not.toBeNull();

		// #175 core: the note element is a DESCENDANT of the own list item.
		const hint = q<HTMLElement>(container, 'admin-roles-admins-self-hint');
		expect(hint, 'expected the self-removal note to render').not.toBeNull();
		expect(
			hint!.closest('li'),
			"expected the note to sit inside the viewer's own <li> — not outside the list"
		).toBe(selfRow);

		// It occupies the button slot: inside the <ul>, inside the row's own
		// {#each} iteration — never floating after the list.
		expect(hint!.closest('ul'), 'expected the note to live inside the admin <ul>').not.toBeNull();
	});

	it('route integration — NO separate note below the admin list: the section renders no direct-child paragraph carrying the self-hint message', async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();

		const adminsSection = q<HTMLElement>(container, 'admin-roles-admins');
		expect(adminsSection).not.toBeNull();

		// #164's shape — <section> > <p data-testid="admin-roles-admins-self-hint">
		// below the <ul> — must be GONE. Scan every element in the section that
		// carries the hint text: each one must be inside a <li>.
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

		// And specifically: no direct child of the section (the old <p> position)
		// carries the message.
		const directChildrenWithHint = Array.from(adminsSection!.children).filter((el) =>
			(el.textContent ?? '').includes(SELF_HINT_KEY) && el.tagName !== 'UL'
		);
		expect(
			directChildrenWithHint,
			'expected no separate note element below the admin list'
		).toEqual([]);
	});

	it("route integration — the note text shares the ROW with the admin's own name (one <li> holds both), and the row still offers no Remove control", async () => {
		selectPolyphony();
		loadOk();

		const { container } = await renderReady();

		const selfRow = q<HTMLElement>(container, 'admin-entry-admin-p');
		expect(selfRow).not.toBeNull();

		// Same row: name + note in ONE list item.
		expect(selfRow!.textContent).toContain('Mihkel Putrinš');
		expect(selfRow!.textContent).toContain(SELF_HINT_KEY);

		// #164 still holds: the note REPLACES the button, it does not join one.
		expect(q(selfRow!, 'admin-remove-admin-p')).toBeNull();
		expect(selfRow!.querySelector('button')).toBeNull();
	});

	it("route integration — other admins' rows keep their working Remove button next to the note-bearing own row: rendered, enabled, click reaches removeAdmin", async () => {
		selectPolyphony();
		loadOk();
		h.listAdminsMock
			.mockReset()
			.mockResolvedValueOnce({ persons: [DB_ROOT, SELF_OWNER, BELA], canManage: true })
			.mockResolvedValueOnce({ persons: [DB_ROOT, SELF_OWNER], canManage: true });

		const { container } = await renderReady();
		await waitFor(() => {
			expect(q(container, 'admin-entry-p-bela')).not.toBeNull();
		});

		// The OTHER rows carry no note and a working button.
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

		// After the refetch the own row survives — note inline, still buttonless.
		await waitFor(() => {
			expect(q(container, 'admin-entry-p-bela')).toBeNull();
		});
		const selfRow = q<HTMLElement>(container, 'admin-entry-admin-p')!;
		expect(selfRow.textContent).toContain(SELF_HINT_KEY);
		expect(selfRow.querySelector('button')).toBeNull();
	});
});

// (*MVOX:Tallis* — #175 RED: self-removal note inline in the own row)
