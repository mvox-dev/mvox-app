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
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	createMemberRecordMock,
	loadMemberRecordMock,
	loadRosterMock,
	updateMemberRecordMock
} from '$lib/testing/mocks/roster';
import { rowsA, rowsB, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
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

const RECORDS: Record<string, string> = { 'p-ada': 'rec-ada', 'p-bob': 'rec-bob' };

function lookup(personId: string): MemberRecordLookup {
	return {
		state: 'one',
		record: { _id: RECORDS[personId], name: 'Old', phone: '', email: 'x@x.com', birthdate: '', id_code: '' }
	};
}

beforeEach(() => {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsB()))
	);
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

	it('A first save settling late leaves the second save of the same member locked', async () => {
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		const { container } = render(Page);
		const first = await startSaveInAThenSwitch(container);
		await switchTo(container, 'sampledb', 'section-toggle-sec-sop');
		await expandGroup(container, 'unassigned', 'roster-row-m-ada');

		const second = holdNext(updateMemberRecordMock);
		await rename(container, 'm-ada', 'Ada again');
		await waitFor(() => {
			expect(updates()).toEqual([
				['sampledb', 'rec-ada', { name: 'Ada A' }],
				['sampledb', 'rec-ada', { name: 'Ada again' }]
			]);
		});
		expect(editorDisabled(container)).toEqual(allAre(true));

		await expectLateSettleChangesNothing(container, first, { value: undefined }, WRITES);
		expect(editorDisabled(container)).toEqual(allAre(true));

		second.resolve(undefined);
		await waitFor(() => {
			expect(q(container, 'roster-record-name')).toBeNull();
		});
	});
});

// (*MVOX:Josquin*)
