// @vitest-environment happy-dom
// The admin-only roster-names toggle on /profile.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

const h = vi.hoisted(() => ({
	listMyProfilesMock: vi.fn(),
	readRosterNamesMock: vi.fn(),
	updateRosterNamesMock: vi.fn()
}));
vi.mock('$lib/profile/profileData', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/profileData')>(
		'$lib/profile/profileData'
	);
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] })
}));
vi.mock('$lib/collective/rosterNames', () => ({
	readRosterNamesSetting: h.readRosterNamesMock,
	updateRosterShowRealNames: h.updateRosterNamesMock
}));

import ProfilePage from './profile/+page.svelte';
import { m } from '$lib/paraglide/messages.js';
import { adminStore, resetAdmin, type AdminState } from '$lib/nav/adminStore';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';
import { resetAppState } from '$lib/testing/appReset';
import type { Collective } from '$lib/collectives/types';
import { signIn } from '$lib/testing/session';

type RosterNamesSetting = { dbEntityId: string; showRealNames: boolean };

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const rosterSelect = (c: HTMLElement) =>
	q(c, '[data-testid="profile-roster-names"]') as HTMLSelectElement | null;
const rosterHint = (c: HTMLElement) => q(c, '[data-testid="profile-roster-names-hint"]');
const rosterStatus = (c: HTMLElement) => q(c, '[data-testid="profile-roster-names-status"]');
const rosterError = (c: HTMLElement) => q(c, '[data-testid="profile-roster-names-error"]');
const timeFormatSelect = (c: HTMLElement) =>
	q(c, '[data-testid="profile-time-format"]') as HTMLSelectElement | null;

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

const COLLECTIVE_A = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
const COLLECTIVE_B = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

function wireProfilesPerCollective(): void {
	h.listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'bravura'
			? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' as const }]
			: [{ _id: 'prof-a-dom', name: 'Ada', email: '', _sharing: 'domain' as const }]
	);
}

function signInMember(collectives: Collective[]): void {
	signIn({ token: 'jwt-member', collectives });
}

function displayName(container: HTMLElement): string {
	return (q(container, '[data-testid="profile-name-value"]')?.textContent ?? '').trim();
}

async function waitReadyShowing(container: HTMLElement, name: string): Promise<void> {
	await waitFor(() => {
		expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull();
		expect(displayName(container)).toBe(name);
	});
}

async function renderAdminReady(
	setting: RosterNamesSetting = { dbEntityId: 'db-entity-a', showRealNames: false }
): Promise<HTMLElement> {
	wireProfilesPerCollective();
	h.readRosterNamesMock.mockResolvedValue(setting);
	adminStore.set('admin');
	signInMember([COLLECTIVE_A]);
	const { container } = render(ProfilePage);
	await waitReadyShowing(container, 'Ada');
	await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
	return container;
}

beforeEach(() => {
	localStorage.clear();
	h.listMyProfilesMock.mockReset();
	h.readRosterNamesMock.mockReset();
	h.updateRosterNamesMock.mockReset();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	resetAppState();
	resetAdmin();
});

