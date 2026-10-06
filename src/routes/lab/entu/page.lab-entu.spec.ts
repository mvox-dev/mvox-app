// @vitest-environment happy-dom
// /lab/entu: a sign-in link that lets Entu ask for the provider, and an add-passkey link
// shown only to a signed-in user with a selected collective (#826).
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { exchangeMock } = vi.hoisted(() => ({ exchangeMock: vi.fn() }));
vi.mock('$lib/auth/exchange', () => ({ exchangeSession: exchangeMock }));
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

import Page from './+page.svelte';
import { runCallbackExchange } from '../../auth/callback/run-callback-exchange';
import { resolveGuardRedirect } from '$lib/auth/guard';
import { getToken } from '$lib/auth/storage';
import { authStore } from '$lib/auth/session';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { collectiveState } from '$lib/collectives/store';
import { discoverMock } from '$lib/testing/routeMocks';
import { resetAppState } from '$lib/testing/appReset';
import { signIn, SAMPLEDB } from '$lib/testing/session';
import { LOCALES, readMessages } from '$lib/testing/pages/files';

const API = 'https://api.entu-test.invalid/';
const OTHER = { db: 'otherdb', name: 'Other', personId: 'person-o' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'none' })}.${b64({ accounts: {}, exp: 9_999_999_999 })}.sig`;

function signInLink(container: HTMLElement): HTMLAnchorElement {
	const a = container.querySelector<HTMLAnchorElement>('[data-testid="lab-entu-sign-in"]');
	expect(a, 'the sign-in link is always shown').not.toBeNull();
	return a!;
}

function passkeyLink(container: HTMLElement): HTMLAnchorElement | null {
	return container.querySelector<HTMLAnchorElement>('[data-testid="lab-entu-add-passkey"]');
}

function parts(href: string) {
	const url = new URL(href);
	return {
		base: `${url.origin}${url.pathname}`,
		params: Object.fromEntries(url.searchParams)
	};
}

// Stops happy-dom from following the link off the test page; the click handler still runs.
function stayOnPage(event: Event) {
	event.preventDefault();
}

beforeEach(() => {
	resetAppState();
	document.addEventListener('click', stayOnPage);
});

afterEach(() => {
	cleanup();
	document.removeEventListener('click', stayOnPage);
	overwriteGetLocale(() => 'en');
	exchangeMock.mockReset();
	discoverMock.mockReset();
});

describe('/lab/entu sign-in link', () => {
	// Break: route the link through a provider, or drop `next`, and the parts differ.
	it('goes to Entu auth with no provider, the existing callback as next, and lang', () => {
		const { container } = render(Page);
		expect(parts(signInLink(container).href)).toEqual({
			base: `${API}auth`,
			params: { next: `${window.location.origin}/auth/callback?key=`, lang: 'en' }
		});
	});

	// Break: pass the app locale straight through and lv/uk reach Entu, which has only et/en.
	it.each([
		['et', 'et'],
		['en', 'en'],
		['lv', 'en'],
		['uk', 'en']
	])('app locale %s asks Entu for %s', (appLocale, entuLang) => {
		overwriteGetLocale(() => appLocale as 'en');
		const { container } = render(Page);
		expect(parts(signInLink(container).href).params.lang).toBe(entuLang);
	});

	// Break: drop the click handler's state write and the callback answers csrf_mismatch.
	it('a click leaves the callback its state; the user lands back here signed in', async () => {
		const { container } = render(Page);
		await fireEvent.click(signInLink(container));

		exchangeMock.mockResolvedValue({ ok: true, token: JWT, accounts: [], user: { _id: 'u1' } });
		discoverMock.mockResolvedValue({ collectives: [], erroredDbs: [] });
		expect(await runCallbackExchange('session-key')).toEqual({ ok: true, redirectTo: '/lab/entu' });
		expect(exchangeMock).toHaveBeenCalledWith({ sessionToken: 'session-key' });
		expect(getToken()).toBe(JWT);
	});

	// Break: leave /lab/entu off the public list and a signed-out visitor is sent to login.
	it('a signed-out visitor is let through to the page', () => {
		expect(resolveGuardRedirect({ pathname: '/lab/entu', token: null, nowMs: Date.now() })).toBe(
			null
		);
	});
});

describe('/lab/entu add-passkey link', () => {
	// Break: show the link without checking the session and it appears here.
	it('is not shown when signed out, even with a collective still in the store', () => {
		collectiveState.set({ status: 'ready', collectives: [SAMPLEDB], erroredDbs: [] });
		authStore.set({ status: 'anonymous' });
		const { container } = render(Page);
		expect(passkeyLink(container)).toBeNull();
	});

	// Break: show it before a collective is resolved and it renders with no db.
	it('is not shown when signed in but no collective is selected yet', () => {
		signIn();
		collectiveState.set({ status: 'loading' });
		const { container } = render(Page);
		expect(passkeyLink(container)).toBeNull();
	});

	// Break: build the URL from the first collective instead of the selected one.
	it("links to Entu's add-passkey page for the selected collective's database", () => {
		signIn({ collectives: [SAMPLEDB, OTHER], selected: 'otherdb' });
		const { container } = render(Page);
		expect(passkeyLink(container)?.href).toBe('https://entu.app/otherdb/passkey');
	});
});

describe('/lab/entu strings', () => {
	const KEYS = ['lab_entu_heading', 'lab_entu_sign_in', 'lab_entu_add_passkey'];

	// Break: leave a key out of one locale file, or render a hardcoded label.
	it.each(LOCALES)('under %s the page shows that locale’s strings', (locale) => {
		overwriteGetLocale(() => locale as 'en');
		signIn();
		const { container } = render(Page);
		const shown = [
			container.querySelector('h1')?.textContent?.trim(),
			signInLink(container).textContent?.trim(),
			passkeyLink(container)?.textContent?.trim()
		];
		expect(shown).toEqual(KEYS.map((k) => readMessages(locale)[k]));
	});
});

// (*MVOX:Josquin*)
