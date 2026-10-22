// @vitest-environment happy-dom
// #1026: Entu reads a pending invite back as `invite: true`; the roster must show it as pending.
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
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
vi.mock('$lib/nav/dbRights', async (importOriginal) =>
	(await import('$lib/testing/mocks/admin')).dbRightOverRealModule(importOriginal)
);
vi.mock('$lib/roster/memberRecord', async (importOriginal) =>
	(await import('$lib/testing/mocks/roster')).memberRecordModule(importOriginal)
);
vi.mock('$lib/library/libraryRights', async (importOriginal) =>
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
import type { RosterRow } from '$lib/roster/rosterData';
import { dbEditRight, resetDbEditRight } from '$lib/nav/dbRights';
import { toListRead } from '$lib/testing/listReadFixtures';
import { listSectionsMock } from '$lib/testing/moduleHandles';
import { json } from '$lib/testing/entuFetchKit';
import {
	listJoinStateDetailsMock,
	resolveDbRightMock,
	withdrawInviteMock
} from '$lib/testing/mocks/admin';
import {
	listDeactivateBlockersMock,
	listInactiveMembersMock,
	loadInactiveRosterMock,
	loadMemberRecordMock,
	loadRosterMock
} from '$lib/testing/mocks/roster';
import { ORG_A } from '$lib/testing/pages/rosterFixtures';
import { setAuthed } from '$lib/testing/pages/roster';
import { treeA } from '$lib/testing/pages/rosterInvite';
import { resetAppState } from '$lib/testing/appReset';
import { q } from '$lib/testing/pages/dom';

const { listJoinStateDetails: realDetails } = await vi.importActual<
	typeof import('$lib/profile/linkedIdentities')
>('$lib/profile/linkedIdentities');
const { withdrawInvite: realWithdraw } =
	await vi.importActual<typeof import('$lib/invite/inviteSelfLink')>('$lib/invite/inviteSelfLink');

function rows(): RosterRow[] {
	return [
		{ memberId: 'm3', personId: 'pp-3', name: 'Carl Cantor', email: 'carl@profile.example', sectionIds: [], dbEntityId: ORG_A, createdAt: '2026-09-01T10:00:00.000Z' }
	];
}

type Entry = { _id: string; string: string; invite?: true; provider?: string };
let entuUser: Entry[];
let deletes: string[];

// The wire as entu-api credentialMask returns it: pending `{_id, string, invite: true}`.
const wire = vi.fn(async (url: string, init?: RequestInit) => {
	const u = String(url);
	const method = init?.method ?? 'GET';
	if (u.includes('/property/')) {
		const id = u.split('/property/')[1]?.split('?')[0] ?? '';
		if (method === 'DELETE') {
			deletes.push(id);
			entuUser = entuUser.filter((e) => e._id !== id);
			return json({ deleted: true });
		}
		return json({ _id: id, created: { at: new Date().toISOString() } });
	}
	const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
	const entity = { _id: id, _viewer: [{ reference: 'me' }], entu_user: entuUser };
	return json({ entity });
}) as unknown as typeof fetch;

beforeEach(() => {
	entuUser = [{ _id: 'eu-p', string: 'carl@person.example', invite: true }];
	deletes = [];
	listJoinStateDetailsMock.mockImplementation((cfg, ids) => realDetails(cfg, ids, wire));
	withdrawInviteMock.mockImplementation((cfg, personId) => realWithdraw(cfg, personId, wire));
	loadRosterMock.mockResolvedValue(toListRead(rows()));
	listSectionsMock.mockResolvedValue(treeA());
	resolveDbRightMock.mockResolvedValue('owner');
	loadInactiveRosterMock.mockResolvedValue(toListRead([]));
	listInactiveMembersMock.mockResolvedValue(toListRead([]));
	listDeactivateBlockersMock.mockResolvedValue([]);
	loadMemberRecordMock.mockResolvedValue({ state: 'none' });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	resetAppState();
	resetDbEditRight();
});

async function openRow() {
	const { container } = render(Page);
	setAuthed();
	dbEditRight.set('editor');
	await waitFor(() => expect(q(container, 'section-toggle-unassigned')).not.toBeNull());
	await fireEvent.click(q(container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(container, 'roster-row-card-m3')).not.toBeNull());
	await fireEvent.click(q(container, 'roster-row-card-m3')!);
	await waitFor(() => expect(q(container, 'roster-member-withdraw-m3')).not.toBeNull());
	return container;
}

const joinState = (c: HTMLElement) =>
	q(c, 'roster-row-join-state-m3')!.getAttribute('data-join-state');

describe('#1026 a pending invite (invite: true) reads as pending on the roster', () => {
	it('the row shows Resend and Withdraw, and never reads as joined', async () => {
		const container = await openRow();
		expect(q(container, 'roster-member-reinvite-m3')).not.toBeNull();
		expect(joinState(container)).toBe('invited');
		expect(container.textContent).not.toContain('roster_member_join_state_joined');
	});

	it('Withdraw DELETEs every pending entry by _id, and the row turns absent', async () => {
		entuUser.push({ _id: 'eu-p2', string: 'carl@person.example', invite: true });
		const container = await openRow();
		await fireEvent.click(q(container, 'roster-member-withdraw-m3')!);
		await waitFor(() => expect(q(container, 'roster-member-invite-m3')).not.toBeNull());
		expect(deletes).toEqual(['eu-p', 'eu-p2']);
		expect(joinState(container)).toBe('absent');
		expect(q(container, 'roster-withdraw-error-m3')).toBeNull();
	});

	it('nothing left to withdraw shows the visible error, never success, and refreshes the row', async () => {
		const container = await openRow();
		entuUser = [];
		await fireEvent.click(q(container, 'roster-member-withdraw-m3')!);
		await waitFor(() => expect(q(container, 'roster-withdraw-error-m3')).not.toBeNull());
		expect(q(container, 'roster-withdraw-error-m3')!.textContent?.trim()).toBe(
			'[roster_member_withdraw_failed]'
		);
		expect(deletes).toEqual([]);
		await waitFor(() => expect(joinState(container)).toBe('absent'));
	});
});

// (*MVOX:Josquin*)
