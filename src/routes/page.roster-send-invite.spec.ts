// @vitest-environment happy-dom
// #1003: the roster's Invite and Resend ask Entu to email the invite to the person's own email.
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
import { reportProblem } from '$lib/testing/mocks/session';
import {
	listJoinStateDetailsMock,
	mintSelfLinkInviteMock,
	resolveDbRightMock,
	sendInviteMock
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

const { sendInvite: realSendInvite } =
	await vi.importActual<typeof import('$lib/invite/sendInvite')>('$lib/invite/sendInvite');

// Profile emails differ from person emails: the roster row's email must never be the target.
function rows(): RosterRow[] {
	return [
		{ memberId: 'm3', personId: 'pp-3', name: 'Carl Cantor', email: 'carl@profile.example', sectionIds: [], dbEntityId: ORG_A },
		{ memberId: 'm4', personId: 'pp-4', name: 'Dora Descant', email: 'dora@profile.example', sectionIds: [], dbEntityId: ORG_A }
	];
}

let personEmails: Record<string, string[]>;
let sendStatus: number;
let posts: Array<{ url: string; body: unknown }>;

const wire = vi.fn(async (url: string, init?: RequestInit) => {
	const method = init?.method ?? 'GET';
	const personId = String(url).split('/entity/')[1]?.split('?')[0] ?? '';
	if (method === 'POST') {
		posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return json({ _id: personId }, sendStatus);
	}
	const email = (personEmails[personId] ?? []).map((string, i) => ({ _id: `em-${i}`, string }));
	return json({ entity: { _id: personId, _viewer: [{ reference: 'me' }], email } });
}) as unknown as typeof fetch;

beforeEach(() => {
	personEmails = { 'pp-3': ['carl@person.example'], 'pp-4': ['dora@person.example'] };
	sendStatus = 200;
	posts = [];
	sendInviteMock.mockImplementation((cfg, personId) => realSendInvite(cfg, personId, wire));
	loadRosterMock.mockResolvedValue(toListRead(rows()));
	listSectionsMock.mockResolvedValue(treeA());
	listJoinStateDetailsMock.mockResolvedValue({
		'pp-3': { state: 'invited', at: '2026-09-10T12:00:00.000Z' },
		'pp-4': { state: 'absent' }
	});
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

async function clickInvite(producer: 'invite' | 'reinvite', memberId: string) {
	const utils = render(Page);
	setAuthed();
	dbEditRight.set('editor');
	const { container } = utils;
	await waitFor(() => expect(q(container, 'section-toggle-unassigned')).not.toBeNull());
	await fireEvent.click(q(container, 'section-toggle-unassigned')!);
	await waitFor(() => expect(q(container, `roster-row-card-${memberId}`)).not.toBeNull());
	await fireEvent.click(q(container, `roster-row-card-${memberId}`)!);
	const id = `roster-member-${producer}-${memberId}`;
	await waitFor(() => expect(q(container, id)).not.toBeNull());
	await fireEvent.click(q(container, id)!);
	return container;
}

describe('#1003 Invite and Resend send the invite by email', () => {
	it.each([
		['invite', 'm4', 'pp-4', 'dora@person.example'],
		['reinvite', 'm3', 'pp-3', 'carl@person.example']
	] as const)('%s POSTs send-invite for that person and shows "Sent to" its person email', async (producer, memberId, personId, email) => {
		const container = await clickInvite(producer, memberId);
		await waitFor(() => expect(q(container, `roster-invite-sent-${memberId}`)).not.toBeNull());
		expect(q(container, `roster-invite-sent-${memberId}`)!.textContent).toContain(
			`[roster_member_invite_sent {"email":"${email}"}]`
		);
		expect(posts).toEqual([
			{
				url: `https://api.entu-test.invalid/sampledb/entity/${personId}`,
				body: [{ type: 'entu_user', string: 'send-invite' }]
			}
		]);
		expect(mintSelfLinkInviteMock).not.toHaveBeenCalled();
		expect(container.textContent).not.toContain('profile.example');
		expect(q(container, `roster-invite-copy-${memberId}`)).toBeNull();
	});

	it('a member with a profile email but no person email: nothing is sent, and the no-email message shows', async () => {
		personEmails['pp-4'] = [];
		const container = await clickInvite('invite', 'm4');
		await waitFor(() => expect(q(container, 'roster-invite-no-email-m4')).not.toBeNull());
		expect(q(container, 'roster-invite-no-email-m4')!.textContent).toContain(
			'[roster_member_invite_no_email]'
		);
		expect(posts).toEqual([]);
		expect(q(container, 'roster-invite-sent-m4')).toBeNull();
		expect(container.textContent).not.toContain('dora@profile.example');
	});

	it('a refused send shows the plain error, sends one report, and no API text appears', async () => {
		sendStatus = 403;
		const container = await clickInvite('invite', 'm4');
		await waitFor(() => expect(q(container, 'roster-invite-error-m4')).not.toBeNull());
		const alert = q(container, 'roster-invite-error-m4')!;
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent?.trim()).toBe('[roster_member_invite_send_failed]');
		expect(reportProblem).toHaveBeenCalledTimes(1);
		expect(reportProblem.mock.calls[0][0]).toMatchObject({ area: 'roster' });
		expect(container.textContent).not.toMatch(/HTTP|403|contract|admin_invite_error/);
		expect(q(container, 'roster-invite-sent-m4')).toBeNull();
	});
});

// (*MVOX:Josquin*)
