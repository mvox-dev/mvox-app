// @vitest-environment happy-dom
import { toListRead } from '$lib/testing/listReadFixtures';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/pages/adminCopy')).adminMessages()
);

const h = vi.hoisted(() => {
	class SelfLinkMintError extends Error {
		readonly phase: 'identity-read' | 'stale-invite-cleanup' | 'mint';
		readonly reason: 'http' | 'contract' | 'missing-self-editor';
		constructor(
			message: string,
			opts: {
				phase: 'identity-read' | 'stale-invite-cleanup' | 'mint';
				reason: 'http' | 'contract' | 'missing-self-editor';
			}
		) {
			super(message);
			this.name = 'SelfLinkMintError';
			this.phase = opts.phase;
			this.reason = opts.reason;
		}
	}
	return {
		SelfLinkMintError,
		mintSelfLinkInviteMock: vi.fn(),
		listJoinStatesMock: vi.fn(),
		listLinkedIdentitiesMock: vi.fn(),
	};
});
vi.mock('$lib/admin/roleManagement', async () =>
	(await import('$lib/testing/mocks/admin')).roleManagementModule()
);
vi.mock('$lib/nav/adminStore', async () =>
	(await import('$lib/testing/mocks/admin')).adminStoreModule()
);
vi.mock('$lib/library/librarianStore', async () =>
	(await import('$lib/testing/mocks/admin')).librarianStoreModule()
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
	SelfLinkMintError: h.SelfLinkMintError,
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

import Page from './admin/+page.svelte';
import { expectWholeTextMarkedOnce } from '$lib/testing/nameMarker';
import { listSectionsMock, resolveDatabaseEntityIdMock } from '$lib/testing/moduleHandles';
import {
	InviteCreateError,
	createInviteMock,
	listAdminsMock,
	listLibrariansMock,
	resolveAdminMock,
	resolveCollectiveNameMarkerMock,
	resolveInviteParentMock,
	resolveLibrarianMock,
	resolveOwnerTierMock,
	resolveParentMock,
	updateCollectiveNameMock
} from '$lib/testing/mocks/admin';
import { loadRosterMock } from '$lib/testing/mocks/roster';
import { ANNA, ROSTER, jwt, selectSampledb } from '$lib/testing/pages/admin';
import { cleanupReset, q } from '$lib/testing/pages/dom';

const MINTED_TOKEN = jwt({ db: 'sampledb', entityId: 'p-cilla', iat: 1, exp: 4_102_444_800 });

const JOIN_STATES = {
	'p-anna': 'joined',
	'p-bela': 'invited',
	'p-cilla': 'absent',
	'p-dora': 'absent'
} as const;

function loadOk() {
	resolveAdminMock.mockResolvedValue('admin');
	resolveOwnerTierMock.mockResolvedValue('owner');
	resolveDatabaseEntityIdMock.mockResolvedValue('org-1');
	resolveLibrarianMock.mockResolvedValue({ state: 'librarian', libraryId: 'lib-1' });
	listAdminsMock.mockResolvedValue({ persons: [ANNA], canManage: true });
	listLibrariansMock.mockResolvedValue({ persons: [], canManage: true });
	loadRosterMock.mockResolvedValue(toListRead(ROSTER));
	listSectionsMock.mockResolvedValue([]);
	h.listJoinStatesMock.mockResolvedValue({ ...JOIN_STATES });
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

beforeEach(() => {
	for (const mock of Object.values(h)) {
		if (typeof mock === 'function' && 'mockReset' in mock) {
			(mock as ReturnType<typeof vi.fn>).mockReset();
		}
	}
	listSectionsMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	listAdminsMock.mockReset();
	listLibrariansMock.mockReset();
	resolveAdminMock.mockReset();
	resolveCollectiveNameMarkerMock.mockReset();
	resolveLibrarianMock.mockReset();
	resolveOwnerTierMock.mockReset();
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

		expect(resolveOwnerTierMock).toHaveBeenCalled();
		const tierCall = resolveOwnerTierMock.mock.calls[0];
		expect(tierCall[0]).toMatchObject({ db: 'sampledb', token: 'jwt-admin' });
		expect(tierCall[1]).toBe('admin-p');
		expect(tierCall[3]).toBe('org-1');
	});
});

