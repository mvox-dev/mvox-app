// @vitest-environment happy-dom
//
// #35 — profile edit v2 page tests. Targets the v2 surface: one field editor
// per field, autosave-driven saves, save feedback on the active visibility
// button.
//
// AMENDED for #205 (standing UX rule 4): the fields are whole-field
// display-then-edit now — `profile-<field>-edit` (a native button wrapping the
// value) activates `profile-<field>` (the input). Everything here that types
// goes through `openEditor`; value reads in display state go through
// `displayValue`. The activation contract itself is pinned in
// page.profile-whole-field.spec.ts.
import { cleanup, createEvent, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
		// #131 — browse-then-confirm conflict resolution: first tap previews a
		// conflicting tier's value, second tap on the SAME tier resolves it.
		profile_visibility_confirm_preview: (p: { level: string }) => `Tap again to keep ${p.level}`,
		profile_visibility_preview_note: () => 'Tap again to keep this version.',
		profile_visibility_unset: () => 'Not set at any level yet.',
		profile_move_error: () =>
			"Couldn't change visibility. Nothing was lost — please try again.",
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
		// #123 — LanguageSelector (now rendered as app chrome on this page) reads
		// this key for its aria-label.
		profile_language_label: () => 'Language',
		// #207 rule 5 — the AM/PM preference control, app chrome like the
		// language selector above (see page.profile-time-format.spec.ts for the
		// dedicated feature tests).
		profile_time_format_label: () => 'Time format',
		profile_time_format_24h: () => '24-hour',
		profile_time_format_ampm: () => 'AM/PM',
		profile_time_format_hint: () => 'Applies on this device.',
		// #193 — linked accounts section, always rendered once status is 'ready'
		// (see page.profile-linked-accounts.spec.ts for the dedicated feature tests).
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
		profile_link_cancel: () => 'Cancel'
	}
}));

const h = vi.hoisted(() => {
	class ProfileSaveError extends Error {
		readonly createdProfileId?: string;
		constructor(message: string, createdProfileId?: string) {
			super(message);
			this.name = 'ProfileSaveError';
			this.createdProfileId = createdProfileId;
		}
	}
	return {
		ProfileSaveError,
		listMyProfilesMock: vi.fn(),
		applyProfileSaveMock: vi.fn(),
		// #131 — the browse-then-confirm resolve-write primitive.
		applyConflictResolutionMock: vi.fn()
	};
});
// #131 — mock ONLY the new applyConflictResolution primitive; keep every other
// fieldMove export real (planLoadedDuplicateRepairs drives the existing,
// unmocked repair-banner tests below — must not be replaced wholesale).
vi.mock('$lib/profile/fieldMove', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/fieldMove')>('$lib/profile/fieldMove');
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
	ProfileSaveError: h.ProfileSaveError
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
// #193 — the profile page reads `?link_error` / `?linked` off `page.url` (the
// return leg of the provider-link round trip). Default: a clean /profile URL.
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './profile/+page.svelte';
import { setToken, setUser, setLastProvider, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { get } from 'svelte/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

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

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

// ── #205 — display-then-edit helpers ────────────────────────────────────────
// The profile fields are whole-field activators now (standing UX rule 4): the
// raw input only mounts after activating `profile-<field>-edit`. Ready
// sentinels therefore wait on the ProfileField WRAPPER, and every test that
// types must open the editor first. The full activation contract is pinned in
// page.profile-whole-field.spec.ts — these helpers just keep this file on it.

/** Wait until the profile surface is loaded (display state). */
async function waitReady(container: HTMLElement): Promise<void> {
	await waitFor(() =>
		expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
	);
}

/** The display-state value element's text for a field (trimmed). */
function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
	return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
}

/** Activate a field's whole-field button; answers the revealed input. */
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

beforeEach(() => {
	vi.useFakeTimers();
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
	h.applyConflictResolutionMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('/profile v2 — render + seed', () => {
	it('renders name and email whole-field activators once loaded (#205 — the raw inputs no longer live-mount)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitReady(container);
		expect(q(container, '[data-testid="profile-name-edit"]')).not.toBeNull();
		expect(q(container, '[data-testid="profile-email-edit"]')).not.toBeNull();
	});

	it('seeds the displays from the narrowest non-empty holder, and the editor opens pre-filled', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);
		expect(displayValue(container, 'name')).toBe('Ada');
		expect(displayValue(container, 'email')).toBe('ada@x.io');
		const nameInput = await openEditor(container, 'name');
		expect(nameInput.value).toBe('Ada');
	});

	it('shows load error with retry', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		selectPolyphony();
		h.listMyProfilesMock.mockRejectedValue(new Error('listMyProfiles failed: 500'));
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-load-error"]')).not.toBeNull()
		);
		expect(container.textContent).toContain('Could not load your profile.');
		expect(q(container, '[data-testid="profile-retry-load"]')).not.toBeNull();
		consoleSpy.mockRestore();
	});

	it('renders a sign-out link to /auth/logout (#59 — moved from agenda page)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitReady(container);
		const signOut = q(container, 'a[href="/auth/logout"]');
		expect(signOut).not.toBeNull();
		expect(signOut?.textContent).toBe('Sign out');
	});

	it('shows the signed-in account + provider (#60)', async () => {
		selectPolyphony();
		setUser({ _id: 'u1', email: 'mihkel@example.com', name: 'Mihkel' });
		setLastProvider('google');
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitReady(container);
		const identity = q(container, '[data-testid="profile-identity"]');
		expect(identity).not.toBeNull();
		expect(identity?.textContent).toBe('Signed in as mihkel@example.com via Google');
	});

	it('falls back to name when the user has no email (#60)', async () => {
		selectPolyphony();
		setUser({ _id: 'u1', name: 'Mihkel' });
		setLastProvider('smart-id');
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitReady(container);
		const identity = q(container, '[data-testid="profile-identity"]');
		expect(identity?.textContent).toBe('Signed in as Mihkel via Smart-ID');
	});
});

