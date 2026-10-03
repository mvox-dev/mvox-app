// @vitest-environment happy-dom
// ?error=session_expired renders a session-expired message in the alert slot, keeps the
// provider CTAs, and the page performs no navigation on mount.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

// Mutable $app/state stub — same pattern as page.invite-landing.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { setLastProvider } from '$lib/auth/storage';
// The real paraglide surface, deliberately not mocked: this page is where the user reads
// why they were signed out, so the copy has to come from the locale files.
import { m } from '$lib/paraglide/messages.js';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import etMessages from '../../../../messages/et.json';
import lvMessages from '../../../../messages/lv.json';
import ukMessages from '../../../../messages/uk.json';
import { gotoMock } from '$lib/testing/routeMocks';

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

	// ── the copy is translated, not a hardcoded English literal ──
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
