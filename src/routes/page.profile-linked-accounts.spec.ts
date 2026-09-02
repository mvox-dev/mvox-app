// @vitest-environment happy-dom
//
// #193 RED — profile page: linked auth providers + "Link another account".
//
// Design (issue #193 + SPIKE 2026-09-01, Gama/Mihkel-approved self-invite
// mechanism): the profile page shows the person entity's ACTUAL bound
// identities (read via listLinkedIdentities — the entu_user array, NOT the
// localStorage last-provider, which only knows how THIS session logged in).
// "Link another account" opens native per-provider controls; picking one mints
// a self-invite on the user's OWN person AT CLICK TIME (never pre-minted — the
// token is a live 24h bearer credential) and launches the second-provider OAuth
// round trip with `intent: 'link'` riding the localStorage state blob. The
// token never enters any URL. Redemption appends the second identity server-side.
//
// These are the page-INTEGRATION pins: the data function is called from the
// real route with the real selected collective's cfg + personId, and the flow
// is reachable from the rendered page — not just in isolation.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMessageEmpty, messagePatterns, type MessageFile } from '$lib/testing/messageFile.js';

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
		// #205 — whole-field display-then-edit activators (sr-only action labels).
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
		profile_visibility_unset: () => 'Not set at any level yet.',
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
		// #207 rule 5 — the AM/PM preference control, app chrome like the
		// language selector above (see page.profile-time-format.spec.ts).
		profile_time_format_label: () => 'Time format',
		profile_time_format_24h: () => '24-hour',
		profile_time_format_ampm: () => 'AM/PM',
		profile_time_format_hint: () => 'Applies on this device.',
		// #193 — linked accounts. Every new UI string rides a Paraglide key (the
		// locale-parity block at the bottom pins all four locales).
		profile_linked_accounts_title: (p: { collective: string }) =>
			`Sign-ins that work for ${p.collective}`,
		profile_link_another: () => 'Link another account',
		profile_link_choose_provider: () => 'Choose a provider to link',
		profile_link_error_conflict: () =>
			'That account is already in use by another member here.',
		profile_link_error_dead: () => 'The link attempt expired or was already used.',
		profile_link_error_failed: () => 'Linking failed — you can try again.',
		profile_link_error_missing_rights: () =>
			'Your account is missing the rights needed to link another sign-in.',
		profile_link_error_already_linked: () => 'That sign-in is already linked to your account.',
		profile_link_error_step: (p: { step: string }) =>
			`Linking could not be completed — it stopped at step: ${p.step}. You can try again.`,
		profile_link_success: (p: { collective: string }) =>
			`That sign-in now works for ${p.collective}.`,
		// #219 — the after-the-fact case: the round trip completed and nothing
		// changed. Neutral copy, NOT an error (Gama ruling on #219).
		profile_link_noop_same_identity: () => 'That sign-in was already linked. Nothing changed.',
		profile_link_cancel: () => 'Cancel',
		// #218 — provider display names resolve through Paraglide (single source
		// in $lib/auth/providers). AUTH_PROVIDERS binds `label` to these message
		// functions AT MODULE LOAD, so a missing key here would make the page
		// render throw. Bare nouns per Gama's #218 ruling.
		auth_provider_smart_id: () => 'Smart-ID',
		auth_provider_mobile_id: () => 'Mobile-ID',
		auth_provider_id_card: () => 'ID-card',
		auth_provider_e_mail: () => 'E-mail',
		auth_provider_google: () => 'Google',
		auth_provider_apple: () => 'Apple'
	}
}));