describe('/profile v2 — autosave on blur', () => {
	it('typing then blurring the name input triggers an autosave', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		const arg = h.applyProfileSaveMock.mock.calls[0][0];
		expect(arg).toMatchObject({
			level: 'domain',
			existingId: null,
			personId: 'person-p',
			fields: { name: 'Ada', email: '' }
		});
	});
});

describe('/profile v2 — autosave on idle', () => {
	it('typing then waiting 2 seconds triggers an autosave', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-dom-1' });
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });

		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
		vi.advanceTimersByTime(2_000);
		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
	});
});

describe('/profile v2 — autosave on visibility change', () => {
	it('clicking a visibility icon on a dirty field saves before moving', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await waitReady(container);

		// Edit the name (makes it dirty). #205 — the tier toolbar must stay
		// mounted and live WHILE the editor is open (only the display/input
		// area swaps), so this click sequence still exercises save-before-move.
		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });

		// Click the public visibility button for name — should fire autosave first.
		const pubBtn = q(
			container,
			'[data-testid="profile-vis-name-public"]'
		) as HTMLButtonElement;
		await fireEvent.click(pubBtn);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			fields: { name: 'Ada M.', email: 'ada@x.io' }
		});
	});
});

describe('/profile v2 — save feedback on active button', () => {
	it('while saving, the active visibility button shows Saving and is disabled', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		// The active button (domain) should show saving feedback.
		await waitFor(() => {
			const domBtn = q(
				container,
				'[data-testid="profile-vis-name-domain"]'
			) as HTMLButtonElement;
			expect(domBtn.disabled).toBe(true);
			expect(domBtn.getAttribute('aria-busy')).toBe('true');
			expect(
				q(container, '[data-testid="profile-vis-name-domain-saving"]')
			).not.toBeNull();
		});

		// Resolve the save — button returns to normal.
		d.resolve({ profileId: 'prof-dom' });
		// Also mock the re-read for refreshCompletionGate.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada M.', email: '', _sharing: 'domain' }
		]);
		await waitFor(() => {
			const domBtn = q(
				container,
				'[data-testid="profile-vis-name-domain"]'
			) as HTMLButtonElement;
			expect(domBtn.getAttribute('aria-busy')).toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-domain-saving"]')).toBeNull();
		});
	});
});