describe('#301 /admin invite — two behaviours, one button', () => {
	it('default ("a new person") + submit → createInvite exactly as today; mintSelfLinkInvite is NOT called', async () => {
		selectSampledb();
		loadOk();
		createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();
		await waitFor(() => personSelect(section)); // the select exists…
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(createInviteMock).toHaveBeenCalledTimes(1);
		const [cfgArg, inputArg] = createInviteMock.mock.calls[0] as [
			{ db: string; token: string },
			{ dbEntityId: string }
		];
		expect(cfgArg).toMatchObject({ db: 'sampledb', token: 'jwt-admin' });
		expect(inputArg).toEqual({ dbEntityId: 'org-1' });
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it('a person chosen + submit → mintSelfLinkInvite(cfg, personId); createInvite is NOT called; the done panel (link, copy, bearer warning) is unchanged', async () => {
		selectSampledb();
		loadOk();
		h.mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: MINTED_TOKEN });
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(h.mintSelfLinkInviteMock).toHaveBeenCalledTimes(1);
		const mintCall = h.mintSelfLinkInviteMock.mock.calls[0];
		expect(mintCall[0]).toMatchObject({ db: 'sampledb', token: 'jwt-admin' });
		expect(mintCall[1]).toBe('p-cilla');
		expect(createInviteMock).not.toHaveBeenCalled();

		expect(q(container, 'invite-link')).toBeNull();
		expect(q(container, 'invite-copy')).not.toBeNull();
		expect(q(container, 'invite-bearer-warning')?.textContent).toContain('Bearer secret');
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
	});
});

describe('#301 /admin invite — when the select is not rendered', () => {
	it('no uninvited persons → NO select at all (not disabled, not empty — absent), and the section works as today', async () => {
		selectSampledb();
		loadOk();
		h.listJoinStatesMock.mockResolvedValue({
			'p-anna': 'joined',
			'p-bela': 'invited',
			'p-cilla': 'joined',
			'p-dora': 'invited'
		});
		createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();
		await waitFor(() => {
			expect(h.listJoinStatesMock).toHaveBeenCalled();
		});
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();

		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(createInviteMock).toHaveBeenCalledTimes(1);
	});

	it('non-owner admin (editor tier) → no select, the existing owner-rights explanation, and the blank invite still works unchanged', async () => {
		selectSampledb();
		loadOk();
		resolveOwnerTierMock.mockResolvedValue('editor');
		createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-owner-note')).not.toBeNull();
		});
		expect(q(section, 'invite-owner-note')!.textContent).toContain(
			'Managing invites requires owner rights.'
		);
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();

		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(createInviteMock).toHaveBeenCalledTimes(1);
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it("owner tier 'error' → no select (an affordance is never rendered off an unresolved rights answer)", async () => {
		selectSampledb();
		loadOk();
		resolveOwnerTierMock.mockResolvedValue('error');
		const { section } = await renderInviteReady();
		await waitFor(() => {
			expect(resolveOwnerTierMock).toHaveBeenCalled();
		});
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(section.querySelector('select')).toBeNull();
	});

	it('listJoinStates fails loud → a visible note (no silently-missing select), and the blank invite path stays fully available', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		const boom = new Error('listLinkedIdentities: identity read failed: HTTP 500');
		h.listJoinStatesMock.mockRejectedValue(boom);
		createInviteMock.mockResolvedValue({
			personId: 'p-new',
			memberId: 'm-new',
			inviteToken: MINTED_TOKEN
		});
		const { container, section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-person-list-error')).not.toBeNull();
		});
		expect(q(section, 'invite-person-list-error')!.textContent).toContain(
			'Could not load the list of uninvited people.'
		);
		expect(container.textContent).not.toContain('HTTP 500');
		expect(q(section, 'invite-person-select')).toBeNull();
		expect(consoleSpy).toHaveBeenCalledWith('admin/invite: loading the join states failed', boom);

		const submit = submitButton(section);
		expect(submit.disabled).toBe(false);
		await fireEvent.click(submit);
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});
		expect(createInviteMock).toHaveBeenCalledTimes(1);

		consoleSpy.mockRestore();
	});
});

