// @vitest-environment happy-dom
// Roster write flags and error slots reset on a collective switch.
import { cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);

vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/sections/sectionActions', async () =>
	(await import('$lib/testing/mocks/sections')).sectionActionsModule(['reparent', 'rename'])
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
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal)
);

import type { RosterRow } from '$lib/roster/rosterData';
import { resolveMyLibraryId, resolveLibrarian } from '$lib/library/librarianStore';
import { resetAdmin } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { resetAppState } from '$lib/testing/appReset';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	deactivateMemberMock,
	listDeactivateBlockersMock,
	listInactiveMembersMock,
	loadActiveAndArchivedRostersMock,
	loadInactiveRosterMock,
	loadMemberRecordMock,
	loadRosterMock,
	reinstateMemberMock
} from '$lib/testing/mocks/roster';
import {
	assignMock,
	createMock,
	deleteMock,
	renameMock,
	reorderMock,
	reparentMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import { ORG_A, ORG_B, rowsB, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
import {
	flush,
	openCard,
	switchToOtherChoirArrange,
	switchToOtherChoirGroups
} from '$lib/testing/pages/roster';
import { rowOrder } from '$lib/testing/pages/rosterArrange';
import { renderGroupsRoster, renderInArrangeMode } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function inactiveA(): RosterRow[] {
	return [
		{ memberId: 'm-ina', personId: 'p-ina', name: 'Ina Gone', email: 'ina@x.com', sectionIds: [], dbEntityId: ORG_A }
	];
}

function inactiveB(): RosterRow[] {
	return [
		{ memberId: 'm-inb', personId: 'p-inb', name: 'Benno Gone', email: 'benno@x.com', sectionIds: [], dbEntityId: ORG_B }
	];
}

beforeEach(() => {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsB()))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	assignMock.mockResolvedValue(undefined);
	unassignMock.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
	reorderMock.mockResolvedValue(undefined);
	deleteMock.mockResolvedValue(undefined);
	reparentMock.mockResolvedValue(undefined);
	renameMock.mockResolvedValue(undefined);
	deactivateMemberMock.mockResolvedValue(undefined);
	reinstateMemberMock.mockResolvedValue(undefined);
	loadInactiveRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? inactiveA() : inactiveB()))
	);
	loadActiveAndArchivedRostersMock.mockImplementation(async (cfg: unknown) => {
		const [active, inactive] = await Promise.all([
			loadRosterMock(cfg),
			loadInactiveRosterMock(cfg)
		]);
		return { active, inactive };
	});
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
	vi.mocked(resolveLibrarian).mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	resetAppState();
	resetAdmin();
});

function reorderStatusText(container: HTMLElement): string {
	return (q(container, 'roster-reorder-status')?.textContent ?? '').trim();
}

async function keyboardMoveDown(container: HTMLElement, rowId: string, nthWrite: number) {
	let target = q(container, `arrange-row-${rowId}`) as HTMLElement;
	target.focus();
	await fireEvent.keyDown(target, { key: 'Enter' });
	await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
	await fireEvent.keyDown(target, { key: 'ArrowDown' });
	target = q(container, `arrange-row-${rowId}`) as HTMLElement;
	await fireEvent.keyDown(target, { key: 'Enter' });
	await waitFor(() => {
		expect(reorderMock).toHaveBeenCalledTimes(nthWrite);
	});
}

async function openInactivePanel(container: HTMLElement, memberId: string) {
	await fireEvent.click(q(container, 'roster-inactive-toggle') as HTMLElement);
	await waitFor(() => {
		expect(q(container, `member-reinstate-${memberId}`)).not.toBeNull();
	});
}

async function armAndConfirmDeactivate(container: HTMLElement, memberId: string) {
	await openCard(container, memberId);
	await fireEvent.click(q(container, `member-deactivate-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `member-deactivate-confirm-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `member-deactivate-confirm-${memberId}`) as HTMLElement);
}

