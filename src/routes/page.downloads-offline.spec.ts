// @vitest-environment happy-dom
//
// #353 RED — /downloads: the one view that works with no network, listing
// downloaded parts BY LABEL and opening them from the store.
//
// CONTRACT (spike-353, settled):
//   - Route: src/routes/downloads/+page.svelte. NO nav entry (NAV_ENTRIES
//     pinned 6); the door is the agenda's offline branch (the one branch that
//     RENDERS offline — see the structural pin below). Carries HOUSE_SHELL,
//     no #341 allowlist line: an ordinary top-flowed list.
//   - IDENTITY OFFLINE (spike 3, the blocker): selectedCollectiveIdentityStore
//     is NULL on every page with no network (collective discovery is a
//     network call). This page must NOT read it — it derives its identities
//     from authStore's personIdByDb (decoded locally from the JWT by the root
//     layout's hydrateAuth) via deriveOfflineIdentities + the persisted
//     'mvox.selected_collective' key. Structural pins below.
//   - DATA: per identity, byteStore.heldFileIds(db, personId) is the source
//     of truth for WHAT IS HELD; labelsFor(db, personId) only NAMES held ids.
//     A held id with NO label renders an honest unnamed row (a file the view
//     hides is worse than one it cannot name); an orphan label (bytes gone)
//     produces NO row.
//   - OPEN (#427 review round 3, finding 5): an in-app navigation to the
//     fullscreen viewer, /part/[fileId]?db=. The viewer runs the same
//     openFileBytes read-through this page used to run itself (a store hit
//     touches no network) and owns every notice that read can produce. This
//     page is the only surface that lists parts with no network, so it is
//     the viewer's only offline door.
//   - Testids: downloads-part-{fileId} per row, downloads-open-{fileId} the
//     open control, downloads-empty the empty state.
//   - WORDING: same honesty fence as #351/#352 (byteStore.ts:8) — nothing may
//     imply the stored bytes are private/protected, four locales.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get:
			(_t, key) =>
			(params?: Record<string, unknown>) =>
				params ? `[${String(key)} ${JSON.stringify(params)}]` : `[${String(key)}]`
	})
}));
vi.mock('$lib/paraglide/runtime', () => ({ getLocale: () => 'en' }));
const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

// The auth storage seam: inert here since the byte read moved into the viewer
// (#427), kept because the root-layout imports still resolve through it.
vi.mock('$lib/auth/storage', () => ({
	getToken: () => 'tok-1',
	setToken: vi.fn(),
	getUser: () => null,
	setUser: vi.fn(),
	getLastProvider: () => null,
	setLastProvider: vi.fn(),
	clearAll: vi.fn()
}));

// ── the two store seams, substituted at the app singletons ──────────────────
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

/** The label shape #353 pins (spike 2b): minimal, filename load-bearing. */
type PartLabel = { work: string; composer: string; edition: string; filename: string };

function createFakeLabelStore() {
	const map = new Map<string, PartLabel>();
	const key = (db: string, personId: string, fileId: string) => JSON.stringify([db, personId, fileId]);
	return {
		seed(db: string, personId: string, fileId: string, label: PartLabel) {
			map.set(key(db, personId, fileId), label);
		},
		async putLabel(identity: { db: string; personId: string } | null, fileId: string, label: PartLabel) {
			if (identity === null) throw new Error('label store: no identity');
			map.set(key(identity.db, identity.personId, fileId), label);
		},
		async labelsFor(db: string, personId: string) {
			const out = new Map<string, PartLabel>();
			for (const [k, label] of map) {
				const [d, p, fileId] = JSON.parse(k) as [string, string, string];
				if (d === db && p === personId) out.set(fileId, label);
			}
			return out;
		},
		async remove(k: { db: string; personId: string; fileId: string }) {
			map.delete(key(k.db, k.personId, k.fileId));
		}
	};
}

let fakeByteStore: FakeByteStore;
let fakeLabelStore: ReturnType<typeof createFakeLabelStore>;
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => fakeByteStore }));
vi.mock('$lib/files/appLabelStore', () => ({ getAppLabelStore: () => fakeLabelStore }));

import { authStore } from '$lib/auth/session';
import { NAV_ENTRIES } from '$lib/nav/entries';
import { HOUSE_SHELL } from '../page-shell';
import { createRouteLoadMachine } from '$lib/loading/routeLoad';

