// @vitest-environment happy-dom
//
// #408 RED — the "Install as app" button on /profile (Profiililt saab mvoxi
// seadmesse rakendusena paigaldada). INTEGRATION: the ACTUAL profile route
// renders (house rule — only the network read seams are substituted), so
// GREEN cannot satisfy this by wiring the affordance module in isolation.
//
// CONTRACT (GREEN must implement in src/routes/profile/+page.svelte, wired
// to $lib/install/installState — see installState.spec.ts for the module):
//   - the control sits with the account-level block (sign-out / language /
//     time-format) and, like those, is app chrome: NOT gated on collective
//     selection.
//   - 'prompt' state: ONE native classed
//     <button type="button" data-testid="profile-install-button"> labelled
//     from profile_install_button; pressing it calls the stashed
//     beforeinstallprompt event's prompt().
//   - 'ios-hint' state: the SAME button; pressing it reveals ONE hint line
//     [data-testid="profile-install-ios-hint"] with profile_install_ios_hint
//     (the Share-menu instruction) — a native button + a plain text line,
//     no dialog widget. The hint is NOT in the DOM before the press.
//   - 'none' state: NOTHING renders — no disabled button, no explanation;
//     no [data-testid^="profile-install-"] node exists at all.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));

vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const h = vi.hoisted(() => ({ listMyProfilesMock: vi.fn() }));
// Mock ONLY the network read; keep the pure helpers real.
vi.mock('$lib/profile/profileData', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/profileData')>(
		'$lib/profile/profileData'
	);
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});

import ProfilePage from './profile/+page.svelte';
import { clearAll, setToken } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const installButton = (c: HTMLElement) =>
	q(c, '[data-testid="profile-install-button"]') as HTMLButtonElement | null;
const iosHint = (c: HTMLElement) => q(c, '[data-testid="profile-install-ios-hint"]');

// ── environment stubs (mirrors installState.spec.ts) ────────────────────────

const CHROME_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const IPHONE_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function stubNavigator(input: { userAgent: string; platform: string; maxTouchPoints: number }) {
	for (const [key, value] of Object.entries(input)) {
		Object.defineProperty(window.navigator, key, { value, configurable: true });
	}
	Object.defineProperty(window.navigator, 'standalone', {
		value: undefined,
		configurable: true
	});
}

function stubDisplayModeStandalone(matches: boolean): void {
	vi.spyOn(window, 'matchMedia').mockImplementation(
		(query: string) =>
			({
				matches: query === '(display-mode: standalone)' ? matches : false,
				media: query,
				onchange: null,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
				dispatchEvent: () => false
			}) as unknown as MediaQueryList
	);
}