describe('/roster — #296 reorder busy state across a collective switch', () => {
	it("LATE-SETTLE CLOBBER (reorder): A's stale reorder settles AFTER a genuine reorder has started on B — B's busy state survives, B's controls stay frozen, no third write can fire", async () => {
		const gateA = deferred();
		const gateB = deferred();
		reorderMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await keyboardMoveDown(container, 'sec-sop', 1);
		await switchToOtherChoirArrange(container);

		expect(
			q(container, 'section-reorder-pending'),
			"precondition: B renders no busy region after the switch"
		).toBeNull();

		await keyboardMoveDown(container, 'sec-b1', 2);

		gateA.resolve();
		await flush();

		expect(
			q(container, 'section-reorder-pending'),
			"B's write is STILL in flight — the busy region must survive A's stale settle"
		).not.toBeNull();
		expect(
			(q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled,
			"B's structural controls stay frozen while B's own write is in flight"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b1')?.getAttribute('draggable')).toBe('false');

		await fireEvent.click(q(container, 'arrange-indent-sec-b1') as HTMLElement);
		(q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).click();
		await flush();
		expect(reparentMock).not.toHaveBeenCalled();

		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(q(container, 'section-reorder-pending')).toBeNull();
		expect(reorderStatusText(container)).toContain('roster_section_dropped');
		expect(reorderStatusText(container)).toContain('Bass I');
		expect(reorderStatusText(container)).not.toContain('Soprano');
		expect(reorderMock).toHaveBeenCalledTimes(2);
	});

	it("LATE-SETTLE CLOBBER (reparent): A's stale reparent settles AFTER a genuine reorder has started on B — B's busy state survives and B completes honestly", async () => {
		const gateA = deferred();
		reparentMock.mockImplementation(() => gateA.promise);
		const gateB = deferred();
		reorderMock.mockImplementation(() => gateB.promise);
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirArrange(container);

		expect(
			q(container, 'section-reorder-pending'),
			"precondition: B renders no busy region after the switch"
		).toBeNull();

		await keyboardMoveDown(container, 'sec-b1', 1);

		gateA.resolve();
		await flush();

		expect(
			q(container, 'section-reorder-pending'),
			"B's write is STILL in flight — the busy region must survive A's stale reparent settle"
		).not.toBeNull();
		expect(
			(q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled,
			"B's structural controls stay frozen while B's own write is in flight"
		).toBe(true);

		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'arrange-indent-sec-b1') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(reorderStatusText(container)).toContain('Bass I');
		expect(reorderMock).toHaveBeenCalledTimes(1);
		expect(reparentMock).toHaveBeenCalledTimes(1);
	});
});

describe('/roster — #296 amendment: reorder failure banners across a collective switch', () => {
	it("NO CROSS-COLLECTIVE BANNER (reorder): A's reorder FAILURE settling after the switch paints no page-level failure banner over B, and B's tree is untouched", async () => {
		const gate = deferred();
		reorderMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await keyboardMoveDown(container, 'sec-sop', 1);
		await switchToOtherChoirArrange(container);

		gate.reject(new Error('write failed'));
		await flush();

		expect(
			q(container, 'section-reorder-error'),
			"A's stale failure must not raise the page-level reorder banner over B"
		).toBeNull();
		expect(reorderStatusText(container)).toBe('');
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
	});

	it("NO CROSS-COLLECTIVE BANNER (reparent): A's reparent FAILURE settling after the switch paints no page-level failure banner over B", async () => {
		const gate = deferred();
		reparentMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});
		await switchToOtherChoirArrange(container);

		gate.reject(new Error('write failed'));
		await flush();

		expect(
			q(container, 'section-reorder-error'),
			"A's stale reparent failure must not raise the page-level banner over B"
		).toBeNull();
		expect(reorderStatusText(container)).toBe('');
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
		expect(reorderMock).not.toHaveBeenCalled();
	});
});

describe('/roster — #296 reinstate busy state across a collective switch', () => {
	it("LATE-SETTLE CLOBBER: A's stale reinstate settles AFTER a genuine reinstate has started on B — B's button stays disabled, B's write cannot double-fire, and B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		reinstateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderGroupsRoster();

		await openInactivePanel(container, 'm-ina');
		await fireEvent.click(q(container, 'member-reinstate-m-ina') as HTMLElement);
		await waitFor(() => {
			expect(reinstateMemberMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await openInactivePanel(container, 'm-inb');

		expect(
			(q(container, 'member-reinstate-m-inb') as HTMLButtonElement).disabled,
			"B's reinstate button must be enabled after the switch"
		).toBe(false);

		await fireEvent.click(q(container, 'member-reinstate-m-inb') as HTMLElement);
		await waitFor(() => {
			expect(reinstateMemberMock).toHaveBeenCalledTimes(2);
		});

		gateA.reject(new Error('write failed'));
		await flush();

		const btnB = q(container, 'member-reinstate-m-inb') as HTMLButtonElement;
		expect(
			btnB.disabled,
			"B's write is STILL in flight — its reinstate button stays disabled"
		).toBe(true);

		await fireEvent.click(btnB);
		btnB.click();
		await flush();
		expect(reinstateMemberMock).toHaveBeenCalledTimes(2);
		expect(reinstateMemberMock.mock.calls[1][1]).toBe('m-inb');

		loadInactiveRosterMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(
				toListRead(
					cfg.db === 'sampledb'
						? inactiveA()
						: [{ memberId: 'm-inb2', personId: 'p-inb2', name: 'Berta Gone', email: 'berta@x.com', sectionIds: [], dbEntityId: ORG_B }]
				)
			)
		);
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect(q(container, 'member-reinstate-m-inb2')).not.toBeNull();
		});
		expect((q(container, 'member-reinstate-m-inb2') as HTMLButtonElement).disabled).toBe(false);
		expect(reinstateMemberMock).toHaveBeenCalledTimes(2);
	});
});

