// @vitest-environment happy-dom
// #1031: both invite paths send through send-invite; a new person is created with the email first.
import { toListRead } from '$lib/testing/listReadFixtures';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/adminCopy')).adminMessages()
);

const h = vi.hoisted(() => ({
	mintSelfLinkInviteMock: vi.fn(),
	listJoinStatesMock: vi.fn(),
	listLinkedIdentitiesMock: vi.fn()
}));
vi.mock('$lib/problems/reportProblem', async () =>
	(await import('$lib/testing/mocks/session')).reportProblemModule()
);
vi.mock('$lib/admin/roleManagement', async () =>
	(await import('$lib/testing/mocks/admin')).roleManagementModule()
);
vi.mock('$lib/nav/dbRights', async () =>
	(await import('$lib/testing/mocks/admin')).dbRightsModule()
);
vi.mock('$lib/library/libraryRights', async () =>
	(await import('$lib/testing/mocks/admin')).libraryRightsModule()
);
vi.mock('$lib/collective/databaseEntity', async () =>
	(await import('$lib/testing/moduleHandles')).entityIdModule()
);
vi.mock('$lib/roster/rosterData', async () =>
	(await import('$lib/testing/mocks/roster')).rosterModule()
);
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/collectiveName', async () =>
	(await import('$lib/testing/mocks/admin')).collectiveNameModule()
);
vi.mock('$lib/invite/inviteData', async () => ({
	...(await import('$lib/testing/mocks/admin')).inviteDataModule({ errors: true }),
	mintSelfLinkInvite: h.mintSelfLinkInviteMock
}));
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: h.listLinkedIdentitiesMock,
	listJoinStates: h.listJoinStatesMock
}));
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './profile/+page.svelte';
import { expectWholeTextMarkedOnce } from '$lib/testing/nameMarker';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	InviteCreateError,
	createInviteMock,
	listAdminsMock,
	listLibrariansMock,
	resolveDbEditRightMock,
	resolveCollectiveNameMarkerMock,
	resolveInviteParentMock,
	resolveLibraryEditRightMock,
	resolveDbRightMock,
	resolveParentMock,
	sendInviteMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { reportProblem } from '$lib/testing/mocks/session';
import { ANNA, ROSTER, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupReset, q } from '$lib/testing/pages/dom';
import { json } from '$lib/testing/entuFetchKit';
import { dbEditRight } from '$lib/nav/dbRights';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';

const { createInvite: realCreateInvite } =
	await vi.importActual<typeof import('$lib/invite/inviteCreate')>('$lib/invite/inviteCreate');
const { sendInvite: realSendInvite } =
	await vi.importActual<typeof import('$lib/invite/sendInvite')>('$lib/invite/sendInvite');

type Call = { method: string; url: string; body: Array<{ type: string; string?: string }> | null };
let calls: Call[];
let personEmails: Record<string, string[]>;
let sendStatus: number;

// Entu's real shape: a pending invite reads back as `invite: true`, never a token.
const wire = vi.fn(async (url: string, init?: RequestInit) => {
	const u = String(url);
	const method = init?.method ?? 'GET';
	const body = init?.body ? (JSON.parse(String(init.body)) as Call['body']) : null;
	calls.push({ method, url: u, body });
	if (u.includes('name.string=person')) return json({ entities: [{ _id: 'person-type-1' }] });
	if (u.includes('name.string=member')) return json({ entities: [{ _id: 'member-type-1' }] });
	const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
	const invite = { _id: 'eu-1', type: 'entu_user', invite: true };
	if (method === 'GET') {
		const email = (personEmails[id] ?? []).map((string, i) => ({ _id: `em-${i}`, string }));
		return json({ entity: { _id: id, _viewer: [{ reference: 'admin-p' }], email, entu_user: [invite] } });
	}
	if (id) return json({ _id: id }, body?.some((p) => p.string === 'send-invite') ? sendStatus : 200);
	if (body?.some((p) => p.type === 'email')) return json({ _id: 'p-new', properties: [invite] });
	return json({ _id: 'm-new' });
}) as unknown as typeof fetch;