const h = vi.hoisted(() => {
	class SelfLinkMintError extends Error {
		readonly phase: string;
		readonly reason: string;
		constructor(message: string, opts: { phase: string; reason: string }) {
			super(message);
			this.name = 'SelfLinkMintError';
			this.phase = opts.phase;
			this.reason = opts.reason;
		}
	}
	class InviteCreateError extends Error {}
	return {
		SelfLinkMintError,
		InviteCreateError,
		listMyProfilesMock: vi.fn(),
		applyProfileSaveMock: vi.fn(),
		applyConflictResolutionMock: vi.fn(),
		listLinkedIdentitiesMock: vi.fn(),
		mintSelfLinkInviteMock: vi.fn()
	};
});
vi.mock('$lib/profile/fieldMove', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/profile/fieldMove')>('$lib/profile/fieldMove');
	return { ...actual, applyConflictResolution: h.applyConflictResolutionMock };
});
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
// #193 — the linked-identities read producer (unit-pinned in
// lib/profile/linkedIdentities.spec.ts against the real wire; mocked HERE so the
// page test pins the WIRING: called from the route with the real cfg/personId).
vi.mock('$lib/profile/linkedIdentities', () => ({
	listLinkedIdentities: h.listLinkedIdentitiesMock
}));
// #193 — the mint producer (unit-pinned in lib/invite/selfLink.spec.ts against
// the real wire; mocked HERE to pin mint-at-click-time from the real page).
vi.mock('$lib/invite/inviteData', () => ({
	mintSelfLinkInvite: h.mintSelfLinkInviteMock,
	SelfLinkMintError: h.SelfLinkMintError,
	INVITE_MINT_TRIGGER: 'trigger invite token',
	InviteCreateError: h.InviteCreateError,
	createInvite: vi.fn(),
	resolvePersonParentId: vi.fn(),
	resolveInviteParentId: vi.fn()
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
// #193 (review F1) — the RETURN leg lands on `/profile?link_error=<code>` or
// `/profile?linked=1`; the page must read it off `page.url`. Mutable stub so each
// test points the URL at its own outcome.
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './profile/+page.svelte';
import { setToken, setUser, setLastProvider, clearAll } from '$lib/auth/storage';
import { decodeState, OAUTH_STATE_KEY } from '$lib/auth/state';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { resetGate } from '$lib/profile/completionGate';

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const qa = (c: HTMLElement, sel: string) => Array.from(c.querySelectorAll(sel));

function selectPolyphony() {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

const GOOGLE_ID = { _id: 'eu-1', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' };
const EMAIL_ID = { _id: 'eu-2', uid: 'me@example.com', provider: 'e-mail', email: 'me@example.com' };
// #206 — binds the provider that currently LEADS the picker, so the focus-skip
// test below has something to skip. See that test for why it needs its own.
const SMART_ID = { _id: 'eu-3', uid: 'EE38001085718', provider: 'smart-id', email: '' };

async function renderReady(): Promise<HTMLElement> {
	selectPolyphony();
	const { container } = render(Page);
	await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
	return container;
}

/**
 * Render, wait for the linked-identities read to LAND (the picker's per-provider
 * disabled state is derived from it — asserting before it resolves would race),
 * then open the provider picker.
 */
async function openPicker(): Promise<HTMLElement> {
	const container = await renderReady();
	await waitFor(() =>
		expect(qa(container, '[data-testid^="profile-linked-identity"]').length).toBeGreaterThan(0)
	);
	await fireEvent.click(q(container, '[data-testid="profile-link-another"]') as HTMLElement);
	await waitFor(() =>
		expect(q(container, '[data-testid="profile-link-provider-apple"]')).not.toBeNull()
	);
	return container;
}

beforeEach(() => {
	h.listMyProfilesMock.mockReset().mockResolvedValue([]);
	h.applyProfileSaveMock.mockReset();
	h.applyConflictResolutionMock.mockReset();
	h.listLinkedIdentitiesMock.mockReset().mockResolvedValue({
		identities: [GOOGLE_ID],
		pendingInvites: 0
	});
	h.mintSelfLinkInviteMock.mockReset().mockResolvedValue({ inviteToken: 'tok.link.1' });
	localStorage.removeItem(OAUTH_STATE_KEY);
	pageStub.url = new URL('http://localhost/profile');
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	localStorage.removeItem(OAUTH_STATE_KEY);
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('/profile — linked accounts section (#193 AC1: display from the entity read)', () => {
	it('renders the section and is WIRED to the route: listLinkedIdentities gets the selected collective cfg + personId', async () => {
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
		);
		const section = q(container, '[data-testid="profile-linked-accounts"]') as HTMLElement;
		expect(section.textContent).toContain('Sign-ins that work for Polyphony');

		expect(h.listLinkedIdentitiesMock).toHaveBeenCalledTimes(1);
		expect(h.listLinkedIdentitiesMock.mock.calls[0].slice(0, 2)).toEqual([
			{ db: 'polyphony', token: 'jwt-member' },
			'person-p'
		]);
	});

	it('a person with TWO bound identities renders TWO rows — both providers visible (the APPEND result)', async () => {
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID, EMAIL_ID],
			pendingInvites: 0
		});
		const container = await renderReady();

		await waitFor(() =>
			expect(qa(container, '[data-testid^="profile-linked-identity"]')).toHaveLength(2)
		);
		const section = q(container, '[data-testid="profile-linked-accounts"]') as HTMLElement;
		expect(section.textContent).toContain('Google');
		expect(section.textContent).toContain('E-mail');
		expect(section.textContent).toContain('me@example.com');
	});

	it('the list comes from the ENTITY read, not localStorage last-provider (which only knows this session)', async () => {
		setUser({ _id: 'person-p', email: 'me@example.com', name: 'Me' });
		setLastProvider('apple'); // this session happened to log in via Apple…
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID], // …but the person's only BOUND identity is Google.
			pendingInvites: 0
		});
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
		);
		const section = q(container, '[data-testid="profile-linked-accounts"]') as HTMLElement;
		expect(section.textContent).toContain('Google');
		expect(section.textContent).not.toContain('Apple');
	});

	it('masked un-redeemed invite placeholders are NOT presented as linked identities', async () => {
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID],
			pendingInvites: 1
		});
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
		);
		expect(qa(container, '[data-testid^="profile-linked-identity"]')).toHaveLength(1);
		const section = q(container, '[data-testid="profile-linked-accounts"]') as HTMLElement;
		expect(section.textContent).not.toContain('***');
	});
});

