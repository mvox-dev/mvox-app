// @vitest-environment happy-dom
// The profile page: one editor per field, autosaved, with save feedback.
import { cleanup, createEvent, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
		profile_language_label: () => 'Language',
		profile_time_format_label: () => 'Time format',
		profile_time_format_24h: () => '24-hour',
		profile_time_format_ampm: () => 'AM/PM',
		profile_time_format_hint: () => 'Applies on this device.',
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
		profile_link_cancel: () => 'Cancel',
		auth_provider_smart_id: () => 'Smart-ID',
		auth_provider_mobile_id: () => 'Mobile-ID',
		auth_provider_id_card: () => 'ID-card',
		auth_provider_e_mail: () => 'E-mail',
		auth_provider_google: () => 'Google',
		auth_provider_apple: () => 'Apple'
	})
);

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
		applyConflictResolutionMock: vi.fn()
	};
});
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
import { setUser, setLastProvider } from '$lib/auth/storage';
import { get } from 'svelte/store';
import { completionGateStore, resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function selectSampledb() {
	signIn({ token: 'jwt-member' });
}

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);

async function waitReady(container: HTMLElement): Promise<void> {
	await waitFor(() =>
		expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull()
	);
}

function displayValue(container: HTMLElement, field: 'name' | 'email'): string {
	return (q(container, `[data-testid="profile-${field}-value"]`)?.textContent ?? '').trim();
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

beforeEach(() => {
	vi.useFakeTimers();
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
	h.applyConflictResolutionMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	cleanup();
	resetAppState();
	resetGate();
});

describe('/profile v2 — render + seed', () => {
	it('renders name and email whole-field activators once loaded (#205 — the raw inputs no longer live-mount)', async () => {
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitReady(container);
		expect(q(container, '[data-testid="profile-name-edit"]')).not.toBeNull();
		expect(q(container, '[data-testid="profile-email-edit"]')).not.toBeNull();
	});

	it('seeds the displays from the narrowest non-empty holder, and the editor opens pre-filled', async () => {
		selectSampledb();
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
		selectSampledb();
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
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitReady(container);
		const signOut = q(container, 'a[href="/auth/logout"]');
		expect(signOut).not.toBeNull();
		expect(signOut?.textContent).toBe('Sign out');
	});

	it('shows the signed-in account + provider (#60)', async () => {
		selectSampledb();
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
		selectSampledb();
		setUser({ _id: 'u1', name: 'Mihkel' });
		setLastProvider('smart-id');
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitReady(container);
		const identity = q(container, '[data-testid="profile-identity"]');
		expect(identity?.textContent).toBe('Signed in as Mihkel via Smart-ID');
	});

	it.each([
		[
			'with an email',
			{ _id: 'u1', email: 'mihkel@example.com', name: 'Mihkel' },
			'google',
			'mihkel@example.com'
		],
		['name only', { _id: 'u1', name: 'Mihkel' }, 'smart-id', 'Mihkel'],
		['name only, no provider', { _id: 'u1', name: 'Mihkel' }, null, 'Mihkel']
	] as const)(
		'the signed-in-as line is inside a capture-redaction marker (%s)',
		async (_label, user, provider, value) => {
			selectSampledb();
			setUser({ ...user });
			if (provider) setLastProvider(provider);
			h.listMyProfilesMock.mockResolvedValue([]);
			const { container } = render(Page);
			await waitReady(container);
			const identity = q(container, '[data-testid="profile-identity"]');
			expect(identity).not.toBeNull();
			const marked = identity?.querySelector('[data-redact]');
			expect(marked, 'profile-identity must wrap its account value in RedactedText').not.toBeNull();
			expect(marked?.textContent).toContain(value);
		}
	);
});

describe('/profile v2 — autosave on blur', () => {
	it('typing then blurring the name input triggers an autosave', async () => {
		selectSampledb();
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
		selectSampledb();
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
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });

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
		selectSampledb();
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

		d.resolve({ profileId: 'prof-dom' });
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
		selectSampledb();
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
		expect(displayValue(container, 'name')).toBe('Ada');
	});
});

describe('/profile v2 — name-private guard', () => {
	it('the private visibility button for name is always disabled', async () => {
		selectSampledb();
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
		selectSampledb();
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
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-priv', name: 'Ada', email: '', _sharing: 'private' }
		]);
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });

		await expect(fireEvent.blur(nameInput)).rejects.toThrow('name-private guard');
	});

	it('name-private guard on the move path: button is disabled', async () => {
		selectSampledb();
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
});