describe('/profile v2 — save failure shows per-field error', () => {
	it('a rejected autosave shows an error under the field', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockRejectedValueOnce(new Error('save failed'));
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada' } });
		await fireEvent.blur(nameInput);

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-name-error"]')).not.toBeNull()
		);
		// Draft preserved (retryable) — the closed editor's display keeps it.
		expect(displayValue(container, 'name')).toBe('Ada');
	});
});

describe('/profile v2 — name-private guard', () => {
	it('the private visibility button for name is always disabled', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);

		const privBtn = q(
			container,
			'[data-testid="profile-vis-name-private"]'
		) as HTMLButtonElement;
		expect(privBtn.disabled).toBe(true);
	});

	it('the private visibility button for email is NOT disabled (email can be private)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);

		const privBtn = q(
			container,
			'[data-testid="profile-vis-email-private"]'
		) as HTMLButtonElement;
		expect(privBtn.disabled).toBe(false);
	});

	it('name-private guard on the save path throws (never silent)', async () => {
		selectPolyphony();
		// Contrive an impossible state: name sitting at the private level.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' }
		]);
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });

		// Blurring triggers the autosave blur, which calls onAutosave — the guard throws.
		// fireEvent.blur is async (wraps in act), so the throw surfaces as a rejected promise.
		await expect(fireEvent.blur(nameInput)).rejects.toThrow('name-private guard');
	});

	it('name-private guard on the move path: button is disabled', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);

		// The private button is disabled so a click won't fire onmove.
		const privBtn = q(
			container,
			'[data-testid="profile-vis-name-private"]'
		) as HTMLButtonElement;
		expect(privBtn.disabled).toBe(true);
	});
});

describe('/profile v2 — sibling value pinned (privacy leak prevention)', () => {
	it('a name autosave while email lives at a different level pins sibling to the target entity value', async () => {
		selectPolyphony();
		// name at domain, email at private — different levels.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' },
			{ _id: 'prof-priv', name: '', email: 'secret@x.io', _sharing: 'private' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await waitReady(container);

		// Edit name and blur to trigger autosave.
		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		const arg = h.applyProfileSaveMock.mock.calls[0][0];
		// The save targets the domain entity. Its sibling (email) should be the
		// domain entity's confirmed email (''), NOT the private entity's email
		// ('secret@x.io'). Using the unified draft email would leak the private email.
		expect(arg).toMatchObject({
			level: 'domain',
			existingId: 'prof-dom',
			fields: { name: 'Ada M.', email: '' }
		});
	});
});

describe('/profile v2 — #39 name prefill from EntuUser', () => {
	it('prefills domain name from EntuUser.name when no domain profile exists', async () => {
		setUser({ _id: 'u1', name: 'Ada Lovelace' });
		h.listMyProfilesMock.mockResolvedValue([]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('Ada Lovelace');
		});
		const input = await openEditor(container, 'name');
		expect(input.value).toBe('Ada Lovelace');
	});

	it('does NOT overwrite an existing domain name with EntuUser.name', async () => {
		setUser({ _id: 'u1', name: 'Ada Lovelace' });
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-d', name: 'Her Chosen Name', email: 'a@b.c', _sharing: 'domain' }
		]);
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('Her Chosen Name');
		});
	});

	it('leaves domain name empty when EntuUser has no name', async () => {
		setUser({ _id: 'u1' });
		h.listMyProfilesMock.mockResolvedValue([]);
		selectPolyphony();

		const { container } = render(Page);

		await waitReady(container);
		const input = await openEditor(container, 'name');
		expect(input.value).toBe('');
	});
});