// ── review F1: the copy must not claim more than the mechanism delivers ─────────
//
// The mint runs against the SELECTED collective's {db, personId}, so the second
// identity is appended to that collective's person entity and nothing else. The
// list was already per-collective; only the labels ("Linked accounts", "linked to
// your account") read account-wide. These pin the scope into the words.

describe('/profile — linking copy is scoped to the collective (#193 review F1)', () => {
	it('the section heading names the selected collective', async () => {
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
		);
		const heading = q(container, '[data-testid="profile-linked-accounts"] h2') as HTMLElement;
		expect(heading.textContent?.trim()).toBe('Sign-ins that work for Polyphony');
	});

	it('the success line says which collective the sign-in now works for — never "your account"', async () => {
		pageStub.url = new URL('http://localhost/profile?linked=1');
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-link-success"]')).not.toBeNull()
		);
		const success = q(container, '[data-testid="profile-link-success"]') as HTMLElement;
		expect(success.textContent?.trim()).toBe('That sign-in now works for Polyphony.');
		expect(success.textContent).not.toContain('your account');
	});

	it('switching collective re-scopes the copy — it reads selectedCollectiveStore, not a fixed label', async () => {
		pageStub.url = new URL('http://localhost/profile?linked=1');
		setToken('jwt-member');
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' },
				{ db: 'kammerkoor', name: 'Kammerkoor', personId: 'person-k' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set('polyphony');

		const { container } = render(Page);
		await waitFor(() =>
			expect(
				(q(container, '[data-testid="profile-linked-accounts"] h2') as HTMLElement)?.textContent
			).toContain('Polyphony')
		);

		selectedCollectiveDbStore.set('kammerkoor');

		await waitFor(() =>
			expect(
				(q(container, '[data-testid="profile-linked-accounts"] h2') as HTMLElement)?.textContent
			).toContain('Kammerkoor')
		);
		await waitFor(() =>
			expect(
				(q(container, '[data-testid="profile-link-success"]') as HTMLElement)?.textContent
			).toContain('Kammerkoor')
		);
	});
});

