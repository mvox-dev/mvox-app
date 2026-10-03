// @vitest-environment happy-dom
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
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
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './profile/+page.svelte';
import { resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

function selectSampledb() {
	signIn({ token: 'jwt-member' });
}

beforeEach(() => {
	h.listMyProfilesMock.mockReset();
});

afterEach(() => {
	cleanup();
	resetAppState();
	resetGate();
});

describe('/profile — session expired (#107)', () => {
	it('an auth-expired profile load shows the session-expired notice with a sign-in link — not the generic load error', async () => {
		h.listMyProfilesMock.mockRejectedValue(authExpiredError());
		selectSampledb();

		const { container } = render(Page);

		await waitFor(() => {
			expect(container.querySelector('[data-testid="session-expired"]')).not.toBeNull();
		});
		const signin = container.querySelector('[data-testid="session-expired-signin"]');
		expect(signin, 'the notice must carry a sign-in link').not.toBeNull();
		expect(signin?.getAttribute('href') ?? '').toContain('/auth/login');

		expect(container.querySelector('[data-testid="profile-load-error"]')).toBeNull();
		expect(container.querySelector('[data-testid="profile-retry-load"]')).toBeNull();
		expect(container.querySelector('[data-testid="profile-field-name"]')).toBeNull();
	});

	it('a GENERIC profile load failure still shows the loud load error + retry (auth handling must not swallow it)', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		h.listMyProfilesMock.mockRejectedValue(new Error('listMyProfiles failed: 500'));
		selectSampledb();

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
