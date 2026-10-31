// @vitest-environment happy-dom
// #1048 — /profile names the commit the running app was built from, whatever the load state.
import { execFileSync } from 'node:child_process';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('$lib/profile/profileData', async (importOriginal) =>
	(await import('$lib/testing/mocks/session')).profileDataModule(importOriginal)
);

import ProfilePage from './profile/+page.svelte';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { resetGate } from '$lib/profile/completionGate';
import { resetAppState } from '$lib/testing/appReset';
import { listMyProfilesMock } from '$lib/testing/mocks/session';
import { signIn } from '$lib/testing/session';

// Under vitest the bundle is a dev build: it names the commit this checkout is at.
const SHORT = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim().slice(0, 7);

const line = (c: HTMLElement) =>
	c.querySelector('[data-testid="profile-running-build"]')?.textContent?.trim();

afterEach(() => {
	overwriteGetLocale(() => 'en');
	cleanup();
	resetAppState();
	resetGate();
	listMyProfilesMock.mockReset();
});

describe('#1048 the profile page shows the running build', () => {
	it('names the short commit in English once the profile is loaded', async () => {
		signIn({ token: 'jwt-member', selected: 'sampledb' });
		listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(ProfilePage);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="profile-field-name"]')).not.toBeNull()
		);
		expect(line(container)).toBe(`mvox version ${SHORT}`);
	});

	it('names it in Estonian too, with no collective to load', async () => {
		overwriteGetLocale(() => 'et');
		signIn({ token: 'jwt-member', collectives: [] });
		listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(ProfilePage);
		await waitFor(() =>
			expect(container.querySelector('[data-testid="profile-no-collective"]')).not.toBeNull()
		);
		expect(line(container)).toBe(`mvox versioon ${SHORT}`);
	});
});

// (*MVOX:Josquin*)
