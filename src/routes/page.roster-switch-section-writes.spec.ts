// @vitest-environment happy-dom
// A section write from collective A that settles after a switch to B and back changes nothing.
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

import Page from './roster/+page.svelte';
import type { RosterRow } from '$lib/roster/rosterData';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import {
	assignMock,
	createMock,
	reorderMock,
	reparentMock,
	unassignMock
} from '$lib/testing/mocks/sections';
import { rowsA, rowsB, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
import { cleanupResetReparentMocks, setAuthedWithTwoCollectives } from '$lib/testing/pages/roster';
import {
	expandGroup,
	expectLateSettleChangesNothing,
	holdNext,
	switchTo,
	type Outcome
} from '$lib/testing/pages/rosterSwitch';
import { q } from '$lib/testing/pages/dom';

const WRITES = [assignMock, unassignMock, reorderMock, reparentMock, createMock];

function adaInSoprano(): RosterRow[] {
	const [ada, bea] = rowsA();
	return [{ ...ada, sectionIds: ['sec-sop'], ownerIds: ['person-p'] }, bea];
}

beforeEach(() => {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? adaInSoprano() : rowsB()))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	for (const write of WRITES) write.mockResolvedValue(undefined);
	createMock.mockResolvedValue('sec-created');
});

afterEach(() => {
	cleanupResetReparentMocks();
	vi.restoreAllMocks();
});

const openSoprano = (container: HTMLElement) =>
	expandGroup(container, 'sec-sop', 'section-picker-select-m-ada-sec-sop');

async function renderView(view: 'groups' | 'arrange'): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'section-toggle-sec-sop')).not.toBeNull();
	});
	if (view === 'groups') {
		await openSoprano(container);
	} else {
		await fireEvent.click(q(container, 'roster-view-chip-arrange') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'arrange-row-sec-sop')).not.toBeNull();
		});
	}
	return container;
}

async function pickForAda(container: HTMLElement, value: string): Promise<void> {
	await fireEvent.change(q(container, 'section-picker-select-m-ada-sec-sop') as HTMLElement, {
		target: { value }
	});
}

async function indentAlto(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'arrange-indent-sec-alto') as HTMLElement);
}

async function createChorus(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await fireEvent.input(q(container, 'roster-new-section-name') as HTMLElement, {
		target: { value: 'Chorus' }
	});
	await fireEvent.click(q(container, 'roster-new-section-submit') as HTMLElement);
}

async function openCreateForm(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-new-section') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'roster-new-section-form')).not.toBeNull();
	});
}

interface Row {
	guard: string;
	view: 'groups' | 'arrange';
	held: Mock;
	act: (container: HTMLElement) => Promise<void>;
	outcome: Outcome<unknown>;
	onReturn?: (container: HTMLElement) => Promise<void>;
}

const BOOM = { error: new Error('boom-a') };

const ROWS: Row[] = [
	{ guard: 'rosterSectionOps 63: unassign lands', view: 'groups', held: unassignMock, act: (c) => pickForAda(c, ''), outcome: { value: undefined } },
	{ guard: 'rosterSectionOps 98: move, assign lands', view: 'groups', held: assignMock, act: (c) => pickForAda(c, 'sec-alto'), outcome: { value: undefined } },
	{ guard: 'rosterSectionOps 110: move, unassign fails', view: 'groups', held: unassignMock, act: (c) => pickForAda(c, 'sec-alto'), outcome: BOOM },
	{ guard: 'rosterSectionOps 118: move, unassign lands', view: 'groups', held: unassignMock, act: (c) => pickForAda(c, 'sec-alto'), outcome: { value: undefined } },
	{ guard: 'sectionReorderOps 114: reparent lands', view: 'arrange', held: reparentMock, act: indentAlto, outcome: { value: undefined } },
	{ guard: 'sectionReorderOps 117: renumber lands', view: 'arrange', held: reorderMock, act: indentAlto, outcome: { value: undefined } },
	{ guard: 'sectionCreateOps 61: create fails', view: 'arrange', held: createMock, act: createChorus, outcome: BOOM, onReturn: openCreateForm }
];

describe('/roster — a section write settling after a switch away and back changes nothing (#790)', () => {
	it.each(ROWS.map((row) => [row.guard, row] as const))('%s', async (_, { view, held: mock, act, outcome, onReturn }) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const held = holdNext<unknown>(mock);
		const container = await renderView(view);

		await act(container);
		await waitFor(() => {
			expect(mock).toHaveBeenCalled();
		});
		await switchTo(container, 'other-choir', view === 'groups' ? 'section-toggle-sec-b1' : 'arrange-row-sec-b1');
		await switchTo(container, 'sampledb', view === 'groups' ? 'section-toggle-sec-sop' : 'arrange-row-sec-sop');
		if (view === 'groups') await openSoprano(container);
		await onReturn?.(container);

		await expectLateSettleChangesNothing(container, held, outcome, WRITES);
	});
});

// (*MVOX:Josquin*)
