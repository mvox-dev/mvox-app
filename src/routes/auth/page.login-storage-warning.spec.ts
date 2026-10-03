// @vitest-environment happy-dom
// When the browser refuses to store data, the login screen shows one storage warning above
// the provider buttons, which still render.
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';
import { withBlockedStorage, withRefusedWrites } from '$lib/testing/blockedStorage';
import { strategy } from '$lib/paraglide/runtime.js';

vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);

// Mutable $app/state stub — same pattern as login/page.signin-picker.spec.ts.
const pageStub = vi.hoisted(() => ({
	url: new URL('http://localhost/auth/login')
}));
vi.mock('$app/state', () => ({ page: pageStub }));

import Page from './login/+page.svelte';
import { m } from '$lib/paraglide/messages.js';
import { gotoMock } from '$lib/testing/routeMocks';

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
		// Writes refused for the whole render, not a one-shot spy: a refusal that expires
		// after the probe's single setItem proves nothing.
		const { container } = withRefusedWrites(() => renderAt());

		const warning = container.querySelector(WARNING_SELECTOR);
		expect(warning, 'the storage warning must render').not.toBeNull();
		expect(warning?.getAttribute('role')).toBe('alert');
		expect(warning?.textContent?.trim()).toBe(m.login_storage_warning());
		assertAllProvidersRender(container);
	});

	// Blocked site data: reading the localStorage property itself throws. One unguarded read
	// on the render path replaces this screen with SvelteKit's error page.
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
// Paraglide's localStorage strategy would make every m.*() call throw in exactly this browser;
// the strategy list in vite.config.ts keeps it out.

describe('locale resolution never touches localStorage (#442)', () => {
	it("'localStorage' is absent from the paraglide strategy list", () => {
		expect(strategy).not.toContain('localStorage');
	});
});

// ── i18n — login_storage_warning present, non-empty, in all four locales ───────

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

// (*MVOX:Tallis*)
