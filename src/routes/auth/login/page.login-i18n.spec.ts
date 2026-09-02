// @vitest-environment happy-dom
//
// #218 RED — every visible string on the sign-in surface resolves through
// Paraglide, in ALL FOUR locales (en/et/lv/uk).
//
// Today the page hardcodes English for the heading, three of the four error
// branches (csrf_mismatch, missing_session_token, and the generic fallback —
// only session_expired already rides m.session_expired_message, #107 F4), and
// the '· last used' marker; the google CTA still reads 'Continue with Google'.
//
// CONTRACT (for the GREEN implementer):
//   - keys login_heading, login_error_csrf_mismatch,
//     login_error_missing_session_token, login_error_generic, login_last_used
//     in all four locale files; ENGLISH VALUES VERBATIM-EQUAL to today's
//     hardcoded strings so page.signin-picker.spec.ts (regex /·\s*last used/i)
//     and page.session-expired.spec.ts (negative match on 'something went
//     wrong') stay green;
//   - login_last_used is the WHOLE marker including the '·' separator; the
//     &nbsp; before it stays in the markup;
//   - Gama ruling (issue #218, 2026-09-02): the heading KEEPS the product name
//     in every locale (en 'Sign in to mvox', et 'Logi mvoxi sisse'; lv/uk
//     natural with 'mvox' kept) — after #206 this is the single signed-out
//     surface and carries no wordmark;
//   - provider CTAs render {provider.label()} from AUTH_PROVIDERS whose labels
//     are the auth_provider_* message functions (see
//     src/lib/auth/providers.spec.ts) — google reads 'Google', bare noun, on
//     this page too.
//
// This is an integration spec on the REAL route component with the REAL
// paraglide surface — the four locale files are the source of truth, so the
// per-locale assertions read messages/<locale>.json and require the rendered
// text to BE that value (and not the English one — a copied-over English value
// is not a translation).
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// Mutable $app/state stub — same pattern as page.session-expired.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './+page.svelte';
import { setLastProvider } from '$lib/auth/storage';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
const OTHER_LOCALES = ['et', 'lv', 'uk'] as const;

function messages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

// The message-file value as a plain string. None of the #218 keys is a variant
// message; failing on the type here keeps a missing key loud and readable.
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
});

// ── i18n — every #218 key present, non-empty, in ALL FOUR locales ───────────────
// (pattern: page.profile-linked-accounts.spec.ts locale-parity block)

describe('locale parity — every #218 key present and non-empty in en/et/lv/uk', () => {
	const KEYS = [
		'login_heading',
		'login_error_csrf_mismatch',
		'login_error_missing_session_token',
		'login_error_generic',
		'login_last_used',
		'auth_provider_smart_id',
		'auth_provider_mobile_id',
		'auth_provider_id_card',
		'auth_provider_e_mail',
		'auth_provider_google',
		'auth_provider_apple'
	] as const;

	it.each(LOCALES)('%s carries every key, none empty', (locale) => {
		const file = messages(locale);
		for (const key of KEYS) {
			expect(isMessageEmpty(file[key]), `messages/${locale}.json: ${key}`).toBe(false);
		}
	});

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
});

// (*MVOX:Tallis* — #218 RED: the sign-in surface reads the locale files, all four)
