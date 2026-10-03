// @vitest-environment happy-dom
// A stale completion-gate result after a collective switch is dropped.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '$lib/testing/entuFetchKit';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
		profile_title: () => 'Your profile',
		profile_intro: () => 'Fill in your name and email.',
		profile_completion_required: () => 'Please add your name to continue.',
		profile_no_collective: () => 'Select a collective.',
		profile_load_error: () => 'Could not load your profile.',
		profile_load_retry: () => 'Retry',
		profile_field_name_label: () => 'Name',
		profile_field_email_label: () => 'Email',
		profile_name_edit_label: () => 'Edit name',
		profile_email_edit_label: () => 'Edit email',
		profile_level_public_label: () => 'Public',
		profile_level_public_hint: () => 'Anyone.',
		profile_level_domain_label: () => 'Collective',
		profile_level_domain_hint: () => 'Members.',
		profile_level_private_label: () => 'Private',
		profile_level_private_hint: () => 'Only you.',
		profile_save: () => 'Save',
		profile_saving: () => 'Saving…',
		profile_saved: () => 'Saved',
		profile_save_error: () => "Couldn't save — please try again.",
		profile_name_private_disabled: () => 'Name cannot be private',
		profile_visibility_title: () => 'Who can see each field',
		profile_visibility_intro: () => 'Pick an icon to move a field.',
		profile_visibility_active: (p: { level: string }) => `Visible at ${p.level}`,
		profile_visibility_move: (p: { field: string; level: string }) =>
			`Move ${p.field} to ${p.level}`,
		profile_visibility_moving: () => 'Moving…',
		profile_visibility_leak: (p: { level: string }) => `Still readable at ${p.level}`,
		profile_visibility_conflict: (p: { field: string }) =>
			`Your ${p.field} has different values at more than one level.`,
		profile_visibility_confirm_preview: (p: { level: string }) => `Tap again to keep ${p.level}`,
		profile_visibility_preview_note: () => 'Tap again to keep this version.',
		profile_move_error: () => "Couldn't change visibility. Nothing was lost — please try again.",
		profile_repair_title: () => 'Unfinished visibility change',
		profile_repair_body_tightening: (p: { field: string; level: string }) =>
			`Your ${p.field} is still readable at ${p.level}.`,
		profile_repair_body_widening: (p: { field: string; level: string }) =>
			`An old copy of your ${p.field} is still at ${p.level}.`,
		profile_repair_body_loaded: (p: { field: string; level: string }) =>
			`An unfinished change left your ${p.field} readable at ${p.level}.`,
		profile_repair_action: () => 'Finish now',
		profile_repair_working: () => 'Finishing…',
		profile_repair_error: (p: { field: string; level: string }) =>
			`Couldn't finish. Your ${p.field} is still readable at ${p.level}.`,
		profile_repair_done: () => 'Visibility change completed.',
		profile_sign_out: () => 'Sign out',
		profile_signed_in_as: (p: { account: string; provider: string }) =>
			`Signed in as ${p.account} via ${p.provider}`,
		profile_language_label: () => 'Language',
		profile_time_format_label: () => 'Time format',
		profile_time_format_24h: () => '24-hour',
		profile_time_format_ampm: () => 'AM/PM',
		profile_time_format_hint: () => 'Applies on this device.',
		profile_linked_accounts_title: (p: { collective: string }) =>
			`Sign-ins that work for ${p.collective}`,
		profile_link_another: () => 'Link another account',
		profile_link_choose_provider: () => 'Choose a provider to link',
		profile_link_error_conflict: () => 'That account is already in use by another member here.',
		profile_link_error_dead: () => 'The link attempt expired or was already used.',
		profile_link_error_failed: () => 'Linking failed — you can try again.',
		profile_link_error_missing_rights: () =>
			'Your account is missing the rights needed to link another sign-in.',
		profile_link_error_already_linked: () => 'That sign-in is already linked to your account.',
		profile_link_error_step: (p: { step: string }) =>
			`Linking could not be completed — it stopped at step: ${p.step}. You can try again.`,
		profile_link_success: (p: { collective: string }) =>
			`That sign-in now works for ${p.collective}.`,
		profile_link_cancel: () => 'Cancel',
		auth_provider_smart_id: () => 'Smart-ID',
		auth_provider_mobile_id: () => 'Mobile-ID',
		auth_provider_id_card: () => 'ID-card',
		auth_provider_e_mail: () => 'E-mail',
		auth_provider_google: () => 'Google',
		auth_provider_apple: () => 'Apple'
	})
);

