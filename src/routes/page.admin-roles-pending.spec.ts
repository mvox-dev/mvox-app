// @vitest-environment happy-dom
//
// #325 RED — pending guard on the /admin role add/remove surface (the
// ADMIN/LIBRARIAN half of the issue). Contract: issue #325 + Gama's
// 2026-09-11 `ready` ruling.
//
// WHY THIS HALF'S GUARD IS CORRECTNESS, NOT COSMETICS — the writes here are
// REAL direct rights-tier grants (roleManagement.ts: addAdmin/addLibrarian
// POST `_owner`/`_editor` values via grantEditor + delete stale ids), so
// concurrent writes race Entu's replacement semantics. Citing the rights doc
// by stable id per ER-16 (docs/architecture/entu-rights-and-visibility-model.md),
// quoted whole:
//
//   ER-6 — "A reference can hold at most one active direct rights-tier grant
//   per entity. Granting a new direct tier (`_owner`/`_editor`/`_viewer`/
//   `_expander`) for a reference that already holds a direct tier on that
//   same entity retires (soft-deletes) the old one — even via a bare,
//   independent POST carrying no prior `_id`." Qualifications: ER-8, ER-9.
//
//   ER-9 — "Since entity CREATE grants the creating caller `_owner` as one
//   direct document (ER-5), a later explicit grant of any other direct tier
//   to that same caller on that same entity replaces it (ER-6) and silently
//   demotes the creator from owner — the replace happens with no error and
//   no notice."
//
// So a double-tap that fires two concurrent direct-grant writes for the same
// reference on the same entity races the replacement: the second to land
// silently wins, with no error and no notice. The guard must make a
// concurrent grant write IMPOSSIBLE, not merely unlikely.
//
// PINNED CONTRACT (per issue #325's done-when + the inventory's four-state
// table, docs/qa/autosave-field-inventory.md):
//   - a role write in flight disables the person <select>s AND the remove
//     buttons — and the HANDLERS refuse a second write regardless of the
//     `disabled` attribute (wire-level: exactly one call), because a
//     `disabled` control while pending is a double-tap guard, not a state
//     signal, and fireEvent reaches listeners regardless of `disabled`;
//   - pending is VISIBLE: a caveat-slot paragraph (#321's precedent shape —
//     the same slot the partial/order notices use), role="status",
//     data-testid="admin-roles-pending-notice", text admin_roles_saving —
//     present exactly while a write is in flight;
//   - saved is ANNOUNCED: a PERSISTENT role="status" region (#267 shape —
//     same-node text change fires aria-live),
//     data-testid="admin-roles-status", empty at rest, announcing
//     admin_roles_saved after a successful write;
//   - failure text KEPT byte-identical: the existing
//     admin-roles-action-error role="alert" node with
//     admin_roles_action_error, controls re-enabled for retry.
//
// Messages are mocked leniently (Proxy → key name), so every text assertion
// pins the KEY — the byte-identity of the copy itself is messages/*.json's,
// pinned by src/lib/i18n/pendingGuardKeys.spec.ts.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>) =>
					params === undefined ? String(key) : `${String(key)} ${JSON.stringify(params)}`
		}
	)
}));

