// @vitest-environment happy-dom
// Every visible string on the sign-in page comes from the real locale files, in all four
// locales; a non-English locale must not render the English text.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

// Mutable $app/state stub — same pattern as page.session-expired.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { setLastProvider } from '$lib/auth/storage';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { gotoMock } from '$lib/testing/routeMocks';
import { LOCALES, readMessages as messages } from '$lib/testing/pages/files';

const OTHER_LOCALES = ['et', 'lv', 'uk'] as const;

// None of these keys is a variant message; failing on the type keeps a missing key loud.
function msg(locale: string, key: string): string {
	const value = messages(locale)[key];
	expect(typeof value, `messages/${locale}.json must carry ${key} as a plain string`).toBe(
		'string'
	);
	return value as string;
}

// TODAY'S hardcoded strings — pinned as the en values (verbatim), and as the
// text that must NOT appear under any other locale.
const ENGLISH = {
	login_heading: 'Sign in to mvox',
	login_error_csrf_mismatch: 'Your sign-in link expired or was invalid. Please try again.',
	login_error_missing_session_token: 'Sign-in did not complete. Please try again.',
	login_error_generic: 'Something went wrong. Please try again.',
	login_last_used: '· last used'
} as const;

function renderAt(search = '') {
	pageStub.url = new URL(`http://localhost/auth/login${search}`);
	return render(Page);
}

afterEach(() => {
	cleanup();
	gotoMock.mockReset();
	localStorage.clear();
	sessionStorage.clear();
	overwriteGetLocale(() => 'en');
});

describe('/auth/login — en values are VERBATIM today’s strings (#218)', () => {
	it.each(Object.entries(ENGLISH))('messages/en.json carries %s verbatim', (key, value) => {
		expect(msg('en', key)).toBe(value);
	});

	it("the google CTA reads 'Google' — no 'Continue with' framing anywhere (Gama ruling)", () => {
		overwriteGetLocale(() => 'en');
		const { container } = renderAt();
		const google = container.querySelector('[data-testid="provider-google"]');
		expect(google?.textContent?.trim()).toBe('Google');
		expect(container.textContent).not.toContain('Continue with');
	});
});

describe.each(OTHER_LOCALES)('/auth/login under locale %s (#218)', (locale) => {
	it('renders the heading from login_heading — not the English text', () => {
		overwriteGetLocale(() => locale);
		const expected = msg(locale, 'login_heading');
		expect(expected, 'a copied-over English value is not a translation').not.toBe(
			ENGLISH.login_heading
		);
		const { container } = renderAt();
		expect(container.querySelector('h1')?.textContent?.trim()).toBe(expected);
	});

	it.each([
		['csrf_mismatch', 'login_error_csrf_mismatch'],
		['missing_session_token', 'login_error_missing_session_token'],
		// any unrecognised code takes the generic branch
		['jwt_exploded', 'login_error_generic']
	] as const)('?error=%s renders %s in this locale — never the English text', (code, key) => {
		overwriteGetLocale(() => locale);
		const expected = msg(locale, key);
		expect(expected, 'a copied-over English value is not a translation').not.toBe(ENGLISH[key]);
		const { container } = renderAt(`?error=${code}`);
		const alert = container.querySelector('[role="alert"]');
		expect(alert, 'the error alert slot must render').not.toBeNull();
		expect(alert?.textContent?.trim()).toBe(expected);
	});

	it('marks the remembered provider with the localized login_last_used marker', () => {
		overwriteGetLocale(() => locale);
		const marker = msg(locale, 'login_last_used');
		expect(marker, 'a copied-over English value is not a translation').not.toBe(
			ENGLISH.login_last_used
		);
		setLastProvider('e-mail');
		const { container } = renderAt();
		const cta = container.querySelector('[data-testid="provider-e-mail"]');
		expect(cta?.textContent).toContain(marker);
		expect(cta?.textContent).not.toMatch(/last used/i);
	});
});

describe('et copy ruled by Gama on #218', () => {
	it("et heading is 'Logi mvoxi sisse' and the marker '· viimati kasutatud'", () => {
		expect(msg('et', 'login_heading')).toBe('Logi mvoxi sisse');
		expect(msg('et', 'login_last_used')).toBe('· viimati kasutatud');
	});

	it('the login page renders the et provider labels (ID-kaart / E-post) under et', () => {
		overwriteGetLocale(() => 'et');
		const { container } = renderAt();
		expect(
			container.querySelector('[data-testid="provider-id-card"]')?.textContent?.trim()
		).toBe('ID-kaart');
		expect(
			container.querySelector('[data-testid="provider-e-mail"]')?.textContent?.trim()
		).toBe('E-post');
	});

	it('the login page offers Pääsuvõti under et (#855)', () => {
		overwriteGetLocale(() => 'et');
		const { container } = renderAt();
		expect(
			container.querySelector('[data-testid="provider-passkey"]')?.textContent?.trim()
		).toBe('Pääsuvõti');
	});
});

// ── i18n — every sign-in key present, non-empty, in all four locales ─────────────

describe('#218 locale copy — product names', () => {

	// Product names stay untranslated in every locale (Gama ruling).
	const PRODUCT_NAMES = [
		['auth_provider_smart_id', 'Smart-ID'],
		['auth_provider_mobile_id', 'Mobile-ID'],
		['auth_provider_google', 'Google'],
		['auth_provider_apple', 'Apple']
	] as const;

	it.each(LOCALES)('%s keeps the product names as-is', (locale) => {
		for (const [key, name] of PRODUCT_NAMES) {
			expect(msg(locale, key), `messages/${locale}.json: ${key}`).toBe(name);
		}
	});

	it('et localizes ID-card and E-mail per Estonian convention', () => {
		expect(msg('et', 'auth_provider_id_card')).toBe('ID-kaart');
		expect(msg('et', 'auth_provider_e_mail')).toBe('E-post');
	});

	it('the passkey label reads as ruled on #855 in all four locales', () => {
		const ruled = { en: 'Passkey', et: 'Pääsuvõti', lv: 'Piekļuves atslēga', uk: 'Ключ доступу' };
		for (const [locale, label] of Object.entries(ruled)) {
			expect(msg(locale, 'auth_provider_passkey'), `messages/${locale}.json`).toBe(label);
		}
	});
});

// (*MVOX:Tallis*)
