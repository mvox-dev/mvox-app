// @vitest-environment happy-dom
// /auth/logout runs the real performLogout, then goes straight to /auth/login; it renders
// no signed-out page of its own.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { performLogoutSpy } = vi.hoisted(() => ({
	performLogoutSpy: vi.fn()
}));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('./perform-logout', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./perform-logout')>();
	performLogoutSpy.mockImplementation(actual.performLogout);
	return { performLogout: performLogoutSpy };
});

import Page from './+page.svelte';
import { setToken, setLastProvider, getToken, getLastProvider } from '$lib/auth/storage';
import { authStore } from '$lib/auth/session';
import { gotoMock } from '$lib/testing/routeMocks';

afterEach(() => {
	cleanup();
	gotoMock.mockReset();
	performLogoutSpy.mockClear();
	localStorage.clear();
	sessionStorage.clear();
});

describe('/auth/logout — clears the session and redirects (#206)', () => {
	it('calls performLogout on mount, tearing the stored session down for real', () => {
		setToken('header.payload.sig');
		setLastProvider('google');

		render(Page);

		expect(performLogoutSpy).toHaveBeenCalledTimes(1);
		expect(getToken(), 'token must be gone').toBeNull();
		expect(getLastProvider(), 'explicit sign-out drops the remembered provider').toBeNull();
		expect(get(authStore)).toEqual({ status: 'anonymous' });
	});

	it('navigates to /auth/login after the teardown', () => {
		render(Page);

		expect(gotoMock).toHaveBeenCalledTimes(1);
		const target = gotoMock.mock.calls[0]?.[0];
		expect(String(target)).toBe('/auth/login');
	});

	// A redirect-only route must replace its own history entry, or Back remounts it and
	// the user can never step back past the sign-out.
	it('replaces its own history entry rather than pushing, so Back is not trapped', () => {
		render(Page);

		expect(gotoMock.mock.calls[0]?.[1]).toEqual({ replaceState: true });
	});

	it('renders NO static "Signed out" page content', () => {
		const { container } = render(Page);

		const text = container.textContent ?? '';
		expect(text, 'no "Signed out" heading/copy').not.toMatch(/signed out/i);
		expect(text, 'no manual "Sign back in" link — the redirect is the way back').not.toMatch(
			/sign back in/i
		);
		expect(
			container.querySelector('a[href="/auth/login"]'),
			'no static link standing in for the redirect'
		).toBeNull();
	});
});

// (*MVOX:Tallis*)
