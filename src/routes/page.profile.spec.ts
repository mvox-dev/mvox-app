// @vitest-environment happy-dom
//
// T4.6/#26 — the profile-edit surface at /profile. Component-boundary contract
// (the on-the-wire funnel + fail-loud primitives are proven in the data-layer
// specs; here we prove the UI round trip): three level cards; a level seeds from
// listMyProfiles; a FIRST save dispatches with existingId=null (lazy create, AC1);
// nothing reads "Saved" until applyProfileSave RESOLVES (AC2); a rejected save
// surfaces an inline error and PRESERVES the draft (retryable, never stuck); a
// re-edit dispatches with the existing id; a member who types nothing never saves.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		profile_title: () => 'Your profile',
		profile_intro: () => 'Fill in each level.',
		profile_no_collective: () => 'Select a collective.',
		profile_load_error: (p: { message: string }) => `Could not load: ${p.message}`,
		profile_load_retry: () => 'Retry',
		profile_field_name_label: () => 'Name',
		profile_field_email_label: () => 'Email',
		profile_level_public_label: () => 'Public',
		profile_level_public_hint: () => 'Anyone.',
		profile_level_domain_label: () => 'Collective',
		profile_level_domain_hint: () => 'Members.',
		profile_level_private_label: () => 'Private',
		profile_level_private_hint: () => 'Only you.',
		profile_save: () => 'Save',
		profile_saving: () => 'Saving…',
		profile_saved: () => 'Saved',
		profile_save_error: () => "Couldn't save — please try again."
	}
}));

// Mock the data layer at its module boundary. `profilesByLevel` is the REAL pure
// indexer (the page depends on its by-level shape); listMyProfiles is a spy.
const h = vi.hoisted(() => {
	class ProfileSaveError extends Error {
		readonly createdProfileId?: string;
		constructor(message: string, createdProfileId?: string) {
			super(message);
			this.name = 'ProfileSaveError';
			this.createdProfileId = createdProfileId;
		}
	}
	return { ProfileSaveError, listMyProfilesMock: vi.fn(), applyProfileSaveMock: vi.fn() };
});
vi.mock('$lib/profile/profileData', () => ({
	listMyProfiles: h.listMyProfilesMock,
	profilesByLevel: (ps: Array<{ _sharing: string }>) => {
		const by: Record<string, unknown> = {};
		for (const p of ps) by[p._sharing] = p;
		return by;
	}
}));
vi.mock('$lib/profile/applyProfileSave', () => ({
	applyProfileSave: h.applyProfileSaveMock,
	ProfileSaveError: h.ProfileSaveError
}));
// Sever the $env chain the collectives store pulls in, and the store's `goto`.
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

import Page from './profile/+page.svelte';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

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

beforeEach(() => {
	h.listMyProfilesMock.mockReset();
	h.applyProfileSaveMock.mockReset();
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('/profile — render + seed', () => {
	it('renders all three level cards with name/email inputs once loaded', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-public-name"]')).not.toBeNull());
		for (const level of ['public', 'domain', 'private']) {
			expect(q(container, `[data-testid="profile-${level}-name"]`)).not.toBeNull();
			expect(q(container, `[data-testid="profile-${level}-email"]`)).not.toBeNull();
		}
	});

	it('seeds a level from an existing profile entity; levels with no entity stay blank', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-domain-name"]')).not.toBeNull());
		expect((q(container, '[data-testid="profile-domain-name"]') as HTMLInputElement).value).toBe('Ada');
		expect((q(container, '[data-testid="profile-domain-email"]') as HTMLInputElement).value).toBe('ada@x.io');
		expect((q(container, '[data-testid="profile-public-name"]') as HTMLInputElement).value).toBe('');
	});

	it('a load failure fails loud (error line + retry), never a silent empty form', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockRejectedValue(new Error('listMyProfiles failed: 500'));
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-load-error"]')).not.toBeNull());
		expect(q(container, '[data-testid="profile-retry-load"]')).not.toBeNull();
	});
});

describe('/profile — AC1 + AC3: lazy first save through the create path', () => {
	it('typing into an empty level then saving dispatches with existingId=null (a lazy create)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'server-pub-1' });
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-public-save"]')).not.toBeNull());

		const save = q(container, '[data-testid="profile-public-save"]') as HTMLButtonElement;
		expect(save.disabled).toBe(true); // nothing typed → cannot create an empty shell

		await fireEvent.input(q(container, '[data-testid="profile-public-name"]') as HTMLInputElement, {
			target: { value: 'Ada' }
		});
		await waitFor(() => expect(save.disabled).toBe(false));
		await fireEvent.click(save);

		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1);
		const arg = h.applyProfileSaveMock.mock.calls[0][0];
		expect(arg).toMatchObject({
			level: 'public',
			existingId: null,
			personId: 'person-p',
			fields: { name: 'Ada', email: '' }
		});
		expect(arg.cfg).toMatchObject({ db: 'polyphony', token: 'jwt-member' });
	});

	it('a member who types nothing never dispatches a save (no empty entities)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-public-save"]')).not.toBeNull());
		for (const level of ['public', 'domain', 'private']) {
			expect((q(container, `[data-testid="profile-${level}-save"]`) as HTMLButtonElement).disabled).toBe(true);
		}
		expect(h.applyProfileSaveMock).not.toHaveBeenCalled();
	});
});

