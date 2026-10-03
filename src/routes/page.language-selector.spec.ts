// @vitest-environment happy-dom
import { cleanup, createEvent, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule({ afterNavigate: vi.fn() })
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

const h = vi.hoisted(() => ({ listMyProfilesMock: vi.fn() }));
vi.mock('$lib/profile/profileData', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/profileData')>(
		'$lib/profile/profileData'
	);
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});

import ProfilePage from './profile/+page.svelte';
import Layout from './+layout.svelte';
import LanguageSelector from '$lib/components/LanguageSelector.svelte';
import { cookieName, getLocale, setLocale, strategy } from '$lib/paraglide/runtime.js';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

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

function selectSampledb() {
	signIn({ token: 'jwt-member' });
}

beforeEach(() => {
	localStorage.clear();
	clearLocaleCookie();
	setNavigatorLanguages(['en']);
	h.listMyProfilesMock.mockReset();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	clearLocaleCookie();
	Reflect.deleteProperty(window.navigator, 'languages');
	resetAppState();
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

	it('exposes a toolbar role with an accessible name', async () => {
		const { container } = await renderSelector();
		const selector = q(container, '[data-testid="language-selector"]');
		expect(selector?.getAttribute('role')).toBe('toolbar');
		const label =
			selector?.getAttribute('aria-label') ?? selector?.getAttribute('aria-labelledby');
		expect(label, 'selector toolbar needs aria-label or aria-labelledby').toBeTruthy();
	});

	it('marks the current locale as selected via aria-pressed', async () => {
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

	it('selecting a locale re-renders the profile page in that language', async () => {
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { reload, restore } = spyOnReload();
		try {
			const first = render(ProfilePage);
			await waitFor(() =>
				expect(q(first.container, '[data-testid="profile-field-name"]')).not.toBeNull()
			);
			expect(first.container.textContent).toContain('Language');

			await fireEvent.click(option(first.container, 'et')!);

			expect(reload, 'selecting a locale must request a document reload').toHaveBeenCalled();

			cleanup();
			const second = render(ProfilePage);
			await waitFor(() =>
				expect(q(second.container, '[data-testid="profile-field-name"]')).not.toBeNull()
			);
			expect(second.container.textContent).toContain('Keel');
			expect(second.container.textContent).not.toContain('Language');
		} finally {
			restore();
		}
	});
});

describe('document language attribute (#123 review F1)', () => {
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
	it('locale options are native buttons, and the group holds exactly one Tab stop (roving tabindex, #156)', async () => {
		const { container } = await renderSelector();
		let zeroStops = 0;
		for (const locale of LOCALES) {
			const el = option(container, locale);
			expect(el, `missing option for ${locale}`).not.toBeNull();
			expect(el!.tagName, `${locale} option must be a native <button>`).toBe('BUTTON');
			expect((el as HTMLButtonElement).type).toBe('button');
			if (el!.getAttribute('tabindex') === '0') zeroStops++;
		}
		expect(zeroStops).toBe(1);
	});

	it('locale options are focusable (tab target)', async () => {
		const { container } = await renderSelector();
		const et = option(container, 'et') as HTMLButtonElement;
		et.focus();
		expect(document.activeElement).toBe(et);
	});

	it('ArrowRight moves focus forward and WRAPS; ArrowLeft wraps backwards', async () => {
		const { container } = await renderSelector();
		const opts = LOCALES.map((l) => option(container, l) as HTMLButtonElement);
		expect(opts).toHaveLength(4);

		opts[0].focus();
		await fireEvent.keyDown(opts[0], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(opts[1]);

		await fireEvent.keyDown(opts[3], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(opts[0]);

		await fireEvent.keyDown(opts[0], { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(opts[3]);
	});

	it('arrows NEVER activate — the setLocale seam is untouched by arrow navigation', async () => {
		const setLocaleImpl = vi.fn();
		const { container } = await renderSelector({ setLocaleImpl });
		const opts = LOCALES.map((l) => option(container, l) as HTMLButtonElement);
		opts[0].focus();
		await fireEvent.keyDown(opts[0], { key: 'ArrowRight' });
		await fireEvent.keyDown(opts[1], { key: 'ArrowRight' });
		expect(setLocaleImpl).not.toHaveBeenCalled();
	});

	it('the Tab stop TRAVELS with focus — after arrowing, the focused option is the only "0"', async () => {
		const { container } = await renderSelector();
		const opts = LOCALES.map((l) => option(container, l) as HTMLButtonElement);
		opts[0].focus();
		await fireEvent.keyDown(opts[0], { key: 'ArrowRight' });
		const stops = opts.filter((o) => o.getAttribute('tabindex') === '0');
		expect(stops).toHaveLength(1);
		expect(stops[0]).toBe(opts[1]);
	});

	it('Tab, Enter and Space are NOT preventDefault-ed — focus leaves the group and the option still activates', async () => {
		const { container } = await renderSelector();
		const el = option(container, 'en') as HTMLButtonElement;
		for (const key of ['Tab', 'Enter', ' ']) {
			const event = createEvent.keyDown(el, { key });
			fireEvent(el, event);
			expect(event.defaultPrevented, `${key} must not be swallowed`).toBe(false);
		}
	});
});

describe('integration — /profile route (#123)', () => {
	it('renders the language selector on the actual profile page (ready state)', async () => {
		selectSampledb();
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(ProfilePage);
		await waitFor(() => expect(q(container, '[data-testid="profile-field-name"]')).not.toBeNull());
		expect(q(container, '[data-testid="language-selector"]')).not.toBeNull();
		for (const locale of LOCALES) {
			expect(option(container, locale), `missing option for ${locale}`).not.toBeNull();
		}
	});

	it('renders the language selector even with no collective selected', async () => {
		signIn({ collectives: [] });
		const { container } = render(ProfilePage);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-no-collective"]')).not.toBeNull()
		);
		expect(q(container, '[data-testid="language-selector"]')).not.toBeNull();
	});
});