describe('/roster — #296 deactivate and reinstate failure alerts across a collective switch', () => {
	it("NO CROSS-COLLECTIVE CLOBBER (reinstate failure): B's OWN reinstate-failure alert survives A's stale reinstate failure settling after the switch", async () => {
		const gateA = deferred();
		reinstateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => Promise.reject(new Error('B write failed')));
		const container = await renderGroupsRoster();

		await openInactivePanel(container, 'm-ina');
		await fireEvent.click(q(container, 'member-reinstate-m-ina') as HTMLElement);
		await waitFor(() => {
			expect(reinstateMemberMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);
		await openInactivePanel(container, 'm-inb');

		expect(
			(q(container, 'member-reinstate-m-inb') as HTMLButtonElement).disabled,
			"B's reinstate button must be enabled after the switch"
		).toBe(false);

		await fireEvent.click(q(container, 'member-reinstate-m-inb') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'member-reinstate-failed-m-inb')).not.toBeNull();
		});

		gateA.reject(new Error('A write failed'));
		await flush();

		expect(
			q(container, 'member-reinstate-failed-m-inb'),
			"B's own failure alert must survive A's stale settle"
		).not.toBeNull();
		expect(q(container, 'member-reinstate-failed-m-ina')).toBeNull();
	});

	it("NO CROSS-COLLECTIVE CLOBBER (deactivate failure): B's OWN deactivate-failure alert survives A's stale deactivate failure settling after the switch", async () => {
		const gateA = deferred();
		deactivateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => Promise.reject(new Error('B write failed')));
		const container = await renderGroupsRoster();

		await armAndConfirmDeactivate(container, 'm-ada');
		await waitFor(() => {
			expect(deactivateMemberMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);

		await armAndConfirmDeactivate(container, 'm-bob');
		await waitFor(() => {
			expect(q(container, 'member-deactivate-failed-m-bob')).not.toBeNull();
		});

		gateA.reject(new Error('A write failed'));
		await flush();

		expect(
			q(container, 'member-deactivate-failed-m-bob'),
			"B's own failure alert must survive A's stale settle"
		).not.toBeNull();
		expect(q(container, 'member-deactivate-confirm-m-bob')).not.toBeNull();
		expect(q(container, 'member-deactivate-failed-m-ada')).toBeNull();
	});
});

describe('/roster — #296 amendment: the deactivate refusal across a collective switch', () => {
	it("NO CROSS-COLLECTIVE CLOBBER (refusal): B's OWN grant-holder refusal survives A's stale refusal settling after the switch", async () => {
		const gateA = deferred<{ role: 'admin' | 'librarian' }[]>();
		listDeactivateBlockersMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => Promise.resolve([{ role: 'admin' }]));
		const container = await renderGroupsRoster();

		await armAndConfirmDeactivate(container, 'm-ada');
		await waitFor(() => {
			expect(listDeactivateBlockersMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoirGroups(container);

		await armAndConfirmDeactivate(container, 'm-bob');
		await waitFor(() => {
			expect(q(container, 'member-deactivate-refused-m-bob')).not.toBeNull();
		});

		gateA.resolve([{ role: 'admin' }]);
		await flush();

		expect(
			q(container, 'member-deactivate-refused-m-bob'),
			"B's own refusal must survive A's stale refusal settle"
		).not.toBeNull();
		const confirmB = q(container, 'member-deactivate-confirm-m-bob') as HTMLButtonElement | null;
		expect(confirmB).not.toBeNull();
		expect(confirmB!.disabled).toBe(false);
		expect(q(container, 'member-deactivate-refused-m-ada')).toBeNull();
		expect(deactivateMemberMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
