// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/messages', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages()
);
vi.mock('$lib/paraglide/runtime', async () =>
	(await import('$lib/testing/moduleStubs')).runtimeModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

vi.mock('$lib/auth/storage', () => ({
	getToken: () => 'tok-1',
	setToken: vi.fn(),
	getUser: () => null,
	setUser: vi.fn(),
	getLastProvider: () => null,
	setLastProvider: vi.fn(),
	clearAll: vi.fn()
}));

import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

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
import { gotoMock } from '$lib/testing/routeMocks';

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

	it('a store-read rejection surfaces a load error — never a forever-loading page', async () => {
		const boom = new Error('idb: read failed');
		vi.spyOn(fakeByteStore, 'heldFileIds').mockRejectedValueOnce(boom);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { container } = await renderDownloadsPage();

		await waitFor(() => {
			const alert = container.querySelector('[data-testid="downloads-load-error"]');
			expect(alert).not.toBeNull();
			expect(alert!.getAttribute('role')).toBe('alert');
			expect(alert!.textContent).toContain('[downloads_load_error]');
		});
		expect(container.querySelector('[data-testid="downloads-loading"]')).toBeNull();
		expect(container.querySelector('[data-testid="downloads-empty"]')).toBeNull();
		expect(consoleSpy).toHaveBeenCalledWith('downloads: loading the downloaded parts failed', boom);
		consoleSpy.mockRestore();
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

	it('the agenda links here from BOTH offline branches — cold (error) and warm (cached rows)', () => {
		const agenda = ['src/lib/agenda/AgendaCollectivesStatus.svelte', 'src/lib/agenda/AgendaNotices.svelte']
			.map((p) => readFileSync(resolve(process.cwd(), p), 'utf-8'))
			.join('\n');
		expect(agenda).toContain('agenda_downloads_link');
		expect(agenda).toContain('data-testid="agenda-downloads-link"');
		expect(agenda).toContain('data-testid="agenda-downloads-link-cached"');
		expect(agenda.match(/href="\/downloads"/g)).toHaveLength(2);
	});
});

describe('#353 — out-of-scope views fail LEGIBLY offline (the #331 pattern, one representative)', () => {
	it('a no-network rejection classifies as load-error — a named state, never a hang or an empty-as-if-absent render', async () => {
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
		'last_read_as_of',
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
