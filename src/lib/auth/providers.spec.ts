// The canonical provider order and labels, read through the real Paraglide messages (#206, #218).
import { afterEach, describe, expect, it } from 'vitest';
import { m } from '$lib/paraglide/messages.js';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { AUTH_PROVIDERS, providerLabel } from './providers';

describe('AUTH_PROVIDERS — canonical order (#206)', () => {
	it('is exactly smart-id, mobile-id, id-card, e-mail, google, apple, passkey (#855)', () => {
		expect(AUTH_PROVIDERS.map((p) => p.id)).toEqual([
			'smart-id',
			'mobile-id',
			'id-card',
			'e-mail',
			'google',
			'apple',
			'passkey'
		]);
	});
});

describe('AUTH_PROVIDERS — labels are Paraglide message functions (#218)', () => {
	afterEach(() => {
		overwriteGetLocale(() => 'en');
	});

	it('every entry has a callable label returning a non-empty string', () => {
		overwriteGetLocale(() => 'en');
		for (const provider of AUTH_PROVIDERS) {
			expect(typeof provider.label, `${provider.id} label must be a function`).toBe('function');
			const text = provider.label();
			expect(text.trim().length, `${provider.id} label() must be non-empty`).toBeGreaterThan(0);
		}
	});

	it('each label IS its auth_provider_* message function — a static reference, one source', () => {
		const expected = [
			['smart-id', m.auth_provider_smart_id],
			['mobile-id', m.auth_provider_mobile_id],
			['id-card', m.auth_provider_id_card],
			['e-mail', m.auth_provider_e_mail],
			['google', m.auth_provider_google],
			['apple', m.auth_provider_apple]
		] as const;
		for (const [id, fn] of expected) {
			const entry = AUTH_PROVIDERS.find((p) => p.id === id);
			expect(fn, `m.auth_provider_${id.replace(/-/g, '_')} must exist`).toBeTypeOf('function');
			expect(entry?.label, `${id} label must be the message function itself`).toBe(fn);
		}
	});

	it("google reads 'Google' — the 'Continue with Google' framing is retired (Gama ruling)", () => {
		overwriteGetLocale(() => 'en');
		const google = AUTH_PROVIDERS.find((p) => p.id === 'google');
		expect(google?.label()).toBe('Google');
	});

	it('labels localize: et renders ID-kaart / E-post while product names stay untranslated', () => {
		overwriteGetLocale(() => 'et');
		const byId = new Map(AUTH_PROVIDERS.map((p) => [p.id, p]));
		expect(byId.get('id-card')?.label()).toBe('ID-kaart');
		expect(byId.get('e-mail')?.label()).toBe('E-post');
		expect(byId.get('smart-id')?.label()).toBe('Smart-ID');
		expect(byId.get('mobile-id')?.label()).toBe('Mobile-ID');
		expect(byId.get('google')?.label()).toBe('Google');
		expect(byId.get('apple')?.label()).toBe('Apple');
	});
});

describe('providerLabel — the ONE resolution every consumer shares (#218)', () => {
	afterEach(() => {
		overwriteGetLocale(() => 'en');
	});

	it('resolves a known id through its Paraglide message', () => {
		overwriteGetLocale(() => 'en');
		expect(providerLabel('google')).toBe(m.auth_provider_google());
		expect(providerLabel('smart-id')).toBe(m.auth_provider_smart_id());
	});

	it('follows the active locale', () => {
		overwriteGetLocale(() => 'et');
		expect(providerLabel('id-card')).toBe('ID-kaart');
		expect(providerLabel('e-mail')).toBe('E-post');
	});

	// Break: drop auth_provider_passkey or the entry and the fallback reads 'Passkey'.
	it("names a passkey sign-in 'Pääsuvõti' under et, as /profile's sign-in line shows it (#855)", () => {
		overwriteGetLocale(() => 'et');
		expect(providerLabel('passkey')).toBe('Pääsuvõti');
	});

	it('keeps the capitalised-id fallback for unknown ids (the old profile-page contract)', () => {
		expect(providerLabel('github')).toBe('Github');
	});
});

// (*MVOX:Tallis*)