describe('/profile — "Link another account" flow (#193 AC2/AC3: native controls, mint at click time)', () => {
	it('the CTA is a NATIVE button (PO standing rule) and nothing is minted on page load', async () => {
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-link-another"]')).not.toBeNull()
		);
		const cta = q(container, '[data-testid="profile-link-another"]') as HTMLElement;
		expect(cta.tagName).toBe('BUTTON');
		expect(cta.textContent).toContain('Link another account');
		// The invite token is a live 24h bearer credential — never pre-minted.
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it('clicking the CTA reveals NATIVE per-provider controls — still no mint until a provider is picked', async () => {
		const container = await renderReady();
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-link-another"]')).not.toBeNull()
		);

		await fireEvent.click(q(container, '[data-testid="profile-link-another"]') as HTMLElement);

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-link-provider-google"]')).not.toBeNull()
		);
		const providerControls = qa(container, '[data-testid^="profile-link-provider-"]');
		expect(providerControls.length).toBeGreaterThan(1); // one per available provider
		for (const el of providerControls) {
			expect(['BUTTON', 'A']).toContain((el as HTMLElement).tagName);
		}
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it('picking a NOT-yet-linked provider mints the self-invite on the OWN person and launches the link round trip — token in the blob, never in a URL', async () => {
		const container = await openPicker();

		// Google is already bound (the beforeEach default), so the link the user can
		// actually start is a provider they do NOT have yet.
		await fireEvent.click(
			q(container, '[data-testid="profile-link-provider-apple"]') as HTMLElement
		);

		// The real mint producer is driven with the route's own cfg + personId.
		await waitFor(() => expect(h.mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		expect(h.mintSelfLinkInviteMock.mock.calls[0].slice(0, 2)).toEqual([
			{ db: 'polyphony', token: 'jwt-member' },
			'person-p'
		]);

		// The OAuth state blob is the ONLY carrier — full shape. #219: the blob now
		// also carries the pre-mint snapshot of the linked set ({_id, uid, provider}
		// per identity), replayed by the callback's same-identity duplicate check.
		await waitFor(() => expect(localStorage.getItem(OAUTH_STATE_KEY)).not.toBeNull());
		expect(decodeState(localStorage.getItem(OAUTH_STATE_KEY)!)).toEqual({
			nonce: expect.any(String),
			return_to: '/profile?linked=1',
			intent: 'link',
			provider: 'apple',
			invite: { db: 'polyphony', token: 'tok.link.1' },
			linkPersonId: 'person-p',
			linkedSnapshot: [{ _id: 'eu-1', uid: 'uid-g-1', provider: 'google' }]
		});

		// Bearer hygiene: the token never enters any URL.
		expect(window.location.href).not.toContain('tok.link.1');
	});

	it('a mint failure (e.g. missing self-_editor) surfaces a LOUD named error — no silent fallback, no launch', async () => {
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('self-link mint refused: HTTP 403 — the person lacks self-_editor', {
				phase: 'mint',
				reason: 'missing-self-editor'
			})
		);
		const container = await openPicker();

		await fireEvent.click(
			q(container, '[data-testid="profile-link-provider-apple"]') as HTMLElement
		);

		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).not.toBeNull());
		const error = q(container, '[data-testid="profile-link-error"]') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain(
			'Your account is missing the rights needed to link another sign-in.'
		);
		// The failed mint launched nothing.
		expect(localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
	});
});

// ── #219: an already-linked provider is a legitimate pick — the block is gone ───
//
// The #193 review-F3 pre-mint block punished the everyday "which Google was it?"
// case. The guard MOVED to the callback: entu-api's same-person branch still
// reports a clean `redeemed` with no conflict flag, so the round trip runs and
// run-link-callback.ts detects the no-op afterwards against the pre-mint
// snapshot riding the OAuth-state blob (see run-link-callback.spec.ts,
// "same-identity re-link"). The picker's only remaining disabling condition is
// linkedLoadFailed (review F1 — unchanged).

describe('/profile — already-linked providers stay offered (#219)', () => {
	it('the already-bound provider is ENABLED and carries no "already linked" sub-label', async () => {
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID],
			pendingInvites: 0
		});
		const container = await openPicker();

		const google = q(container, '[data-testid="profile-link-provider-google"]') as HTMLButtonElement;
		expect(google.disabled).toBe(false);
		expect(q(container, '[data-testid="profile-link-already-linked-google"]')).toBeNull();
		expect(google.textContent).not.toContain('That sign-in is already linked to your account.');

		const apple = q(container, '[data-testid="profile-link-provider-apple"]') as HTMLButtonElement;
		expect(apple.disabled).toBe(false);
	});

	it('clicking the already-linked provider mints and launches the round trip — snapshot riding the blob', async () => {
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID],
			pendingInvites: 0
		});
		const container = await openPicker();

		await fireEvent.click(
			q(container, '[data-testid="profile-link-provider-google"]') as HTMLElement
		);

		// The real mint producer is driven with the route's own cfg + personId —
		// same shape as for a not-yet-linked provider. No refusal, no linkError.
		await waitFor(() => expect(h.mintSelfLinkInviteMock).toHaveBeenCalledTimes(1));
		expect(h.mintSelfLinkInviteMock.mock.calls[0].slice(0, 2)).toEqual([
			{ db: 'polyphony', token: 'jwt-member' },
			'person-p'
		]);
		expect(q(container, '[data-testid="profile-link-error"]')).toBeNull();

		// Full blob shape, toEqual — the pre-mint snapshot ({_id, uid, provider} of
		// the CURRENT identities) is what the callback's duplicate check replays.
		await waitFor(() => expect(localStorage.getItem(OAUTH_STATE_KEY)).not.toBeNull());
		expect(decodeState(localStorage.getItem(OAUTH_STATE_KEY)!)).toEqual({
			nonce: expect.any(String),
			return_to: '/profile?linked=1',
			intent: 'link',
			provider: 'google',
			invite: { db: 'polyphony', token: 'tok.link.1' },
			linkPersonId: 'person-p',
			linkedSnapshot: [{ _id: 'eu-1', uid: 'uid-g-1', provider: 'google' }]
		});

		// The launch is real: the page navigated to the Entu OAuth init URL (link
		// intent — no login_hint), with the invite token in NO URL.
		expect(window.location.href).toBe(
			'https://api.entu-test.invalid/auth/google?next=http%3A%2F%2Flocalhost%2Fauth%2Fcallback%3Fkey%3D'
		);
		expect(window.location.href).not.toContain('tok.link.1');
	});
});

