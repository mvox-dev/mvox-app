// @vitest-environment happy-dom
// A record save in flight in one collective must not lock the next one's record editor (#819).
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal, { writes: true })
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
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
import type { MemberRecordLookup } from '$lib/roster/memberRecord';
import type { RosterRow } from '$lib/roster/rosterData';
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	createMemberRecordMock,
	loadMemberRecordMock,
	loadRosterMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { ORG_B, rowsA, rowsB, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
import { cleanupClearResetAdmin, setAuthedWithTwoCollectives } from '$lib/testing/pages/roster';
import { nameInput, openEditor } from '$lib/testing/pages/rosterRecordEditor';
import {
	expandGroup,
	expectLateSettleChangesNothing,
	holdNext,
	switchTo
} from '$lib/testing/pages/rosterSwitch';
import { q } from '$lib/testing/pages/dom';

const WRITES = [createMemberRecordMock, updateMemberRecordMock];
const EDITOR = ['name', 'phone', 'email', 'birthdate', 'id-code', 'save'];

const RECORDS: Record<string, string> = { 'p-ada': 'rec-ada', 'p-bob': 'rec-bob', 'p-ada-b': 'rec-ada-b' };

function lookup(personId: string): MemberRecordLookup {
	return {
		state: 'one',
		record: { _id: RECORDS[personId], name: 'Old', phone: '', email: 'x@x.com', birthdate: '', id_code: '' }
	};
}

// Collective B's member that shares A's member id: ids are per database, so they can collide.
const adaInB: RosterRow = { ...rowsB()[0], memberId: 'm-ada', personId: 'p-ada-b', dbEntityId: ORG_B };

function serve(rowsInB: RosterRow[]): void {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsInB))
	);
}

beforeEach(() => {
	serve(rowsB());
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	loadMemberRecordMock.mockImplementation((_cfg: unknown, personId: string) =>
		Promise.resolve(lookup(personId))
	);
	createMemberRecordMock.mockResolvedValue('rec-new');
	updateMemberRecordMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanupClearResetAdmin();
	vi.restoreAllMocks();
});

function editorDisabled(container: HTMLElement): Record<string, boolean> {
	return Object.fromEntries(
		EDITOR.map((f) => [f, (q(container, `roster-record-${f}`) as HTMLInputElement).disabled])
	);
}

const allAre = (disabled: boolean) => Object.fromEntries(EDITOR.map((f) => [f, disabled]));

async function rename(container: HTMLElement, memberId: string, name: string): Promise<void> {
	await openEditor(container, memberId);
	await waitFor(() => {
		expect(nameInput(container).value).toBe('Old');
	});
	await fireEvent.input(nameInput(container), { target: { value: name } });
	await fireEvent.click(q(container, 'roster-record-save') as HTMLElement);
}

function updates(): [string, string, unknown][] {
	return updateMemberRecordMock.mock.calls.map(([cfg, id, changes]) => [
		(cfg as { db: string }).db,
		id as string,
		changes
	]);
}

async function startSaveInAThenSwitch(container: HTMLElement) {
	await waitFor(() => {
		expect(q(container, 'section-toggle-unassigned')).not.toBeNull();
	});
	await expandGroup(container, 'unassigned', 'roster-row-m-ada');
	const heldA = holdNext(updateMemberRecordMock);
	await rename(container, 'm-ada', 'Ada A');
	await waitFor(() => {
		expect(updates()).toEqual([['sampledb', 'rec-ada', { name: 'Ada A' }]]);
	});
	await switchTo(container, 'other-choir', 'section-toggle-sec-b1');
	return heldA;
}

describe('/roster — a record save in flight does not lock the next collective (#819)', () => {
	it('B record editor is enabled and B save goes through while A save is in flight', async () => {
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		const { container } = render(Page);
		const heldA = await startSaveInAThenSwitch(container);
		await expandGroup(container, 'unassigned', 'roster-row-m-bob');

		await openEditor(container, 'm-bob');
		await waitFor(() => {
			expect(nameInput(container).value).toBe('Old');
		});
		expect(editorDisabled(container)).toEqual(allAre(false));
		await fireEvent.input(nameInput(container), { target: { value: 'Bob B' } });
		await fireEvent.click(q(container, 'roster-record-save') as HTMLElement);

		await waitFor(() => {
			expect(updates()).toEqual([
				['sampledb', 'rec-ada', { name: 'Ada A' }],
				['other-choir', 'rec-bob', { name: 'Bob B' }]
			]);
		});
		await waitFor(() => {
			expect(q(container, 'roster-record-name')).toBeNull();
		});
		await expectLateSettleChangesNothing(container, heldA, { value: undefined }, WRITES);
	});

	it('A late settle leaves B save of the same member id locked until B settles', async () => {
		serve([adaInB]);
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		const { container } = render(Page);
		const heldA = await startSaveInAThenSwitch(container);
		await expandGroup(container, 'unassigned', 'roster-row-m-ada');

		const heldB = holdNext(updateMemberRecordMock);
		await rename(container, 'm-ada', 'Ada B');
		await waitFor(() => {
			expect(updates()).toEqual([
				['sampledb', 'rec-ada', { name: 'Ada A' }],
				['other-choir', 'rec-ada-b', { name: 'Ada B' }]
			]);
		});
		expect(editorDisabled(container)).toEqual(allAre(true));

		await expectLateSettleChangesNothing(container, heldA, { value: undefined }, WRITES);
		expect(editorDisabled(container)).toEqual(allAre(true));

		heldB.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'roster-record-name')).toBeNull();
		});
	});
});

// (*MVOX:Josquin*)