describe('/profile — AC2: no "Saved" without a server confirmation', () => {
	it('while the save is in flight the level is disabled and shows Saving…, NOT Saved; only after resolve does Saved appear', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const d = deferred<{ profileId: string }>();
		h.applyProfileSaveMock.mockReturnValueOnce(d.promise);
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-public-save"]')).not.toBeNull());

		await fireEvent.input(q(container, '[data-testid="profile-public-name"]') as HTMLInputElement, {
			target: { value: 'Ada' }
		});
		const save = q(container, '[data-testid="profile-public-save"]') as HTMLButtonElement;
		await fireEvent.click(save);

		// In flight: disabled, "Saving…", and NOTHING has reached "Saved".
		await waitFor(() => expect(save.disabled).toBe(true));
		expect(save.textContent).toContain('Saving…');
		expect(q(container, '[data-testid="profile-public-saved"]')).toBeNull();

		d.resolve({ profileId: 'server-pub-1' });
		await waitFor(() => expect(q(container, '[data-testid="profile-public-saved"]')).not.toBeNull());
	});
});

describe('/profile — fail-loud, preserve-on-error, retryable', () => {
	it('a rejected save shows an inline error, KEEPS the typed draft, and re-enables the level', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		h.applyProfileSaveMock.mockRejectedValueOnce(new Error('createProfile failed: 500'));
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-public-save"]')).not.toBeNull());

		await fireEvent.input(q(container, '[data-testid="profile-public-name"]') as HTMLInputElement, {
			target: { value: 'Ada' }
		});
		await fireEvent.click(q(container, '[data-testid="profile-public-save"]') as HTMLButtonElement);

		await waitFor(() => expect(q(container, '[data-testid="profile-public-error"]')).not.toBeNull());
		// Draft preserved (invite precedent: values stay for retry), not reverted.
		expect((q(container, '[data-testid="profile-public-name"]') as HTMLInputElement).value).toBe('Ada');
		// Re-enabled — retryable, never stuck-pending.
		expect((q(container, '[data-testid="profile-public-save"]') as HTMLButtonElement).disabled).toBe(false);
		expect(q(container, '[data-testid="profile-public-saved"]')).toBeNull();
	});
});

describe('/profile — load generation guard: a collective switch mid-load', () => {
	it('a stale list resolving after the switch is a no-op — the newer collective wins (no cross-collective display bleed)', async () => {
		setToken('jwt-member');
		collectiveState.set({
			status: 'ready',
			collectives: [
				{ db: 'coll-a', name: 'A', personId: 'person-a' },
				{ db: 'coll-b', name: 'B', personId: 'person-b' }
			],
			erroredDbs: []
		});
		urlCollectiveDbStore.set(null);

		const dA = deferred<Array<{ _id: string; name: string; email: string; _sharing: string }>>();
		const dB = deferred<Array<{ _id: string; name: string; email: string; _sharing: string }>>();
		h.listMyProfilesMock.mockImplementation((cfg: { db: string }) => {
			if (cfg.db === 'coll-a') return dA.promise;
			if (cfg.db === 'coll-b') return dB.promise;
			return Promise.resolve([]);
		});

		selectedCollectiveDbStore.set('coll-a');
		const { container } = render(Page);
		// A's list is in flight (still pending) …
		await waitFor(() =>
			expect(h.listMyProfilesMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'coll-a' }),
				'person-a'
			)
		);
		// … the member switches to B before A resolves.
		selectedCollectiveDbStore.set('coll-b');
		await waitFor(() =>
			expect(h.listMyProfilesMock).toHaveBeenCalledWith(
				expect.objectContaining({ db: 'coll-b' }),
				'person-b'
			)
		);

		// B resolves and seeds the form.
		dB.resolve([{ _id: 'prof-b', name: 'Bob', email: 'bob@x.io', _sharing: 'public' }]);
		await waitFor(() =>
			expect((q(container, '[data-testid="profile-public-name"]') as HTMLInputElement)?.value).toBe('Bob')
		);

		// A resolves LATE — its captured generation is stale, so it must NOT overwrite B.
		dA.resolve([{ _id: 'prof-a', name: 'Ada', email: 'ada@x.io', _sharing: 'public' }]);
		await Promise.resolve();
		await Promise.resolve();
		expect((q(container, '[data-testid="profile-public-name"]') as HTMLInputElement).value).toBe('Bob');
	});
});

describe('/profile — re-edit dispatches an update, not a create', () => {
	it('editing a seeded level saves with the existing id', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@x.io', _sharing: 'domain' }
		]);
		h.applyProfileSaveMock.mockResolvedValue({ profileId: 'prof-dom' });
		const { container } = render(Page);
		await waitFor(() => expect(q(container, '[data-testid="profile-domain-name"]')).not.toBeNull());

		await fireEvent.input(q(container, '[data-testid="profile-domain-name"]') as HTMLInputElement, {
			target: { value: 'Ada M.' }
		});
		const save = q(container, '[data-testid="profile-domain-save"]') as HTMLButtonElement;
		await waitFor(() => expect(save.disabled).toBe(false));
		await fireEvent.click(save);

		expect(h.applyProfileSaveMock).toHaveBeenCalledTimes(1);
		expect(h.applyProfileSaveMock.mock.calls[0][0]).toMatchObject({
			level: 'domain',
			existingId: 'prof-dom',
			fields: { name: 'Ada M.', email: 'ada@x.io' }
		});
	});
});
