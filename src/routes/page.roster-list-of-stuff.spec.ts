// @vitest-environment happy-dom
// The roster's members list renders through the list-of-stuff frame (#861).
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule({ archived: true })
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: false })
);
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal)
);

import Page from './roster/+page.svelte';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadInactiveRosterMock, loadRosterMock } from '$lib/testing/mocks/roster';
import { altoSection } from '$lib/testing/pages/rosterFixtures';
import { setAuthedWithOneCollective } from '$lib/testing/pages/roster';
import { useRosterDeactivatePage } from '$lib/testing/pages/rosterDeactivate';
import { q } from '$lib/testing/pages/dom';
import { goOffline, goOnline } from '$lib/testing/networkSignal';

useRosterDeactivatePage();

const gone = {
	memberId: 'm9',
	personId: 'pp-9',
	name: 'Gone Girl',
	email: 'gone@example.com',
	sectionIds: ['sec-alto'],
	dbEntityId: 'db-1'
};

async function renderAs(admin: 'admin' | 'not-admin'): Promise<HTMLElement> {
	listSectionsMock.mockResolvedValue([altoSection]);
	loadInactiveRosterMock.mockResolvedValue(toListRead([gone]));
	const { container } = render(Page);
	setAuthedWithOneCollective();
	adminStore.set(admin);
	await waitFor(() => expect(q(container, 'roster-sort-toggle')).not.toBeNull());
	return container;
}

function inside(container: HTMLElement, slot: string, testid: string): boolean {
	const el = q(container, testid);
	return el !== null && q(container, slot)?.contains(el) === true;
}

function follows(a: Node, b: Node): boolean {
	// eslint-disable-next-line no-bitwise
	return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('/roster — members list on list-of-stuff (#861)', () => {
	it('admin, grouped: show-inactive sits in the filter slot; sort toggle and view modes in the view slot', async () => {
		const container = await renderAs('admin');
		await waitFor(() => expect(q(container, 'roster-inactive-toggle')).not.toBeNull());
		expect(inside(container, 'list-of-stuff-filter', 'roster-inactive-toggle')).toBe(true);
		expect(inside(container, 'list-of-stuff-view', 'roster-sort-toggle')).toBe(true);
		expect(inside(container, 'list-of-stuff-view', 'roster-view-modes')).toBe(true);
	});

	it('admin, offline: filter, title line, then the offline notice in the list body (#869)', async () => {
		await goOffline();
		const container = await renderAs('admin');
		await waitFor(() => expect(q(container, 'roster-inactive-toggle')).not.toBeNull());
		const notice = q(container, 'roster-write-unavailable')!;
		const toggle = q(container, 'roster-inactive-toggle')!;
		const order = [toggle, q(container, 'list-of-stuff-header')!, notice];
		expect(order.slice(1).every((el, i) => follows(order[i], el))).toBe(true);
		expect(q(container, 'list-of-stuff-body')!.contains(notice)).toBe(true);
		await goOnline();
	});

	it('admin, A–Z: the sort toggle stays in the view slot and the view modes are gone', async () => {
		const container = await renderAs('admin');
		await fireEvent.click(q(container, 'roster-sort-toggle')!);
		await waitFor(() => expect(q(container, 'roster-flat-list')).not.toBeNull());
		expect(inside(container, 'list-of-stuff-view', 'roster-sort-toggle')).toBe(true);
		expect(q(container, 'roster-view-modes')).toBeNull();
	});

	it('non-admin: no filter slot and no show-inactive toggle', async () => {
		const container = await renderAs('not-admin');
		expect(q(container, 'list-of-stuff-filter')).toBeNull();
		expect(q(container, 'roster-inactive-toggle')).toBeNull();
	});

	it('admin opens inactive: the inactive list sits in the list body, after the active rows', async () => {
		const container = await renderAs('admin');
		await waitFor(() => expect(q(container, 'roster-inactive-toggle')).not.toBeNull());
		await fireEvent.click(q(container, 'roster-inactive-toggle')!);
		const list = await waitFor(() => {
			const el = q(container, 'roster-inactive-list');
			expect(el).not.toBeNull();
			return el!;
		});
		expect(q(container, 'list-of-stuff-body')!.contains(list)).toBe(true);
		expect(follows(q(container, 'roster-groups')!, list)).toBe(true);
	});

	it('admin, every member inactive: the toggle still shows and opening it lists them', async () => {
		listSectionsMock.mockResolvedValue([]);
		loadRosterMock.mockResolvedValue(toListRead([]));
		loadInactiveRosterMock.mockResolvedValue(toListRead([gone]));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() => expect(q(container, 'roster-empty')).not.toBeNull());
		await waitFor(() => expect(q(container, 'roster-inactive-toggle')).not.toBeNull());
		expect(inside(container, 'list-of-stuff-filter', 'roster-inactive-toggle')).toBe(true);
		await fireEvent.click(q(container, 'roster-inactive-toggle')!);
		await waitFor(() => expect(q(container, 'inactive-member-row-m9')).not.toBeNull());
	});

	it('sections fail to load: no view slot, no sort toggle, no view modes', async () => {
		const console_ = vi.spyOn(console, 'error').mockImplementation(() => {});
		listSectionsMock.mockRejectedValue(new Error('sections boom'));
		const { container } = render(Page);
		setAuthedWithOneCollective();
		adminStore.set('admin');
		await waitFor(() => expect(q(container, 'roster-inactive-toggle')).not.toBeNull());
		expect(q(container, 'list-of-stuff-view')).toBeNull();
		expect(q(container, 'roster-sort-toggle')).toBeNull();
		expect(q(container, 'roster-view-modes')).toBeNull();
		console_.mockRestore();
	});
});
