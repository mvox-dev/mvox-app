// @vitest-environment happy-dom
//
// #260 RED — the completionGate race: a stale resolveGate settle after a
// collective switch corrupts the membership SSOT.
//
// THE DEFECT (triage YELLOW-T4.8.1, verbatim on main): profile/+page.svelte's
// `refreshCompletionGate()` does `resolveGate(...).then((state) =>
// completionGateStore.set(state))` with NO generation guard. It is called from
// generation-guarded queue callbacks, but the async read INSIDE it is not
// guarded — start a gate re-read in collective A, switch to B, and A's late
// answer lands as the current truth. `completionGateStore` is the app-wide
// SSOT ("no surface can re-derive the gate"), so a stale 'complete' suppresses
// the /profile redirect and re-enables member affordances everywhere at once,
// and BY DESIGN nothing downstream can catch it: the written value is keyed to
// nothing.
//
// THE PROOF CLAUSE (#253 standard — Bentham, pre-committed): a timing race
// resists commit-replay, so every test here is DETERMINISTICALLY ORDERED — the
// resolveGate promise is HELD by the test (deferred mock), the collective is
// switched, and only THEN is the stale read settled. The race test fails
// against pre-fix code EVERY run, for the RIGHT reason: the tripping assertion
// is on the STORE'S VALUE, showing the stale 'complete' actually reaching
// `completionGateStore` — never a timeout, never an unrelated assertion.
//
// These specs render the REAL /profile route component (integration, not an
// isolated unit): the gate re-read is initiated exactly the way the app does
// it — a domain-level name save settling through the real edit queue's
// `reconcile` → `refreshCompletionGate()`. Only `resolveGate` is overridden
// (importActual keeps the real store — layout.completion-gate.spec.ts
// precedent), so the store the assertions read is the ONE shared SSOT
// instance every consumer subscribes to.
//
// House precedent mirrored, not reinvented: the event page's generation
// guards and #255's call-time capture pattern (per-request context captured
// at initiation, compared at settle). RED asserts OUTCOME, not mechanism —
// GREEN may key the guard on request generation or collective identity.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
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
	}
}));

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
// Override ONLY resolveGate; keep the REAL store/resetGate so the page under
// test and this spec's assertions share the one SSOT instance — the same
// partial-mock shape layout.completion-gate.spec.ts uses.
vi.mock('$lib/profile/completionGate', async (importActual) => {
	const actual = await importActual<typeof import('$lib/profile/completionGate')>();
	return { ...actual, resolveGate: h.resolveGateMock };
});
// The linked-identities read runs after every profile load; stubbed empty so it
// neither hits the network nor injects its own async noise into the ordering.
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: vi.fn().mockResolvedValue({ identities: [] })
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './profile/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { get } from 'svelte/store';
import { completionGateStore, resetGate, type GateState } from '$lib/profile/completionGate';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Drain the microtask queue so a just-settled promise chain fully lands. */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

const COLLECTIVE_A = { db: 'polyphony', name: 'Polyphony', personId: 'person-p' };
const COLLECTIVE_B = { db: 'bravura', name: 'Bravura', personId: 'person-b' };

/** Per-collective profiles with DISTINCT names, so "which collective's ready
 *  state is on screen" is observable in the DOM — the switch sentinels below
 *  are content-based, never a guess about render timing. Both hold their name
 *  at DOMAIN level, so a name save dispatches at 'domain' and its reconcile
 *  reaches `refreshCompletionGate()` (the gate re-read's real initiation site). */
function wireProfilesPerCollective(): void {
	h.listMyProfilesMock.mockImplementation(async (cfg: { db: string }) =>
		cfg.db === 'bravura'
			? [{ _id: 'prof-b-dom', name: 'Bea', email: '', _sharing: 'domain' }]
			: [{ _id: 'prof-a-dom', name: 'Ada', email: '', _sharing: 'domain' }]
	);
}