describe('#301 /admin invite — person-path (mint) failures surface their own detail', () => {
	it('a SelfLinkMintError surfaces its OWN message naming the person — never the generic createInvite branch, never the orphaned-person warning; the selection survives for retry', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint failed: HTTP 500', {
				phase: 'mint',
				reason: 'http'
			})
		);
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});
		const mintError = q<HTMLElement>(container, 'invite-mint-error')!;
		expect(mintError.textContent).toContain('Could not invite Cilla Cane.');
		expect(container.textContent).not.toContain('Invite creation failed.');
		expect(q(container, 'invite-partial-failure')).toBeNull();
		expect(container.textContent).not.toContain('self-link mint failed: HTTP 500');
		const loggedDetail = consoleSpy.mock.calls
			.flat()
			.some((arg) => arg instanceof Error && arg.message === 'self-link mint failed: HTTP 500');
		expect(loggedDetail).toBe(true);

		const selectAfter = personSelect(section);
		expect(selectAfter.value).toBe('p-cilla');
		expect(submitButton(section).textContent?.trim()).toBe('Invite Cilla Cane');

		consoleSpy.mockRestore();
	});

	it("the mint 403 ('missing-self-editor') surfaces the owner-rights meaning, not the raw platform text", async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint refused: HTTP 403 — the person lacks self-_editor', {
				phase: 'mint',
				reason: 'missing-self-editor'
			})
		);
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));

		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});
		expect(q(container, 'invite-mint-error')!.textContent).toContain(
			'Inviting an existing person requires owner rights.'
		);
		expect(container.textContent).not.toContain('self-_editor');
		expect(container.textContent).not.toContain('HTTP 403');

		consoleSpy.mockRestore();
	});
});

describe('/admin invite — a failed read is reported (#756)', () => {
	async function spyAndLoad() {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		return consoleSpy;
	}

	it('a failed owner-tier read is reported', async () => {
		const consoleSpy = await spyAndLoad();
		const boom = new Error('tier read failed');
		resolveOwnerTierMock.mockRejectedValue(boom);
		await renderInviteReady();
		await waitFor(() =>
			expect(consoleSpy).toHaveBeenCalledWith('admin/invite: reading the owner tier failed', boom)
		);
		consoleSpy.mockRestore();
	});

	it('a failed re-read after a person mint is reported and the done panel still shows', async () => {
		const consoleSpy = await spyAndLoad();
		const boom = new Error('join-state re-read failed');
		h.listJoinStatesMock.mockResolvedValueOnce({ ...JOIN_STATES }).mockRejectedValue(boom);
		h.mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: MINTED_TOKEN });
		const { container, section } = await renderInviteReady();
		await pick(await waitFor(() => personSelect(section)), 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => expect(q(container, 'invite-admin-result')).not.toBeNull());
		expect(consoleSpy).toHaveBeenCalledWith(
			'admin/invite: re-reading the join state after an invite failed',
			boom
		);
		consoleSpy.mockRestore();
	});
});