// Mock every data seam at its module boundary — same set as page.admin.spec.ts.
const h = vi.hoisted(() => {
	class RoleLockoutError extends Error {
		readonly code = 'role-lockout';
		constructor(entityId: string, personId: string) {
			super(`lockout ${entityId}/${personId}`);
			this.name = 'RoleLockoutError';
		}
	}
	class RoleGrantMissingError extends Error {
		readonly code = 'role-grant-missing';
		constructor(entityId: string, personId: string) {
			super(`missing ${entityId}/${personId}`);
			this.name = 'RoleGrantMissingError';
		}
	}
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
	return {
		RoleLockoutError,
		RoleGrantMissingError,
		InviteCreateError,
		listAdminsMock: vi.fn(),
		addAdminMock: vi.fn(),
		removeAdminMock: vi.fn(),
		listLibrariansMock: vi.fn(),
		addLibrarianMock: vi.fn(),
		removeLibrarianMock: vi.fn(),
		resolveAdminMock: vi.fn(),
		resolveOwnerTierMock: vi.fn().mockResolvedValue('error'),
		resolveLibrarianMock: vi.fn(),
		resolveDatabaseEntityIdMock: vi.fn(),
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		resolveParentMock: vi.fn(),
		resolveInviteParentMock: vi.fn(),
		createInviteMock: vi.fn(),
		listJoinStatesMock: vi.fn().mockResolvedValue({}),
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
	resolveAdmin: h.resolveAdminMock,
	resolveOwnerTier: h.resolveOwnerTierMock
}));
vi.mock('$lib/library/librarianStore', () => ({
	resolveLibrarian: h.resolveLibrarianMock
}));
vi.mock('$lib/profile/linkedIdentities', () => ({
	listJoinStates: h.listJoinStatesMock
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

import Page from './admin/+page.svelte';
import type { RolePerson } from '$lib/admin/roleManagement';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';

const ANNA = { id: 'p-anna', name: 'Anna Arro', role: 'owner' as const, valueIds: ['pv-own-anna'] };
const BELA = {
	id: 'p-bela',
	name: 'Bela Brauer',
	role: 'editor' as const,
	valueIds: ['pv-ed-bela']
};
const CILLA = {
	id: 'p-cilla',
	name: 'Cilla Cane',
	role: 'editor' as const,
	valueIds: ['pv-ed-cilla']
};

function listing(persons: RolePerson[], canManage = true) {
	return { persons, canManage };
}

const ROSTER = [
	{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' },
	{ memberId: 'm-2', personId: 'p-bela', name: 'Bela Brauer', email: '' },
	{ memberId: 'm-3', personId: 'p-cilla', name: 'Cilla Cane', email: '' },
	{ memberId: 'm-4', personId: 'p-dora', name: 'Dora Duncan', email: '' }
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
	h.listAdminsMock.mockResolvedValue(listing([ANNA, BELA]));
	h.listLibrariansMock.mockResolvedValue(listing([CILLA]));
	h.loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	h.listSectionsMock.mockResolvedValue([]);
	h.addAdminMock.mockResolvedValue(undefined);
	h.addLibrarianMock.mockResolvedValue(undefined);
	h.removeAdminMock.mockResolvedValue(undefined);
	h.removeLibrarianMock.mockResolvedValue(undefined);
	h.resolveParentMock.mockResolvedValue('parent-1');
	h.resolveInviteParentMock.mockResolvedValue('org-1');
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
	h.resolveOwnerTierMock.mockResolvedValue('error');
	h.listJoinStatesMock.mockResolvedValue({});
}

function q<T extends HTMLElement>(root: ParentNode, testid: string): T | null {
	return root.querySelector(`[data-testid="${testid}"]`) as T | null;
}

async function renderReady() {
	const rendered = render(Page);
	await waitFor(() => {
		expect(q(rendered.container, 'admin-roles-admins')).not.toBeNull();
		expect(q(rendered.container, 'admin-roles-librarians')).not.toBeNull();
	});
	return rendered;
}

function adminSelect(container: HTMLElement): HTMLSelectElement {
	const select = q<HTMLSelectElement>(container, 'admin-add-admin-select');
	expect(select, 'expected admin-add-admin-select').not.toBeNull();
	return select!;
}

function librarianSelect(container: HTMLElement): HTMLSelectElement {
	const select = q<HTMLSelectElement>(container, 'admin-add-librarian-select');
	expect(select, 'expected admin-add-librarian-select').not.toBeNull();
	return select!;
}

async function pick(select: HTMLSelectElement, personId: string): Promise<void> {
	await fireEvent.change(select, { target: { value: personId } });
}

/** A promise the test settles by hand — the in-flight window under test. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
	let resolve!: (v: T) => void;
	let reject!: (e: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	loadOk();
	selectPolyphony();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
});

// ── the four states exist as DOM facts ─────────────────────────────────────────

describe('#325 admin/librarian — four states at rest (not yet attempted)', () => {
	it('ready page: PERSISTENT empty role="status" region (admin-roles-status, #267 same-node shape), NO pending notice, NO action error', async () => {
		const { container } = await renderReady();

		// The saved-announcement region is persistent so aria-live fires on a
		// text CHANGE of a mounted node, never on a fresh mount.
		const status = q(container, 'admin-roles-status');
		expect(status, 'expected the persistent admin-roles-status region').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.textContent?.trim()).toBe('');

		expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		expect(q(container, 'admin-roles-action-error')).toBeNull();

		// Controls enabled at rest.
		expect(adminSelect(container).disabled).toBe(false);
		expect(librarianSelect(container).disabled).toBe(false);
		expect((q<HTMLButtonElement>(container, 'admin-remove-p-bela') as HTMLButtonElement).disabled).toBe(
			false
		);
	});
});

// ── the guard: a write in flight disables the controls and refuses a second write ──

describe('#325 admin/librarian — a grant write in flight disables the surface (ER-6/ER-9 race closed)', () => {
	it('add-admin in flight: BOTH selects and the remove buttons disable; the visible saving notice (caveat-slot paragraph, role="status") shows; a second pick fires NO second grant write; settle → re-enabled, notice gone, saved announced', async () => {
		const d = deferred<undefined>();
		h.addAdminMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		await pick(adminSelect(container), 'p-cilla');
		expect(h.addAdminMock).toHaveBeenCalledTimes(1);

		// Pending is VISIBLE (the caveat-slot paragraph shape, #321 precedent) —
		// `disabled` alone is a double-tap guard, not a state signal
		// (docs/qa/autosave-field-inventory.md).
		await waitFor(() => {
			const notice = q(container, 'admin-roles-pending-notice');
			expect(notice, 'expected the visible pending notice while the write is in flight').not.toBeNull();
			expect(notice!.getAttribute('role')).toBe('status');
			expect(notice!.textContent).toContain('admin_roles_saving');
		});

		// The whole role surface guards: the select that fired, its sibling
		// select, and every remove button — any of them could otherwise fire a
		// concurrent direct-grant write into the ER-6 replacement race.
		expect(adminSelect(container).disabled).toBe(true);
		expect(librarianSelect(container).disabled).toBe(true);
		expect(
			(q<HTMLButtonElement>(container, 'admin-remove-p-bela') as HTMLButtonElement).disabled
		).toBe(true);
		expect(
			(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla') as HTMLButtonElement).disabled
		).toBe(true);

		// WIRE-LEVEL: the handler itself refuses — fireEvent reaches the
		// listener regardless of the `disabled` attribute, exactly like a
		// double-tap racing the attribute flip. NO concurrent grant write.
		await pick(adminSelect(container), 'p-dora');
		expect(h.addAdminMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'admin-remove-p-bela') as HTMLElement);
		expect(h.removeAdminMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		});
		expect(adminSelect(container).disabled).toBe(false);
		expect(librarianSelect(container).disabled).toBe(false);

		// Saved is ANNOUNCED on the persistent region.
		await waitFor(() => {
			expect(q(container, 'admin-roles-status')?.textContent).toContain('admin_roles_saved');
		});

		// The guard releases: a next write is possible after settle.
		await pick(adminSelect(container), 'p-dora');
		expect(h.addAdminMock).toHaveBeenCalledTimes(2);
	});

	it('remove-admin double-tap fires EXACTLY ONE revoke write; while it is in flight a pick fires NO grant write; settle → saved announced', async () => {
		const d = deferred<undefined>();
		h.removeAdminMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		const removeBela = q<HTMLButtonElement>(container, 'admin-remove-p-bela') as HTMLButtonElement;
		await fireEvent.click(removeBela);
		await fireEvent.click(removeBela);
		expect(h.removeAdminMock).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});
		expect(adminSelect(container).disabled).toBe(true);

		// The select is part of the same race surface: a grant for the person
		// being removed, landing second, would silently win (ER-6).
		await pick(adminSelect(container), 'p-cilla');
		expect(h.addAdminMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'admin-roles-status')?.textContent).toContain('admin_roles_saved');
		});
	});

	it('librarian half carries the SAME guard: add-librarian in flight disables its select and remove button, a second pick fires no second write, saved announced on settle', async () => {
		const d = deferred<undefined>();
		h.addLibrarianMock.mockReturnValue(d.promise);
		const { container } = await renderReady();

		await pick(librarianSelect(container), 'p-anna');
		expect(h.addLibrarianMock).toHaveBeenCalledTimes(1);

		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});
		expect(librarianSelect(container).disabled).toBe(true);
		expect(
			(q<HTMLButtonElement>(container, 'librarian-remove-p-cilla') as HTMLButtonElement).disabled
		).toBe(true);

		await pick(librarianSelect(container), 'p-dora');
		expect(h.addLibrarianMock).toHaveBeenCalledTimes(1);
		await fireEvent.click(q(container, 'librarian-remove-p-cilla') as HTMLElement);
		expect(h.removeLibrarianMock).not.toHaveBeenCalled();

		d.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'admin-roles-status')?.textContent).toContain('admin_roles_saved');
		});
	});
});

// ── failure: the existing surfacing is KEPT byte-identical, plus retry ─────────

describe('#325 admin/librarian — failure text kept, controls re-enabled for retry', () => {
	it('a rejected add keeps the EXISTING admin-roles-action-error role="alert" (admin_roles_action_error), drops the pending notice, announces NO saved, and re-enables the controls — a retry write fires', async () => {
		const d = deferred<undefined>();
		h.addAdminMock.mockReturnValueOnce(d.promise);
		const { container } = await renderReady();

		await pick(adminSelect(container), 'p-cilla');
		await waitFor(() => {
			expect(q(container, 'admin-roles-pending-notice')).not.toBeNull();
		});

		d.reject(new Error('grant rejected'));
		await waitFor(() => {
			const alert = q(container, 'admin-roles-action-error');
			expect(alert, 'expected the existing failure node, unchanged').not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('admin_roles_action_error');
		});
		expect(q(container, 'admin-roles-pending-notice')).toBeNull();
		expect(q(container, 'admin-roles-status')?.textContent ?? '').not.toContain(
			'admin_roles_saved'
		);
		expect(adminSelect(container).disabled).toBe(false);

		// Retry is live: the guard released on failure too.
		await pick(adminSelect(container), 'p-cilla');
		expect(h.addAdminMock).toHaveBeenCalledTimes(2);
	});
});

// (*MVOX:Tallis* — #325 RED)