function signInWithTwoCollectives(): void {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [COLLECTIVE_A, COLLECTIVE_B],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
	return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
}

/** Wait until the profile surface shows THIS collective's loaded name — proof
 *  the new context's load fully landed (not a leftover DOM from the last one). */
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

/** Initiate the gate re-read the way the app does: a domain-level name save
 *  settles, the queue's `reconcile` fires, and `refreshCompletionGate()` calls
 *  `resolveGate` — whose promise THIS spec holds. Waits until the resolveGate
 *  call count reaches `expectedCalls`, so the initiation is confirmed before
 *  the test proceeds to switch/settle. */
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
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
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

		// 1. Initiate the gate re-read in A. The resolveGate promise is HELD.
		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		expect(h.resolveGateMock.mock.calls[0][0]).toMatchObject({ db: 'polyphony' });
		expect(h.resolveGateMock.mock.calls[0][1]).toBe('person-p');

		// 2. Switch to B while A's read is still in flight.
		await switchCollective(container, 'bravura', 'Bea');

		// 3. B's own gate resolution lands (the layout owns this on a switch):
		//    the user has NOT completed her profile in B.
		completionGateStore.set('incomplete');

		// 4. ONLY NOW settle A's stale read — with exactly the value that opens
		//    the hole: 'complete' suppresses the /profile redirect and re-enables
		//    member affordances app-wide.
		staleRead.resolve('complete');
		await flushMicrotasks();

		// THE assertion (the store's value — the SSOT itself): A's stale
		// 'complete' must never land. Pre-fix this reads 'complete' — the stale
		// write reaching the app-wide gate — and fails every run.
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

		// B's resolve has not landed: the store is still in its pending state.
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

		// No switch: the settle is current, and MUST write.
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

		// Three gate re-reads initiated across A → B → A, ALL held.
		await saveNameToInitiateGateRead(container, 'Ada M.', 1);
		await switchCollective(container, 'bravura', 'Bea');
		await saveNameToInitiateGateRead(container, 'Bea M.', 2);
		await switchCollective(container, 'polyphony', 'Ada');
		await saveNameToInitiateGateRead(container, 'Ada N.', 3);

		// The three requests carried their own contexts at initiation.
		expect(h.resolveGateMock.mock.calls[0][0]).toMatchObject({ db: 'polyphony' });
		expect(h.resolveGateMock.mock.calls[1][0]).toMatchObject({ db: 'bravura' });
		expect(h.resolveGateMock.mock.calls[1][1]).toBe('person-b');
		expect(h.resolveGateMock.mock.calls[2][0]).toMatchObject({ db: 'polyphony' });

		// Settle out of order: the superseded A-read first (no assertion on the
		// intermediate value — RED pins outcome, not the guard's keying), then
		// the LAST requested context's read.
		readA1.resolve('incomplete');
		await flushMicrotasks();
		readA2.resolve('complete');
		await flushMicrotasks();
		expect(get(completionGateStore)).toBe('complete');

		// B's read settles LAST of all — from a context the user has left.
		// It must write nothing: the last-requested context's result stands.
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

		// The stale read REJECTS after the user has left its context. The guard
		// must swallow it silently (write nothing, surface nothing) — GREEN's
		// seam owns the rejection so it cannot escape as an unhandled rejection.
		staleRead.reject(new Error('resolveGate: network down'));
		await flushMicrotasks();

		expect(get(completionGateStore)).toBe('loading');
		// B's surface is untouched by A's stale failure.
		expect(q(container, '[data-testid="profile-load-error"]')).toBeNull();
		expect(displayValue(container, 'name')).toBe('Bea');
	});

	it('write-side guard only: the completionGate module keeps its exported surface (no API change for consumers)', async () => {
		// The ACTUAL module (this spec mocks only resolveGate for the page) —
		// consumers everywhere depend on exactly this surface.
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

		// The store contract consumers rely on: starts 'loading', set() lands.
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