const posts = () => calls.filter((c) => c.method === 'POST');
const sendPosts = () =>
	posts().filter((c) => c.body?.some((p) => p.type === 'entu_user' && p.string === 'send-invite'));

const JOIN_STATES = {
	'p-anna': 'joined',
	'p-bela': 'invited',
	'p-cilla': 'absent',
	'p-dora': 'absent'
} as const;

function loadOk() {
	resolveDbEditRightMock.mockResolvedValue('editor');
	dbEditRight.set('editor');
	resolveDbRightMock.mockResolvedValue('owner');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibraryEditRightMock.mockResolvedValue({ state: 'editor', libraryId: 'lib-1' });
	listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	h.listJoinStatesMock.mockResolvedValue({ ...JOIN_STATES });
	createInviteMock.mockImplementation((cfg, input) => realCreateInvite(cfg, input, wire));
	sendInviteMock.mockImplementation((cfg, personId) => realSendInvite(cfg, personId, wire));
	resolveParentMock.mockResolvedValue('parent-1');
	resolveInviteParentMock.mockResolvedValue('org-1');
	resolveCollectiveNameMarkerMock.mockResolvedValue({ markerId: 'marker-1', name: 'Sampledb' });
	updateCollectiveNameMock.mockResolvedValue(undefined);
}

async function renderInviteReady(): Promise<{ container: HTMLElement; section: HTMLElement }> {
	const { container } = render(Page);
	await waitFor(() => {
		const submit = q<HTMLButtonElement>(container, 'invite-admin-submit');
		expect(submit).not.toBeNull();
		expect(submit!.disabled).toBe(false);
	});
	const section = q<HTMLElement>(container, 'admin-invite-section')!;
	expect(section).not.toBeNull();
	return { container, section };
}

function personSelect(section: HTMLElement): HTMLSelectElement {
	const select = q<HTMLSelectElement>(section, 'invite-person-select');
	expect(select, 'expected [data-testid="invite-person-select"]').not.toBeNull();
	expect(select!.tagName).toBe('SELECT'); // native control (house rule)
	return select!;
}

function options(select: HTMLSelectElement): HTMLOptionElement[] {
	return Array.from(select.querySelectorAll('option'));
}

async function pick(select: HTMLSelectElement, value: string): Promise<void> {
	await fireEvent.change(select, { target: { value } });
}

function submitButton(section: HTMLElement): HTMLButtonElement {
	return q<HTMLButtonElement>(section, 'invite-admin-submit')!;
}

async function submitNew(section: HTMLElement, email = 'mari@example.com'): Promise<void> {
	await fireEvent.input(q(section, 'invite-email')!, { target: { value: email } });
	await fireEvent.click(submitButton(section));
}

const statusText = (section: HTMLElement) => q(section, 'invite-send-status')?.textContent ?? '';

beforeEach(() => {
	calls = [];
	personEmails = { 'p-cilla': ['cilla@person.example'], 'p-new': ['mari@example.com'] };
	sendStatus = 200;
	resetTypeIdCache();
	reportProblem.mockReset();
	sendInviteMock.mockReset();
	for (const mock of Object.values(h)) {
		if (typeof mock === 'function' && 'mockReset' in mock) {
			(mock as ReturnType<typeof vi.fn>).mockReset();
		}
	}
	listSectionsMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	listAdminsMock.mockReset();
	listLibrariansMock.mockReset();
	resolveDbEditRightMock.mockReset();
	resolveCollectiveNameMarkerMock.mockReset();
	resolveLibraryEditRightMock.mockReset();
	resolveDbRightMock.mockReset();
	updateCollectiveNameMock.mockReset();
	createInviteMock.mockReset();
	resolveInviteParentMock.mockReset();
	resolveParentMock.mockReset();
});

afterEach(cleanupReset);

