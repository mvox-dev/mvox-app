// @vitest-environment happy-dom
//
// T4.5/#31 — the unauthed invite landing at /invite/[token]. Contract:
// - valid token   → landing with db + expiry + one CTA per provider
// - invalid token → error, NO CTA
// - client-expired→ warning but CTAs KEPT (the server is the authority; a fast
//                   client clock must not brick a valid invite)
// - ?outcome=dead|conflict|unexpected|error → the callback's post-exchange states
// Bearer-secret hygiene is asserted at the admin page + storage level; this page
// only ever moves the token into hrefs built by buildInviteProviderHref.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PROVIDERS } from '$lib/auth/providers';
import { OAUTH_STATE_KEY } from '$lib/auth/state';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		invite_landing_title: () => "You're invited",
		invite_landing_intro: (p: { db: string }) => `You have been invited to join ${p.db} on mvox.`,
		invite_landing_expires: (p: { date: string }) => `Valid until ${p.date}.`,
		invite_landing_choose_provider: () => 'Sign in to accept the invitation:',
		invite_landing_expired_warning: (p: { date: string }) =>
			`This invite appears to have expired on ${p.date}. You can still try.`,
		invite_error_invalid: () => 'This invite link is not valid.',
		invite_error_dead: () => 'This invite could not be redeemed.',
		invite_error_conflict: () => 'Your sign-in is already linked to a different account.',
		invite_error_conflict_continue: () => 'Continue to mvox',
		invite_error_unexpected: () => 'Something inconsistent happened.',
		invite_error_failed: () => 'Redeeming the invite failed.',
		invite_retry: () => 'Try again'
	}
}));

// Mutable $app/state stub — each test points `page` at its own params/url.
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/invite/x')
}));
vi.mock('$app/state', () => ({ page: pageStub }));
// Sever the $env chain preemptively (harmless if the page never imports it).
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import Page from './invite/[token]/+page.svelte';

function jwt(payload: object): string {
	const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

const TOKEN = jwt({ db: 'polyphony', entityId: 'p1', iat: 1, exp: 4_102_444_800 }); // year 2100
const EXPIRED_TOKEN = jwt({ db: 'polyphony', entityId: 'p1', iat: 1, exp: 1_000 }); // 1970

function renderAt(token: string, search = '') {
	pageStub.params = { token };
	pageStub.url = new URL(`http://localhost/invite/${token}${search}`);
	return render(Page);
}

afterEach(() => {
	cleanup();
});

describe('/invite/[token] — ready (valid token)', () => {
	it('shows the landing with the db from the token and one CTA per provider, hrefs exact', () => {
		const { container } = renderAt(TOKEN);
		expect(container.querySelector('[data-testid="invite-landing-valid"]')).not.toBeNull();
		expect(container.textContent).toContain('polyphony');

		for (const provider of AUTH_PROVIDERS) {
			const cta = container.querySelector(`[data-testid="invite-cta-${provider.id}"]`);
			expect(cta, `CTA for ${provider.id}`).not.toBeNull();
			expect(cta!.getAttribute('href')).toBe(
				`/auth/${provider.id}?intent=invite&invite=${encodeURIComponent(TOKEN)}&return_to=${encodeURIComponent(`/invite/${TOKEN}`)}`
			);
		}
	});
});

describe('/invite/[token] — invalid token', () => {
	it('shows the invalid state with NO provider CTA', () => {
		const { container } = renderAt('garbage-not-a-jwt');
		expect(container.querySelector('[data-testid="invite-landing-invalid"]')).not.toBeNull();
		expect(container.querySelector('[data-testid^="invite-cta-"]')).toBeNull();
	});
});

describe('/invite/[token] — client-clock expired', () => {
	it('shows the expired warning but KEEPS the CTAs (server is the authority; truly dead invites land on outcome=dead)', () => {
		const { container } = renderAt(EXPIRED_TOKEN);
		expect(container.querySelector('[data-testid="invite-landing-expired"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="invite-cta-google"]')).not.toBeNull();
	});
});

describe('/invite/[token] — callback outcomes (take precedence over fresh parsing)', () => {
	it('outcome=dead: honest expired-or-used copy, no CTA (the user is NOT signed in)', () => {
		const { container } = renderAt(TOKEN, '?outcome=dead');
		expect(container.querySelector('[data-testid="invite-landing-dead"]')).not.toBeNull();
		expect(container.querySelector('[data-testid^="invite-cta-"]')).toBeNull();
	});

	it('outcome=conflict: explains the existing-account bind and links home (signed in as the existing person)', () => {
		const { container } = renderAt(TOKEN, '?outcome=conflict');
		const block = container.querySelector('[data-testid="invite-landing-conflict"]');
		expect(block).not.toBeNull();
		expect(block!.querySelector('a[href="/"]')).not.toBeNull();
	});

	it('outcome=unexpected: the AC1 tripwire state is surfaced, never absorbed — and offers NO CTA (a re-redemption of a consumed token is a guaranteed dead end)', () => {
		const { container } = renderAt(TOKEN, '?outcome=unexpected');
		expect(container.querySelector('[data-testid="invite-landing-unexpected"]')).not.toBeNull();
		expect(container.querySelector('[data-testid^="invite-cta-"]')).toBeNull();
	});

	it('outcome=error: failed exchange offers a real retry (a fresh CTA click mints a fresh single-use session key)', () => {
		const { container } = renderAt(TOKEN, '?outcome=error');
		expect(container.querySelector('[data-testid="invite-landing-error"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="invite-retry"]')).not.toBeNull();
	});
});

describe('/invite/[token] — stale OAuth-state hygiene', () => {
	it('clears an abandoned OAuth-state blob (which, for invite intent, carries the bearer invite token) on render — an abandoned provider round-trip must not leave the token in localStorage indefinitely', () => {
		localStorage.setItem(OAUTH_STATE_KEY, 'stale-blob-carrying-a-bearer-token');
		renderAt(TOKEN);
		expect(localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
	});
});
