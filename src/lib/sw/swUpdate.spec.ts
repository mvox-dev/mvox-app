// Update forcing: no installed client stays on an old worker, and none reload-loops off one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decideFetch } from './swPolicy';
import {
	UPDATE_CHECK_INTERVAL_MS,
	VISIBILITY_CHECK_MIN_GAP_MS,
	initialUpdateSchedulerState,
	decideUpdateCheck,
	createSingleReloadGuard,
	shouldReloadOnControllerChange,
	startUpdateForcing
} from './swUpdate';

describe('#368 — update-check scheduler constants', () => {
	it('checks at most hourly on the interval — conservative: far below the 24h spec ceiling that wedged the field client, far above anything that could hammer the CDN', () => {
		expect(UPDATE_CHECK_INTERVAL_MS).toBe(60 * 60 * 1000);
	});

	it('floors visibility-triggered checks at one minute — returning to the app re-checks, flipping between apps does not spam', () => {
		expect(VISIBILITY_CHECK_MIN_GAP_MS).toBe(60 * 1000);
	});
});

describe('#368 — update-check scheduler decisions (full-shape toEqual: decision AND next state)', () => {
	const T0 = 1_789_468_110_784; // a real deploy-stamp-shaped epoch ms

	it('initial state records the boot moment as the last check — registration at boot IS a check; the first forced one waits a full gap', () => {
		expect(initialUpdateSchedulerState(T0)).toEqual({ lastCheckMs: T0 });
	});

	it('interval tick with the interval elapsed → check, and the state advances to now', () => {
		const state = initialUpdateSchedulerState(T0);
		expect(
			decideUpdateCheck(state, { kind: 'interval-tick', nowMs: T0 + UPDATE_CHECK_INTERVAL_MS })
		).toEqual({
			check: true,
			state: { lastCheckMs: T0 + UPDATE_CHECK_INTERVAL_MS }
		});
	});

	it('interval tick before the interval elapsed → no check, state unchanged', () => {
		const state = initialUpdateSchedulerState(T0);
		expect(
			decideUpdateCheck(state, {
				kind: 'interval-tick',
				nowMs: T0 + UPDATE_CHECK_INTERVAL_MS - 1
			})
		).toEqual({
			check: false,
			state: { lastCheckMs: T0 }
		});
	});

	it('becoming visible after minutes away → check (the phone-returns-to-the-app moment the field bug needed)', () => {
		const state = initialUpdateSchedulerState(T0);
		const nowMs = T0 + 5 * 60 * 1000;
		expect(decideUpdateCheck(state, { kind: 'became-visible', nowMs })).toEqual({
			check: true,
			state: { lastCheckMs: nowMs }
		});
	});

	it('becoming visible after hours in the background → check', () => {
		const state = initialUpdateSchedulerState(T0);
		const nowMs = T0 + 3 * 60 * 60 * 1000;
		expect(decideUpdateCheck(state, { kind: 'became-visible', nowMs })).toEqual({
			check: true,
			state: { lastCheckMs: nowMs }
		});
	});

	it('DO-NOT-SPAM: rapid visibility flips cost exactly one check', () => {
		// Away 5 minutes, then three visible/hidden flips seconds apart.
		let state = initialUpdateSchedulerState(T0);
		const flip1 = decideUpdateCheck(state, { kind: 'became-visible', nowMs: T0 + 5 * 60 * 1000 });
		expect(flip1).toEqual({
			check: true,
			state: { lastCheckMs: T0 + 5 * 60 * 1000 }
		});
		state = flip1.state;

		const flip2 = decideUpdateCheck(state, {
			kind: 'became-visible',
			nowMs: T0 + 5 * 60 * 1000 + 2_000
		});
		expect(flip2).toEqual({ check: false, state: { lastCheckMs: T0 + 5 * 60 * 1000 } });
		state = flip2.state;

		const flip3 = decideUpdateCheck(state, {
			kind: 'became-visible',
			nowMs: T0 + 5 * 60 * 1000 + 7_000
		});
		expect(flip3).toEqual({ check: false, state: { lastCheckMs: T0 + 5 * 60 * 1000 } });

		const checks = [flip1, flip2, flip3].filter((d) => d.check).length;
		expect(checks).toBe(1);
	});

	it('a visibility check resets the interval clock too — one shared lastCheckMs, no double-checking across triggers', () => {
		let state = initialUpdateSchedulerState(T0);
		const visible = decideUpdateCheck(state, {
			kind: 'became-visible',
			nowMs: T0 + 30 * 60 * 1000
		});
		expect(visible.check).toBe(true);
		state = visible.state;
		// The hourly tick at T0+1h finds the clock reset by the visibility check at T0+30min.
		expect(
			decideUpdateCheck(state, { kind: 'interval-tick', nowMs: T0 + UPDATE_CHECK_INTERVAL_MS })
		).toEqual({
			check: false,
			state: { lastCheckMs: T0 + 30 * 60 * 1000 }
		});
	});
});

