// @vitest-environment happy-dom
// Roster remove and deactivate pending flags reset on a collective switch.
import { render, fireEvent, waitFor } from '@testing-library/svelte';
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
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule()
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

import { resolveMyLibraryId } from '$lib/library/librarianStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	deactivateMemberMock,
	listDeactivateBlockersMock,
	listInactiveMembersMock,
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
import { rowsA, rowsB, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
import {
	cleanupClearResetAdmin,
	flush,
	openCard,
	removeStatusText,
	switchToOtherChoirArrange,
	switchToOtherChoirGroups
} from '$lib/testing/pages/roster';
import { renderGroupsRoster, renderInArrangeMode } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

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
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	vi.mocked(resolveMyLibraryId).mockResolvedValue('lib-1');
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(cleanupClearResetAdmin);

async function startHeldRemoveOnA(container: HTMLElement) {
	await fireEvent.click(q(container, 'section-remove-sec-tenor') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'section-remove-confirm-sec-tenor')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'section-remove-confirm-sec-tenor') as HTMLElement);
	await waitFor(() => {
		expect(deleteMock).toHaveBeenCalledTimes(1);
	});
}

async function startHeldDeactivate(container: HTMLElement, memberId: string, nthWrite: number) {
	await openCard(container, memberId);
	await fireEvent.click(q(container, `member-deactivate-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(q(container, `member-deactivate-confirm-${memberId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `member-deactivate-confirm-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(deactivateMemberMock).toHaveBeenCalledTimes(nthWrite);
	});
}

describe('/roster — #287 removePending across a collective switch', () => {
	it("STALE DISABLE: with collective A's delete WRITE still in flight, collective B's structural controls render ENABLED from load — A's unresolved write is not B's business", async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);

		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's rename trigger must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			(q(container, 'arrange-indent-sec-b2') as HTMLButtonElement).disabled,
			"B's indent control must not be disabled by A's in-flight write"
		).toBe(false);
		expect(
			q(container, 'arrange-row-sec-b1')?.getAttribute('draggable'),
			"B's rows must be draggable — no structural write is in flight HERE"
		).toBe('true');

		gate.resolve();
		await flush();
	});

	it("CROSS-COLLECTIVE ANNOUNCEMENT: A's delete SUCCESS settling after the switch leaves roster-section-remove-status EMPTY — it must not name A's section into B's live region", async () => {
		const gate = deferred();
		deleteMock.mockImplementation(() => gate.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);
		await switchToOtherChoirArrange(container);

		gate.resolve();
		await flush();

		expect(removeStatusText(container)).toBe('');
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
		expect(q(container, 'arrange-row-sec-b2')).not.toBeNull();
	});

	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new delete has started on B — B's armed pair stays mounted, stays disabled, and B's write cannot double-fire", async () => {
		const gateA = deferred();
		const gateB = deferred();
		deleteMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderInArrangeMode();

		await startHeldRemoveOnA(container);
		await switchToOtherChoirArrange(container);

		expect(
			(q(container, 'section-remove-sec-b2') as HTMLButtonElement).disabled,
			"B's delete trigger must be enabled after the switch"
		).toBe(false);

		await fireEvent.click(q(container, 'section-remove-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'section-remove-confirm-sec-b2')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'section-remove-confirm-sec-b2') as HTMLElement);
		await waitFor(() => {
			expect(deleteMock).toHaveBeenCalledTimes(2);
		});

		gateA.resolve();
		await flush();

		const confirmB = q(container, 'section-remove-confirm-sec-b2') as HTMLButtonElement | null;
		expect(confirmB, "B's armed pair must survive A's stale settle").not.toBeNull();
		expect(confirmB!.disabled, "B's write is STILL in flight — confirm stays disabled").toBe(true);
		expect(confirmB!.getAttribute('aria-busy')).toBe('true');
		expect(
			(q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled,
			"B's structural controls stay frozen while B's own write is in flight"
		).toBe(true);
		expect(q(container, 'arrange-row-sec-b1')?.getAttribute('draggable')).toBe('false');
		expect(removeStatusText(container)).toBe('');

		await fireEvent.click(confirmB!);
		confirmB!.click();
		await flush();
		expect(deleteMock).toHaveBeenCalledTimes(2);

		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect((q(container, 'arrange-rename-sec-b1') as HTMLButtonElement).disabled).toBe(false);
		});
		expect(removeStatusText(container)).toContain('roster_section_removed');
		expect(removeStatusText(container)).toContain('Bass II');
		expect(removeStatusText(container)).not.toContain('Tenor');
		expect(deleteMock).toHaveBeenCalledTimes(2);
	});
});

describe('/roster — #287 deactivatePending across a collective switch', () => {
	it("STALE DISABLE: with collective A's deactivate WRITE still in flight, collective B's deactivate trigger renders ENABLED from load", async () => {
		const gate = deferred();
		deactivateMemberMock.mockImplementation(() => gate.promise);
		const container = await renderGroupsRoster();

		await startHeldDeactivate(container, 'm-ada', 1);
		await switchToOtherChoirGroups(container);
		await openCard(container, 'm-bob');

		expect(
			(q(container, 'member-deactivate-m-bob') as HTMLButtonElement).disabled,
			"B's deactivate trigger must not be disabled by A's in-flight write"
		).toBe(false);

		gate.resolve();
		await flush();
	});

	it("LATE-SETTLE CLOBBER: A's stale settle lands AFTER a genuine new deactivate has started on B — B's armed pair stays mounted, disabled and aria-busy; no double-fire; B then completes honestly", async () => {
		const gateA = deferred();
		const gateB = deferred();
		deactivateMemberMock
			.mockImplementationOnce(() => gateA.promise)
			.mockImplementationOnce(() => gateB.promise);
		const container = await renderGroupsRoster();

		await startHeldDeactivate(container, 'm-ada', 1);
		await switchToOtherChoirGroups(container);
		await openCard(container, 'm-bob');

		expect(
			(q(container, 'member-deactivate-m-bob') as HTMLButtonElement).disabled,
			"B's deactivate trigger must be enabled after the switch"
		).toBe(false);

		await startHeldDeactivate(container, 'm-bob', 2);

		gateA.resolve();
		await flush();

		const confirmB = q(container, 'member-deactivate-confirm-m-bob') as HTMLButtonElement | null;
		expect(confirmB, "B's armed pair must survive A's stale settle").not.toBeNull();
		expect(confirmB!.disabled, "B's write is STILL in flight — confirm stays disabled").toBe(true);
		expect(confirmB!.getAttribute('aria-busy')).toBe('true');
		expect(
			(q(container, 'member-deactivate-cancel-m-bob') as HTMLButtonElement).disabled
		).toBe(true);

		await fireEvent.click(confirmB!);
		confirmB!.click();
		await flush();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(2);

		loadRosterMock.mockImplementation((cfg: { db: string }) =>
			Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : []))
		);
		gateB.resolve();
		await flush();
		await waitFor(() => {
			expect(q(container, 'roster-row-m-bob')).toBeNull();
		});
		expect(q(container, 'member-deactivate-confirm-m-bob')).toBeNull();
		expect(deactivateMemberMock).toHaveBeenCalledTimes(2);
	});
});

// (*MVOX:Tallis*)