describe('/profile — roster-names control structure (admin view)', () => {
	it('renders a NATIVE <select> with exactly the two options profile/real (profile FIRST — the default), labelled via <label for>', async () => {
		const container = await renderAdminReady();
		const select = rosterSelect(container)!;
		expect(select.tagName).toBe('SELECT');
		expect(select.id).toBe('profile-roster-names');
		const options = [...select.querySelectorAll('option')];
		expect(options.map((o) => o.value)).toEqual(['profile', 'real']);
		expect(options[0].textContent?.trim()).toBe(m.profile_roster_names_profile());
		expect(options[1].textContent?.trim()).toBe(m.profile_roster_names_real());
		const label = q(container, 'label[for="profile-roster-names"]');
		expect(label, 'label[for=profile-roster-names] missing').not.toBeNull();
		expect(label!.textContent?.trim()).toBe(m.profile_roster_names_label());
		expect(select.labels?.length).toBeGreaterThan(0);
		expect(select.tabIndex).toBeGreaterThanOrEqual(0);
	});

	it('renders the collective-wide hint DIRECTLY UNDER the select', async () => {
		const container = await renderAdminReady();
		const hintEl = rosterHint(container);
		expect(hintEl, 'profile-roster-names-hint missing').not.toBeNull();
		expect(hintEl!.textContent?.trim()).toBe(m.profile_roster_names_hint());
		expect(
			rosterSelect(container)!.compareDocumentPosition(hintEl!) &
				Node.DOCUMENT_POSITION_FOLLOWING,
			'the hint must come after the select in document order'
		).toBeTruthy();
	});

	it('sits AFTER the time-format control, as a SIBLING block in the same app-chrome column', async () => {
		const container = await renderAdminReady();
		const timeFormat = timeFormatSelect(container)!;
		const roster = rosterSelect(container)!;
		expect(timeFormat, 'the time-format control must be untouched').not.toBeNull();
		expect(
			timeFormat.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the roster-names control must come after the time-format control'
		).toBeTruthy();
		expect(roster.closest('div')!.parentElement).toBe(timeFormat.closest('div')!.parentElement);
		expect(q(container, '[data-testid="profile-time-format-hint"]')).not.toBeNull();
	});

	it('page invariants hold: exactly one <main>, exactly one <h1>', async () => {
		const container = await renderAdminReady();
		expect(container.querySelectorAll('main')).toHaveLength(1);
		expect(container.querySelectorAll('h1')).toHaveLength(1);
	});

	it('is app chrome, NOT gated on route-load status: still rendered for an admin when the profile-fields load errored', async () => {
		wireProfilesPerCollective();
		h.listMyProfilesMock.mockRejectedValue(new Error('boom'));
		h.readRosterNamesMock.mockResolvedValue({ dbEntityId: 'db-entity-a', showRealNames: false });
		adminStore.set('admin');
		signInMember([COLLECTIVE_A]);
		const { container } = render(ProfilePage);
		await waitFor(() => expect(q(container, '[data-testid="profile-load-error"]')).not.toBeNull());
		expect(rosterSelect(container), 'app chrome must survive a fields load-error').not.toBeNull();
	});
});

describe('/profile — roster-names visibility is admin-only (fail-closed)', () => {
	for (const state of ['not-admin', 'loading', 'error'] as AdminState[]) {
		it(`adminStore '${state}' → the control is ABSENT from the DOM (no disabled control, no text); it APPEARS when the store resolves 'admin'`, async () => {
			wireProfilesPerCollective();
			h.readRosterNamesMock.mockResolvedValue({
				dbEntityId: 'db-entity-a',
				showRealNames: true
			});
			adminStore.set(state);
			signInMember([COLLECTIVE_A]);
			const { container } = render(ProfilePage);
			await waitReadyShowing(container, 'Ada');
			expect(timeFormatSelect(container)).not.toBeNull();
			expect(rosterSelect(container)).toBeNull();
			expect(rosterHint(container)).toBeNull();
			expect(q(container, 'label[for="profile-roster-names"]')).toBeNull();
			expect(q(container, '#profile-roster-names')).toBeNull();

			adminStore.set('admin');
			await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
			expect(rosterHint(container)).not.toBeNull();
		});
	}
});