describe('#301 /admin invite — the person select (owner, uninvited persons present)', () => {
	it('renders a labelled native select defaulting to "a new person", listing ONLY absent-state persons (withdrawn in, invited/joined out), placed between the collective line and the submit button', async () => {
		selectSampledb();
		loadOk();
		const { section } = await renderInviteReady();

		const select = await waitFor(() => personSelect(section));

		const label = select.closest('label');
		expect(label, 'the select must sit inside its <label>').not.toBeNull();
		expect(label!.textContent).toContain('Who are you inviting?');

		const opts = options(select);
		expect(opts.map((o) => o.value)).toEqual(['', 'p-cilla', 'p-dora']);
		expect(opts[0].textContent?.trim()).toBe('A new person');
		expect(opts[1].textContent?.trim()).toBe('Cilla Cane');
		expect(opts[2].textContent?.trim()).toBe('Dora Duncan');

		expect(select.value).toBe('');
		expect(opts[0].disabled).toBe(false);
		expect(opts[0].hidden).toBe(false);

		const ordered = Array.from(section.querySelectorAll('[data-testid]')).map((el) =>
			el.getAttribute('data-testid')
		);
		expect(ordered.indexOf('invite-db-fixed')).toBeLessThan(ordered.indexOf('invite-person-select'));
		expect(ordered.indexOf('invite-person-select')).toBeLessThan(
			ordered.indexOf('invite-admin-submit')
		);

		const [jsCfg, jsIds] = h.listJoinStatesMock.mock.calls[0] as [
			{ db: string; token: string },
			string[]
		];
		expect(jsCfg).toMatchObject({ db: 'sampledb', token: 'jwt-admin' });
		expect([...jsIds].sort()).toEqual(['p-anna', 'p-bela', 'p-cilla', 'p-dora']);

		expect(resolveDbRightMock).toHaveBeenCalled();
		const tierCall = resolveDbRightMock.mock.calls[0];
		expect(tierCall[0]).toMatchObject({ db: 'sampledb', token: 'jwt-admin' });
		expect(tierCall[1]).toBe('admin-p');
		expect(tierCall[3]).toBe('org-1');
	});
});

