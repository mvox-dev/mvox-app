// #206 RED — canonical sign-in provider order.
//
// The picker leads with the Estonian national auth methods (Smart-ID first),
// then e-mail, then the big-tech providers. This list is the single source of
// truth for THREE consumers, so the order is pinned here as a full-shape
// assertion (toEqual, not objectContaining — partial assertions hide bugs):
//   1. the login page          — src/routes/auth/login/+page.svelte
//   2. the invite landing      — src/routes/invite/[token]/+page.svelte
//   3. the #193 profile link-picker — src/routes/profile/+page.svelte
//
// Consumer 3 reorders too: Google moves from first to fifth in the "Link another
// account" picker. That is an intended side effect of #206 — one canonical order
// everywhere the user picks a provider — not an oversight.
//
// Coupled assertion to re-arm on any future reorder:
// src/routes/page.profile-linked-accounts.spec.ts (#193 review F3) asserts that
// opening the profile picker skips PAST the leading provider to the first one the
// user can actually pick. That test only has teeth while its fixture binds — and
// therefore DISABLES — whichever provider leads this list: with an enabled leader
// it passes whether or not the implementation filters on `:not([disabled])`.
// So a reorder does not merely mean "update that test", it means point its
// fixture at the NEW leader and re-check that dropping the `:not([disabled])`
// selector in src/routes/profile/+page.svelte turns it RED again.
import { afterEach, describe, expect, it } from 'vitest';
// #218 — the REAL paraglide surface, deliberately NOT mocked: the provider
// labels' single source of truth is the four locale files, and this spec pins
// that each AUTH_PROVIDERS entry binds the actual message function.
import { m } from '$lib/paraglide/messages.js';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';
import { AUTH_PROVIDERS, providerLabel } from './providers';

describe('AUTH_PROVIDERS — canonical order (#206)', () => {
	it('is exactly smart-id, mobile-id, id-card, e-mail, google, apple', () => {
		expect(AUTH_PROVIDERS.map((p) => p.id)).toEqual([
			'smart-id',
			'mobile-id',
			'id-card',
			'e-mail',
			'google',
			'apple'
		]);
	});
});

// ── #218 — provider labels resolve through Paraglide ────────────────────────────
//
// CONTRACT (for the GREEN implementer):
//   - src/lib/auth/providers.ts imports { m } from '$lib/paraglide/messages.js'
//     and each entry's `label` IS the message function itself — a STATIC member
//     reference (m.auth_provider_<id with underscores>), never a computed key
//     access. Keys: auth_provider_smart_id, auth_provider_mobile_id,
//     auth_provider_id_card, auth_provider_e_mail, auth_provider_google,
//     auth_provider_apple. Consumers render {provider.label()}.
//   - Gama copy ruling (issue #218, 2026-09-02): six bare-noun keys. Google
//     reads 'Google' EVERYWHERE — the 'Continue with Google' framing goes.
//     Product names stay untranslated in all locales (Smart-ID, Mobile-ID,
//     Google, Apple); ID-card and E-mail localize per locale convention
//     (et: 'ID-kaart' / 'E-post').
//   - providerLabel(id) is exported HERE as the one resolution every consumer
//     shares; unknown ids keep the capitalised-id fallback the profile page
//     used to implement locally (its PROVIDER_LABELS map is deleted — see
//     src/routes/page.profile-linked-accounts.spec.ts for that pin).

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

	it('keeps the capitalised-id fallback for unknown ids (the old profile-page contract)', () => {
		expect(providerLabel('github')).toBe('Github');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Tallis* — #218 RED: labels through Paraglide, providerLabel single source)
