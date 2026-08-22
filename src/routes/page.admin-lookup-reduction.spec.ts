// @vitest-environment happy-dom
//
// #173 RED — the /admin page load resolves the database entity ONCE, not three
// times (integration: real admin/+page.svelte + REAL resolveAdmin and
// resolveLibrarian; only the wire and the non-#173 data seams are mocked —
// same harness family as page.admin-database.spec.ts).
//
// TODAY (the debt this spec pins away): one load runs `resolveDatabaseEntityId`
// THREE times — the page's own direct call, one inside `resolveAdmin`, one
// inside `resolveLibrarian` -> `resolveMyLibraryId`. The id is db-scoped and
// constant for the load, so two of those are pure redundant round-trips.
//
// Pinned wiring contract (GREEN must implement):
//   - ONE `resolveDatabaseEntityId` call per admin page load. The page resolves
//     the id once and threads it into `resolveAdmin` and `resolveLibrarian`
//     via their pre-resolved-dbEntityId params (pinned in
//     adminStore.preresolved.spec.ts / librarianStore.preresolved.spec.ts).
//   - Same data, fewer fetches: the page still reaches ready, still hands the
//     database entity id to `listAdmins`, and the rights/library reads still
//     happen (they are the ONLY wire traffic the resolution seams produce).
//
// resolveAdmin / resolveLibrarian run REAL here — mocking them would let GREEN
// "pass" without actually removing their internal lookups from the page path.
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const h = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	addAdminMock: vi.fn(),
	removeAdminMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	addLibrarianMock: vi.fn(),
	removeLibrarianMock: vi.fn(),
	// #173 — THE counted seam. A spy, not a stub of behavior: every code path
	// that wants the database entity id must come through here.
	resolveDatabaseEntityIdMock: vi.fn(),
	entuFetchMock: vi.fn(),
	loadRosterMock: vi.fn(),
	resolveParentMock: vi.fn(),
	createInviteMock: vi.fn(),
	resolveCollectiveNameMarkerMock: vi.fn(),
	updateCollectiveNameMock: vi.fn()
}));

vi.mock('$lib/admin/roleManagement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/admin/roleManagement')>();
	return {
		...actual,
		listAdmins: h.listAdminsMock,
		addAdmin: h.addAdminMock,
		removeAdmin: h.removeAdminMock,
		listLibrarians: h.listLibrariansMock,
		addLibrarian: h.addLibrarianMock,
		removeLibrarian: h.removeLibrarianMock
	};
});
// NOTE: adminStore and librarianStore are NOT mocked — their real
// resolveAdmin/resolveLibrarian run so their internal database-entity
// resolutions are COUNTED (they import the seam lazily; vi.mock intercepts
// dynamic imports too).
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: h.resolveDatabaseEntityIdMock };
});
// The wire: serves ONLY the reads the resolution seams legitimately need
// (rights on the database entity, library search). Anything else rejects loud.
vi.mock('$lib/entu/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/entu/request')>();
	return { ...actual, entuFetch: h.entuFetchMock };
});
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: h.loadRosterMock }));
vi.mock('$lib/collectives/collectiveName', () => ({
	resolveCollectiveNameMarker: h.resolveCollectiveNameMarkerMock,
	updateCollectiveName: h.updateCollectiveNameMock
}));
vi.mock('$lib/invite/inviteData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/invite/inviteData')>();
	return {
		...actual,
		resolvePersonParentId: h.resolveParentMock,
		createInvite: h.createInviteMock
	};
});
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

const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // the database entity — THE collective
const VIEWER = 'admin-p';

const ANNA: RolePerson = {
	id: 'p-anna',
	name: 'Anna Arro',
	role: 'owner',
	valueIds: ['pv-own-anna']
};

const ROSTER = [{ memberId: 'm-1', personId: 'p-anna', name: 'Anna Arro', email: '' }];

function json(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body)
	} as unknown as Response;
}

function selectPolyphony() {
	setToken('jwt-admin');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: VIEWER }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	h.resolveDatabaseEntityIdMock.mockResolvedValue(DB_ENTITY);
	// Routed wire — the real resolveAdmin / resolveLibrarian downstream reads.
	h.entuFetchMock.mockImplementation((_db: string, path: string) => {
		if (path.startsWith(`entity/${DB_ENTITY}?props=_owner`)) {
			// Rights read on the database entity: the viewer IS an owner.
			return Promise.resolve(
				json({ entity: { _id: DB_ENTITY, _owner: [{ reference: VIEWER }], _editor: [] } })
			);
		}
		if (path.includes('_type.string=library')) {
			// Factual "no library in this collective" — refreshLibrarians is skipped.
			return Promise.resolve(json({ entities: [] }));
		}
		return Promise.reject(
			new Error(`unexpected wire traffic during admin load: ${path} (#173 harness)`)
		);
	});
	h.listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	h.listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	h.loadRosterMock.mockResolvedValue(ROSTER);
	h.resolveParentMock.mockResolvedValue(DB_ENTITY);
	h.createInviteMock.mockResolvedValue({
		personId: 'p-new',
		memberId: 'm-new',
		inviteToken: 'a.b.c'
	});
	h.resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Polyphony' });
	h.updateCollectiveNameMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	selectPolyphony();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'admin-roles-admins')).not.toBeNull();
	});
	return container;
}

describe('/admin — one database-entity resolution per load (#173)', () => {
	it('reaches ready with resolveDatabaseEntityId called exactly ONCE', async () => {
		await renderReady();

		// THE #173 assertion. Today this is 3 (page direct + resolveAdmin +
		// resolveLibrarian); the target is 1 — resolve once, thread the id.
		expect(h.resolveDatabaseEntityIdMock).toHaveBeenCalledTimes(1);
	});

	it('same data, fewer fetches — the id still reaches listAdmins and the rights/library reads still happen', async () => {
		await renderReady();

		// The reduction must not un-wire the page: the database entity id is
		// still what keys the admin role list…
		expect(h.listAdminsMock).toHaveBeenCalled();
		expect(h.listAdminsMock.mock.calls[0][1]).toBe(DB_ENTITY);

		// …and the resolution seams' REAL downstream reads still ran: exactly
		// one rights read on the database entity + one library search. No other
		// wire traffic (a leftover redundant lookup would have rejected loudly
		// in the router above and failed renderReady).
		const paths = h.entuFetchMock.mock.calls.map((c) => String(c[1]));
		expect(paths.filter((p) => p.startsWith(`entity/${DB_ENTITY}?props=_owner`))).toHaveLength(1);
		expect(paths.filter((p) => p.includes('_type.string=library'))).toHaveLength(1);
		expect(paths).toHaveLength(2);
	});
});

// (*MVOX:Tallis* — #173 RED)