describe('#1031 /admin invite — both paths send through send-invite', () => {
	it('a new person: the create body carries the email and no mint trigger, then send-invite goes to the new id', async () => {
		selectSampledb();
		loadOk();
		const { section } = await renderInviteReady();
		await waitFor(() => personSelect(section));
		await submitNew(section);

		await waitFor(() => expect(statusText(section)).toContain('Sent to mari@example.com'));
		const create = posts().find((c) => /\/entity$/.test(c.url) && c.body?.some((p) => p.type === 'email'));
		expect(create?.body).toEqual([
			{ type: '_type', reference: 'person-type-1' },
			{ type: '_parent', reference: 'org-1' },
			{ type: 'email', string: 'mari@example.com' }
		]);
		const mintTriggers = posts().filter((c) =>
			c.body?.some((p) => p.type === 'entu_user' && p.string !== 'send-invite')
		);
		expect(mintTriggers).toEqual([]);
		expect(sendPosts().map((c) => c.url.split('/entity/')[1])).toEqual(['p-new']);
		expect(sendPosts()[0].url).toContain('/sampledb/');
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it('an existing person with a person email: one send-invite POST for that id, "Sent to <email>", no create, no mint', async () => {
		selectSampledb();
		loadOk();
		const { section } = await renderInviteReady();
		await pick(await waitFor(() => personSelect(section)), 'p-cilla');
		expect(q(section, 'invite-email')).toBeNull();
		await fireEvent.click(submitButton(section));

		await waitFor(() => expect(statusText(section)).toContain('Sent to cilla@person.example'));
		expect(posts()).toHaveLength(1);
		expect(sendPosts().map((c) => c.url.split('/entity/')[1])).toEqual(['p-cilla']);
		expect(sendInviteMock.mock.calls[0][0]).toMatchObject({ db: 'sampledb', token: 'jwt-admin' });
		expect(createInviteMock).not.toHaveBeenCalled();
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
		expect(q(section, 'invite-copy')).toBeNull();
	});

	it('an existing person with no person email: no request goes out and the no-email message shows', async () => {
		selectSampledb();
		loadOk();
		personEmails = {};
		const { section } = await renderInviteReady();
		await pick(await waitFor(() => personSelect(section)), 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() =>
			expect(statusText(section)).toContain('This member has no email address, so no invite was sent.')
		);
		expect(posts()).toEqual([]);
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it("the submit button's visible label (= accessible name: plain button, no aria-label) states which behaviour fires, and flips with the selection", async () => {
		selectSampledb();
		loadOk();
		const { section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));
		const submit = submitButton(section);

		expect(submit.getAttribute('aria-label')).toBeNull();
		expect(submit.textContent?.trim()).toBe('Create invite');

		await pick(select, 'p-cilla');
		await waitFor(() => {
			expect(submit.textContent?.trim()).toBe('Invite Cilla Cane');
		});

		await pick(select, '');
		await waitFor(() => {
			expect(submit.textContent?.trim()).toBe('Create invite');
		});
		expect(q(section, 'invite-email')).not.toBeNull();
	});
});

describe('#301 /admin invite — when the select is not rendered', () => {
	it('no uninvited persons → NO select at all (not disabled, not empty — absent), and the new-person invite still sends', async () => {
		selectSampledb();
		loadOk();
		h.listJoinStatesMock.mockResolvedValue({
			'p-anna': 'joined',
			'p-bela': 'invited',
			'p-cilla': 'joined',
			'p-dora': 'invited'
		});
		const { section } = await renderInviteReady();
		await waitFor(() => {
			expect(h.listJoinStatesMock).toHaveBeenCalled();
		});
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();

		await submitNew(section);
		await waitFor(() => expect(statusText(section)).toContain('Sent to mari@example.com'));
		expect(createInviteMock).toHaveBeenCalledTimes(1);
	});

	it('non-owner admin (editor tier) → no select, the existing owner-rights explanation, and the new-person invite still sends', async () => {
		selectSampledb();
		loadOk();
		resolveDbRightMock.mockResolvedValue('editor');
		const { section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-owner-note')).not.toBeNull();
		});
		expect(q(section, 'invite-owner-note')!.textContent).toContain(
			'Managing invites requires owner rights.'
		);
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();

		await submitNew(section);
		await waitFor(() => expect(statusText(section)).toContain('Sent to mari@example.com'));
		expect(createInviteMock).toHaveBeenCalledTimes(1);
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it("owner tier 'error' → no select (an affordance is never rendered off an unresolved rights answer)", async () => {
		selectSampledb();
		loadOk();
		resolveDbRightMock.mockResolvedValue('error');
		const { section } = await renderInviteReady();
		await waitFor(() => {
			expect(resolveDbRightMock).toHaveBeenCalled();
		});
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();
	});

	it('listJoinStates fails loud → a visible note (no silently-missing select), and the new-person invite stays fully available', async () => {
		selectSampledb();
		loadOk();
		const boom = new Error('listLinkedIdentities: identity read failed: HTTP 500');
		h.listJoinStatesMock.mockRejectedValue(boom);
		const { container, section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-person-list-error')).not.toBeNull();
		});
		expect(q(section, 'invite-person-list-error')!.textContent).toContain(
			'Could not load the list of uninvited people.'
		);
		expect(container.textContent).not.toContain('HTTP 500');
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(reportProblem).toHaveBeenCalledWith({
			area: 'admin/invite',
			action: 'loading the join states',
			error: boom
		});

		expect(submitButton(section).disabled).toBe(false);
		await submitNew(section);
		await waitFor(() => expect(statusText(section)).toContain('Sent to mari@example.com'));
		expect(createInviteMock).toHaveBeenCalledTimes(1);
	});
});

describe('#1031 /admin invite — a rejected send shows the plain error', () => {
	it('a 403 send shows the plain error, sends one report, never the contract or platform text; the selection survives', async () => {
		selectSampledb();
		loadOk();
		sendStatus = 403;
		const { container, section } = await renderInviteReady();
		await pick(await waitFor(() => personSelect(section)), 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(section, 'invite-send-error')?.textContent).toContain(
				"Couldn't send the invite. Please try again."
			);
		});
		expect(q(section, 'invite-send-error')!.getAttribute('role')).toBe('alert');
		const inviteReports = reportProblem.mock.calls.filter(([p]) => p.area === 'admin/invite');
		expect(inviteReports).toHaveLength(1);
		expect(inviteReports[0][0]).toMatchObject({ action: 'sending an invite' });
		expect(container.textContent).not.toMatch(/contract|HTTP 403|invite token/i);
		expect(container.textContent).not.toContain('Invite creation failed.');
		expect(q(container, 'invite-partial-failure')).toBeNull();
		expect(statusText(section)).toBe('');

		expect(personSelect(section).value).toBe('p-cilla');
		expect(submitButton(section).textContent?.trim()).toBe('Invite Cilla Cane');
	});

	it('a new person whose send fails joins the person list, picked, so a retry sends to them without a second create', async () => {
		selectSampledb();
		loadOk();
		sendStatus = 500;
		const { section } = await renderInviteReady();
		await waitFor(() => personSelect(section));
		await submitNew(section);

		await waitFor(() => expect(q(section, 'invite-send-error')).not.toBeNull());
		const select = personSelect(section);
		expect(options(select).map((o) => o.value)).toEqual(['', 'p-cilla', 'p-dora', 'p-new']);
		expect(select.value).toBe('p-new');
		expect(options(select)[3].textContent?.trim()).toBe('mari@example.com');

		sendStatus = 200;
		await fireEvent.click(submitButton(section));
		await waitFor(() => expect(statusText(section)).toContain('Sent to mari@example.com'));
		expect(createInviteMock).toHaveBeenCalledTimes(1);
		expect(sendPosts().map((c) => c.url.split('/entity/')[1])).toEqual(['p-new', 'p-new']);
		expect(q(section, 'invite-send-error')).toBeNull();
		expect(options(personSelect(section)).map((o) => o.value)).toEqual(['', 'p-cilla', 'p-dora']);
	});
});

describe('/admin invite — a failed read is reported (#756)', () => {
	it('a failed owner-tier read is reported', async () => {
		selectSampledb();
		loadOk();
		const boom = new Error('tier read failed');
		resolveDbRightMock.mockRejectedValue(boom);
		await renderInviteReady();
		await waitFor(() =>
			expect(reportProblem).toHaveBeenCalledWith({
				area: 'admin/invite',
				action: 'reading the owner tier',
				error: boom
			})
		);
	});

	it('a failed re-read after a send is reported and "Sent to" still shows', async () => {
		selectSampledb();
		loadOk();
		const boom = new Error('join-state re-read failed');
		h.listJoinStatesMock.mockResolvedValueOnce({ ...JOIN_STATES }).mockRejectedValue(boom);
		const { section } = await renderInviteReady();
		await pick(await waitFor(() => personSelect(section)), 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => expect(statusText(section)).toContain('Sent to cilla@person.example'));
		expect(reportProblem).toHaveBeenCalledWith({
			area: 'admin/invite',
			action: 're-reading the join state after an invite',
			error: boom
		});
	});
});

describe('#301 /admin invite — after a successful send', () => {
	it('the uninvited list is RE-DERIVED: the person is gone from the options and the select is back to its default', async () => {
		selectSampledb();
		loadOk();
		h.listJoinStatesMock
			.mockResolvedValueOnce({ ...JOIN_STATES })
			.mockResolvedValue({ ...JOIN_STATES, 'p-cilla': 'invited' });

		const { section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));
		expect(options(select).map((o) => o.value)).toEqual(['', 'p-cilla', 'p-dora']);

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => expect(statusText(section)).toContain('Sent to cilla@person.example'));

		await waitFor(() => {
			expect(options(personSelect(section)).map((o) => o.value)).toEqual(['', 'p-dora']);
		});
		expect(h.listJoinStatesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(personSelect(section).value).toBe('');
		expect(submitButton(section).textContent?.trim()).toBe('Create invite');
	});
});

