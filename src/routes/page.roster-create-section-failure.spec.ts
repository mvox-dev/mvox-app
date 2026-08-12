// @vitest-environment happy-dom
//
// TS.3/#97 F5 code-review fix — the /roster page's NEW-SECTION FAILURE paths.
// The happy path is pinned by page.roster-create-section.spec.ts; this file
// covers what used to be INVISIBLE: the picker closes synchronously on a valid
// submit (its pinned contract), so a rejected createSection — or a createSection
// that resolves followed by a rejected assignMemberSection — left the user with a
// vanished dropdown, an unchanged roster and nothing but a console line. Same
// mocking seams as the happy-path spec.
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
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));
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

function fixtureTree(): SectionNode[] {
	const sop1: SectionNode = {
		id: 'sec-sop1',
		name: 'Soprano 1',
		displayOrder: 1,
		parentId: 'sec-sop',
		depth: 1,
		children: []
	};
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, depth: 0, children: [sop1] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, depth: 0, children: [] }
	];
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: ['sec-sop']
		},
		{ memberId: 'm-pete', personId: 'p-pete', name: 'Pete Wilson', email: 'pete@x.com', sectionIds: [] }
	];
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadRosterMock.mockResolvedValue(fixtureRows());
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

async function renderReady() {
	setAuthedWithOneCollective();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(container.querySelector('[data-testid="roster-groups"]')).not.toBeNull();
	});
	// TU.2/#110 finding #9 — sections default COLLAPSED now (member rows, and
	// this file's picker triggers, don't render until expanded); this file's
	// concern is the create/assign FAILURE path, not the collapse default, so
	// expand everything up front via the same toggle-all control #9 shipped.
	const toggleAll = container.querySelector('[data-testid="sections-toggle-all"]') as HTMLElement | null;
	if (toggleAll) {
		await fireEvent.click(toggleAll);
		await waitFor(() => {
			expect(container.querySelector('[data-testid^="roster-row-"]')).not.toBeNull();
		});
	}
	return container;
}

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function createFor(container: HTMLElement, memberId: string, name: string): Promise<void> {
	await fireEvent.click(q(container, `section-picker-trigger-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `section-picker-menu-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-picker-new') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-create-form')).not.toBeNull();
	});
	await fireEvent.input(q(container, 'section-create-name') as HTMLElement, {
		target: { value: name }
	});
	await fireEvent.click(q(container, 'section-create-submit') as HTMLElement);
}

describe('/roster — a failed createSection is SAID, not just logged', () => {
	it("createSection rejects: the member's row shows a role=alert create-failed message, and no section group is invented", async () => {
		createSectionMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();

		await createFor(container, 'm-pete', 'Tenor');

		const error = await waitFor(() => {
			const el = q(container, 'section-write-error-m-pete');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain('roster_section_create_failed');
		// Nothing was written, so nothing was added to the tree either.
		expect(q(container, 'section-group-sec-new-1')).toBeNull();
		expect(assignMock).not.toHaveBeenCalled();
	});

	it('the error is scoped to the member who attempted it — other rows stay clean', async () => {
		createSectionMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();

		await createFor(container, 'm-pete', 'Tenor');

		await waitFor(() => {
			expect(q(container, 'section-write-error-m-pete')).not.toBeNull();
		});
		expect(q(container, 'section-write-error-m-ada')).toBeNull();
	});

	it('a later successful create clears the previous failure message', async () => {
		createSectionMock.mockRejectedValueOnce(new Error('boom'));
		const container = await renderReady();

		await createFor(container, 'm-pete', 'Tenor');
		await waitFor(() => {
			expect(q(container, 'section-write-error-m-pete')).not.toBeNull();
		});

		createSectionMock.mockResolvedValue('sec-new-1');
		await createFor(container, 'm-pete', 'Bass');
		await waitFor(() => {
			expect(q(container, 'section-group-sec-new-1')).not.toBeNull();
		});
		expect(q(container, 'section-write-error-m-pete')).toBeNull();
	});
});

describe('/roster — a created section whose ASSIGN failed says so precisely', () => {
	it('createSection resolves but assignMemberSection rejects: the new group is in the tree, the member is NOT in it, and the assign-failed message is shown', async () => {
		assignMock.mockRejectedValue(new Error('nope'));
		const container = await renderReady();

		await createFor(container, 'm-pete', 'Tenor');

		const error = await waitFor(() => {
			const el = q(container, 'section-write-error-m-pete');
			expect(el).not.toBeNull();
			return el as HTMLElement;
		});
		expect(error.textContent).toContain('roster_section_assign_failed');
		// The create genuinely happened server-side — the section stays in the tree.
		expect(q(container, 'section-group-sec-new-1')).not.toBeNull();
		expect(
			q(container, 'section-group-sec-new-1')?.querySelector('[data-testid="roster-row-m-pete"]')
		).toBeNull();
		// ...and the member is still where they were.
		expect(
			q(container, 'section-group-unassigned')?.querySelector('[data-testid="roster-row-m-pete"]')
		).not.toBeNull();
	});
});

// (*MVOX:Palestrina* — TS.3/#97 F5 code-review fixes)
