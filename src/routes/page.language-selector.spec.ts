// @vitest-environment happy-dom
//
// #123 — RED: language selector on the profile page.
//
// The app ships 4 Paraglide locales (en/et/lv/uk) but language is currently
// browser-detected only (runtime strategy: localStorage → preferredLanguage →
// baseLocale, cookie strategy tree-shaken OUT). This spec defines the contract
// for a user-facing selector:
//
//   Component: src/lib/components/LanguageSelector.svelte
//     - container  [data-testid="language-selector"] (role="group", labelled)
//     - one native <button type="button"> per locale:
//         [data-testid="language-option-<locale>"] showing the locale's
//         NATIVE name (English / Eesti / Latviešu / Українська)
//     - current locale marked with aria-pressed="true"
//     - click → sets the locale via the injectable seam
//       `setLocaleImpl?: (locale) => void` (house style: trailing injectable
//       seam, defaults to the real paraglide `setLocale`)
//
//   Runtime: selection must persist via the PARAGLIDE_LOCALE cookie and the
//   cookie must win over browser detection (preferredLanguage) on next load —
//   i.e. the paraglide strategy list needs 'cookie' BEFORE 'preferredLanguage'
//   (vite.config.ts paraglideVitePlugin strategy — runtime.js is regenerated
//   from it).
//
//   Integration: the selector renders on the actual /profile route — both in
//   the ready state and with no collective selected (language choice is app
//   chrome, like the sign-out link, not gated on membership).
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu.app/' }));

const h = vi.hoisted(() => ({ listMyProfilesMock: vi.fn() }));
// Mock ONLY the network read; keep resolveField/profilesByLevel real.
vi.mock('$lib/profile/profileData', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/profileData')>(
		'$lib/profile/profileData'
	);
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});

import ProfilePage from './profile/+page.svelte';
import Layout from './+layout.svelte';
// Does not exist yet — the whole file is RED with "Failed to resolve import"
// until GREEN creates src/lib/components/LanguageSelector.svelte.
import LanguageSelector from '$lib/components/LanguageSelector.svelte';
import { cookieName, getLocale, setLocale, strategy } from '$lib/paraglide/runtime.js';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
type AppLocale = (typeof LOCALES)[number];

const NATIVE_NAMES: Record<AppLocale, string> = {
	en: 'English',
	et: 'Eesti',
	lv: 'Latviešu',
	uk: 'Українська'
};

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const option = (c: HTMLElement, locale: string) =>
	q(c, `[data-testid="language-option-${locale}"]`);

function renderSelector(props: Record<string, unknown> = {}) {
	return render(LanguageSelector, { props });
}

function clearLocaleCookie() {
	document.cookie = `${cookieName}=; path=/; max-age=0`;
}

/**
 * Replace window.location.reload with a spy; returns a restore fn. The picker
 * uses paraglide's default `reload: true`, so any test exercising the real
 * seam would otherwise depend on happy-dom's navigation stub.
 */
function spyOnReload() {
	const reload = vi.fn();
	const original = Object.getOwnPropertyDescriptor(window.location, 'reload');
	Object.defineProperty(window.location, 'reload', { value: reload, configurable: true });
	return {
		reload,
		restore: () => {
			if (original) Object.defineProperty(window.location, 'reload', original);
			else Reflect.deleteProperty(window.location, 'reload');
		}
	};
}

function setNavigatorLanguages(langs: string[]) {
	Object.defineProperty(window.navigator, 'languages', {
		value: langs,
		configurable: true
	});
}

