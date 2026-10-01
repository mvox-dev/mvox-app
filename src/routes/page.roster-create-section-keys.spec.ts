// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadRosterMock,
	listSectionsMock,
	assignMock,
	unassignMock,
	createSectionMock,
	reorderMock,
	deleteMock,
	resolveDatabaseEntityIdMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	assignMock: vi.fn(),
	unassignMock: vi.fn(),
	createSectionMock: vi.fn(),
	reorderMock: vi.fn(),
	deleteMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createSectionMock,
	reorderSections: reorderMock,
	deleteSection: deleteMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';


const ORG_EFK = '69c7f8718489bfcb0e81b065';
const ORG_SIREEN = '69c7f8788489bfcb0e81b1a9';
const EFK_SOPRANO = '69c7f8728489bfcb0e81b07b';
const EFK_ALTO = '69c7f8748489bfcb0e81b0cd';
const SIREEN_SOPRANO_II = '69c7f8798489bfcb0e81b207';

function liveShapedTree(): SectionNode[] {
	return [
		{
			id: EFK_SOPRANO,
			name: 'Soprano',
			displayOrder: 1,
			parentId: null,
			dbEntityId: ORG_EFK,
			depth: 0,
			children: []
		},
		{
			id: SIREEN_SOPRANO_II,
			name: 'Soprano II',
			displayOrder: 3,
			parentId: null,
			dbEntityId: ORG_SIREEN,
			depth: 0,
			children: []
		},
		{
			id: EFK_ALTO,
			name: 'Alto',
			displayOrder: 4,
			parentId: null,
			dbEntityId: ORG_EFK,
			depth: 0,
			children: []
		}
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [EFK_SOPRANO],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

const CFG = { db: 'sampledb', token: 'jwt-abc' };

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue(liveShapedTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
});

afterEach(() => {
	cleanup();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createSectionMock.mockReset();
	reorderMock.mockReset();
	deleteMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

async function renderArrangeReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

describe('#560 — one key listener on the roster section-create form', () => {
	it('Escape fired at the form wrapper closes it; nothing was written', async () => {
		const container = await renderArrangeReady();

		await fireEvent.keyDown(q(container, 'roster-new-section-form') as HTMLElement, {
			key: 'Escape'
		});

		await waitFor(() => {
			expect(q(container, 'roster-new-section-form')).toBeNull();
		});
		expect(createSectionMock).not.toHaveBeenCalled();
	});

	it('Enter from the name field submits the form', async () => {
		const container = await renderArrangeReady();
		const name = q(container, 'roster-new-section-name') as HTMLInputElement;

		await fireEvent.input(name, { target: { value: 'Tenor 2' } });
		await fireEvent.keyDown(name, { key: 'Enter' });

		await waitFor(() => {
			expect(createSectionMock).toHaveBeenCalledTimes(1);
		});
		expect(createSectionMock).toHaveBeenCalledWith(CFG, {
			name: 'Tenor 2',
			parentId: null,
			dbEntityId: ORG_EFK
		});
	});

	it('Enter on the parent select does not submit', async () => {
		const container = await renderArrangeReady();

		await fireEvent.input(q(container, 'roster-new-section-name') as HTMLInputElement, {
			target: { value: 'Tenor 2' }
		});
		await fireEvent.keyDown(q(container, 'roster-new-section-parent') as HTMLElement, {
			key: 'Enter'
		});

		expect(q(container, 'roster-new-section-form')).not.toBeNull();
		expect(createSectionMock).not.toHaveBeenCalled();
	});
});