const LABEL: PartLabel = {
	work: 'Bogoróditse Djévo',
	composer: 'Arvo Pärt',
	edition: 'SATB 1990',
	filename: 'bogoroditse-sopran.pdf'
};

function pdfBytes(fill: number) {
	return {
		bytes: new Uint8Array(8).fill(fill).buffer,
		filetype: 'application/pdf',
		sha256: `sha-${fill}`
	};
}

async function renderDownloadsPage() {
	const mod = await import('./downloads/+page.svelte');
	return render(mod.default);
}

beforeEach(() => {
	fakeByteStore = createFakeByteStore();
	fakeLabelStore = createFakeLabelStore();
	localStorage.clear();
	gotoMock.mockReset();
	// Kept as a spy, not because the page opens tabs — it must NOT (#427
	// review round 3, finding 5) — but so a regression to the blank-tab
	// dance is visible rather than silently opening a window in the suite.
	vi.spyOn(window, 'open').mockReturnValue({
		location: { href: '' },
		close: vi.fn()
	} as unknown as Window);
	authStore.set({
		status: 'authenticated',
		personIdByDb: { sampledb: 'person-1' },
		expMs: Date.now() + 3_600_000
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('#353 — /downloads lists held parts BY LABEL, with zero network', () => {
	it('renders a held part named by its label — work, composer, filename all visible', async () => {
		// No network at all: any fetch is a spec failure, loudly.
		vi.stubGlobal('fetch', () => {
			throw new Error('#353: the offline view touched the network');
		});
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-a', pdfBytes(1));
		fakeLabelStore.seed('sampledb', 'person-1', 'file-a', LABEL);

		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			const row = container.querySelector('[data-testid="downloads-part-file-a"]');
			expect(row).not.toBeNull();
			expect(row!.textContent).toContain('Bogoróditse Djévo');
			expect(row!.textContent).toContain('Arvo Pärt');
			expect(row!.textContent).toContain('bogoroditse-sopran.pdf');
		});
	});

	it('a held id with NO label renders an honest unnamed row — it must NOT disappear from the list', async () => {
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-b', pdfBytes(2));

		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			const row = container.querySelector('[data-testid="downloads-part-file-b"]');
			expect(row).not.toBeNull();
			expect(row!.textContent).toContain('[downloads_unnamed_part]');
			// Still openable — unnamed is not unreachable.
			expect(container.querySelector('[data-testid="downloads-open-file-b"]')).not.toBeNull();
		});
	});

	it('an orphan label (bytes evicted, name left behind) produces NO row — heldFileIds is the source of truth', async () => {
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-a', pdfBytes(1));
		fakeLabelStore.seed('sampledb', 'person-1', 'file-a', LABEL);
		fakeLabelStore.seed('sampledb', 'person-1', 'file-ghost', { ...LABEL, filename: 'ghost.pdf' });

		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="downloads-part-file-a"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="downloads-part-file-ghost"]')).toBeNull();
	});

	it('renders honestly when empty — the named empty state, never a blank page', async () => {
		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="downloads-empty"]')).not.toBeNull();
			expect(container.textContent).toContain('[downloads_empty]');
		});
		expect(container.querySelectorAll('[data-testid^="downloads-part-"]')).toHaveLength(0);
	});

	// #427 review round 3, finding 5 — this page is the ONLY surface that
	// lists parts with no network (the library and event entry points both
	// need an Entu read before they can show a file at all), so if it does
	// not reach the viewer, the viewer has no offline door and #427's third
	// done-when is satisfied only by a bookmarked URL.
	it('opens a part IN the app: an in-app navigation to the fullscreen viewer, carrying the row\'s own db', async () => {
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-a', pdfBytes(1));
		fakeLabelStore.seed('sampledb', 'person-1', 'file-a', LABEL);

		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="downloads-open-file-a"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="downloads-open-file-a"]')!);

		await waitFor(() => {
			expect(gotoMock.mock.calls).toEqual([['/part/file-a?db=sampledb']]);
		});
		// No blank tab, no raw bytes in a foreign tab: the viewer reads them.
		expect(window.open).not.toHaveBeenCalled();
	});

	it('a row of a SECOND collective navigates under its own db — the page holds several identities at once', async () => {
		authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-1', otherdb: 'person-2' },
			expMs: Date.now() + 3_600_000
		});
		fakeByteStore.seed({ db: 'otherdb', personId: 'person-2' }, 'file-b', pdfBytes(2));
		fakeLabelStore.seed('otherdb', 'person-2', 'file-b', LABEL);

		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="downloads-open-file-b"]')).not.toBeNull();
		});
		await fireEvent.click(container.querySelector('[data-testid="downloads-open-file-b"]')!);

		await waitFor(() => {
			expect(gotoMock.mock.calls).toEqual([['/part/file-b?db=otherdb']]);
		});
	});

	// The open-failure alert that used to live here is gone with the byte
	// read (#427 review round 3, finding 5): a navigation cannot fail the way
	// a signing or a byte GET can, and the viewer distinguishes "not on this
	// device" from "a server answered and refused" — a distinction this page
	// never drew. Its notices are pinned in
	// src/routes/part/page.part-viewer.spec.ts.

	// Bentham review round, finding 1 — the cold-start auth race. authStore's
	// REAL first value on a fresh full-document load is 'loading' (the root
	// layout's onMount hydrateAuth hasn't resolved yet); every other spec in
	// this file hand-sets authStore to 'authenticated' in beforeEach, which
	// skips exactly the ordering that broke. This test drives the real
	// sequence: mount while 'loading', THEN resolve to 'authenticated' —
	// pinning that the page waits (no downloads-empty claim) instead of
	// permanently mis-reading the unresolved state as "signed out".
	it('cold start: authStore begins at loading — the page waits, then renders the held part once auth resolves', async () => {
		authStore.set({ status: 'loading' });
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-a', pdfBytes(1));
		fakeLabelStore.seed('sampledb', 'person-1', 'file-a', LABEL);

		const { container } = await renderDownloadsPage();

		expect(container.querySelector('[data-testid="downloads-loading"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="downloads-empty"]')).toBeNull();
		expect(container.querySelector('[data-testid="downloads-part-file-a"]')).toBeNull();

		authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-1' },
			expMs: Date.now() + 3_600_000
		});

		await waitFor(() => {
			const row = container.querySelector('[data-testid="downloads-part-file-a"]');
			expect(row).not.toBeNull();
			expect(row!.textContent).toContain('Bogoróditse Djévo');
		});
	});

	// Bentham review round, finding 2 — heldFileIds/labelsFor reject on a real
	// IDB error (idbAdapter.ts:80/:96). The read's `.then()` had no `.catch()`,
	// so a rejection left `loaded` false forever — on this exact
	// degraded-conditions surface, that reads as an infinite "Loading…", never
	// as a failure. Pins that a rejection instead flips `loaded` true and
	// renders the alert — never a forever-loading page, never a false empty
	// claim either.
	it('a store-read rejection surfaces a load error — never a forever-loading page', async () => {
		vi.spyOn(fakeByteStore, 'heldFileIds').mockRejectedValueOnce(new Error('idb: read failed'));

		const { container } = await renderDownloadsPage();

		await waitFor(() => {
			const alert = container.querySelector('[data-testid="downloads-load-error"]');
			expect(alert).not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('[downloads_load_error]');
		});
		expect(container.querySelector('[data-testid="downloads-loading"]')).toBeNull();
		expect(container.querySelector('[data-testid="downloads-empty"]')).toBeNull();
	});
});