const h = vi.hoisted(() => ({
	listMyProfilesMock: vi.fn(),
	applyProfileSaveMock: vi.fn(),
	resolveGateMock: vi.fn()
}));

vi.mock('$lib/profile/profileData', () => {
	const NARROWNESS: Record<string, number> = { private: 0, domain: 1, public: 2 };
	return {
		listMyProfiles: h.listMyProfilesMock,
		profilesByLevel: (ps: Array<{ _sharing: string }>) => {
			const by: Record<string, unknown> = {};
			for (const p of ps) by[p._sharing] = p;
			return by;
		},
		NARROWNESS,
		resolveField: (
			ps: Array<{ _id: string; name: string; email: string; _sharing: string }>,
			field: 'name' | 'email'
		) => {
			const withValue = ps
				.filter((p) => p[field] !== '')
				.slice()
				.sort((a, b) => NARROWNESS[a._sharing] - NARROWNESS[b._sharing]);
			return {
				value: withValue.length > 0 ? withValue[0][field] : '',
				holders: withValue.map((p) => ({ level: p._sharing, id: p._id }))
			};
		}
	};
});
vi.mock('$lib/profile/applyProfileSave', () => ({
	applyProfileSave: h.applyProfileSaveMock,
	ProfileSaveError: class ProfileSaveError extends Error {}
}));
vi.mock('$lib/profile/completionGate', async (importActual) => {
	const actual = await importActual<typeof import('$lib/profile/completionGate')>();
	return { ...actual, resolveGate: h.resolveGateMock };
});
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] })
}));
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

import Page from './profile/+page.svelte';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { get } from 'svelte/store';
import { completionGateStore, resetGate, type GateState } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

const COLLECTIVE_A = { db: 'sampledb', name: 'Sampledb', personId: 'person-p' };
const COLLECTIVE_B = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

function wireProfilesPerCollective(): void {
	h.listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'bravura'
			? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' }]
			: [{ _id: 'prof-a-dom', name: 'Ada', email: '', _sharing: 'domain' }]
	);
}

function signInWithTwoCollectives(): void {
	signIn({
		token: 'jwt-member',
		collectives: [COLLECTIVE_A, COLLECTIVE_B],
		selected: 'sampledb'
	});
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
	return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
}

async function waitReadyShowing(container: HTMLElement, name: string): Promise<void> {
	await waitFor(() => {
		expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull();
		expect(displayValue(container, 'name')).toBe(name);
	});
}

async function openEditor(
	container: HTMLElement,
	field: 'name' | 'email'
): Promise<HTMLInputElement> {
	const btn = q(container, `[data-testid="profile-${field}-edit"]`) as HTMLButtonElement | null;
	expect(btn, `profile-${field}-edit must render in display state`).not.toBeNull();
	await fireEvent.click(btn!);
	let editorInput: HTMLInputElement | null = null;
	await waitFor(() => {
		editorInput = q(container, `[data-testid="profile-${field}"]`) as HTMLInputElement | null;
		expect(editorInput).not.toBeNull();
	});
	return editorInput!;
}

async function saveNameToInitiateGateRead(
	container: HTMLElement,
	newName: string,
	expectedCalls: number
): Promise<void> {
	const nameInput = await openEditor(container, 'name');
	await fireEvent.input(nameInput, { target: { value: newName } });
	await fireEvent.blur(nameInput);
	await waitFor(() => expect(h.resolveGateMock).toHaveBeenCalledTimes(expectedCalls));
}

async function switchCollective(container: HTMLElement, db: string, showsName: string): Promise<void> {
	selectedCollectiveDbStore.set(db);
	await waitReadyShowing(container, showsName);
}

afterEach(() => {
	cleanup();
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
	h.resolveGateMock.mockReset();
	resetAppState();
	resetGate();
});