describe('/profile — roster-names READ (integration: the page route drives the seam)', () => {
	it('on load, reads the setting through readRosterNamesSetting for the selected collective', async () => {
		const container = await renderAdminReady();
		expect(h.readRosterNamesMock).toHaveBeenCalled();
		expect(h.readRosterNamesMock.mock.calls[0][0]).toMatchObject({ db: 'sampledb' });
		expect(rosterSelect(container)!.value).toBe('profile');
	});

	it("server false (or absent → false) → 'profile' selected", async () => {
		const container = await renderAdminReady({ dbEntityId: 'db-entity-a', showRealNames: false });
		expect(rosterSelect(container)!.value).toBe('profile');
	});

	it("server true → 'real' selected", async () => {
		const container = await renderAdminReady({ dbEntityId: 'db-entity-a', showRealNames: true });
		await waitFor(() => expect(rosterSelect(container)!.value).toBe('real'));
	});

	it("RACE (deterministic, #257/#260 class): A's read held → switch to B (false, landed) → A settles true → the select stays on B's 'profile'", async () => {
		wireProfilesPerCollective();
		const staleRead = deferred<RosterNamesSetting>();
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? Promise.resolve({ dbEntityId: 'db-entity-b', showRealNames: false })
				: staleRead.promise
		);
		adminStore.set('admin');
		signInMember([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');

		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await waitFor(() =>
			expect(
				h.readRosterNamesMock.mock.calls.some((c) => (c[0] as { db: string }).db === 'bravura')
			).toBe(true)
		);
		await flushMicrotasks();
		expect(rosterSelect(container)!.value).toBe('profile');

		staleRead.resolve({ dbEntityId: 'db-entity-a', showRealNames: true });
		await flushMicrotasks();
		expect(rosterSelect(container)!.value, "A's stale answer must never land on B").toBe(
			'profile'
		);
	});

	it("resetState joins: switching away from a collective showing 'real' resets to the DEFAULT while the new read is still in flight", async () => {
		wireProfilesPerCollective();
		const heldB = deferred<RosterNamesSetting>(); // never settles
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? heldB.promise
				: Promise.resolve({ dbEntityId: 'db-entity-a', showRealNames: true })
		);
		adminStore.set('admin');
		signInMember([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)!.value).toBe('real'));

		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await waitFor(() =>
			expect(
				h.readRosterNamesMock.mock.calls.some((c) => (c[0] as { db: string }).db === 'bravura')
			).toBe(true)
		);
		expect(rosterSelect(container)!.value).toBe('profile');
	});
});

describe('/profile — roster-names WRITE (server-confirmed, never optimistic)', () => {
	it('onchange calls updateRosterShowRealNames(cfg, dbEntityId, true); the select is DISABLED in flight, no announcement yet; the new value shows only AFTER the await resolves, announced via the persistent status region', async () => {
		const container = await renderAdminReady();
		const write = deferred<void>();
		h.updateRosterNamesMock.mockReturnValueOnce(write.promise);

		const regionBefore = rosterStatus(container);
		expect(regionBefore, 'profile-roster-names-status must be mounted persistently').not.toBeNull();
		expect(regionBefore!.getAttribute('role')).toBe('status');
		expect(regionBefore!.textContent?.trim()).toBe('');

		const select = rosterSelect(container)!;
		await fireEvent.change(select, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));

		const call = h.updateRosterNamesMock.mock.calls[0];
		expect(call[0]).toMatchObject({ db: 'sampledb' });
		expect(call[1]).toBe('db-entity-a');
		expect(call[2]).toBe(true);

		await waitFor(() => expect(rosterSelect(container)!.disabled).toBe(true));
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		expect(rosterError(container)).toBeNull();

		write.resolve(undefined);
		await flushMicrotasks();
		await waitFor(() => {
			expect(rosterSelect(container)!.disabled).toBe(false);
			expect(rosterSelect(container)!.value).toBe('real');
		});
		const regionAfter = rosterStatus(container);
		expect(regionAfter).toBe(regionBefore);
		expect(regionAfter!.textContent?.trim()).toBe(m.profile_roster_names_saved());
	});

	it('the announcement is CLEARED at the START of the next attempt (never on settle, never a timer) — a failed retry shows no stale confirmation', async () => {
		const container = await renderAdminReady();
		const write1 = deferred<void>();
		const write2 = deferred<void>();
		h.updateRosterNamesMock
			.mockReturnValueOnce(write1.promise)
			.mockReturnValueOnce(write2.promise);

		const select = rosterSelect(container)!;
		await fireEvent.change(select, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));
		write1.resolve(undefined);
		await flushMicrotasks();
		await waitFor(() =>
			expect(rosterStatus(container)!.textContent?.trim()).toBe(m.profile_roster_names_saved())
		);

		await fireEvent.change(rosterSelect(container)!, { target: { value: 'profile' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(2));
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');

		write2.reject(new Error('entu 500'));
		await flushMicrotasks();
		await waitFor(() => expect(rosterError(container)).not.toBeNull());
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		expect(rosterSelect(container)!.value).toBe('real');
		expect(rosterSelect(container)!.disabled).toBe(false);
	});

	it('FORCED FAILURE tells the truth: error message says the setting was NOT changed, the select shows the pre-write SERVER value (no re-read), re-enabled', async () => {
		const container = await renderAdminReady(); // server: false → 'profile'
		const readCallsBefore = h.readRosterNamesMock.mock.calls.length;
		h.updateRosterNamesMock.mockImplementationOnce(() =>
			Promise.reject(new Error('updateRosterShowRealNames POST failed: 403'))
		);

		const select = rosterSelect(container)!;
		await fireEvent.change(select, { target: { value: 'real' } });
		await waitFor(() => expect(rosterError(container)).not.toBeNull());

		const error = rosterError(container)!;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent?.trim()).toBe(m.profile_roster_names_error());
		expect(rosterSelect(container)!.value).toBe('profile');
		expect(rosterSelect(container)!.disabled).toBe(false);
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		expect(h.readRosterNamesMock.mock.calls.length).toBe(readCallsBefore);
	});

	it("WRITE RACE (deterministic): a write settling AFTER a collective switch announces nothing and writes no state for the stale collective; B's select is usable immediately", async () => {
		wireProfilesPerCollective();
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? Promise.resolve({ dbEntityId: 'db-entity-b', showRealNames: false })
				: Promise.resolve({ dbEntityId: 'db-entity-a', showRealNames: false })
		);
		const write = deferred<void>();
		h.updateRosterNamesMock.mockReturnValueOnce(write.promise);
		adminStore.set('admin');
		signInMember([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)).not.toBeNull());

		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));

		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await flushMicrotasks();
		expect(rosterSelect(container)!.disabled).toBe(false);
		expect(rosterSelect(container)!.value).toBe('profile');

		write.resolve(undefined);
		await flushMicrotasks();
		expect(rosterStatus(container)!.textContent?.trim(), 'no stale-collective announcement').toBe(
			''
		);
		expect(rosterError(container)).toBeNull();
		expect(rosterSelect(container)!.value).toBe('profile');
		expect(rosterSelect(container)!.disabled).toBe(false);
	});

	it('WRITE RACE variant: a stale write REJECTING after the switch surfaces no error for the collective the user left', async () => {
		wireProfilesPerCollective();
		h.readRosterNamesMock.mockImplementation((cfg: { db: string }) =>
			cfg.db === 'bravura'
				? Promise.resolve({ dbEntityId: 'db-entity-b', showRealNames: false })
				: Promise.resolve({ dbEntityId: 'db-entity-a', showRealNames: false })
		);
		const write = deferred<void>();
		h.updateRosterNamesMock.mockReturnValueOnce(write.promise);
		adminStore.set('admin');
		signInMember([COLLECTIVE_A, COLLECTIVE_B]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)).not.toBeNull());

		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));

		selectedCollectiveDbStore.set('bravura');
		await waitReadyShowing(container, 'Bea');
		await flushMicrotasks();

		write.reject(new Error('entu network down'));
		await flushMicrotasks();
		expect(rosterError(container), "A's stale failure must not surface on B").toBeNull();
		expect(rosterStatus(container)!.textContent?.trim()).toBe('');
		expect(rosterSelect(container)!.value).toBe('profile');
	});
});