type BipEvent = Event & {
	prompt: ReturnType<typeof vi.fn>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function makeBeforeInstallPrompt(): BipEvent {
	const evt = new Event('beforeinstallprompt', { cancelable: true }) as BipEvent;
	evt.prompt = vi.fn().mockResolvedValue(undefined);
	evt.userChoice = Promise.resolve({ outcome: 'dismissed' });
	return evt;
}

function selectSampledb() {
	setToken('jwt-member');
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('sampledb');
}

async function renderProfileReady(): Promise<HTMLElement> {
	selectSampledb();
	h.listMyProfilesMock.mockResolvedValue([]);
	const { container } = render(ProfilePage);
	// page-ready marker: the time-format control is unconditional app chrome
	await waitFor(() =>
		expect(q(container, '[data-testid="profile-time-format"]')).not.toBeNull()
	);
	return container;
}

beforeEach(() => {
	localStorage.clear();
	h.listMyProfilesMock.mockReset();
	stubNavigator({ userAgent: CHROME_UA, platform: 'Win32', maxTouchPoints: 0 });
	stubDisplayModeStandalone(false);
});

afterEach(() => {
	// Contract-defined reset while the page (and thus the adapter) is still
	// mounted: appinstalled clears any stashed prompt -> 'none'.
	window.dispatchEvent(new Event('appinstalled'));
	cleanup();
	localStorage.clear();
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
	vi.restoreAllMocks();
});

describe("/profile — install button, 'none' state (#408)", () => {
	it('renders NOTHING when no prompt is stashed and the platform is not iOS', async () => {
		const container = await renderProfileReady();
		expect(container.querySelectorAll('[data-testid^="profile-install-"]').length).toBe(0);
	});
});

describe("/profile — install button, 'prompt' state (#408)", () => {
	it('beforeinstallprompt after mount -> ONE native classed button with the i18n label', async () => {
		const container = await renderProfileReady();
		window.dispatchEvent(makeBeforeInstallPrompt());

		await waitFor(() => expect(installButton(container)).not.toBeNull());
		const button = installButton(container)!;
		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('type')).toBe('button');
		// native-controls fence: the house button carries a class
		expect((button.getAttribute('class') ?? '').trim()).not.toBe('');
		expect(button.textContent).toContain('[profile_install_button]');
		expect(
			container.querySelectorAll('[data-testid="profile-install-button"]').length
		).toBe(1);
		// no iOS hint in the prompt state
		expect(iosHint(container)).toBeNull();
	});

	it('pressing the button calls the stashed prompt()', async () => {
		const container = await renderProfileReady();
		const evt = makeBeforeInstallPrompt();
		window.dispatchEvent(evt);
		await waitFor(() => expect(installButton(container)).not.toBeNull());

		await fireEvent.click(installButton(container)!);
		await waitFor(() => expect(evt.prompt).toHaveBeenCalledTimes(1));
	});

	it('a REJECTED prompt() removes the button and logs — never an inert control', async () => {
		const container = await renderProfileReady();
		const evt = makeBeforeInstallPrompt();
		// Chromium's failure mode: the banner had already been consumed.
		const invalidState = Object.assign(
			new Error('The prompt() method may only be called once.'),
			{ name: 'InvalidStateError' }
		);
		evt.prompt = vi.fn().mockRejectedValue(invalidState);
		window.dispatchEvent(evt);
		await waitFor(() => expect(installButton(container)).not.toBeNull());

		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		await fireEvent.click(installButton(container)!);

		// The stash is spent, so the affordance collapses: there is no button
		// left to press uselessly (the issue body's one explicit "no").
		await waitFor(() => expect(installButton(container)).toBeNull());
		expect(consoleError).toHaveBeenCalledWith('profile: install prompt failed', invalidState);
	});

	it('is app chrome — present even with NO collective selected', async () => {
		setToken('jwt-member');
		collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
		h.listMyProfilesMock.mockResolvedValue([]);
		const { container } = render(ProfilePage);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-no-collective"]')).not.toBeNull()
		);

		window.dispatchEvent(makeBeforeInstallPrompt());
		await waitFor(() => expect(installButton(container)).not.toBeNull());
	});
});

describe("/profile — install button, 'ios-hint' state (#408)", () => {
	it('iPhone, not standalone, no prompt -> the button renders; the hint does NOT yet', async () => {
		stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 });
		const container = await renderProfileReady();

		await waitFor(() => expect(installButton(container)).not.toBeNull());
		expect(iosHint(container)).toBeNull();
	});

	it('pressing the button reveals the Share-menu instruction line', async () => {
		stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 });
		const container = await renderProfileReady();
		await waitFor(() => expect(installButton(container)).not.toBeNull());

		await fireEvent.click(installButton(container)!);
		await waitFor(() => expect(iosHint(container)).not.toBeNull());
		expect(iosHint(container)!.textContent).toContain('[profile_install_ios_hint]');
	});
});

// ── locale parity: the two #408 keys, present + non-empty in ALL FOUR files ──

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;
const NEW_KEYS = ['profile_install_button', 'profile_install_ios_hint'] as const;

function readMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(__dirname, `../../messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('locale parity — #408 keys exist, non-empty, in en/et/lv/uk', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json carries every new key`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
				expect(isMessageEmpty(messages[key]), `${locale}.json ${key} is empty`).toBe(false);
			}
		});
	}

	it("the Estonian copy is Mihkel's drafted default (issue #408 body, verbatim)", () => {
		const et = readMessages('et');
		expect(et.profile_install_button).toBe('Paigalda mvox seadmesse');
		// The iOS menu item's wording is the platform's, not ours — the draft
		// ships and gets checked against a real device (noted in the commit body).
		expect(et.profile_install_ios_hint).toBe('Ava jagamismenüü ja vali «Lisa avakuvale».');
	});
});
