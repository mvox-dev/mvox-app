// @vitest-environment happy-dom
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);

vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);
vi.mock('$lib/profile/applyProfileSave', async () =>
	(await import('$lib/testing/mocks/profile')).applyProfileSaveModule('shared')
);
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
import { resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { ProfileSaveError } from '$lib/testing/mocks/profile';

function authExpiredError(): Error {
	const e = new Error('Entu returned 401 — session expired');
	e.name = 'AuthExpiredError';
	return e;
}

function selectSampledb() {
	signIn({ token: 'jwt-member' });
}

beforeEach(() => {
	listMyProfilesMock.mockReset();
});

afterEach(() => {
	cleanup();
	resetAppState();
	resetGate();
});

describe('/profile — session expired (#107)', () => {
	it('an auth-expired profile load shows the session-expired notice with a sign-in link — not the generic load error', async () => {
		listMyProfilesMock.mockRejectedValue(authExpiredError());
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
		listMyProfilesMock.mockRejectedValue(new Error('listMyProfiles failed: 500'));
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
