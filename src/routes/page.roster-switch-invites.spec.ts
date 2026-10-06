// @vitest-environment happy-dom
// An invite write from before a collective switch, settling late, changes nothing on screen.
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('plain')
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/roster/memberLifecycle', async () =>
	(await import('$lib/testing/mocks/roster')).memberLifecycleModule()
);
vi.mock('$lib/invite/inviteData', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).inviteWritesModule(importOriginal, { withdraw: true })
);
vi.mock('$lib/profile/linkedIdentities', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).joinStateDetailsModule(importOriginal)
);
vi.mock('$lib/nav/adminStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).ownerTierOverRealModule(importOriginal)
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal)
);
vi.mock('$lib/library/librarianStore', async (importOriginal) =>
	(await import('$lib/testing/mocks/library')).readyLibrarianModule(importOriginal)
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
import { adminStore } from '$lib/nav/adminStore';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import {
	listJoinStateDetailsMock,
	mintSelfLinkInviteMock,
	resolveOwnerTierMock,
	withdrawInviteMock
} from '$lib/testing/mocks/admin';
import { loadMemberRecordMock, loadRosterMock } from '$lib/testing/mocks/roster';
import { rowsA, rowsB, treeA, treeB } from '$lib/testing/pages/rosterFixtures';
import { openCard, setAuthedWithTwoCollectives } from '$lib/testing/pages/roster';
import { cleanupRestoreClipboard } from '$lib/testing/pages/rosterInvite';
import {
	expandGroup,
	expectLateSettleChangesNothing,
	holdNext,
	switchTo,
	type Outcome
} from '$lib/testing/pages/rosterSwitch';
import { q } from '$lib/testing/pages/dom';

const WRITES = [mintSelfLinkInviteMock, withdrawInviteMock];
const INVITED_AT = '2026-10-01T12:00:00.000Z';

beforeEach(() => {
	loadRosterMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(toListRead(cfg.db === 'sampledb' ? rowsA() : rowsB()))
	);
	listSectionsMock.mockImplementation((cfg: { db: string }) =>
		Promise.resolve(cfg.db === 'sampledb' ? treeA() : treeB())
	);
	listJoinStateDetailsMock.mockImplementation((_cfg: unknown, personIds: string[]) =>
		Promise.resolve(Object.fromEntries(personIds.map((id) => [id, { state: 'absent' }])))
	);
	resolveOwnerTierMock.mockResolvedValue('owner');
	mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: 'tok-a' });
	withdrawInviteMock.mockResolvedValue(undefined);
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanupRestoreClipboard();
	vi.restoreAllMocks();
});

async function renderOnA(): Promise<HTMLElement> {
	setAuthedWithTwoCollectives();
	adminStore.set('admin');
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'section-toggle-unassigned')).not.toBeNull();
	});
	return container;
}

async function showMember(container: HTMLElement, memberId: string): Promise<void> {
	await expandGroup(container, 'unassigned', `roster-row-${memberId}`);
	await openCard(container, memberId);
	await waitFor(() => {
		expect(q(container, `roster-member-invite-${memberId}`)).not.toBeNull();
	});
}

async function invite(container: HTMLElement, memberId: string, mock: Mock): Promise<void> {
	const calls = mock.mock.calls.length;
	await fireEvent.click(q(container, `roster-member-invite-${memberId}`) as HTMLElement);
	await waitFor(() => {
		expect(mock.mock.calls.length).toBeGreaterThan(calls);
	});
}

const ROWS: Array<{ guard: string; held: Mock; outcome: Outcome<unknown> }> = [
	{ guard: 'rosterInviteOps 18: the re-read after a mint lands', held: listJoinStateDetailsMock, outcome: { value: { 'p-ada': { state: 'invited', at: INVITED_AT } } } },
	{ guard: 'rosterInviteOps 38: the mint lands', held: mintSelfLinkInviteMock, outcome: { value: { inviteToken: 'tok-a' } } },
	{ guard: 'rosterInviteOps 43: the mint fails', held: mintSelfLinkInviteMock, outcome: { error: new Error('boom-a') } }
];

describe('/roster — an invite write settling after a switch changes nothing (#790)', () => {
	it.each(ROWS.map((row) => [row.guard, row] as const))('%s', async (_, row) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const container = await renderOnA();
		await showMember(container, 'm-ada');
		const held = holdNext<unknown>(row.held);

		await invite(container, 'm-ada', row.held);
		await switchTo(container, 'other-choir', 'section-toggle-sec-b1');
		await switchTo(container, 'sampledb', 'section-toggle-sec-sop');
		await showMember(container, 'm-ada');

		await expectLateSettleChangesNothing(container, held, row.outcome, WRITES);
	});

	it("rosterInviteOps 51: A's late mint keeps B's own mint controls busy", async () => {
		const container = await renderOnA();
		await showMember(container, 'm-ada');
		const heldA = holdNext<unknown>(mintSelfLinkInviteMock);
		await invite(container, 'm-ada', mintSelfLinkInviteMock);
		await switchTo(container, 'other-choir', 'section-toggle-sec-b1');
		await showMember(container, 'm-bob');
		holdNext<unknown>(mintSelfLinkInviteMock);
		await invite(container, 'm-bob', mintSelfLinkInviteMock);
		expect((q(container, 'roster-member-invite-m-bob') as HTMLButtonElement).disabled).toBe(true);

		await expectLateSettleChangesNothing(container, heldA, { value: { inviteToken: 'tok-a' } }, WRITES);
	});
});

// (*MVOX:Josquin*)
