// @vitest-environment happy-dom
//
// #107 RED — the sign-in page must SAY "session expired" when the entuFetch
// layer's 401 recovery lands the user here.
//
// The task's "server-side load function receiving 401 → responds with redirect
// to sign-in (or sets session-expired flag)" adapts to this SPA (ssr = false,
// no server loads) as: entuFetch redirects to `/auth/login?error=session_expired`
// (single-flight — pinned in request.auth-expired.spec.ts), and THIS page
// renders that flag as a human-readable session-expired message. Today the
// unknown error code falls into the generic "Something went wrong" branch.
//
// CONTRACT (for the GREEN implementer):
//   - `?error=session_expired` renders an explicit session-expired message in
//     the existing role="alert" slot (text mentions the session having
//     expired), NOT the generic fallback;
//   - the provider CTAs stay rendered (the message must not replace the way
//     back in);
//   - an error arrival must NOT silently auto-redirect to the remembered
//     provider (the user deserves to read WHY they were signed out — the
//     existing `if (error) return` early-out already covers this; pinned here
//     so the session-expired branch keeps it).
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// Mutable $app/state stub — same pattern as page.invite-landing.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { setLastProvider } from '$lib/auth/storage';
// The REAL paraglide surface — deliberately NOT mocked here. This page is the
// durable session-expired surface (the per-page notice only flashes past before
// the redirect lands), so the copy has to come from the four locale files.
import { m } from '$lib/paraglide/messages.js';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import etMessages from '../../../../messages/et.json';
import lvMessages from '../../../../messages/lv.json';
import ukMessages from '../../../../messages/uk.json';

function renderAt(search: string) {
	pageStub.url = new URL(`http://localhost/auth/login${search}`);
	return render(Page);
}

afterEach(() => {
	cleanup();
	gotoMock.mockReset();
	localStorage.clear();
	sessionStorage.clear();
});

describe('/auth/login — session expired flag (#107)', () => {
	it('?error=session_expired renders an explicit session-expired message, not the generic fallback', () => {
		const { container } = renderAt('?error=session_expired');

		const alert = container.querySelector('[role="alert"]');
		expect(alert, 'the error alert slot must render').not.toBeNull();
		const text = alert?.textContent ?? '';
		expect(text, 'must name the session as expired').toMatch(/session/i);
		expect(text, 'must name the session as expired').toMatch(/expired/i);
		expect(text, 'must not fall back to the generic error').not.toMatch(/something went wrong/i);
	});

	it('the provider sign-in CTAs stay rendered alongside the session-expired message', () => {
		const { container } = renderAt('?error=session_expired');

		expect(container.querySelector('[data-testid="provider-google"]')).not.toBeNull();
	});

	it('arriving with the session-expired flag does NOT silently auto-redirect to the remembered provider', () => {
		setLastProvider('google');
		renderAt('?error=session_expired');

		expect(gotoMock).not.toHaveBeenCalled();
	});

	// ── #107 review F4 — the copy must be TRANSLATED, not a hardcoded English
	// literal duplicating the key that was just added to all four locale files.
	// An Estonian/Latvian/Ukrainian singer whose session expires reads this page,
	// not the notice that flashed past.
	it('renders the paraglide message, so the login copy and the locale files cannot drift', () => {
		const { container } = renderAt('?error=session_expired');

		expect(container.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
			m.session_expired_message()
		);
	});

	it('renders the ESTONIAN copy under the et locale (not English)', () => {
		overwriteGetLocale(() => 'et');
		try {
			const { container } = renderAt('?error=session_expired');
			const text = container.querySelector('[role="alert"]')?.textContent?.trim();
			expect(text).toBe(etMessages.session_expired_message);
			expect(text).not.toBe('Your session has expired. Please sign in again.');
		} finally {
			overwriteGetLocale(() => 'en');
		}
	});

	it('all four shipped locales carry the key (checklist item 5)', () => {
		for (const messages of [etMessages, lvMessages, ukMessages]) {
			expect(messages.session_expired_message).toBeTruthy();
			expect(messages.session_expired_signin).toBeTruthy();
		}
	});
});

// (*MVOX:Tallis*)
