// @vitest-environment happy-dom
//
// #107 review F6 — the /profile session-expired branch shipped with no spec at
// all: the `'session-expired'` status was added to the page but never
// exercised, so nothing pinned it against a later refactor. Mirrors
// page.roster-session-expired.spec.ts, both pairings:
//   • an auth-expired load shows the notice, NOT the generic load error;
//   • a generic failure still shows the loud load error + retry.
//
// Mock scaffolding inherited from page.profile.spec.ts.
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (p?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
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
	return { ProfileSaveError, listMyProfilesMock: vi.fn() };
});
vi.mock('$lib/profile/profileData', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/profile/profileData')>();
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});
vi.mock('$lib/profile/applyProfileSave', () => ({
	applyProfileSave: vi.fn(),
	ProfileSaveError: h.ProfileSaveError
}));
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
import { resetGate } from '$lib/profile/completionGate';

/** Duck-typed 401 rejection from the entuFetch layer (name-tag contract). */
function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
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

beforeEach(() => {
	h.listMyProfilesMock.mockReset();
});

afterEach(() => {
	cleanup();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	resetGate();
});

describe('/profile — session expired (#107)', () => {
	it('an auth-expired profile load shows the session-expired notice with a sign-in link — not the generic load error', async () => {
		h.listMyProfilesMock.mockRejectedValue(authExpiredError());
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		const signin = container.querySelector('[data-testid="session-expired-signin"]');
		expect(signin, 'the notice must carry a sign-in link').not.toBeNull();
		expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

		expect(container.querySelector('[data-testid="profile-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="profile-retry-load"]')).toBeNull();
		// …and never the editable form, which would invite a save that cannot land.
		expect(container.querySelector('[data-testid="profile-name"]')).toBeNull();
	});

	it('a GENERIC profile load failure still shows the loud load error + retry (auth handling must not swallow it)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		h.listMyProfilesMock.mockRejectedValue(new Error('listMyProfiles failed: 500'));
		selectPolyphony();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="profile-load-error"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="profile-retry-load"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="session-expired"]')).toBeNull();
		consoleSpy.mockRestore();
	});
});

// (*MVOX:Josquin*)