describe('#260 — a stale resolveGate settle after a collective switch must not write the SSOT', () => {
	it("THE RACE (deterministic): A's read held → switch to B (gate 'incomplete') → A settles 'complete' → the store stays on B's 'incomplete', never A's stale answer", async () => {
		wireProfilesPerCollective();
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		h.resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		expect(h.resolveGateMock.mock.calls[0][0]).toMatchObject({ db: 'sampledb' });
		expect(h.resolveGateMock.mock.calls[0][1]).toBe('person-p');

		await switchCollective(container, 'bravura', 'Bea');

		completionGateStore.set('incomplete');

		staleRead.resolve('complete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('incomplete');
	});

	it("variant: with B's own resolve still pending, a stale A settle leaves the store on 'loading' — never A's answer", async () => {
		wireProfilesPerCollective();
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		h.resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		await switchCollective(container, 'bravura', 'Bea');

		expect(get(completionGateStore)).toBe('loading');

		staleRead.resolve('complete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('loading');
	});

	it("happy path unchanged: a same-collective settle still lands on the store normally", async () => {
		wireProfilesPerCollective();
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const read = deferred<GateState>();
		h.resolveGateMock.mockReturnValueOnce(read.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);

		read.resolve('complete');
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('complete');
	});

	it("rapid A→B→A: only the LAST requested context's result lands — B's late settle from a left context never overwrites it", async () => {
		wireProfilesPerCollective();
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-x' });
		const readA1 = deferred<GateState>();
		const readB = deferred<GateState>();
		const readA2 = deferred<GateState>();
		h.resolveGateMock
			.mockReturnValueOnce(readA1.promise)
			.mockReturnValueOnce(readB.promise)
			.mockReturnValueOnce(readA2.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		await switchCollective(container, 'bravura', 'Bea');
		await saveNameToInitiateGateRead(container, 'Bea M.', 2);
		await switchCollective(container, 'sampledb', 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada N.', 3);

		expect(h.resolveGateMock.mock.calls[0][0]).toMatchObject({ db: 'sampledb' });
		expect(h.resolveGateMock.mock.calls[1][0]).toMatchObject({ db: 'bravura' });
		expect(h.resolveGateMock.mock.calls[1][1]).toBe('person-b');
		expect(h.resolveGateMock.mock.calls[2][0]).toMatchObject({ db: 'sampledb' });

		readA1.resolve('incomplete');
		await flushMicrotasks();
		readA2.resolve('complete');
		await flushMicrotasks();
		expect(get(completionGateStore)).toBe('complete');

		readB.resolve('incomplete');
		await flushMicrotasks();
		expect(get(completionGateStore)).toBe('complete');
	});

	it('a REJECTED stale read after a switch is also ignored: no write, no stale error state from a context the user left', async () => {
		wireProfilesPerCollective();
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-a-dom' });
		const staleRead = deferred<GateState>();
		h.resolveGateMock.mockReturnValueOnce(staleRead.promise);
		signInWithTwoCollectives();

		const { container } = render(Page);
		await waitReadyShowing(container, 'Ada');

		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		await switchCollective(container, 'bravura', 'Bea');

		staleRead.reject(new Error('resolveGate: network down'));
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('loading');
		expect(q(container, '[data-testid="profile-load-error"]')).toBeNull();
		expect(displayValue(container, 'name')).toBe('Bea');
	});

	it('write-side guard only: the completionGate module keeps its exported surface (no API change for consumers)', async () => {
		const actual = await vi.importActual<typeof import('$lib/profile/completionGate')>(
			'$lib/profile/completionGate'
		);
		expect(typeof actual.completionGateStore.subscribe).toBe('function');
		expect(typeof actual.completionGateStore.set).toBe('function');
		expect(typeof actual.completionGateStore.update).toBe('function');
		expect(typeof actual.resolveGate).toBe('function');
		expect(typeof actual.resetGate).toBe('function');
		expect(typeof actual.hasVisibleName).toBe('function');
		expect(typeof actual.hasDomainName).toBe('function');

		const seen: GateState[] = [];
		const unsubscribe = actual.completionGateStore.subscribe((s) => seen.push(s));
		actual.completionGateStore.set('complete');
		unsubscribe();
		expect(seen).toEqual(['loading', 'complete']);
		actual.resetGate();
		expect(get(actual.completionGateStore)).toBe('loading');
	});
});

// (*MVOX:Tallis*)
