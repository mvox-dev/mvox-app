// @vitest-environment happy-dom
//
// #206 RED — /auth/logout is a pass-through, not a destination.
//
// Today the route clears the session and then parks the user on a static
// "Signed out" page. #206 retires that page: logout clears the session
// (performLogout) and immediately navigates to /auth/login, where the
// always-rendered picker (see page.signin-picker.spec.ts) is the one true
// signed-out surface.
//
// CONTRACT (for the GREEN implementer):
//   - mounting the route calls performLogout() (the shared teardown — storage
//     AND authStore, provider dropped);
//   - it then navigates to /auth/login via goto;
//   - it renders NO static "Signed out" content (no heading, no "You have been
//     signed out" copy, no manual "Sign back in" link — the redirect IS the
//     way back in).
//
// This is an integration spec on the REAL route component
// (src/routes/auth/logout/+page.svelte), driving the REAL performLogout —
// the spy wraps the actual implementation so the storage teardown is verified
// end-to-end, not hand-waved through a stub.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const { gotoMock, performLogoutSpy } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	performLogoutSpy: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('./perform-logout', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./perform-logout')>();
	performLogoutSpy.mockImplementation(actual.performLogout);
	return { performLogout: performLogoutSpy };
});

import Page from './+page.svelte';
import { setToken, setLastProvider, getToken, getLastProvider } from '$lib/auth/storage';
import { authStore } from '$lib/auth/session';

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

	// #206 review F1 — a redirect-only route must REPLACE its own history entry.
	// Pushed, /auth/logout stays on the stack: Back remounts this component, its
	// onMount fires again and pushes /auth/login again, so the user can never
	// step back past the sign-out to wherever they came from.
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