describe('/profile — roster-names WRITE precondition (no confirmed entity id)', () => {
	it('READ STILL IN FLIGHT: the control is rendered (adminStore landed first) but the select is DISABLED — a forced change writes nothing; it becomes usable when the read settles', async () => {
		wireProfilesPerCollective();
		const read = deferred<RosterNamesSetting>();
		h.readRosterNamesMock.mockReturnValueOnce(read.promise);
		adminStore.set('admin');
		signInMember([COLLECTIVE_A]);
		const { container } = render(ProfilePage);
		await waitReadyShowing(container, 'Ada');
		await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
		expect(rosterSelect(container)!.disabled, 'no confirmed entity id → unusable').toBe(true);

		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await flushMicrotasks();
		expect(h.updateRosterNamesMock).not.toHaveBeenCalled();
		expect(rosterSelect(container)!.value).toBe('profile');
		expect(rosterStatus(container)!.textContent?.trim(), 'no success claim').toBe('');

		read.resolve({ dbEntityId: 'db-entity-a', showRealNames: false });
		await flushMicrotasks();
		await waitFor(() => expect(rosterSelect(container)!.disabled).toBe(false));
		await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
		await waitFor(() => expect(h.updateRosterNamesMock).toHaveBeenCalledTimes(1));
		expect(h.updateRosterNamesMock.mock.calls[0][1]).toBe('db-entity-a');
	});

	it('READ FAILED: the control stays rendered on the documented default but DISABLED (the id never arrives); a forced change writes nothing, restores the select to the server value and says the setting was NOT changed', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			wireProfilesPerCollective();
			h.readRosterNamesMock.mockRejectedValue(new Error('entu 500'));
			adminStore.set('admin');
			signInMember([COLLECTIVE_A]);
			const { container } = render(ProfilePage);
			await waitReadyShowing(container, 'Ada');
			await waitFor(() => expect(rosterSelect(container)).not.toBeNull());
			await flushMicrotasks();

			expect(warn).toHaveBeenCalled();
			expect(rosterSelect(container)!.value).toBe('profile');
			expect(rosterSelect(container)!.disabled, 'a failed read leaves no entity id').toBe(true);

			await fireEvent.change(rosterSelect(container)!, { target: { value: 'real' } });
			await flushMicrotasks();
			expect(h.updateRosterNamesMock).not.toHaveBeenCalled();
			await waitFor(() => expect(rosterError(container)).not.toBeNull());
			expect(rosterError(container)!.getAttribute('role')).toBe('alert');
			expect(rosterError(container)!.textContent?.trim()).toBe(m.profile_roster_names_error());
			expect(rosterSelect(container)!.value, 'never a value the server does not hold').toBe(
				'profile'
			);
			expect(rosterStatus(container)!.textContent?.trim(), 'no success claim').toBe('');
		} finally {
			warn.mockRestore();
		}
	});
});

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