describe('#301 /admin invite — after a successful person mint', () => {
	it('the uninvited list is RE-DERIVED: the person is gone from the options and the select is back to its default', async () => {
		selectSampledb();
		loadOk();
		h.listJoinStatesMock
			.mockResolvedValueOnce({ ...JOIN_STATES })
			.mockResolvedValue({ ...JOIN_STATES, 'p-cilla': 'invited' });
		h.mintSelfLinkInviteMock.mockResolvedValue({ inviteToken: MINTED_TOKEN });

		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));
		expect(options(select).map((o) => o.value)).toEqual(['', 'p-cilla', 'p-dora']);

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-result')).not.toBeNull();
		});

		const createAnother = Array.from(container.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Create another invite'
		);
		expect(createAnother).not.toBeUndefined();
		await fireEvent.click(createAnother!);

		await waitFor(() => {
			const fresh = personSelect(section);
			expect(options(fresh).map((o) => o.value)).toEqual(['', 'p-dora']);
		});
		expect(h.listJoinStatesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		const fresh = personSelect(section);
		expect(fresh.value).toBe('');
		expect(submitButton(section).textContent?.trim()).toBe('Create invite');
	});
});

describe('#301 /admin invite — the two error surfaces never cross paths', () => {
	it('a failed person mint clears when the selection returns to "a new person" — no per-person note under a "Create invite" button', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint failed: HTTP 500', { phase: 'mint', reason: 'http' })
		);
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));

		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});

		await pick(personSelect(section), '');
		await waitFor(() => {
			expect(submitButton(section).textContent?.trim()).toBe('Create invite');
		});
		expect(q(container, 'invite-mint-error')).toBeNull();
		expect(container.textContent).not.toContain('Could not invite Cilla Cane.');

		consoleSpy.mockRestore();
	});

	it('a failed blank invite never stacks with a later mint failure — one surface at a time', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		createInviteMock.mockRejectedValue(
			new InviteCreateError('invite create failed: HTTP 500', {
				phase: 'person',
				reason: 'http'
			})
		);
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint failed: HTTP 500', { phase: 'mint', reason: 'http' })
		);
		const { container, section } = await renderInviteReady();
		await waitFor(() => personSelect(section));

		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-admin-error')).not.toBeNull();
		});

		await pick(personSelect(section), 'p-cilla');
		await waitFor(() => {
			expect(q(container, 'invite-admin-error')).toBeNull();
		});

		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-mint-error')).not.toBeNull();
		});
		expect(q(container, 'invite-admin-error')).toBeNull();
		expect(container.textContent).not.toContain('Invite creation failed.');

		consoleSpy.mockRestore();
	});
});

describe('#301 /admin invite — the uninvited-list read is owner-gated', () => {
	it('an editor-tier admin triggers NO listJoinStates fan-out, and still gets the owner-rights explanation', async () => {
		selectSampledb();
		loadOk();
		resolveOwnerTierMock.mockResolvedValue('editor');
		const { section } = await renderInviteReady();

		await waitFor(() => {
			expect(q(section, 'invite-owner-note')).not.toBeNull();
		});
		expect(resolveOwnerTierMock).toHaveBeenCalled();
		expect(h.listJoinStatesMock).not.toHaveBeenCalled();
		expect(q(section, 'invite-person-list-error')).toBeNull();
		expect(q(section, 'invite-person-select')).toBeNull();
	});
});

// (*MVOX:Tallis* — #301 RED: owner-only person select routing the existing

describe('/admin invite — the person select states a truncated roster (#321 review F2)', () => {
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

// (*MVOX:Palestrina* — #301 review F1/F2: cross-path error clearing + the

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

	it('the mint-error message naming the person holds its whole text in exactly one marker', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectSampledb();
		loadOk();
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint failed: HTTP 500', {
				phase: 'mint',
				reason: 'http'
			})
		);
		const { container, section } = await renderInviteReady();
		const select = await waitFor(() => personSelect(section));
		await pick(select, 'p-cilla');
		await fireEvent.click(submitButton(section));
		await waitFor(() => {
			expect(q(container, 'invite-mint-error')?.textContent).toContain('Could not invite Cilla Cane.');
		});
		const message = q<HTMLElement>(container, 'invite-mint-error')!.querySelector('p') as HTMLElement;
		expectWholeTextMarkedOnce(message, 'invite mint-error message');
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Tallis* — #361 RED: invite name-bearing sentences marked)
