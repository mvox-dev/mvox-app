// @vitest-environment happy-dom
//
// #469 — the ADMIN ROLES page (`src/routes/admin/+page.svelte`) obeys
// `roster_show_real_names`.
//
// HISTORY, named not deleted: this file was the #269 SCOPE FENCE under Henry's
// 2026-09-06 roster-only ruling. Mihkel's #469 word (2026-09-23, issue body:
// "all places we are showing member names and they all must obey the admin
// setting") SUPERSEDES that ruling, so the fence FLIPS to the conditional
// contract. This page consumes the SHARED `loadRoster`: its rows feed
// `rosterOrder(roster, sections)` for the add-admin/add-librarian <select>s and
// ride into `<InviteSurface roster={roster}>` whose person select renders
// `p.name` per option — one producer, three pickers.
//
// The wire ($lib/testing/realNamesFence) keeps both sides non-vacuous:
// `_type.string=database` RESOLVES, the toggle is a REAL read answer (true or
// false), named `admin_member_record`s are served either way, and the person
// join-state read answers 'absent' so the invite person select renders.
//
// Pinned: (a) toggle ON → the add-admin picker's AND the invite person
// picker's option labels are the REAL names, in displayed-name order, with the
// profile names nowhere on the page; ONE toggle read + ONE records read for the
// whole load; (b) toggle OFF → the reverse: profile names, ZERO
// `admin_member_record` requests, the toggle itself read once.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const h = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	resolveAdminMock: vi.fn(),
	resolveOwnerTierMock: vi.fn(),
	resolveLibrarianMock: vi.fn(),
	listSectionsMock: vi.fn(),
	resolveParentMock: vi.fn(),
	createInviteMock: vi.fn(),
	resolveCollectiveNameMarkerMock: vi.fn(),
	updateCollectiveNameMock: vi.fn()
}));

// Everything EXCEPT the roster producer and the database-entity resolve is
// mocked at its own module boundary, so the only traffic on the stubbed wire is
// the roster load this file is about. `$lib/roster/rosterData` and
// `$lib/collective/databaseEntity` deliberately run for real.
vi.mock('$lib/admin/roleManagement', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/admin/roleManagement')>()),
	listAdmins: h.listAdminsMock,
	addAdmin: vi.fn(),
	removeAdmin: vi.fn(),
	listLibrarians: h.listLibrariansMock,
	addLibrarian: vi.fn(),
	removeLibrarian: vi.fn()
}));
vi.mock('$lib/nav/adminStore', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/nav/adminStore')>()),
	resolveAdmin: h.resolveAdminMock,
	// #469 — InviteSurface's person select renders only for a confirmed owner;
	// the tier itself is out of this file's scope, so it is mocked to 'owner'.
	resolveOwnerTier: h.resolveOwnerTierMock
}));
vi.mock('$lib/library/librarianStore', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/library/librarianStore')>()),
	resolveLibrarian: h.resolveLibrarianMock
}));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: h.listSectionsMock
}));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/invite/inviteData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/invite/inviteData')>()),
	resolvePersonParentId: h.resolveParentMock,
	createInvite: h.createInviteMock
}));
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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	realNamesWire,
	PROFILE_NAMES,
	REAL_NAMES,
	DB_ENTITY_ID,
	MEMBER_PERSON
} from '$lib/testing/realNamesFence';