// The reload-loop fence: if the latch is wrong, every deploy reload-loops every open tab.

describe('#368 — controllerchange fires once → exactly one reload', () => {
	it('first fire reloads', () => {
		const reload = vi.fn();
		const onControllerChange = createSingleReloadGuard(reload);
		onControllerChange();
		expect(reload.mock.calls).toEqual([[]]);
	});

	it('fires again (same guard instance, same latch state) → NO second reload', () => {
		const reload = vi.fn();
		const onControllerChange = createSingleReloadGuard(reload);
		onControllerChange();
		onControllerChange();
		expect(reload.mock.calls).toEqual([[]]);
	});

	it('a burst of fires still costs exactly one reload — the latch never resets within a page lifetime', () => {
		const reload = vi.fn();
		const onControllerChange = createSingleReloadGuard(reload);
		for (let i = 0; i < 5; i += 1) onControllerChange();
		expect(reload.mock.calls).toEqual([[]]);
	});

	it('a fresh guard (the page the reload itself produced) starts unlatched — each deploy costs at most one reload, the NEXT deploy gets its own', () => {
		// reload() replaces the page, which builds a new guard; per deploy one fire, one reload.
		const firstPageReload = vi.fn();
		const first = createSingleReloadGuard(firstPageReload);
		first();
		expect(firstPageReload.mock.calls).toEqual([[]]);

		const nextPageReload = vi.fn();
		const next = createSingleReloadGuard(nextPageReload);
		next();
		next();
		expect(nextPageReload.mock.calls).toEqual([[]]);
	});

	it('guards do not share latch state through module scope — the latch lives in the guard instance', () => {
		const a = vi.fn();
		const b = vi.fn();
		const guardA = createSingleReloadGuard(a);
		const guardB = createSingleReloadGuard(b);
		guardA();
		guardB();
		expect(a.mock.calls).toEqual([[]]);
		expect(b.mock.calls).toEqual([[]]);
	});
});

// clients.claim() also fires controllerchange on a page that loaded uncontrolled (a first visit),
// which must not reload: on /auth/callback that would restart the token exchange.
describe('#368 — controllerchange reload only on a page that was already controlled at boot', () => {
	it('uncontrolled at boot (first install / post-clear-site-data) → no reload: clients.claim fires controllerchange on a page that is already newest', () => {
		expect(shouldReloadOnControllerChange({ hadControllerAtBoot: false })).toBe(false);
	});

	it('controlled at boot (a deploy landing on an installed client) → reload: this is the wedge-breaking case #368 exists for', () => {
		expect(shouldReloadOnControllerChange({ hadControllerAtBoot: true })).toBe(true);
	});

	it('attached only when controlled at boot, and then still exactly once — the two halves compose', () => {
		const drive = (hadControllerAtBoot: boolean) => {
			const reload = vi.fn();
			const listener = shouldReloadOnControllerChange({ hadControllerAtBoot })
				? createSingleReloadGuard(reload)
				: null;
			for (let i = 0; i < 3; i += 1) listener?.();
			return reload;
		};

		expect(drive(false).mock.calls).toEqual([]);
		expect(drive(true).mock.calls).toEqual([[]]);
	});
});

// /service-worker.js must not ride the CDN's 4h static default; the update check depends on it.

describe('#368 — static/_headers hardens /service-worker.js', () => {
	const headersPath = resolve(process.cwd(), 'static/_headers');

	it('exists', () => {
		expect(existsSync(headersPath)).toBe(true);
	});

	it('carries the /service-worker.js block with max-age=0, must-revalidate — verbatim', () => {
		const content = readFileSync(headersPath, 'utf-8');
		const lines = content.split('\n');
		const ruleIndex = lines.findIndex((line) => line.trim() === '/service-worker.js');
		expect(ruleIndex, '_headers must contain a /service-worker.js path rule').toBeGreaterThan(-1);

		// The header lines of a block are the indented lines after the path line.
		const headerLines: string[] = [];
		for (let i = ruleIndex + 1; i < lines.length; i += 1) {
			const line = lines[i];
			if (!/^\s+\S/.test(line)) break;
			headerLines.push(line.trim());
		}
		const cacheControl = headerLines.find((line) => /^cache-control:/i.test(line));
		expect(cacheControl, 'the /service-worker.js block must set Cache-Control').toBeTruthy();
		expect(cacheControl).toContain('max-age=0');
		expect(cacheControl).toContain('must-revalidate');
	});

	it('names only the worker and the missing-file page — no blanket header rules ride along', () => {
		const content = readFileSync(headersPath, 'utf-8');
		// Every non-empty, non-indented, non-comment line is a path rule.
		const pathRules = content
			.split('\n')
			.filter((line) => line.trim() !== '' && !/^\s/.test(line) && !line.startsWith('#'));
		expect(pathRules).toEqual(['/service-worker.js', '/_app/404.html']);
	});
});

