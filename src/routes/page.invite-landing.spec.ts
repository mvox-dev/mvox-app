// @vitest-environment happy-dom
// The unauthed invite landing: a valid token shows one CTA per provider, an invalid one none;
// a client-side expiry warns but keeps the CTAs, since the server is the authority.
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PROVIDERS } from '$lib/auth/providers';
import { OAUTH_STATE_KEY } from '$lib/auth/state';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).englishMessages({
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
		invite_retry: () => 'Try again',
		// AUTH_PROVIDERS binds its labels at module load, so a missing key here
		// makes every provider CTA throw. Bare nouns: 'Google', not 'Continue with'.
		auth_provider_smart_id: () => 'Smart-ID',
		auth_provider_mobile_id: () => 'Mobile-ID',
		auth_provider_id_card: () => 'ID-card',
		auth_provider_e_mail: () => 'E-mail',
		auth_provider_google: () => 'Google',
		auth_provider_apple: () => 'Apple',
		auth_provider_passkey: () => 'Passkey'
	})
);

// Mutable $app/state stub — each test points `page` at its own params/url.
const pageStub = vi.hoisted(() => ({
	params: {} as Record<string, string>,
	url: new URL('http://localhost/invite/x')
}));
vi.mock('$app/state', () => ({ page: pageStub }));
// Sever the $env chain preemptively (harmless if the page never imports it).
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import Page from './invite/[token]/+page.svelte';
import { jwt } from '$lib/testing/pages/admin';

const TOKEN = jwt({ db: 'sampledb', entityId: 'p1', iat: 1, exp: 4_102_444_800 }); // year 2100
const EXPIRED_TOKEN = jwt({ db: 'sampledb', entityId: 'p1', iat: 1, exp: 1_000 }); // 1970

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
		expect(container.textContent).toContain('sampledb');

		for (const provider of AUTH_PROVIDERS) {
			const cta = container.querySelector(`[data-testid="invite-cta-${provider.id}"]`);
			expect(cta, `CTA for ${provider.id}`).not.toBeNull();
			expect(cta!.getAttribute('href')).toBe(
				`/auth/${provider.id}?intent=invite&invite=${encodeURIComponent(TOKEN)}&return_to=${encodeURIComponent(`/invite/${TOKEN}`)}`
			);
		}
	});

	// On this public page the expiry renders as the ISO date YYYY-MM-DD, never a
	// browser-locale date; the mock echoes its `date` param, pinning the real string.
	it('#207 rule 7: the expiry date renders as ISO YYYY-MM-DD', () => {
		const { container } = renderAt(TOKEN);
		// The oracle mirrors the required production mechanism (en-CA Intl → ISO)
		// over the token's exp instant in the runner's local zone.
		const isoExpiry = new Intl.DateTimeFormat('en-CA', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date(4_102_444_800_000));
		expect(isoExpiry).toMatch(/^\d{4}-\d{2}-\d{2}$/); // oracle self-check
		expect(container.textContent).toContain(`Valid until ${isoExpiry}.`);
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

// ── #218 — provider CTA labels come from Paraglide, bare nouns ─────────────────

describe('/invite/[token] — provider CTA labels come from Paraglide (#218)', () => {
	it("renders one CTA per provider, passkey included (#855) — google reads 'Google'", () => {
		const { container } = renderAt(TOKEN);
		const EXPECTED: Record<string, string> = {
			'smart-id': 'Smart-ID',
			'mobile-id': 'Mobile-ID',
			'id-card': 'ID-card',
			'e-mail': 'E-mail',
			google: 'Google',
			apple: 'Apple',
			passkey: 'Passkey'
		};
		const ctas = Array.from(container.querySelectorAll('[data-testid^="invite-cta-"]'));
		const shown = ctas.map((cta) => [
			(cta.getAttribute('data-testid') ?? '').replace(/^invite-cta-/, ''),
			cta.textContent?.trim()
		]);
		expect(Object.fromEntries(shown)).toEqual(EXPECTED);
		expect(shown).toHaveLength(Object.keys(EXPECTED).length);
		expect(container.textContent).not.toContain('Continue with');
	});
});

describe('/invite/[token] — stale OAuth-state hygiene', () => {
	it('clears an abandoned OAuth-state blob (which, for invite intent, carries the bearer invite token) on render — an abandoned provider round-trip must not leave the token in localStorage indefinitely', () => {
		localStorage.setItem(OAUTH_STATE_KEY, 'stale-blob-carrying-a-bearer-token');
		renderAt(TOKEN);
		expect(localStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
	});
});