describe('/profile v2 — cross-queue lock (save in flight blocks move)', () => {
	it('a move is blocked while an autosave is in flight', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		const { container } = render(Page);
		await waitReady(container);

		// Edit and blur to start a save.
		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		// While save is in flight, the visibility buttons should be disabled.
		await waitFor(() => {
			const pubBtn = q(
				container,
				'[data-testid="profile-vis-email-public"]'
			) as HTMLButtonElement;
			expect(pubBtn.disabled).toBe(true);
		});

		// Resolve the save.
		d.resolve({ profileId: 'prof-dom' });
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada M.', email: 'ada@x.io', _sharing: 'domain' }
		]);
	});
});

describe('/profile v2 — T4.8 completion gate SSOT', () => {
	it('the completion banner clears after a domain name autosave', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValueOnce([]);
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'dp-1', name: 'Ann', email: '', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'dp-1' });
		completionGateStore.set('incomplete');

		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-completion-required"]')).not.toBeNull()
		);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ann' } });
		await fireEvent.blur(nameInput);

		await waitFor(() =>
			expect(q(container, '[data-testid="profile-completion-required"]')).toBeNull()
		);
		expect(get(completionGateStore)).toBe('complete');
	});
});

describe('/profile v2 — repair banners still work', () => {
	it('an interrupted-move duplicate shows the repair banner', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() =>
			expect(
				q(container, '[data-testid="profile-visibility-repair-name"]')
			).not.toBeNull()
		);
	});
});

