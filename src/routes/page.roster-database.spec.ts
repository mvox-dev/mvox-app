// @vitest-environment happy-dom
// /roster on database-parented data, through the real data modules.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

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

vi.mock('$lib/entu/request', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/entu/request')>();
	return { ...actual, entuFetch: entuFetchMock };
});
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const DB_ENTITY = '69c7f8688489bfcb0e81aff1'; // the database entity — THE collective
const CFG = testCfg('sampledb', 'jwt-abc');

function wireRouter(path: string): Response {
	if (path.includes('_type.string=member') && path.includes('status.string=active')) {
		return json({
			entities: [
				{
					_id: 'm-pete',
					person: [{ reference: 'p-pete' }],
					_parent: [{ reference: DB_ENTITY, entity_type: 'database' }],
					_owner: [{ reference: 'p-pete' }]
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
	signIn({ collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'p-pete' }] });
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
	resetAppState();
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
	it("renders the member read off a database-parented member row, and a TOP-LEVEL create threads the DATABASE entity id: createSection(cfg, { name, parentId: null, dbEntityId: <database entity> })", async () => {
		const container = await renderReady();

		await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-arrange-list')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-new-section-form')).not.toBeNull();
		});
		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
			target: { value: 'Tenor' }
		});
		await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Tenor',
			parentId: null,
			dbEntityId: DB_ENTITY
		});
	});

	it('nothing on the wire ever queries `_type.string=organization`', async () => {
		await renderReady();
		expect(wireLog.some((p) => p.includes('_type.string=organization'))).toBe(false);
		expect(wireLog.some((p) => p.includes('_type.string=member'))).toBe(true);
	});
});

// (*MVOX:Tallis*)