const NEW_KEYS = [
	'profile_roster_names_label',
	'profile_roster_names_profile',
	'profile_roster_names_real',
	'profile_roster_names_hint',
	'profile_roster_names_error',
	'profile_roster_names_saved'
] as const;

const PINNED_TEXT: Record<(typeof LOCALES)[number], Record<(typeof NEW_KEYS)[number], string>> = {
	en: {
		profile_roster_names_label: 'Names on the roster',
		profile_roster_names_profile: 'Profile names',
		profile_roster_names_real: 'Real names',
		profile_roster_names_hint: 'Applies to the whole collective, not only to you.',
		profile_roster_names_error: "Couldn't save — the roster setting was not changed.",
		profile_roster_names_saved: 'Roster name setting saved.'
	},
	et: {
		profile_roster_names_label: 'Nimed rosteris',
		profile_roster_names_profile: 'Profiilinimed',
		profile_roster_names_real: 'Pärisnimed',
		profile_roster_names_hint: 'Kehtib kogu koorile, mitte ainult sinule.',
		profile_roster_names_error: 'Salvestamine ebaõnnestus — seadistus jäi muutmata.',
		profile_roster_names_saved: 'Rosteri nimede seadistus salvestatud.'
	},
	lv: {
		profile_roster_names_label: 'Vārdi dalībnieku sarakstā',
		profile_roster_names_profile: 'Profila vārdi',
		profile_roster_names_real: 'Īstie vārdi',
		profile_roster_names_hint: 'Attiecas uz visu kolektīvu, ne tikai uz jums.',
		profile_roster_names_error: 'Neizdevās saglabāt — iestatījums netika mainīts.',
		profile_roster_names_saved: 'Saraksta vārdu iestatījums saglabāts.'
	},
	uk: {
		profile_roster_names_label: 'Імена у списку учасників',
		profile_roster_names_profile: 'Імена профілів',
		profile_roster_names_real: 'Справжні імена',
		profile_roster_names_hint: 'Стосується всього колективу, а не лише вас.',
		profile_roster_names_error: 'Не вдалося зберегти — налаштування не змінено.',
		profile_roster_names_saved: 'Налаштування імен у списку збережено.'
	}
};

function readMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(__dirname, `../../messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('locale parity — #267 keys exist, non-empty, exact text, in en/et/lv/uk', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json carries every new key, non-empty`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
				expect(isMessageEmpty(messages[key]), `${locale}.json ${key} is empty`).toBe(false);
			}
		});

		it(`${locale}.json pins the exact text (et control strings PO-verbatim; the rest refinable drafts)`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(messages[key], `${locale}.json ${key}`).toBe(PINNED_TEXT[locale][key]);
			}
		});
	}
});

// (*MVOX:Tallis*)