describe('#353 — identity offline (spike 3a: the three derivation cases, through the page)', () => {
	it('several collectives, no persisted pick → parts of ALL of the token\'s identities render', async () => {
		authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-1', crede: 'person-2' },
			expMs: Date.now() + 3_600_000
		});
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-a', pdfBytes(1));
		fakeByteStore.seed({ db: 'crede', personId: 'person-2' }, 'file-c', pdfBytes(3));
		fakeLabelStore.seed('sampledb', 'person-1', 'file-a', LABEL);
		fakeLabelStore.seed('crede', 'person-2', 'file-c', { ...LABEL, filename: 'crede-alt.pdf' });

		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="downloads-part-file-a"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="downloads-part-file-c"]')).not.toBeNull();
		});
	});

	it('a persisted pick narrows to that collective alone', async () => {
		authStore.set({
			status: 'authenticated',
			personIdByDb: { sampledb: 'person-1', crede: 'person-2' },
			expMs: Date.now() + 3_600_000
		});
		localStorage.setItem('mvox.selected_collective', 'sampledb');
		fakeByteStore.seed({ db: 'sampledb', personId: 'person-1' }, 'file-a', pdfBytes(1));
		fakeByteStore.seed({ db: 'crede', personId: 'person-2' }, 'file-c', pdfBytes(3));

		const { container } = await renderDownloadsPage();
		await waitFor(() => {
			expect(container.querySelector('[data-testid="downloads-part-file-a"]')).not.toBeNull();
		});
		expect(container.querySelector('[data-testid="downloads-part-file-c"]')).toBeNull();
	});
});