describe('#301 /admin invite — the two error surfaces never cross paths', () => {
	it('a failed send clears when the selection returns to "a new person"', async () => {
		selectSampledb();
		loadOk();
		sendStatus = 500;
		const { section } = await renderInviteReady();
		await pick(await waitFor(() => personSelect(section)), 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => expect(q(section, 'invite-send-error')).not.toBeNull());

		await pick(personSelect(section), '');
		await waitFor(() => {
			expect(submitButton(section).textContent?.trim()).toBe('Create invite');
		});
		expect(q(section, 'invite-send-error')).toBeNull();
	});

	it('a failed new-person create never stacks with a later send failure — one surface at a time', async () => {
		selectSampledb();
		loadOk();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		createInviteMock.mockRejectedValue(
			new InviteCreateError('person create failed: HTTP 500', {
				phase: 'person-create',
				reason: 'http'
			})
		);
		sendStatus = 500;
		const { container, section } = await renderInviteReady();
		await waitFor(() => personSelect(section));

		await submitNew(section);
		await waitFor(() => {
			expect(q(container, 'invite-admin-error')).not.toBeNull();
		});

		await pick(personSelect(section), 'p-cilla');
		await waitFor(() => {
			expect(q(container, 'invite-admin-error')).toBeNull();
		});

		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(section, 'invite-send-error')).not.toBeNull();
		});
		expect(q(container, 'invite-admin-error')).toBeNull();
		expect(container.textContent).not.toContain('Invite creation failed.');
		vi.mocked(console.error).mockRestore();
	});
});