// ── #219: the linked-identities list de-duplicates by uid+provider ──────────────
//
// The same-identity re-link the callback now cleans up can leave (or, before the
// cleanup lands server-side, HAS left) two entu_user entries with identical
// uid+provider and different _ids. One identity must render as ONE row — first
// occurrence in entity order wins — while two genuinely different accounts at
// the same provider stay two rows.

describe('/profile — linked-identities list de-duplicates by uid+provider (#219)', () => {
	const GOOGLE_DUP = { _id: 'eu-9', uid: 'uid-g-1', provider: 'google', email: 'me@example.com' };
	const GOOGLE_OTHER = {
		_id: 'eu-10',
		uid: 'uid-g-2',
		provider: 'google',
		email: 'other@example.com'
	};

	it('two entries with the SAME uid+provider render exactly ONE row — the first occurrence wins', async () => {
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID, GOOGLE_DUP],
			pendingInvites: 0
		});
		const container = await renderReady();

		await waitFor(() =>
			expect(qa(container, '[data-testid^="profile-linked-identity"]').length).toBeGreaterThan(0)
		);
		const rows = qa(container, '[data-testid^="profile-linked-identity"]');
		expect(rows).toHaveLength(1);
		expect((rows[0] as HTMLElement).getAttribute('data-testid')).toBe(
			'profile-linked-identity-eu-1'
		);
	});

	it('two entries with the same provider but DIFFERENT uids stay TWO rows — the key is uid+provider, not provider alone', async () => {
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID, GOOGLE_OTHER],
			pendingInvites: 0
		});
		const container = await renderReady();

		await waitFor(() =>
			expect(qa(container, '[data-testid^="profile-linked-identity"]')).toHaveLength(2)
		);
	});
});

// ── review F1: the RETURN leg of the round trip must speak ──────────────────────
//
// run-link-callback.ts redirects every redemption-side failure to
// `/profile?link_error=<code>` and success to `/profile?linked=1`. Before this
// fix nothing on the profile page read either, so a user whose second provider
// was already bound to another member came back to a normal-looking profile.

describe('/profile — link round-trip outcome from the URL (#193 review F1)', () => {
	const CASES: ReadonlyArray<[string, string]> = [
		['conflict', 'That account is already in use by another member here.'],
		['dead', 'The link attempt expired or was already used.'],
		['failed', 'Linking failed — you can try again.'],
		['already_linked', 'That sign-in is already linked to your account.'],
		// Named, never swallowed into the generic "linking failed".
		['unexpected', 'it stopped at step: unexpected'],
		['invalid', 'it stopped at step: invalid'],
		['persist_failed', 'it stopped at step: persist_failed']
	];

	it.each(CASES)('?link_error=%s renders the named alert', async (code, expected) => {
		pageStub.url = new URL(`http://localhost/profile?link_error=${code}`);
		const container = await renderReady();

		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).not.toBeNull());
		const error = q(container, '[data-testid="profile-link-error"]') as HTMLElement;
		expect(error.getAttribute('role')).toBe('alert');
		expect(error.textContent).toContain(expected);
	});

	it('?linked=1 confirms the link instead of staying silent', async () => {
		pageStub.url = new URL('http://localhost/profile?linked=1');
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-link-success"]')).not.toBeNull()
		);
		expect(
			(q(container, '[data-testid="profile-link-success"]') as HTMLElement).textContent
		).toContain('That sign-in now works for Polyphony.');
		expect(q(container, '[data-testid="profile-link-error"]')).toBeNull();
	});

	// The whitelist above is closed on purpose: `?link_error=` is attacker-shaped
	// input landing in a role="alert" node, and the previous `default:` arm echoed
	// it verbatim through `profile_link_error_step`.
	it.each([
		'<img src=x onerror=alert(1)>',
		'totally-made-up',
		'',
		'CONFLICT' // right word, wrong case — still not one of ours
	])('an unrecognized ?link_error=%s never echoes the parameter', async (code) => {
		pageStub.url = new URL(
			`http://localhost/profile?link_error=${encodeURIComponent(code)}`
		);
		const container = await renderReady();

		if (code === '') {
			// An empty value is falsy — no banner at all, and certainly no echo.
			await waitFor(() =>
				expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
			);
			expect(q(container, '[data-testid="profile-link-error"]')).toBeNull();
			return;
		}

		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).not.toBeNull());
		const error = q(container, '[data-testid="profile-link-error"]') as HTMLElement;
		expect(error.textContent?.trim()).toBe('Linking failed — you can try again.');
		expect(error.textContent).not.toContain(code);
		expect(error.innerHTML).not.toContain(code);
	});

	it('a clean /profile URL shows neither banner', async () => {
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
		);
		expect(q(container, '[data-testid="profile-link-error"]')).toBeNull();
		expect(q(container, '[data-testid="profile-link-success"]')).toBeNull();
	});

	it('starting a new attempt clears the previous round trip’s verdict', async () => {
		pageStub.url = new URL('http://localhost/profile?link_error=conflict');
		const container = await renderReady();
		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).not.toBeNull());

		await fireEvent.click(q(container, '[data-testid="profile-link-another"]') as HTMLElement);

		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).toBeNull());
	});
});

