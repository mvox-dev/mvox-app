// @vitest-environment happy-dom
//
// #161 RED — the /roster page on DATABASE-parented data, wire-level
// (integration: real roster/+page.svelte, REAL rosterData/profileData/
// sectionData against a stubbed `entuFetch`; only the WRITE layer
// (sectionActions) is mocked so the create call shape is observable).
//
// The live db after #159/#161 holds NO organization entities: members and
// top-level sections are parented to the DATABASE entity
// (`entity_type: 'database'` in the `_parent` wire shape). Pinned contract:
//   - the roster renders those members (the read layer keys the collective off
//     the `database` parent, not the retired `organization` one),
//   - a TOP-LEVEL section create threads the DATABASE entity id into
//     `createSection` (the page KNOWS the collective from the member row — the
//     data layer must not guess),
//   - nothing on the wire ever queries `_type.string=organization`.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { entuFetchMock, assignMock, unassignMock, createSectionMock, wireLog } = vi.hoisted(() => ({
	entuFetchMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createSectionMock: vi.fn(),
	wireLog: [] as string[]
}));

// READ layers stay REAL — the wire is the seam (see module header).
vi.mock('$lib/entu/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/entu/request')>();
	return { ...actual, entuFetch: entuFetchMock };
});
// WRITE layer mocked so the create call shape is observable.
vi.mock('$lib/sections/sectionActions', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionActions')>();
	return {
		...actual,
		assignMemberSection: assignMock,
		unassignMemberSection: unassignMock,
		createSection: createSectionMock
	};
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── the wire (post-#159 shape: NO organization entities exist) ─────────────────

const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // the database entity — THE collective
const CFG = { db: 'polyphony', token: 'jwt-abc' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** Routes the READ queries loadRoster/listSections actually issue. */
function wireRouter(path: string): Response {
	if (path.includes('_type.string=member') && path.includes('status.string=active')) {
		return json({
			entities: [
				{
					_id: 'm-pete',
					person: [{ reference: 'p-pete' }],
					// The member's collective is its DATABASE `_parent` — there is no
					// organization entry anymore.
					_parent: [{ reference: DB_ENTITY, entity_type: 'database' }]
				}
			],
			count: 1
		});
	}
	if (path.includes('_type.string=profile') && path.includes('_parent.reference=p-pete')) {
		return json({
			entities: [
				{
					_id: 'prof-pete',
					name: [{ string: 'Pete Wilson' }],
					email: [{ string: 'pete@x.com' }],
					_sharing: [{ string: 'domain' }]
				}
			],
			count: 1
		});
	}
	if (path.includes('_type.string=section')) {
		return json({
			entities: [
				{
					_id: 'sec-sop',
					name: [{ string: 'Soprano' }],
					display_order: [{ number: 1 }],
					_parent: [{ reference: DB_ENTITY, entity_type: 'database' }]
				}
			],
			count: 1
		});
	}
	return json({ entities: [], count: 0 });
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'p-pete' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'p-pete' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	wireLog.length = 0;
	entuFetchMock.mockImplementation(async (_db: string, path: string) => {
		wireLog.push(path);
		return wireRouter(path);
	});
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	// Sections default collapsed (TU.2/#110 #9) — expand so member rows and
	// their picker triggers render.
	const toggleAll = q(container, 'roster-view-chip-expanded');
	if (toggleAll) {
		await fireEvent.click(toggleAll);
	}
	await waitFor(() => {
		expect(q(container, 'roster-row-m-pete')).not.toBeNull();
	});
	return container;
}

describe('/roster on DATABASE-parented data (#161)', () => {
	it("renders the member read off a database-parented member row, and a TOP-LEVEL create threads the DATABASE entity id: createSection(cfg, { name, parentId: null, orgId: <database entity> })", async () => {
		const container = await renderReady();

		// Open the picker on the (unassigned) member and start a top-level create.
		await fireEvent.click(q(container, 'section-picker-trigger-m-pete') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-picker-menu-m-pete')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-create-form')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		// The page KNOWS the collective (the member's database `_parent`) and must
		// say it — the data layer never guesses.
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Tenor',
			parentId: null,
			orgId: DB_ENTITY
		});
	});

	it('nothing on the wire ever queries `_type.string=organization`', async () => {
		await renderReady();
		expect(wireLog.some((p) => p.includes('_type.string=organization'))).toBe(false);
		// …and the roster genuinely came off the wire (regression guard for the
		// harness itself, not the app).
		expect(wireLog.some((p) => p.includes('_type.string=member'))).toBe(true);
	});
});

// (*MVOX:Tallis* — #161 RED)