// $service-worker's `files` is all of static/, and addAll rejects on any non-OK response;
// CF Pages never serves its own config files, so precaching them would wedge the install.
describe('#368 — CF Pages config files are excluded from the service worker manifest', () => {
	const loadKitConfig = async () => {
		const module = await import(pathToFileURL(resolve(process.cwd(), 'svelte.config.js')).href);
		return module.default.kit;
	};

	it('svelte.config.js carries a kit.serviceWorker.files filter', async () => {
		const kit = await loadKitConfig();
		expect(typeof kit.serviceWorker?.files).toBe('function');
	});

	it('the filter rejects the CF Pages config files — they are deploy config, never served as assets', async () => {
		const kit = await loadKitConfig();
		const files = kit.serviceWorker.files;
		expect(files('_headers')).toBe(false);
		expect(files('_redirects')).toBe(false);
		expect(files('_routes.json')).toBe(false);
	});

	it('the filter rejects the missing-file page — CF answers its own path with a redirect', async () => {
		const kit = await loadKitConfig();
		expect(kit.serviceWorker.files('_app/404.html')).toBe(false);
	});

	it('the filter still accepts real static assets — this is an exclusion, not an opt-in list', async () => {
		const kit = await loadKitConfig();
		const files = kit.serviceWorker.files;
		expect(files('robots.txt')).toBe(true);
		expect(files('favicon.png')).toBe(true);
		expect(files('images/logo.svg')).toBe(true);
	});

	it('the filter keeps SvelteKit’s own default exclusion, which setting this option replaces wholesale', async () => {
		const kit = await loadKitConfig();
		expect(kit.serviceWorker.files('.DS_Store')).toBe(false);
	});
});


describe('#368 — #353 fences hold', () => {
	const ORIGIN = 'https://mvox.eu';
	const CTX = { origin: ORIGIN, precached: ['/', '/_app/env.js'] };

	it('NEVER_CACHE_PATHS still bypass — /version.json and /_app/version.json stay live; freezing either re-wedges the update dance', () => {
		expect(
			decideFetch({ url: `${ORIGIN}/version.json`, method: 'GET', mode: 'no-cors' }, CTX)
		).toEqual({ kind: 'bypass' });
		expect(
			decideFetch({ url: `${ORIGIN}/_app/version.json`, method: 'GET', mode: 'no-cors' }, CTX)
		).toEqual({ kind: 'bypass' });
	});
});

describe('#368 — startUpdateForcing on a client', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function bootClient(opts: { controlled: boolean; update?: () => Promise<unknown> }) {
		vi.useFakeTimers();
		const swListeners = new Map<string, () => void>();
		const docListeners = new Map<string, () => void>();
		const registration = { update: vi.fn(opts.update ?? (async () => undefined)) };
		const reload = vi.fn();
		const doc = {
			visibilityState: 'visible',
			addEventListener: (type: string, fn: () => void) => docListeners.set(type, fn)
		};
		vi.stubGlobal('navigator', {
			serviceWorker: {
				controller: opts.controlled ? {} : null,
				getRegistration: async () => registration,
				addEventListener: (type: string, fn: () => void) => swListeners.set(type, fn)
			}
		});
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', { location: { reload } });
		startUpdateForcing();
		return {
			registration,
			reload,
			controllerChange: () => swListeners.get('controllerchange')?.(),
			setVisibility: (state: 'visible' | 'hidden') => {
				doc.visibilityState = state;
				docListeners.get('visibilitychange')?.();
			}
		};
	}

	it('a page controlled at boot reloads once, however often the controller changes', () => {
		const client = bootClient({ controlled: true });

		client.controllerChange();
		client.controllerChange();

		expect(client.reload).toHaveBeenCalledTimes(1);
	});

	it('a page uncontrolled at boot never reloads on controllerchange', () => {
		const client = bootClient({ controlled: false });

		client.controllerChange();

		expect(client.reload).not.toHaveBeenCalled();
	});

	it('the hourly tick asks the registration for an update, and not before', async () => {
		const client = bootClient({ controlled: true });

		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1);
		expect(client.registration.update).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(client.registration.update).toHaveBeenCalledTimes(1);
	});

	it('returning to the tab after a minute away asks for an update; hiding it does not', async () => {
		const client = bootClient({ controlled: true });
		await vi.advanceTimersByTimeAsync(VISIBILITY_CHECK_MIN_GAP_MS);

		client.setVisibility('hidden');
		await vi.advanceTimersByTimeAsync(0);
		expect(client.registration.update).not.toHaveBeenCalled();
		client.setVisibility('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(client.registration.update).toHaveBeenCalledTimes(1);
	});

	it('a rejected update (offline) is warned, never thrown', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const client = bootClient({
			controlled: true,
			update: async () => {
				throw new TypeError('Failed to fetch');
			}
		});

		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);

		expect(client.registration.update).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

// (*MVOX:Tallis* — #368 RED)
