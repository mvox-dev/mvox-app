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
import { describe, expect, it } from 'vitest';
import { AUTH_PROVIDERS } from './providers';

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

// (*MVOX:Tallis*)