// ── review F1: a FAILED identity read is not an empty identity list ─────────────
//
// Every user has at least one bound identity, so falling back to `[]` was a
// display lie AND a safety hole: `linkedProviderIds` went empty, which defeats
// both duplicate-link guards (the per-provider `disabled` and the check at the
// top of handleLinkProvider) at the same time.

describe('/profile — linked-identities read failure (#193 review F1)', () => {
	it('says WHICH step failed instead of rendering an empty "Linked accounts" list', async () => {
		h.listLinkedIdentitiesMock.mockRejectedValue(
			new Error('listLinkedIdentities: identity read failed: HTTP 500')
		);
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-load-error"]')).not.toBeNull()
		);
		const alert = q(container, '[data-testid="profile-linked-load-error"]') as HTMLElement;
		expect(alert.getAttribute('role')).toBe('alert');
		expect(alert.textContent).toContain('it stopped at step: identity-read');
		// The name/email editing surface — the page's primary purpose — survives.
		expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull();
	});

	it('blocks linking entirely while the bound set is unknown — no duplicate can be minted', async () => {
		h.listLinkedIdentitiesMock.mockRejectedValue(new Error('HTTP 500'));
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-load-error"]')).not.toBeNull()
		);
		const cta = q(container, '[data-testid="profile-link-another"]') as HTMLButtonElement;
		expect(cta.disabled).toBe(true);

		await fireEvent.click(cta);
		expect(q(container, '[data-testid="profile-link-provider-apple"]')).toBeNull();
		expect(h.mintSelfLinkInviteMock).not.toHaveBeenCalled();
	});

	it('retrying the read clears the error and renders the real list', async () => {
		h.listLinkedIdentitiesMock.mockRejectedValueOnce(new Error('HTTP 500'));
		const container = await renderReady();
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-load-error"]')).not.toBeNull()
		);

		await fireEvent.click(q(container, '[data-testid="profile-linked-retry"]') as HTMLElement);

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-load-error"]')).toBeNull()
		);
		expect(qa(container, '[data-testid^="profile-linked-identity"]')).toHaveLength(1);
		expect((q(container, '[data-testid="profile-link-another"]') as HTMLButtonElement).disabled).toBe(
			false
		);
	});
});

// ── review F2: the mint phase must reach the user ───────────────────────────────
//
// SelfLinkMintError carries a three-value phase. Collapsing every non-rights
// failure into "Linking failed — you can try again." hid the one case where a
// retry cannot help: `stale-invite-cleanup` aborts before the mint and will keep
// aborting until the stale property is cleared server-side.

