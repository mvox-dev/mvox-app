// @vitest-environment happy-dom
import { fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	(await import('$lib/testing/mocks/sections')).sectionActionsModule(['reparent'])
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

import type { RosterRow } from '$lib/roster/rosterData';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	assignMock,
	createMock,
	deleteMock,
	reorderMock,
	reparentMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import { ORG_A, ORG_B, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
import { cleanupResetReparentMocks, flush } from '$lib/testing/pages/roster';
import { rowOrder } from '$lib/testing/pages/rosterArrange';
import { renderInArrangeMode } from '$lib/testing/pages/rosterRender';
import { q } from '$lib/testing/pages/dom';

function rowsA(): RosterRow[] {
	return [
		{ memberId: 'm-ada', personId: 'p-ada', name: 'Ada Lovelace', email: 'ada@x.com', sectionIds: ['sec-sop'], dbEntityId: ORG_A },
		{ memberId: 'm-bea', personId: 'p-bea', name: 'Bea Noe', email: 'bea@x.com', sectionIds: ['sec-alto'], dbEntityId: ORG_A }
	];
}

function rowsB(): RosterRow[] {
	return [
		{ memberId: 'm-bob', personId: 'p-bob', name: 'Bob Bass', email: 'bob@x.com', sectionIds: ['sec-b1'], dbEntityId: ORG_B }
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
});

afterEach(cleanupResetReparentMocks);

function statusText(container: HTMLElement): string {
	return (q(container, 'roster-reorder-status')?.textContent ?? '').trim();
}

async function switchToOtherChoir(container: HTMLElement) {
	selectedCollectiveDbStore.set('other-choir');
	await waitFor(() => {
		expect(q(container, 'arrange-row-sec-b1')).not.toBeNull();
	});
	expect(q(container, 'arrange-row-sec-alto')).toBeNull();
}

describe('/roster — a structural-write SUCCESS settling after a collective switch writes NOTHING (#264 item 4)', () => {
	it('performReorder: a held reorderSections SUCCESS settles after the switch → the live region stays EMPTY (no stale "moved"/"dropped" announcement), no banner, and collective B\'s tree is untouched', async () => {
		let release!: () => void;
		reorderMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		const container = await renderInArrangeMode();

		let target = q(container, 'arrange-row-sec-sop') as HTMLElement;
		target.focus();
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => expect(target.getAttribute('data-grabbed')).toBe('true'));
		await fireEvent.keyDown(target, { key: 'ArrowDown' });
		target = q(container, 'arrange-row-sec-sop') as HTMLElement;
		await fireEvent.keyDown(target, { key: 'Enter' });
		await waitFor(() => {
			expect(reorderMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoir(container);

		release();
		await flush();

		expect(statusText(container)).toBe('');
		expect(q(container, 'section-reorder-error')).toBeNull();
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
	});

	it('performReparent: a held reparentSection SUCCESS settles after the switch → no stale "indented" announcement, and NO follow-up renumber write is fired for either collective', async () => {
		let release!: () => void;
		reparentMock.mockImplementation(
			() =>
				new Promise<void>((res) => {
					release = () => res();
				})
		);
		const container = await renderInArrangeMode();

		await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);
		await waitFor(() => {
			expect(reparentMock).toHaveBeenCalledTimes(1);
		});

		await switchToOtherChoir(container);

		release();
		await flush();

		expect(statusText(container)).toBe('');
		expect(q(container, 'section-reorder-error')).toBeNull();
		expect(reorderMock).not.toHaveBeenCalled();
		expect(rowOrder(container)).toEqual(['arrange-row-sec-b1', 'arrange-row-sec-b2']);
	});
});

// (*MVOX:Tallis* — #264 item 4 RED, house deterministic-race method per #259)
