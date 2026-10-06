// @vitest-environment happy-dom
// A record editor read or save from before a switch away and back leaves the reopened editor alone.
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
	switchTo,
	type Outcome
} from '$lib/testing/pages/rosterSwitch';
import { q } from '$lib/testing/pages/dom';

const WRITES = [createMemberRecordMock, updateMemberRecordMock];

function lookup(name: string): MemberRecordLookup {
	return {
		state: 'one',
		record: { _id: 'rec-ada', name, phone: '', email: 'ada@x.com', birthdate: '', id_code: '' }
	};
}

beforeEach(() => {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsB()))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	loadMemberRecordMock.mockResolvedValue(lookup('Ada Lovelace'));
	createMemberRecordMock.mockResolvedValue('rec-new');
	updateMemberRecordMock.mockResolvedValue(undefined);
});

afterEach(() => {
	cleanupClearResetAdmin();
	vi.restoreAllMocks();
});

const showAda = (container: HTMLElement) =>
	expandGroup(container, 'unassigned', 'roster-row-m-ada');

async function clickAda(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'roster-row-card-m-ada') as HTMLElement);
}

async function saveRename(container: HTMLElement): Promise<void> {
	await openEditor(container, 'm-ada');
	await fireEvent.input(nameInput(container), { target: { value: 'Ada Renamed' } });
	await fireEvent.click(q(container, 'roster-record-save') as HTMLElement);
}

interface Row {
	guard: string;
	held: Mock;
	start: (container: HTMLElement) => Promise<void>;
	outcome: Outcome<unknown>;
	holdAfterOpen?: boolean;
}

const BOOM = { error: new Error('boom-a') };

const ROWS: Row[] = [
	{ guard: 'rosterRecordOps 25: the open read lands', held: loadMemberRecordMock, start: clickAda, outcome: { value: lookup('Ada Stale') } },
	{ guard: 'rosterRecordOps 47: the open read fails', held: loadMemberRecordMock, start: clickAda, outcome: BOOM },
	{ guard: 'rosterRecordOps 91: the save re-read lands', held: loadMemberRecordMock, start: saveRename, outcome: { value: lookup('Ada Lovelace') }, holdAfterOpen: true },
	{ guard: 'rosterRecordOps 123: the save lands', held: updateMemberRecordMock, start: saveRename, outcome: { value: undefined } },
	{ guard: 'rosterRecordOps 129: the save fails', held: updateMemberRecordMock, start: saveRename, outcome: BOOM }
];

describe('/roster — a record editor settle from before a switch away and back changes nothing (#790)', () => {
	it.each(ROWS.map((row) => [row.guard, row] as const))('%s', async (_, row) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		setAuthedWithTwoCollectives();
		adminStore.set('admin');
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'section-toggle-unassigned')).not.toBeNull();
		});
		await showAda(container);
		if (row.holdAfterOpen) {
			loadMemberRecordMock.mockImplementationOnce(() => Promise.resolve(lookup('Ada Lovelace')));
		}
		const held = holdNext<unknown>(row.held);
		const callsBefore = row.held.mock.calls.length;

		await row.start(container);
		await waitFor(() => {
			expect(row.held.mock.calls.length).toBeGreaterThan(callsBefore + (row.holdAfterOpen ? 1 : 0));
		});
		await switchTo(container, 'other-choir', 'section-toggle-sec-b1');
		await switchTo(container, 'sampledb', 'section-toggle-sec-sop');
		await showAda(container);
		await openEditor(container, 'm-ada');
		await waitFor(() => {
			expect(nameInput(container).value).toBe('Ada Lovelace');
		});

		await expectLateSettleChangesNothing(container, held, row.outcome, WRITES, {
			lockClears: row.start === saveRename
		});
	});
});

// (*MVOX:Josquin*)
