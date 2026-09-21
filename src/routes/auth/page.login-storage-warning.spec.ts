// @vitest-environment happy-dom
//
// #442 RED — the login screen warns when the browser refuses to store data.
//
// The page runs a proactive storage self-test on mount (canPersistLocally from
// $lib/auth/storage — the REAL module, not mocked) and, when the browser
// refuses to persist, shows ONE notice. CONTRACT (for the GREEN implementer):
//   - one mount-time $state read mirroring the lastProvider pattern
//     (`typeof window !== 'undefined' ? canPersistLocally() : true`);
//   - one INDEPENDENT sibling notice block above the provider list:
//     {#if !canPersist}<p class="text-sm text-red-700" role="alert"
//     data-testid="login-storage-warning">{m.login_storage_warning()}</p>{/if}
//     — separate from the URL {#if error} block, so both can co-exist;
//   - the {#each AUTH_PROVIDERS} render is untouched: the provider buttons
//     render either way;
//   - i18n key `login_storage_warning` in all four locales; et is the issue
//     body's copy VERBATIM; no browser settings named in any locale.
//
// SCOPE IS THE WARNING ONLY — the OAuth state-blob loop under refused storage
// (callback → csrf_mismatch) is a separate, unfiled matter.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';
import { withBlockedStorage, withRefusedWrites } from '$lib/testing/blockedStorage';
import { strategy } from '$lib/paraglide/runtime.js';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// Mutable $app/state stub — same pattern as login/page.signin-picker.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './login/+page.svelte';
import { m } from '$lib/paraglide/messages.js';

const CANONICAL_ORDER = ['smart-id', 'mobile-id', 'id-card', 'e-mail', 'google', 'apple'];
const WARNING_SELECTOR = '[data-testid="login-storage-warning"]';

function renderAt(search = '') {
	pageStub.url = new URL(`http://localhost/auth/login${search}`);
	return render(Page);
}

function assertAllProvidersRender(container: HTMLElement): void {
	for (const id of CANONICAL_ORDER) {
		expect(
			container.querySelector(`[data-testid="provider-${id}"]`),
			`provider CTA ${id} must render`
		).not.toBeNull();
	}
}

afterEach(() => {
	cleanup();
	gotoMock.mockReset();
	vi.restoreAllMocks();
	localStorage.clear();
	sessionStorage.clear();
});

describe('/auth/login — storage-refused warning (#442)', () => {
	it('storage works → no warning renders and every provider CTA renders', () => {
		const { container } = renderAt();

		expect(
			container.querySelector(WARNING_SELECTOR),
			'no warning when storage works'
		).toBeNull();
		assertAllProvidersRender(container);
	});

	it('setItem throws → the warning renders with role=alert and the i18n text; every provider CTA still renders', () => {
		// Writes refused for the WHOLE render (quota exhausted / Safari private),
		// not a one-shot spy: a mount that renders only because the refusal
		// expired after the probe's single setItem proves nothing.
		const { container } = withRefusedWrites(() => renderAt());

		const warning = container.querySelector(WARNING_SELECTOR);
		expect(warning, 'the storage warning must render').not.toBeNull();
		expect(warning?.getAttribute('role')).toBe('alert');
		expect(warning?.textContent?.trim()).toBe(m.login_storage_warning());
		assertAllProvidersRender(container);
	});

	// The headline case the slice was written for: a browser set to block site
	// data outright, where reading the `localStorage` PROPERTY throws before any
	// method call (see $lib/testing/blockedStorage). Nothing on the render path
	// may be left unguarded — the page's own getLastProvider()/probe, and the
	// locale resolution behind every m.*() call. There is no +error.svelte, so a
	// single unguarded read replaces this screen with SvelteKit's error page,
	// i.e. the exact user this notice was written for never sees it.
	it('storage access itself throws (site data blocked) → the warning renders and every provider CTA still renders', () => {
		const { container } = withBlockedStorage(() => renderAt());

		const warning = container.querySelector(WARNING_SELECTOR);
		expect(warning, 'the storage warning must render').not.toBeNull();
		expect(warning?.getAttribute('role')).toBe('alert');
		expect(warning?.textContent?.trim()).toBe(m.login_storage_warning());
		assertAllProvidersRender(container);
	});

	it('the URL error notice and the storage notice co-exist as independent blocks', () => {
		const { container } = withRefusedWrites(() => renderAt('?error=csrf_mismatch'));

		const warning = container.querySelector(WARNING_SELECTOR);
		expect(warning, 'the storage warning must render').not.toBeNull();
		expect(warning?.textContent?.trim()).toBe(m.login_storage_warning());

		const otherAlerts = Array.from(container.querySelectorAll('[role="alert"]')).filter(
			(el) => el !== warning
		);
		expect(otherAlerts, 'the URL error notice renders as its own block').toHaveLength(1);
		expect(otherAlerts[0]?.textContent?.trim()).toBe(m.login_error_csrf_mismatch());

		assertAllProvidersRender(container);
	});
});

// ── the render path must be storage-free all the way down ─────────────────────
// The notice is only reachable if NOTHING on the way to it reads localStorage.
// Paraglide's generated runtime both reads and writes localStorage when that
// strategy is enabled, so every m.*() call threw in exactly the browser this
// screen addresses; the strategy list is where that is fixed (vite.config.ts).

describe('locale resolution never touches localStorage (#442)', () => {
	it("'localStorage' is absent from the paraglide strategy list", () => {
		expect(strategy).not.toContain('localStorage');
	});
});

// ── i18n — login_storage_warning present, non-empty, in ALL FOUR locales ───────
// (pattern: login/page.login-i18n.spec.ts locale-parity block)

describe('locale parity — login_storage_warning present and non-empty in en/et/lv/uk (#442)', () => {
	const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

	function messages(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it.each(LOCALES)('%s carries login_storage_warning, non-empty', (locale) => {
		const file = messages(locale);
		expect(
			isMessageEmpty(file['login_storage_warning']),
			`messages/${locale}.json: login_storage_warning`
		).toBe(false);
	});

	it("et is the issue body's copy VERBATIM", () => {
		expect(messages('et')['login_storage_warning']).toBe(
			'See brauser ei luba mvoxil selles seadmes andmeid salvestada. mvox vajab seda, et korralikult töötada.'
		);
	});
});

// (*MVOX:Tallis* — #442 RED: the login screen warns when the browser refuses to store data)
