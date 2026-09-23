// @vitest-environment happy-dom
//
// TS.3/#97 F5 — a failed section CREATE is SAID, not just logged. RE-DRIVEN
// through the page-level `roster-new-section` entry (#470: the picker's inline
// create form is RETIRED — "drop the new section creation" — and with it the
// create+assign coupling; the page-level create has no member context, so the
// old "created but assign failed" case dies with the entry). Same mocking
// seams as the other page-level create specs.
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const { loadRosterMock, listSectionsMock, assignMock, unassignMock, createSectionMock } =
	vi.hoisted(() => ({
		loadRosterMock: vi.fn(),
		listSectionsMock: vi.fn(),
		assignMock: vi.fn(),
		unassignMock: vi.fn(),
		createSectionMock: vi.fn()
	}));
// #269 review F1/F2 — /roster calls the OPT-IN real-names producer.
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/sections/sectionData')>();
	return { ...actual, listSections: listSectionsMock };
});
vi.mock('$lib/sections/sectionActions', () => ({
	assignMemberSection: assignMock,
	unassignMemberSection: unassignMock,
	createSection: createSectionMock
}));
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

const ORG_1 = 'org-1';

function fixtureTree(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, dbEntityId: ORG_1, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG_1, depth: 0, children: [] }
	];
}

/** The viewer ('person-p') has her own row → `currentDbEntityId` = ORG_1. */
function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: ['sec-sop'],
			dbEntityId: ORG_1
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_1
		}
	];
}

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
	listSectionsMock.mockResolvedValue(fixtureTree());
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createSectionMock.mockResolvedValue('sec-new-1');
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	assignMock.mockReset();
	unassignMock.mockReset();
	createSectionMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
	resetAdmin();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderArrangeReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'roster-groups')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-arrange-list')).not.toBeNull();
	});
	return container;
}

async function createNamed(container: HTMLElement, name: string): Promise<void> {
	if (!q(container, 'roster-new-section-form')) {
		await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'roster-new-section-form')).not.toBeNull();
		});
	}
	await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
		target: { value: name }
	});
	await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
}

describe('/roster — a failed createSection is SAID, not just logged (re-driven through roster-new-section per #470)', () => {
	it('createSection rejects: a role=alert create-failed message renders in the form, and no section row is invented; no member is assigned', async () => {
		createSectionMock.mockRejectedValue(new Error('boom'));
		const container = await renderArrangeReady();

		await createNamed(container, 'Tenor');

		const error = await waitFor(() => {
			const el = q(container, 'roster-new-section-error');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('roster_section_create_failed');
		// Nothing was written, so nothing was added to the tree either.
		expect(q(container, 'arrange-row-sec-new-1')).toBeNull();
		expect(assignMock).not.toHaveBeenCalled();
	});

	it('a later successful create clears the previous failure message', async () => {
		createSectionMock.mockRejectedValueOnce(new Error('boom'));
		const container = await renderArrangeReady();

		await createNamed(container, 'Tenor');
		await waitFor(() => {
			expect(q(container, 'roster-new-section-error')).not.toBeNull();
		});

		createSectionMock.mockResolvedValue('sec-new-1');
		await createNamed(container, 'Bass');
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-new-1')).not.toBeNull();
		});
		expect(q(container, 'roster-new-section-error')).toBeNull();
	});
});

// (*MVOX:Palestrina* — TS.3/#97 F5 code-review fixes)
// (*MVOX:Tallis* — #470: re-driven through the page-level roster-new-section
//  entry; the create+assign coupling died with the picker's create form)