describe('/profile — mint failures name their step (#193 review F2)', () => {
	const PHASES: ReadonlyArray<string> = ['identity-read', 'stale-invite-cleanup', 'mint'];

	it.each(PHASES)('a mint failure at phase %s surfaces that step by name', async (phase) => {
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError(`self-link failed at ${phase}`, { phase, reason: 'http' })
		);
		const container = await openPicker();

		await fireEvent.click(
			q(container, '[data-testid="profile-link-provider-apple"]') as HTMLElement
		);

		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).not.toBeNull());
		const error = q(container, '[data-testid="profile-link-error"]') as HTMLElement;
		expect(error.textContent).toContain(`it stopped at step: ${phase}`);
		expect(error.textContent).not.toContain('Linking failed — you can try again.');
	});

	it('the missing-self-editor rights gap keeps its own wording', async () => {
		h.mintSelfLinkInviteMock.mockRejectedValue(
			new h.SelfLinkMintError('HTTP 403', { phase: 'mint', reason: 'missing-self-editor' })
		);
		const container = await openPicker();

		await fireEvent.click(
			q(container, '[data-testid="profile-link-provider-apple"]') as HTMLElement
		);

		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).not.toBeNull());
		expect((q(container, '[data-testid="profile-link-error"]') as HTMLElement).textContent).toContain(
			'Your account is missing the rights needed to link another sign-in.'
		);
	});

	it('a non-SelfLinkMintError still falls back to the generic message', async () => {
		h.mintSelfLinkInviteMock.mockRejectedValue(new Error('network down'));
		const container = await openPicker();

		await fireEvent.click(
			q(container, '[data-testid="profile-link-provider-apple"]') as HTMLElement
		);

		await waitFor(() => expect(q(container, '[data-testid="profile-link-error"]')).not.toBeNull());
		expect((q(container, '[data-testid="profile-link-error"]') as HTMLElement).textContent).toContain(
			'Linking failed — you can try again.'
		);
	});
});

// ── review F3: focus custody across the activator→picker swap ───────────────────
//
// The picker REPLACES the CTA, so activating it by keyboard removed the focused
// node from the DOM and dropped focus to <body>. And once open there was no way
// back out.

describe('/profile — the picker keeps keyboard focus (#193 review F3)', () => {
	it('opening the picker focuses the FIRST provider button — an already-linked leader is a real pick now (#219)', async () => {
		// #219 fixture: bind whichever provider LEADS AUTH_PROVIDERS (smart-id
		// since #206). Under the old regime it was disabled and focus had to skip
		// to mobile-id; with the block gone every provider is focusable, so focus
		// lands on the true first button — the already-linked smart-id itself.
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [SMART_ID],
			pendingInvites: 0
		});
		await openPicker();

		expect(document.activeElement).not.toBe(document.body);
		expect((document.activeElement as HTMLElement).getAttribute('data-testid')).toBe(
			'profile-link-provider-smart-id'
		);
	});

	it('Cancel closes the picker and returns focus to the "Link another account" button', async () => {
		const container = await openPicker();

		const cancel = q(container, '[data-testid="profile-link-cancel"]') as HTMLElement;
		expect(cancel.tagName).toBe('BUTTON');
		await fireEvent.click(cancel);

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-link-provider-apple"]')).toBeNull()
		);
		expect((document.activeElement as HTMLElement).getAttribute('data-testid')).toBe(
			'profile-link-another'
		);
	});
});

// ── #219: the same-identity no-op speaks in the NEUTRAL voice ───────────────────
//
// Gama ruling on #219: the after-the-fact case ("you completed a round trip and
// nothing changed") is NOT an error — the user did nothing wrong. It gets its
// own key (profile_link_noop_same_identity) rendered through the same
// non-error styling path as profile_link_success, never through the
// role="alert" error node.

describe('/profile — same-identity no-op notice is neutral (#219)', () => {
	it('?link_noop=same_identity renders the noop message as a status, NOT inside the error node', async () => {
		pageStub.url = new URL('http://localhost/profile?link_noop=same_identity');
		const container = await renderReady();

		await waitFor(() => expect(q(container, '[data-testid="profile-link-noop"]')).not.toBeNull());
		const noop = q(container, '[data-testid="profile-link-noop"]') as HTMLElement;
		// Same non-error path as profile_link_success: role="status", never "alert".
		expect(noop.getAttribute('role')).toBe('status');
		expect(noop.textContent).toContain('That sign-in was already linked. Nothing changed.');
		// The error container (profile_link_error_* path) stays empty — the noop
		// must never ride the alert styling.
		expect(q(container, '[data-testid="profile-link-error"]')).toBeNull();
	});

	it('a clean /profile URL shows no noop banner', async () => {
		const container = await renderReady();

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
		);
		expect(q(container, '[data-testid="profile-link-noop"]')).toBeNull();
	});

	// Closed whitelist, same rationale as ?link_error=: the parameter is
	// attacker-shaped input — an unrecognized value renders nothing and is
	// never echoed.
	it.each(['<img src=x onerror=alert(1)>', 'totally-made-up'])(
		'an unrecognized ?link_noop=%s renders nothing and never echoes',
		async (code) => {
			pageStub.url = new URL(`http://localhost/profile?link_noop=${encodeURIComponent(code)}`);
			const container = await renderReady();

			await waitFor(() =>
				expect(q(container, '[data-testid="profile-linked-accounts"]')).not.toBeNull()
			);
			expect(q(container, '[data-testid="profile-link-noop"]')).toBeNull();
			const section = q(container, '[data-testid="profile-linked-accounts"]') as HTMLElement;
			expect(section.innerHTML).not.toContain(code);
		}
	);
});