function selectPolyphony() {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	localStorage.clear();
	clearLocaleCookie();
	// Deterministic browser detection: happy-dom's default may vary.
	setNavigatorLanguages(['en']);
	h.listMyProfilesMock.mockReset();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	clearLocaleCookie();
	Reflect.deleteProperty(window.navigator, 'languages');
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('LanguageSelector — options (#123)', () => {
	it('renders a selector with all four locale options', async () => {
		const { container } = await renderSelector();
		const selector = q(container, '[data-testid="language-selector"]');
		expect(selector).not.toBeNull();
		for (const locale of LOCALES) {
			expect(option(container, locale), `missing option for ${locale}`).not.toBeNull();
		}
	});

	it('shows each locale under its NATIVE name', async () => {
		const { container } = await renderSelector();
		for (const locale of LOCALES) {
			expect(option(container, locale)?.textContent?.trim()).toBe(NATIVE_NAMES[locale]);
		}
	});

	it('exposes a group role with an accessible name', async () => {
		const { container } = await renderSelector();
		const selector = q(container, '[data-testid="language-selector"]');
		expect(selector?.getAttribute('role')).toBe('group');
		// Label content is Comenius territory — only require that one exists.
		const label =
			selector?.getAttribute('aria-label') ?? selector?.getAttribute('aria-labelledby');
		expect(label, 'selector group needs aria-label or aria-labelledby').toBeTruthy();
	});

	it('marks the current locale as selected via aria-pressed', async () => {
		// Clean state + navigator=['en'] → current locale is 'en'.
		const { container } = await renderSelector();
		expect(option(container, 'en')?.getAttribute('aria-pressed')).toBe('true');
		for (const locale of ['et', 'lv', 'uk']) {
			expect(option(container, locale)?.getAttribute('aria-pressed')).toBe('false');
		}
	});
});

describe('LanguageSelector — selection (#123)', () => {
	it('clicking a locale option invokes the locale-setting seam with that locale', async () => {
		const setLocaleImpl = vi.fn();
		const { container } = await renderSelector({ setLocaleImpl });
		await fireEvent.click(option(container, 'et')!);
		expect(setLocaleImpl).toHaveBeenCalledTimes(1);
		expect(setLocaleImpl.mock.calls[0][0]).toBe('et');
	});

	it('selecting a locale changes the app language (default seam → paraglide)', async () => {
		const { restore } = spyOnReload();
		try {
			const { container } = await renderSelector();
			await fireEvent.click(option(container, 'et')!);
			expect(getLocale()).toBe('et');
		} finally {
			restore();
		}
	});
});

describe('locale persistence — cookie (#123)', () => {
	// RED driver: 'cookie' is currently tree-shaken out of the generated
	// runtime (strategy is localStorage → preferredLanguage → baseLocale), so
	// setLocale never writes the cookie and getLocale never reads it. GREEN
	// adds 'cookie' to the paraglideVitePlugin strategy in vite.config.ts.

	it('setLocale persists the selected locale in the PARAGLIDE_LOCALE cookie', () => {
		setLocale('lv', { reload: false });
		expect(document.cookie).toContain(`${cookieName}=lv`);
	});

	it('a locale picked in the selector persists via the cookie', async () => {
		const { restore } = spyOnReload();
		try {
			const { container } = await renderSelector();
			await fireEvent.click(option(container, 'uk')!);
			expect(document.cookie).toContain(`${cookieName}=uk`);
		} finally {
			restore();
		}
	});

	it('the persisted cookie locale beats browser detection on next load', () => {
		// Simulate a fresh load: no localStorage (cleared in beforeEach), a
		// previously persisted cookie, and a browser reporting Estonian.
		document.cookie = `${cookieName}=uk; path=/`;
		setNavigatorLanguages(['et-EE', 'et']);
		expect(getLocale()).toBe('uk');
	});

	it("runtime strategy resolves 'cookie' before 'preferredLanguage'", () => {
		const cookieIdx = strategy.indexOf('cookie');
		const preferredIdx = strategy.indexOf('preferredLanguage');
		expect(cookieIdx, "'cookie' missing from paraglide strategy").toBeGreaterThanOrEqual(0);
		expect(preferredIdx).toBeGreaterThanOrEqual(0);
		expect(cookieIdx).toBeLessThan(preferredIdx);
	});
});

describe('locale switch takes effect — rendered UI (#123)', () => {
	// The state assertions above (seam called, getLocale() === 'et', cookie
	// written) all pass even when the app visibly stays in the old language:
	// Paraglide messages read plain module state (`_locale` in runtime.js), so
	// `{m.foo()}` in a Svelte template has no reactive dependency and never
	// re-evaluates. The observable contract for a reloading picker is therefore
	// (a) the document reload is requested and (b) the reloaded document renders
	// the newly selected language. Both are asserted here on the real /profile
	// page with unmocked messages.

	it('selecting a locale re-renders the profile page in that language', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { reload, restore } = spyOnReload();
		try {
			const first = render(ProfilePage);
			await waitFor(() =>
				expect(q(first.container, '[data-testid="profile-name"]')).not.toBeNull()
			);
			expect(first.container.textContent).toContain('Language');

			await fireEvent.click(option(first.container, 'et')!);

			// The picker must ask the document to reload — without it the already
			// rendered English strings stay on screen.
			expect(reload, 'selecting a locale must request a document reload').toHaveBeenCalled();

			// Simulate that reload: a fresh document render must come up Estonian.
			cleanup();
			const second = render(ProfilePage);
			await waitFor(() =>
				expect(q(second.container, '[data-testid="profile-name"]')).not.toBeNull()
			);
			expect(second.container.textContent).toContain('Keel');
			expect(second.container.textContent).not.toContain('Language');
		} finally {
			restore();
		}
	});
});

