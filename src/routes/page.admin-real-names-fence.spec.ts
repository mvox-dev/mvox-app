// @vitest-environment happy-dom
//
// #269 review F1/F2 — the SCOPE FENCE on the ADMIN ROLES page
// (`src/routes/admin/+page.svelte`).
//
// Henry's 2026-09-06 scope ruling fences the real-names overlay to /roster.
// This page consumes the SHARED `loadRoster` too — its rows feed
// `rosterOrder(roster, sections)` for both person <select>s and ride along into
// `listAdmins`/`listLibrarians` as the id→name lookup — so the first #269 GREEN
// (overlay inside `loadRoster`) leaked real names into the admin pickers.
//
// The wire here is the "overlay would fire" fixture ($lib/testing/realNamesFence):
// `_type.string=database` RESOLVES, the toggle answers true, and named
// `admin_member_record`s are on offer. A fence spec without that database stub
// would be vacuous — `resolveDatabaseEntityId` would answer null, the overlay
// would degrade to off by itself, and the test would pass on a leaking tree.
//
// Pinned: (a) the add-admin picker's option labels are the PROFILE names;
// (b) ZERO `admin_member_record` requests and ZERO `roster_show_real_names`
// reads across the whole page load.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const h = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	resolveAdminMock: vi.fn(),
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
	resolveAdmin: h.resolveAdminMock
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
import { realNamesWire, PROFILE_NAMES, REAL_NAMES, DB_ENTITY_ID } from '$lib/testing/realNamesFence';

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

beforeEach(() => {
	h.resolveAdminMock.mockResolvedValue('admin');
	h.resolveLibrarianMock.mockResolvedValue({ state: 'not-librarian', libraryId: null });
	h.listAdminsMock.mockResolvedValue({ persons: [], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.listSectionsMock.mockResolvedValue([]);
	h.resolveParentMock.mockResolvedValue(DB_ENTITY_ID);
	h.createInviteMock.mockResolvedValue({ personId: 'p', memberId: 'm', inviteToken: 'a.b.c' });
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
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
	selectPolyphony();
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

describe('#269 scope fence — the ADMIN ROLES page keeps profile names and never reads member records', () => {
	it('with the toggle ON and named records on the wire, the add-admin picker offers PROFILE names', async () => {
		realNamesWire();
		const container = await renderReady();

		const select = container.querySelector(
			'[data-testid="admin-add-admin-select"]'
		) as HTMLSelectElement;
		const labels = [...select.querySelectorAll('option')]
			.map((o) => (o.textContent ?? '').trim())
			.filter((t) => t !== '' && !t.startsWith('admin_roles_') && !t.startsWith('picker_'));
		expect(labels).toEqual([PROFILE_NAMES.m1, PROFILE_NAMES.m2]);
		expect(container.textContent).not.toContain(REAL_NAMES.m1);
		expect(container.textContent).not.toContain(REAL_NAMES.m2);
	});

	it('issues ZERO admin_member_record requests and ZERO roster_show_real_names reads across the whole load', async () => {
		const fetchMock = realNamesWire();
		await renderReady();

		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(urls.filter((u) => u.includes('roster_show_real_names'))).toEqual([]);
	});
});

// (*MVOX:Palestrina* — #269 review F1/F2: admin-roles scope fence)