// ── i18n — the #193 keys exist, non-empty, in ALL FOUR locales ──────────────────

describe('locale parity — every #193 key present and non-empty in en/et/lv/uk', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
	const KEYS = [
		'profile_linked_accounts_title',
		'profile_link_another',
		'profile_link_choose_provider',
		'profile_link_error_conflict',
		'profile_link_error_dead',
		'profile_link_error_failed',
		'profile_link_error_missing_rights',
		'profile_link_error_already_linked',
		'profile_link_error_step',
		'profile_link_success',
		// #219 — the after-the-fact same-identity case, distinct from the
		// pre-existing error key (Gama ruling: neutral copy in all four locales).
		'profile_link_noop_same_identity',
		'profile_link_cancel'
	] as const;

	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s carries every key, none empty', (locale) => {
		const file = messages(locale);
		for (const key of KEYS) {
			expect(isMessageEmpty(file[key]), `messages/${locale}.json: ${key}`).toBe(false);
		}
	});

	// review F1 — the scoping only holds if EVERY locale actually interpolates the
	// collective. A translation that drops `{collective}` silently restores the
	// account-wide claim in that language.
	const SCOPED_KEYS = ['profile_linked_accounts_title', 'profile_link_success'] as const;

	it.each(LOCALES)('%s interpolates {collective} in every collective-scoped key', (locale) => {
		const file = messages(locale);
		for (const key of SCOPED_KEYS) {
			for (const pattern of messagePatterns(file[key])) {
				expect(pattern, `messages/${locale}.json: ${key}`).toContain('{collective}');
			}
		}
	});
});

// ── #218 — ONE source for provider display names ────────────────────────────────
//
// Gama's scope addition on #218 (2026-09-02): the profile page's local
// PROVIDER_LABELS map (from #60, predates #193) is DELETED; the linked-identity
// rows and the 'Signed in as … via …' banner resolve through the same
// Paraglide-keyed providerLabel exported from $lib/auth/providers as every
// other consumer. After this there is exactly one place a provider's display
// name comes from.

describe('single provider-label source — PROVIDER_LABELS is gone (#218)', () => {
	const profileSource = readFileSync(
		resolve(process.cwd(), 'src/routes/profile/+page.svelte'),
		'utf-8'
	);

	it('the profile page no longer defines its own PROVIDER_LABELS map', () => {
		expect(profileSource).not.toContain('PROVIDER_LABELS');
	});

	it("the profile page resolves labels via providerLabel imported from '$lib/auth/providers'", () => {
		expect(profileSource).toMatch(
			/import\s*(?:type\s*)?\{[^}]*\bproviderLabel\b[^}]*\}\s*from\s*'\$lib\/auth\/providers'/
		);
	});

	it('linked-identity rows read their provider names from that single source (exact prefix)', async () => {
		h.listLinkedIdentitiesMock.mockResolvedValue({
			identities: [GOOGLE_ID, EMAIL_ID],
			pendingInvites: 0
		});
		const container = await renderReady();
		await waitFor(() =>
			expect(qa(container, '[data-testid^="profile-linked-identity"]')).toHaveLength(2)
		);
		const googleRow = q(container, '[data-testid="profile-linked-identity-eu-1"]');
		const emailRow = q(container, '[data-testid="profile-linked-identity-eu-2"]');
		expect(googleRow?.textContent?.trim()).toMatch(/^Google\b/);
		expect(emailRow?.textContent?.trim()).toMatch(/^E-mail\b/);
	});

	it("the link picker's google button reads 'Google' — the 'Continue with' framing is retired", async () => {
		const container = await openPicker();
		const google = q(container, '[data-testid="profile-link-provider-google"]');
		expect(google?.textContent?.trim()).toBe('Google');
		expect(google?.textContent).not.toContain('Continue with');
	});
});

// (*MVOX:Tallis* — #193 RED: profile linked-accounts section + link flow wiring + i18n)
// (*MVOX:Tallis* — #219 RED: link picker unblock, uid+provider list de-dup, neutral noop notice)
// (*MVOX:Tallis* — #218 RED: PROVIDER_LABELS deleted, providerLabel is the one source)
