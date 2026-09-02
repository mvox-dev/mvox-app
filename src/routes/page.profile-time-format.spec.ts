// @vitest-environment happy-dom
//
// #207 RED — the time-format preference control on /profile (PO standing
// rule 5: 24h is the default; AM/PM display exists ONLY as a profile
// preference) and the four-locale key parity for every key part 1 adds.
//
// CONTRACT (GREEN must implement in src/routes/profile/+page.svelte):
//   - a NATIVE <select data-testid="profile-time-format"> (rule 1 — native
//     controls only; a custom widget is a YELLOW), Tab-reachable, labelled
//     from profile_time_format_label, with exactly two options:
//     '24h' (profile_time_format_24h) and 'ampm' (profile_time_format_ampm)
//   - current value comes from $lib/preferences/timeFormat's timeFormatStore;
//     changing it writes the store AND localStorage 'mvox.time_format'
//     IMMEDIATELY — no network, no autosave queue, no rights (Gama ruling
//     2026-09-02: localStorage, per-device, no schema change)
//   - ONE muted hint line DIRECTLY UNDER the select,
//     [data-testid="profile-time-format-hint"], from profile_time_format_hint
//     — a fact about the storage ("Applies on this device."), Gama 01:59
//   - app chrome like the language selector (#123): NOT gated on collective
//     selection. Rule 4 does not bind (this is not an in-situ text field) but
//     the control is native and Tab-reachable.
//
// Harness mirrors page.language-selector.spec.ts — the integration precedent
// for a small app-chrome preference on the actual /profile route.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: vi.fn() }));
const pageStub = vi.hoisted(() => ({ url: new URL('http://localhost/profile') }));
vi.mock('$app/state', () => ({ page: pageStub }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

const h = vi.hoisted(() => ({ listMyProfilesMock: vi.fn() }));
// Mock ONLY the network read; keep resolveField/profilesByLevel real.
vi.mock('$lib/profile/profileData', async () => {
	const actual = await vi.importActual<typeof import('$lib/profile/profileData')>(
		'$lib/profile/profileData'
	);
	return { ...actual, listMyProfiles: h.listMyProfilesMock };
});

import ProfilePage from './profile/+page.svelte';
// Does not exist yet — the whole file is RED with "Failed to resolve import"
// until GREEN creates src/lib/preferences/timeFormat.ts.
import { timeFormatStore, TIME_FORMAT_KEY } from '$lib/preferences/timeFormat';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';
import { isMessageEmpty, type MessageFile } from '$lib/testing/messageFile.js';

const q = (c: HTMLElement, sel: string) => c.querySelector(sel);
const control = (c: HTMLElement) =>
	q(c, '[data-testid="profile-time-format"]') as HTMLSelectElement | null;
const hint = (c: HTMLElement) => q(c, '[data-testid="profile-time-format-hint"]');

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

async function renderProfileReady(): Promise<HTMLElement> {
	selectPolyphony();
	h.listMyProfilesMock.mockResolvedValue([]);
	const { container } = render(ProfilePage);
	await waitFor(() => expect(control(container)).not.toBeNull());
	return container;
}

beforeEach(() => {
	localStorage.clear();
	timeFormatStore.set('24h');
	h.listMyProfilesMock.mockReset();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	timeFormatStore.set('24h');
	clearAll({ preserveProvider: false });
	collectiveState.set({ status: 'loading' });
	selectedCollectiveDbStore.set(null);
	urlCollectiveDbStore.set(null);
});

describe('/profile — time-format preference control (#207 rule 5)', () => {
	it('renders a NATIVE <select> (rule 1) with exactly the two options 24h and ampm, labelled', async () => {
		const container = await renderProfileReady();
		const select = control(container)!;
		expect(select.tagName).toBe('SELECT');
		const values = [...select.querySelectorAll('option')].map((o) => o.value);
		expect(values).toEqual(['24h', 'ampm']);
		for (const option of select.querySelectorAll('option')) {
			expect(option.textContent?.trim(), `option ${option.value} needs a visible label`).toBeTruthy();
		}
		// Accessible name: aria-label / aria-labelledby / an associated <label>.
		const named =
			(select.getAttribute('aria-label') ?? '').trim() !== '' ||
			(select.getAttribute('aria-labelledby') ?? '').trim() !== '' ||
			select.labels?.length > 0;
		expect(named, 'the select needs an accessible name').toBe(true);
	});

	it('is Tab-reachable — never tabindex="-1" (native and keyboard-first)', async () => {
		const container = await renderProfileReady();
		expect(control(container)!.tabIndex).toBeGreaterThanOrEqual(0);
	});

	it("shows the CURRENT store value — default '24h'", async () => {
		const container = await renderProfileReady();
		expect(control(container)!.value).toBe('24h');
	});

	it('reflects a previously chosen AM/PM preference', async () => {
		timeFormatStore.set('ampm');
		const container = await renderProfileReady();
		expect(control(container)!.value).toBe('ampm');
	});

	it("changing it writes localStorage 'mvox.time_format' AND the store IMMEDIATELY — no network", async () => {
		const container = await renderProfileReady();
		const fetchCallsBefore = h.listMyProfilesMock.mock.calls.length;

		await fireEvent.change(control(container)!, { target: { value: 'ampm' } });
		expect(localStorage.getItem(TIME_FORMAT_KEY)).toBe('ampm');
		expect(get(timeFormatStore)).toBe('ampm');

		await fireEvent.change(control(container)!, { target: { value: '24h' } });
		expect(localStorage.getItem(TIME_FORMAT_KEY)).toBe('24h');
		expect(get(timeFormatStore)).toBe('24h');

		// No profile write path involved: the ONLY data seam this page owns
		// saw no extra traffic from flipping the preference.
		expect(h.listMyProfilesMock.mock.calls.length).toBe(fetchCallsBefore);
	});

	it('renders ONE muted hint line DIRECTLY UNDER the select (Gama 01:59 — a fact about the storage)', async () => {
		const container = await renderProfileReady();
		const select = control(container)!;
		const hintEl = hint(container);
		expect(hintEl, 'profile-time-format-hint missing').not.toBeNull();
		expect(hintEl!.textContent?.trim()).toBeTruthy();
		// DIRECTLY UNDER: the hint follows the select in document order.
		expect(
			select.compareDocumentPosition(hintEl!) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the hint must come after the select in document order'
		).toBeTruthy();
	});

	it('is app chrome like the language selector — present even with NO collective selected', async () => {
		setToken('jwt-member');
		collectiveState.set({ status: 'ready', collectives: [], erroredDbs: [] });
		const { container } = render(ProfilePage);
		await waitFor(() =>
			expect(q(container, '[data-testid="profile-no-collective"]')).not.toBeNull()
		);
		expect(control(container)).not.toBeNull();
	});
});

// ── locale parity: every key part 1 adds, present + non-empty in ALL FOUR files ──

const LOCALES = ['en', 'et', 'lv', 'uk'] as const;

const NEW_KEYS = [
	// TimeSelect (rule 5 — labelled native selects)
	'time_select_hour_label',
	'time_select_minute_label',
	'time_select_ampm_label',
	// the date half of the same composite — rendered on the event-create form
	// and the event-detail start_datetime editor (#207 review F2)
	'time_select_date_label',
	// profile preference control
	'profile_time_format_label',
	'profile_time_format_24h',
	'profile_time_format_ampm',
	'profile_time_format_hint'
] as const;

function readMessages(locale: string): MessageFile {
	return JSON.parse(
		readFileSync(resolve(__dirname, `../../messages/${locale}.json`), 'utf-8')
	) as MessageFile;
}

describe('locale parity — #207 part 1 keys exist, non-empty, in en/et/lv/uk', () => {
	for (const locale of LOCALES) {
		it(`${locale}.json carries every new key`, () => {
			const messages = readMessages(locale);
			for (const key of NEW_KEYS) {
				expect(key in messages, `${locale}.json missing ${key}`).toBe(true);
				expect(isMessageEmpty(messages[key]), `${locale}.json ${key} is empty`).toBe(false);
			}
		});
	}

	it('the hint copy is the PO-ruled per-device fact (en/et pinned verbatim, Gama 2026-09-02)', () => {
		expect(readMessages('en').profile_time_format_hint).toBe('Applies on this device.');
		expect(readMessages('et').profile_time_format_hint).toBe('Kehtib sellel seadmel.');
	});
});