describe('document language attribute (#123 review F1)', () => {
	// app.html hardcodes `<html lang="en">` and this is a pure client-side SPA
	// (no hooks, no +layout.server), so nothing declared the resolved locale to
	// assistive tech: a fully Estonian page still announced itself as English.
	// The root layout now syncs `document.documentElement.lang` to getLocale().
	beforeEach(() => {
		document.documentElement.lang = 'en';
	});

	it('sets <html lang> to the persisted cookie locale on a fresh load', async () => {
		document.cookie = `${cookieName}=et; path=/`;
		render(Layout);
		await waitFor(() => expect(document.documentElement.lang).toBe('et'));
	});

	it('sets <html lang> to the browser-detected locale when nothing is persisted', async () => {
		setNavigatorLanguages(['uk-UA', 'uk']);
		render(Layout);
		await waitFor(() => expect(document.documentElement.lang).toBe('uk'));
	});
});

describe('LanguageSelector — touch target (#123 review F2)', () => {
	// House rule (#132/T6 review F2): every interactive control reserves a
	// 44px-tall hit area. The locale buttons were px-2 py-1 text-sm (~28px) —
	// the smallest tappable target on the profile page.
	it('every locale option reserves a 44px-tall touch target (min-h-11)', async () => {
		const { container } = await renderSelector();
		for (const locale of LOCALES) {
			const classes = Array.from((option(container, locale) as HTMLElement).classList);
			expect(classes, `${locale} option must reserve a 44px-tall touch target`).toContain(
				'min-h-11'
			);
			expect(classes, `${locale} option must centre its label in that hit area`).toContain(
				'items-center'
			);
		}
	});
});

describe('LanguageSelector — keyboard accessibility (#123)', () => {
	// Native <button> elements give Tab focus + Enter/Space activation for
	// free (happy-dom cannot synthesize key→click, so the contract is pinned
	// structurally: real buttons, in the tab order, programmatically focusable).
	it('locale options are native buttons in the tab order', async () => {
		const { container } = await renderSelector();
		for (const locale of LOCALES) {
			const el = option(container, locale);
			expect(el, `missing option for ${locale}`).not.toBeNull();
			expect(el!.tagName, `${locale} option must be a native <button>`).toBe('BUTTON');
			expect((el as HTMLButtonElement).type).toBe('button');
			expect(el!.getAttribute('tabindex')).not.toBe('-1');
		}
	});

	it('locale options are focusable (tab target)', async () => {
		const { container } = await renderSelector();
		const et = option(container, 'et') as HTMLButtonElement;
		et.focus();
		expect(document.activeElement).toBe(et);
	});
});

describe('integration — /profile route (#123)', () => {
	it('renders the language selector on the actual profile page (ready state)', async () => {
		selectPolyphony();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(ProfilePage);
		// Wait until the page has fully loaded (profile fields present) so the
		// selector is asserted on the real ready-state page, not a flash frame.
		await waitFor(() => expect(q(container, '[data-testid="profile-name"]')).not.toBeNull());
		expect(q(container, '[data-testid="language-selector"]')).not.toBeNull();
		for (const locale of LOCALES) {
			expect(option(container, locale), `missing option for ${locale}`).not.toBeNull();
		}
	});

	it('renders the language selector even with no collective selected', async () => {
		// Language choice is app chrome (like sign-out) — it must not be gated
		// on collective membership.
		collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
		urlCollectiveDbStore.set(null);
		selectedCollectiveDbStore.set(null);
		const { container } = render(ProfilePage);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-no-collective"]')).not.toBeNull()
		);
		expect(q(container, '[data-testid="language-selector"]')).not.toBeNull();
	});
});
