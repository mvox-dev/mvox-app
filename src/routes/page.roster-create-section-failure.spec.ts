// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/sections/sectionActions', async () =>
	(await import('$lib/testing/mocks/sections')).sectionCreateModule({ arrange: false })
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './roster/+page.svelte';
import type { SectionNode } from '$lib/sections/sectionData';
import type { RosterRow } from '$lib/roster/rosterData';
import { adminStore, resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { assignMock, createSectionMock, unassignMock } from '$lib/testing/mocks/sections';

const ORG_1 = 'org-1';

function fixtureTree(): SectionNode[] {
	return [
		{ id: 'sec-sop', name: 'Soprano', displayOrder: 1, parentId: null, dbEntityId: ORG_1, depth: 0, children: [] },
		{ id: 'sec-alto', name: 'Alto', displayOrder: 2, parentId: null, dbEntityId: ORG_1, depth: 0, children: [] }
	];
}

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
	signIn();
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
	resetAppState();
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

// (*MVOX:Palestrina*) (*MVOX:Tallis*)