describe('/profile v2 — sibling value pinned (privacy leak prevention)', () => {
	it('a name autosave while email lives at a different level pins sibling to the target entity value', async () => {
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: '', _sharing: 'domain' },
			{ _id: 'prof-priv', name: '', email: 'secret@x.io', _sharing: 'private' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1));
		const arg = h.applyProfileSaveMock.mock.calls[0][0];
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
		selectSampledb();

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
		selectSampledb();

		const { container } = render(Page);

		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('Her Chosen Name');
		});
	});

	it('leaves domain name empty when EntuUser has no name', async () => {
		setUser({ _id: 'u1' });
		h.listMyProfilesMock.mockResolvedValue([]);
		selectSampledb();

		const { container } = render(Page);

		await waitReady(container);
		const input = await openEditor(container, 'name');
		expect(input.value).toBe('');
	});
});

describe('/profile v2 — cross-queue lock (save in flight blocks move)', () => {
	it('a move is blocked while an autosave is in flight', async () => {
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		const { container } = render(Page);
		await waitReady(container);

		const nameInput = await openEditor(container, 'name');
		await fireEvent.input(nameInput, { target: { value: 'Ada M.' } });
		await fireEvent.blur(nameInput);

		await waitFor(() => {
			const pubBtn = q(
				container,
				'[data-testid="profile-vis-email-public"]'
			) as HTMLButtonElement;
			expect(pubBtn.disabled).toBe(true);
		});

		d.resolve({ profileId: 'prof-dom' });
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada M.', email: 'ada@x.io', _sharing: 'domain' }
		]);
	});
});

describe('/profile v2 — T4.8 completion gate SSOT', () => {
	it('the completion banner clears after a domain name autosave', async () => {
		selectSampledb();
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
		selectSampledb();
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
		selectSampledb();
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

describe('/profile v2 — #131 conflict resolution (browse-then-confirm)', () => {
	it('AC1: a conflicting tier\'s visibility button is NOT disabled (previously always disabled)', async () => {
		selectSampledb();
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
		vi.useRealTimers();
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
		expect(displayValue(container, 'name')).toBe('Ann');

		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		await fireEvent.click(pubBtn);

		await waitFor(() => {
			expect(displayValue(container, 'name')).toBe('Annie');
			expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).not.toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).not.toBeNull();
		});
		expect(h.applyConflictResolutionMock).not.toHaveBeenCalled();
	});

	it('AC3: second tap on the SAME tier resolves — syncs every OTHER holder to the previewed value', async () => {
		vi.useRealTimers(); // see AC2 comment
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValueOnce([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' },
			{ _id: 'prof-pub', name: 'Annie', email: '', _sharing: 'public' }
		]);
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
			sync: [{ id: 'prof-dom', sibling: '' }]
		});

		await waitFor(() => {
			expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).toBeNull();
			expect(q(container, '[data-testid="profile-visibility-repair-name"]')).not.toBeNull();
		});
	});

	it('AC4: tapping a DIFFERENT conflicting tier during preview switches the preview (no resolve)', async () => {
		vi.useRealTimers(); // see AC2 comment
		selectSampledb();
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
			expect(q(container, '[data-testid="profile-vis-name-domain-preview"]')).toBeNull();
		});
		expect(h.applyConflictResolutionMock).not.toHaveBeenCalled();
	});

	it('AC5: a non-conflicting field renders no conflict/preview markers — happy path unchanged', async () => {
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ann', email: '', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());

		expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).toBeNull();
		expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).toBeNull();
		expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).toBeNull();
		const pubBtn = q(container, '[data-testid="profile-vis-name-public"]') as HTMLButtonElement;
		expect(pubBtn.disabled).toBe(false);
		expect(q(container, '[data-testid="profile-vis-name-public-conflict"]')).toBeNull();
	});

	it('AC6: pressing Escape while previewing dismisses the preview back to the active value', async () => {
		vi.useRealTimers(); // see AC2 comment
		selectSampledb();
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
			expect(displayValue(container, 'name')).toBe('Ann');
			expect(q(container, '[data-testid="profile-vis-name-public-preview"]')).toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-preview-note"]')).toBeNull();
			expect(q(container, '[data-testid="profile-vis-name-conflict-note"]')).not.toBeNull();
		});
		expect(h.applyConflictResolutionMock).not.toHaveBeenCalled();
	});
});

describe('/profile — visibility tier group: roving tabindex (#156)', () => {
	async function renderProfile(): Promise<HTMLElement> {
		selectSampledb();
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