describe('#301 /admin invite — the uninvited-list read is owner-gated', () => {
	it('an editor-tier admin triggers NO listJoinStates fan-out, and still gets the owner-rights explanation', async () => {
		selectSampledb();
		loadOk();
		resolveDbRightMock.mockResolvedValue('editor');
		const { section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-owner-note')).not.toBeNull();
		});
		expect(resolveDbRightMock).toHaveBeenCalled();
		expect(h.listJoinStatesMock).not.toHaveBeenCalled();
		expect(q(section, 'invite-person-list-error')).toBeNull();
		expect(q(section, 'invite-person-select')).toBeNull();
	});
});

describe('/admin invite — the person select states a truncated roster (#321)', () => {
	const NOTICE = 'invite-person-partial-notice';

	it('a truncated roster read renders the shared role="status" notice in the invite section', async () => {
		selectSampledb();
		loadOk();
		loadRosterMock.mockReset().mockResolvedValue({ items: ROSTER, total: 500, truncated: true });

		const { section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, NOTICE)).not.toBeNull();
		});
		expect(q(section, NOTICE)!.getAttribute('role')).toBe('status');
		expect(q(section, NOTICE)!.className).not.toMatch(/sr-only|hidden/);
	});

	it('a complete roster read leaves it ABSENT from the DOM', async () => {
		selectSampledb();
		loadOk();

		const { section } = await renderInviteReady();
		expect(q(section, 'invite-admin-submit')).not.toBeNull();

		expect(q(section, NOTICE)).toBeNull();
	});
});

describe('#361 — /admin invite: name-bearing sentences are marked whole', () => {
	it('the submit button reading "Invite {name}" holds its whole text in exactly one marker', async () => {
		selectSampledb();
		loadOk();
		const { section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));
		await pick(select, 'p-cilla');
		await waitFor(() => {
			expect(submitButton(section).textContent).toContain('Invite Cilla Cane');
		});
		expectWholeTextMarkedOnce(submitButton(section), 'invite submit button');
	});
});

// (*MVOX:Josquin*)