function selectSampledb() {
	setToken('jwt-admin');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

beforeEach(() => {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveOwnerTierMock.mockResolvedValue('owner');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	h.listAdminsMock.mockResolvedValue({ persons: [], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.listSectionsMock.mockResolvedValue([]);
	h.resolveParentMock.mockResolvedValue(DB_ENTITY_ID);
	h.createInviteMock.mockResolvedValue({ personId: 'p', memberId: 'm', inviteToken: 'a.b.c' });
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	resetTypeIdCache();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

async function renderReady(): Promise<HTMLElement> {
	selectSampledb();
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="admin-add-admin-select"]')).not.toBeNull();
	});
	await waitFor(() => {
		const select = container.querySelector(
			'[data-testid="admin-add-admin-select"]'
		) as HTMLSelectElement;
		expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
	});
	return container;
}

function addAdminLabels(container: HTMLElement): string[] {
	const select = container.querySelector(
		'[data-testid="admin-add-admin-select"]'
	) as HTMLSelectElement;
	return [...select.querySelectorAll('option')]
		.map((o) => (o.textContent ?? '').trim())
		.filter((t) => t !== '' && !t.startsWith('admin_roles_') && !t.startsWith('picker_'));
}

function invitePersonLabels(container: HTMLElement): string[] {
	const select = container.querySelector(
		'[data-testid="invite-person-select"]'
	) as HTMLSelectElement;
	return [...select.querySelectorAll('option')]
		.map((o) => (o.textContent ?? '').trim())
		.filter((t) => t !== '' && t !== 'admin_invite_person_new');
}

describe('#469 — the ADMIN ROLES page obeys roster_show_real_names (supersedes the #269 roster-only ruling)', () => {
	it('toggle ON: the add-admin picker AND the invite person picker offer the REAL names, in displayed-name order — the profile names appear nowhere on the page', async () => {
		realNamesWire();
		const container = await renderReady();

		// Displayed-name order: Aaron Aardvark (m2) sorts before Zoe Zeta (m1) —
		// profile order (Alice, Berta) would have kept m1 first, so the order
		// itself proves the rows were re-sorted by what they display.
		expect(addAdminLabels(container)).toEqual([REAL_NAMES.m2, REAL_NAMES.m1]);

		// The invite person select renders the SAME rows (roster prop → p.name).
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-person-select"]')).not.toBeNull();
		});
		expect(invitePersonLabels(container)).toEqual([REAL_NAMES.m2, REAL_NAMES.m1]);

		expect(container.textContent).not.toContain(PROFILE_NAMES.m1);
		expect(container.textContent).not.toContain(PROFILE_NAMES.m2);
	});

	it('toggle ON: ONE roster_show_real_names read and ONE admin_member_record read across the whole load — the overlay rides the page\'s one loadRoster call', async () => {
		const fetchMock = realNamesWire();
		const container = await renderReady();
		expect(addAdminLabels(container)).toEqual([REAL_NAMES.m2, REAL_NAMES.m1]);

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(urls.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
	});

	it('toggle OFF: both pickers keep the PROFILE names, the record names appear nowhere, ZERO admin_member_record requests — and the toggle itself IS read (once)', async () => {
		const fetchMock = realNamesWire({ toggle: false });
		const container = await renderReady();

		expect(addAdminLabels(container)).toEqual([PROFILE_NAMES.m1, PROFILE_NAMES.m2]);
		await waitFor(() => {
			expect(container.querySelector('[data-testid="invite-person-select"]')).not.toBeNull();
		});
		expect(invitePersonLabels(container)).toEqual([PROFILE_NAMES.m1, PROFILE_NAMES.m2]);
		expect(container.textContent).not.toContain(REAL_NAMES.m1);
		expect(container.textContent).not.toContain(REAL_NAMES.m2);

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
	});

	// ── #469 review F1: the Admins LIST itself, not just the pickers ──────────
	//
	// Every test above mocks `listAdmins` outright, so the page renders whatever
	// the mock hands back and the name-resolution code never runs. Asserting a
	// rendered Admins row against that mock would pin the mock, not the app.
	// These two delegate to the REAL `listAdmins` and feed it a rights read
	// whose baked `.string` is deliberately the PROFILE name — so the row can
	// only read a real name if `resolveNamesFromRoster` overrode `.string` with
	// what the page's own overlaid roster says.
	//
	// The viewer's own `_owner` value rides along so `canManage` stays true and
	// the pickers still render; it is not a roster member, so it changes no
	// option list.
	async function delegateListAdminsToReal(): Promise<void> {
		const actual =
			await vi.importActual<typeof import('$lib/admin/roleManagement')>(
				'$lib/admin/roleManagement'
			);
		const rightsFetch = (async () =>
			new Response(
				JSON.stringify({
					entity: {
						_owner: [
							{ _id: 'v-viewer', reference: 'admin-p', entity_type: 'person' },
							{
								_id: 'v-m1',
								reference: MEMBER_PERSON.m1,
								string: PROFILE_NAMES.m1,
								entity_type: 'person'
							}
						]
					}
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)) as unknown as typeof fetch;
		h.listAdminsMock.mockImplementation(
			(
				cfg: Parameters<typeof actual.listAdmins>[0],
				dbEntityId: string,
				viewerId: string,
				_fetchImpl: typeof fetch,
				roster: Parameters<typeof actual.listAdmins>[4]
			) => actual.listAdmins(cfg, dbEntityId, viewerId, rightsFetch, roster)
		);
	}

	function adminRow(container: HTMLElement): HTMLElement | null {
		return container.querySelector(`[data-testid="admin-entry-${MEMBER_PERSON.m1}"]`);
	}

	// THE discriminating case: `.string` says Alice, the roster says Zoe, and
	// the row must say Zoe. Drop the override and this is the test that fails.
	it('toggle ON: the Admins row is named from the overlaid roster, NOT from the rights value\'s baked `.string`', async () => {
		await delegateListAdminsToReal();
		realNamesWire();
		const container = await renderReady();

		const row = adminRow(container);
		expect(row, 'Admins row for m1').not.toBeNull();
		expect(row?.textContent).toContain(REAL_NAMES.m1);
		expect(row?.textContent).not.toContain(PROFILE_NAMES.m1);
	});

	// The accepted side effect, pinned as characterization rather than as a
	// discriminator: here `.string` and the roster BOTH say Alice, so this row
	// reads the same with or without the override. What it holds down is that
	// the role list tracks the toggle like every other surface — no real name
	// leaks through the rights value when the toggle is off, and no raw id
	// appears in place of a name.
	it('toggle OFF: the same Admins row reads the PROFILE name — the roster still wins, it just carries profile names now', async () => {
		await delegateListAdminsToReal();
		realNamesWire({ toggle: false });
		const container = await renderReady();

		const row = adminRow(container);
		expect(row, 'Admins row for m1').not.toBeNull();
		expect(row?.textContent).toContain(PROFILE_NAMES.m1);
		expect(row?.textContent).not.toContain(REAL_NAMES.m1);
		expect(row?.textContent).not.toContain(MEMBER_PERSON.m1);
	});
});

// (*MVOX:Palestrina* — #269 review F1/F2: admin-roles scope fence)
// (*MVOX:Tallis* — #469 RED: fence flipped to the conditional contract, invite picker pinned too)