describe('/profile v2 — distinct-value conflict', () => {
	it('a field holding DIFFERENT values at two levels shows a conflict note', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Alice', email: '', _sharing: 'private' },
			{ _id: 'prof-pub', name: 'Alice Smith', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
		);

		expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).not.toBeNull();
		expect(q(container, '[data-testid="profile-visibility-repair-name"]')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// #131 — browse-then-confirm conflict resolution. A field with DIFFERENT
// values at ≥2 tiers currently disables every visibility button — no way to
// resolve. New UX: conflict-tier buttons become clickable. First tap PREVIEWS
// that tier's value (input shows it + a "tap again" hint); a second tap on
// the SAME button RESOLVES — every other holder is synced to the previewed
// value via applyConflictResolution. No modal — the two-tap pattern IS the
// confirmation. Tapping a DIFFERENT conflict button while previewing SWITCHES
// the preview instead of resolving.
// ---------------------------------------------------------------------------
describe('/profile v2 — #131 conflict resolution (browse-then-confirm)', () => {
	it('AC1: a conflicting tier\'s visibility button is NOT disabled (previously always disabled)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());

		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		expect(pubBtn.disabled).toBe(false);
	});

	it('AC2: first tap on a conflicting tier previews its value + shows the "tap again" hint', async () => {
		// Preview is pure synchronous UI state (no debounce involved) — real
		// timers so a not-yet-implemented click's waitFor fails on its own
		// ~1s default instead of hanging on fake-timer-blocked retries to
		// vitest's 5s test timeout (see tallis.md GOTCHA, hit 2026-08-10 on #73).
		vi.useRealTimers();
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
		// Before any tap, the display shows the narrow-wins active value.
		expect(displayValue(container, 'name')).toBe('Ann');

		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		await fireEvent.click(pubBtn);

		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('Annie');
			expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).not.toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).not.toBeNull();
		});
		// Previewing is NOT resolving — no write yet.
		expect(h.applyConflictResolutionMock).not.toHaveBeenCalled();
	});

	it('AC3: second tap on the SAME tier resolves — syncs every OTHER holder to the previewed value', async () => {
		vi.useRealTimers(); // see AC2 comment
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValueOnce([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		// After resolution, the profiles are re-read; both now hold the same
		// value — a same-value duplicate, not a distinct-value conflict, so the
		// conflict note clears (the existing collapse-to-one-entity repair path
		// picks it up from here — real, unmocked planLoadedDuplicateRepairs).
		// Queued up front (not after the resolve click) — the reload now fires
		// off a tick()-scheduled microtask rather than a setTimeout(0) macrotask,
		// so it can land before any post-click synchronous test setup would.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Annie', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		h.applyConflictResolutionMock.mockResolvedValue({ field: 'name', syncedIds: ['prof-dom'] });
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());

		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		await fireEvent.click(pubBtn); // 1st tap — preview
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).not.toBeNull()
		);
		await fireEvent.click(pubBtn); // 2nd tap — resolve

		await waitFor(() => expect(h.applyConflictResolutionMock).toHaveBeenCalledTimes(1));
		expect(h.applyConflictResolutionMock.mock.calls[0][0]).toMatchObject({
			field: 'name',
			value: 'Annie',
			// Only the OTHER holder (domain) needs syncing — public already holds 'Annie'.
			sync: [{ id: 'prof-dom', sibling: '' }]
		});

		await waitFor(() => {
			expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).toBeNull();
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull();
		});
	});

	it('AC4: tapping a DIFFERENT conflicting tier during preview switches the preview (no resolve)', async () => {
		vi.useRealTimers(); // see AC2 comment
		selectPolyphony();
		// Three-way conflict: private is narrowest/active (an already-existing,
		// pre-#131 impossible-to-CREATE-but-legal-to-HOLD state — same precedent
		// as the "name-private guard" describe block above); domain + public are
		// both 'conflict' buttons, neither guarded, so switching between them
		// alone exercises AC4 without touching the always-disabled private button.
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-pri', name: 'Ann', email: '', _sharing: 'private' },
			{ _id: 'prof-dom', name: 'Annie', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'A. Smith', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());

		const domBtn = q(container, '[data-testid="profile-vis-name-domain"]') as HTMLButtonElement;
		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;

		await fireEvent.click(domBtn); // preview domain
		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('Annie');
			expect(q(container, '[data-testid="profile-vis-name-domain-preview"]')).not.toBeNull();
		});

		await fireEvent.click(pubBtn); // switch preview to public
		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('A. Smith');
			expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).not.toBeNull();
			// The domain preview marker is gone — the preview state moved, it didn't accumulate.
			expect(q(container, '[data-testid="profile-vis-name-domain-preview"]')).toBeNull();
		});
		// Switching previews is never a confirm.
		expect(h.applyConflictResolutionMock).not.toHaveBeenCalled();
	});

	it('AC5: a non-conflicting field renders no conflict/preview markers — happy path unchanged', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());

		expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).toBeNull();
		expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).toBeNull();
		expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).toBeNull();
		// The plain inactive/movable public button behaves as before — enabled,
		// no conflict styling hooks.
		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		expect(pubBtn.disabled).toBe(false);
		expect(q(container, '[data-testid="profile-vis-name-public-conflict"]')).toBeNull();
	});

	it('AC6: pressing Escape while previewing dismisses the preview back to the active value', async () => {
		vi.useRealTimers(); // see AC2 comment
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());

		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		await fireEvent.click(pubBtn); // 1st tap — preview

		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('Annie');
			expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).not.toBeNull();
		});

		await fireEvent.keyDown(pubBtn, { key: 'Escape' });

		await waitFor(() => {
			// previewLevel back to null: input reverts to the narrow-wins active
			// value, the preview marker/hint are gone, and the conflict note
			// (not the preview note) shows again.
			expect(displayValue(container, 'name')).toBe('Ann');
			expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).not.toBeNull();
		});
		// Escape is a pure dismiss — no write.
		expect(h.applyConflictResolutionMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// #156 — roving tabindex on the per-field visibility tier group (ProfileField).
// TOOLBAR semantics: arrows MOVE focus only. Activation here is destructive on
// a second tap (a conflict tier resolves in its own favour — browse-then-
// confirm), so an arrow that also selected would resolve conflicts by accident.
//
// The tricky part, and the reason this is pinned rather than read off the
// source: the stop must fall back to the first ENABLED tier. The NAME field's
// private tier is permanently disabled, and a disabled button cannot hold
// focus — a stop parked there would strand the whole group from the keyboard.
// ---------------------------------------------------------------------------
describe('/profile — visibility tier group: roving tabindex (#156)', () => {
	async function renderProfile(): Promise<HTMLElement> {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitReady(container);
		return container;
	}

	function tiers(container: HTMLElement, field: 'name' | 'email'): HTMLButtonElement[] {
		return (['private', 'domain', 'public'] as const).map(
			(level) =>
				q(container, `[data-testid="profile-vis-${field}-${level}"]`) as HTMLButtonElement
		);
	}
	function stops(btns: HTMLButtonElement[]): HTMLButtonElement[] {
		return btns.filter((b) => b.getAttribute('tabindex') === '0');
	}

	it('the tier group is a role="toolbar" with an accessible name', async () => {
		const container = await renderProfile();
		const group = tiers(container, 'email')[0].closest('[role="toolbar"]');
		expect(group, 'the tier group must declare toolbar semantics').not.toBeNull();
		expect(group!.getAttribute('aria-label')).toBeTruthy();
	});

	it('exactly ONE tier is the Tab stop, per field', async () => {
		const container = await renderProfile();
		expect(stops(tiers(container, 'name'))).toHaveLength(1);
		expect(stops(tiers(container, 'email'))).toHaveLength(1);
	});

	it('NAME: the stop is never the permanently-disabled private tier — it falls back to the first ENABLED one', async () => {
		const container = await renderProfile();
		const [priv, domain, pub] = tiers(container, 'name');
		// The name field can never go private, and the CURRENTLY ACTIVE tier is
		// also disabled (you cannot move a field to where it already is) — so
		// `public` is the only enabled tier here.
		expect(priv.disabled, 'the name field cannot go private').toBe(true);
		expect(domain.disabled, 'the active tier is not a move target').toBe(true);
		expect(pub.disabled).toBe(false);

		expect(priv.getAttribute('tabindex')).toBe('-1');
		expect(stops(tiers(container, 'name'))).toEqual([pub]);
	});

	it('arrow navigation SKIPS disabled tiers entirely — it never lands focus on one', async () => {
		const container = await renderProfile();
		const [priv, domain, pub] = tiers(container, 'name');
		pub.focus();
		expect(document.activeElement).toBe(pub);

		// `public` is the only enabled member, so the wrap lands back on itself
		// rather than on either disabled tier.
		await fireEvent.keyDown(pub, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(pub);
		await fireEvent.keyDown(pub, { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(pub);
		expect(document.activeElement).not.toBe(priv);
		expect(document.activeElement).not.toBe(domain);
	});

	it('EMAIL: arrows move between the ENABLED tiers and WRAP, skipping the disabled active tier', async () => {
		const container = await renderProfile();
		const [priv, domain, pub] = tiers(container, 'email');
		// Email CAN go private; the active (domain) tier is the disabled one.
		expect(priv.disabled).toBe(false);
		expect(domain.disabled).toBe(true);
		expect(pub.disabled).toBe(false);

		priv.focus();
		await fireEvent.keyDown(priv, { key: 'ArrowRight' });
		expect(document.activeElement, 'domain is disabled — it must be stepped over').toBe(pub);

		await fireEvent.keyDown(pub, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(priv);

		await fireEvent.keyDown(priv, { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(pub);
	});

	it('arrows MOVE ONLY — no visibility write is issued by arrow navigation', async () => {
		const container = await renderProfile();
		const [priv, , pub] = tiers(container, 'email');
		priv.focus();
		await fireEvent.keyDown(priv, { key: 'ArrowRight' });
		await fireEvent.keyDown(pub, { key: 'ArrowRight' });
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus leaves the group and the tier still activates', async () => {
		const container = await renderProfile();
		const btn = tiers(container, 'email')[0];
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(btn, { key });
			fireEvent(btn, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});

	it('Escape still dismisses a conflict preview — the roving handler did not swallow the pre-existing key', async () => {
		const container = await renderProfile();
		const btn = tiers(container, 'email')[0];
		const event = createEvent.keyDown(btn, { key: 'Escape' });
		fireEvent(btn, event);
		expect(event.defaultPrevented).toBe(false);
	});
});
