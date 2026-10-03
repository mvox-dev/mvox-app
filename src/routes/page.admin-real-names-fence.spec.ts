// @vitest-environment happy-dom
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
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	realNamesWire,
	PROFILE_NAMES,
	REAL_NAMES,
	DB_ENTITY_ID,
	MEMBER_PERSON
} from '$lib/testing/realNamesFence';
import { expectNameMarkedOnce, expectWholeTextMarkedOnce } from '$lib/testing/nameMarker';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function selectSampledb() {
	signIn({ token: 'jwt-admin', collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'admin-p' }] });
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
	resetAppState();
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

		expect(addAdminLabels(container)).toEqual([REAL_NAMES.m2, REAL_NAMES.m1]);

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

	const STALE_GRANT_NAME = 'Bakhed Atgranttime';

	async function delegateListAdminsToReal(bakedName: string): Promise<void> {
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
								string: bakedName,
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

	it('toggle ON: the Admins row is named from the overlaid roster, NOT from the rights value\'s baked `.string`', async () => {
		await delegateListAdminsToReal(PROFILE_NAMES.m1);
		realNamesWire();
		const container = await renderReady();

		const row = adminRow(container);
		expect(row, 'Admins row for m1').not.toBeNull();
		expect(row?.textContent).toContain(REAL_NAMES.m1);
		expect(row?.textContent).not.toContain(PROFILE_NAMES.m1);
	});

	it('toggle OFF: the same Admins row reads the PROFILE name — the roster wins unconditionally, it just carries profile names now', async () => {
		await delegateListAdminsToReal(STALE_GRANT_NAME);
		realNamesWire({ toggle: false });
		const container = await renderReady();

		const row = adminRow(container);
		expect(row, 'Admins row for m1').not.toBeNull();
		expect(row?.textContent).toContain(PROFILE_NAMES.m1);
		expect(row?.textContent).not.toContain(REAL_NAMES.m1);
		expect(row?.textContent).not.toContain(MEMBER_PERSON.m1);
		expect(row?.textContent).not.toContain(STALE_GRANT_NAME);
		expect(container.textContent).not.toContain(STALE_GRANT_NAME);
	});
});

// (*MVOX:Palestrina* — #269 review F1/F2: admin-roles scope fence)
// (*MVOX:Tallis* — #469 RED: fence flipped to the conditional contract, invite picker pinned too)

describe('#361 — admin roles lists: member names are marked', () => {
	const ADMIN_NAME = 'Olga Owner';
	const LIB_NAME = 'Lena Librarian';

	it('Admins list: the name span is marked once, and the Remove button text sits whole in one marker', async () => {
		h.listAdminsMock.mockResolvedValue({
			persons: [
				{ id: 'p-olga', name: ADMIN_NAME, role: 'editor', valueIds: ['v-o'] },
				{ id: 'admin-p', name: 'Viewer Self', role: 'owner', valueIds: ['v-s'] }
			],
			canManage: true
		});
		realNamesWire();
		const container = await renderReady();
		const row = container.querySelector('[data-testid="admin-entry-p-olga"]') as HTMLElement;
		expect(row, 'Admins row').not.toBeNull();
		const remove = row.querySelector('[data-testid="admin-remove-p-olga"]') as HTMLElement;
		expect(remove, 'Admins remove button').not.toBeNull();
		const nameSpan = [...row.children].find((c) => c !== remove) as HTMLElement;
		expectNameMarkedOnce(nameSpan, ADMIN_NAME, 'in the Admins name span');
		expectWholeTextMarkedOnce(remove, 'admin-remove button');
	});

	it('Librarians list: the name span is marked once, and the Remove button text sits whole in one marker', async () => {
		h.resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
		h.listLibrariansMock.mockResolvedValue({
			persons: [{ id: 'p-lena', name: LIB_NAME, role: 'editor', valueIds: ['v-l'] }],
			canManage: true
		});
		realNamesWire();
		const container = await renderReady();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="librarian-entry-p-lena"]')).not.toBeNull();
		});
		const row = container.querySelector('[data-testid="librarian-entry-p-lena"]') as HTMLElement;
		const remove = row.querySelector('[data-testid="librarian-remove-p-lena"]') as HTMLElement;
		expect(remove, 'Librarians remove button').not.toBeNull();
		const nameSpan = [...row.children].find((c) => c !== remove) as HTMLElement;
		expectNameMarkedOnce(nameSpan, LIB_NAME, 'in the Librarians name span');
		expectWholeTextMarkedOnce(remove, 'librarian-remove button');
	});
});

// (*MVOX:Tallis* — #361 RED: admin roles lists marked)