describe('#353 — structural fences: the page is built for offline, not around it', () => {
	const pageSource = () =>
		readFileSync(resolve(process.cwd(), 'src/routes/downloads/+page.svelte'), 'utf-8');

	it('carries the HOUSE_SHELL string verbatim — #341 passes with NO new allowlist entry', () => {
		expect(pageSource()).toContain(HOUSE_SHELL);
	});

	it('never reads selectedCollectiveIdentityStore — it is null offline on every page (spike 3)', () => {
		expect(pageSource()).not.toContain('selectedCollectiveIdentityStore');
	});

	it('derives identities through the pure offline module, and does not re-hydrate auth itself', () => {
		const source = pageSource();
		expect(source).toContain('deriveOfflineIdentities');
		expect(source).not.toContain('hydrateAuth(');
	});

	it('NAV_ENTRIES stays at 6 with no /downloads entry — the door is the agenda\'s offline branch', () => {
		expect(NAV_ENTRIES.map((e) => e.key)).toHaveLength(6);
		expect(NAV_ENTRIES.find((e) => e.route === '/downloads')).toBeUndefined();
	});

	it('the agenda\'s offline branch links here — the one surface that renders with no network (spike 3c)', () => {
		const agenda = readFileSync(resolve(process.cwd(), 'src/routes/+page.svelte'), 'utf-8');
		expect(agenda).toContain('href="/downloads"');
		expect(agenda).toContain('agenda_downloads_link');
	});
});

describe('#353 — out-of-scope views fail LEGIBLY offline (the #331 pattern, one representative)', () => {
	it('a no-network rejection classifies as load-error — a named state, never a hang or an empty-as-if-absent render', async () => {
		// The real machine, driven with the exact rejection offline produces:
		// fetch's TypeError. routeLoad wraps every out-of-scope page body
		// (library/profile/roster/links) — this pins the mechanism they share.
		const statuses: string[] = [];
		const machine = createRouteLoadMachine({
			name: 'offline-representative',
			selected: () => ({ db: 'sampledb' }),
			setStatus: (s) => statuses.push(s),
			load: async () => {
				throw new TypeError('Failed to fetch');
			}
		});
		await machine.loadForSelected();
		expect(statuses).toEqual(['loading', 'load-error']);
	});

	it('the failure COPY exists in all four locales — the state has words, not a blank (library as the representative)', () => {
		for (const locale of ['en', 'et', 'lv', 'uk']) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			expect(messages['library_load_error'], `${locale}: library_load_error`).toBeTruthy();
		}
	});
});

describe('#353 — wording honesty (byteStore.ts:8), the #351 instrument applied to the new keys', () => {
	const localeFiles = ['en', 'et', 'lv', 'uk'] as const;
	const NEW_KEYS = [
		'downloads_title',
		'downloads_empty',
		'downloads_unnamed_part',
		'downloads_open',
		'downloads_loading',
		'downloads_load_error',
		'agenda_downloads_link',
		// Bentham review round, finding 2 — this surface now renders
		// repertoire_pdf_error too (the open-failure alert); the honesty fence
		// should cover every string this route can show, not just the ones it
		// introduced first.
		'repertoire_pdf_error'
	] as const;
	const FORBIDDEN = [
		/priv/i,
		/secur/i,
		/protect/i,
		/kaitst/i,
		/turval/i,
		/aizsarg/i,
		/droš/i,
		/захищ/i,
		/прив/i,
		/безпеч/i
	];

	it('every new key exists, non-empty, in all four locales', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			for (const key of NEW_KEYS) {
				expect(messages[key], `${locale}: ${key}`).toBeTruthy();
			}
		}
	});

	it('no value in any locale implies the stored bytes are private, secure or protected', () => {
		for (const locale of localeFiles) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, string>;
			for (const key of NEW_KEYS) {
				const value = messages[key] ?? '';
				for (const pattern of FORBIDDEN) {
					expect(value, `${locale}: ${key} = "${value}" matches ${pattern}`).not.toMatch(pattern);
				}
			}
		}
	});
});

// (*MVOX:Tallis* — #353 RED; review-fix additions *MVOX:Byrd*)
