// #368 RED — update-forcing: no installed client may stay wedged on an old
// worker, and no client may reload-loop getting off one.
//
// THE FIELD FAILURE (issue #368, diagnosed on-issue + diagnose-368 digest):
// a phone ran a genuinely old worker that never re-checked for an update;
// every reload re-served that worker's own self-consistent stale shell.
// Deterministic recovery was "clear site data" — nothing else. The app had
// ZERO update-forcing code: no registration.update(), no controllerchange
// listener, no updated polling. And /service-worker.js itself was served
// with the CDN's 4h static default (max-age=14400) while the app's two
// hardened endpoints are max-age=0.
//
// THE FIX SHAPE this spec pins (settled per the #368 spike contract — the
// three levers named on-issue):
//   1. A pure update-check scheduler (guard-instrument law: the WHEN of
//      registration.update() is an exported pure decision function, pinned
//      with inline fixtures) — checks on an elapsed interval AND on the tab
//      becoming visible (returning to the app is the natural re-check moment
//      on a phone), with a floor so rapid visibility flips cost ONE check.
//   2. THE reload-loop fence: controllerchange → reload EXACTLY ONCE per
//      page lifetime, guarded by a real latch (driven here, not hand-set).
//      skipWaiting + clients.claim (#353) means controllerchange fires on
//      EVERY deploy while a tab is open — an unguarded reload handler, or a
//      latch that resets in-page, is a reload LOOP: strictly worse than the
//      wedge this issue fixes.
//   3. static/_headers hardens /service-worker.js to max-age=0,
//      must-revalidate — the one file whose freshness the whole update
//      dance depends on. Scoped to that path ONLY: no blanket header rules.
//
// #353 FENCES RE-ASSERTED (this slice EXTENDS the worker's update path; it
// must not reshape the landed policy): NEVER_CACHE_PATHS still bypassed, the
// install-time precache stays the only cache write, swPolicy.spec.ts stays
// untouched — these extension pins live HERE, in a new spec, by design.
//
// NO USER-FACING STRINGS: the whole mechanism is silent (a forced reload
// swaps the shell; there is no banner, no toast, no copy). Comenius skip.
// (The spike contract's deferred-reload-UX-with-copy fork was NOT taken —
// the issue's priority is never-wedged, not zero-reloads.)
import { describe, expect, it, vi } from 'vitest';
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
	shouldReloadOnControllerChange
} from './swUpdate';

// ---------------------------------------------------------------------------
// 1. The update-check scheduler — WHEN to call registration.update(), pure.
// ---------------------------------------------------------------------------

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
		// Away 5 minutes, then three visible/hidden flips seconds apart —
		// the app-switcher dance every phone user does.
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
		// The hourly tick that would have fired at T0+1h now finds the clock
		// reset by the visibility check at T0+30min → no check.
		expect(
			decideUpdateCheck(state, { kind: 'interval-tick', nowMs: T0 + UPDATE_CHECK_INTERVAL_MS })
		).toEqual({
			check: false,
			state: { lastCheckMs: T0 + 30 * 60 * 1000 }
		});
	});
});

// ---------------------------------------------------------------------------
// 2. THE critical pin — controllerchange single-reload guard.
//
// This is the reload-loop fence. The latch is REAL and driven here: the guard
// is created exactly as production creates it and fired repeatedly; nothing
// below hand-sets latch state. Weighted like #351's LRU trap: if this pin is
// wrong, every deploy reload-loops every open tab — strictly worse than #368.
// ---------------------------------------------------------------------------

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
		// Loop-safety reasoning, pinned: reload() replaces the page, so the new
		// page constructs a NEW guard. The controllerchange for the deploy that
		// caused the reload already fired and is not re-fired at the new page —
		// so per deploy: one fire, one latch, one reload, silence.
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

// The OTHER half of the fence: WHETHER to attach the guard at all.
// `clients.claim()` fires controllerchange at every client whose controller
// changes, including null → worker on a page that loaded uncontrolled. So a
// first visit (or one right after "clear site data", the only deterministic
// unwedge available today) would reload itself a second after first paint on
// a page already showing the newest build — and on a cold deep link into
// /auth/callback?key=<JWT> that reload can land mid-exchange and restart the
// token swap. The latch is right; the attach condition is the pin below.
describe('#368 — controllerchange reload only on a page that was already controlled at boot', () => {
	it('uncontrolled at boot (first install / post-clear-site-data) → no reload: clients.claim fires controllerchange on a page that is already newest', () => {
		expect(shouldReloadOnControllerChange({ hadControllerAtBoot: false })).toBe(false);
	});

	it('controlled at boot (a deploy landing on an installed client) → reload: this is the wedge-breaking case #368 exists for', () => {
		expect(shouldReloadOnControllerChange({ hadControllerAtBoot: true })).toBe(true);
	});

	it('attached only when controlled at boot, and then still exactly once — the two halves compose', () => {
		// Drive both halves the way production composes them: decide, attach,
		// then fire the event repeatedly.
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

	it('startUpdateForcing reads navigator.serviceWorker.controller at boot and gates the listener on the pinned decision', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/lib/sw/swUpdate.ts'), 'utf-8');
		expect(source).toContain('navigator.serviceWorker.controller !== null');
		expect(source).toContain('shouldReloadOnControllerChange({ hadControllerAtBoot })');
		// The controllerchange listener must sit INSIDE the gate, not beside it.
		const gateIndex = source.indexOf('if (shouldReloadOnControllerChange(');
		const attachIndex = source.indexOf("addEventListener('controllerchange'");
		expect(gateIndex).toBeGreaterThan(-1);
		expect(attachIndex).toBeGreaterThan(gateIndex);
	});
});

// ---------------------------------------------------------------------------
// 3. static/_headers — the worker script's cache header, pinned by literal
// strings (runbook-pin style). /service-worker.js was live-probed serving
// max-age=14400 (CF Pages static default) while /version.json and
// /_app/version.json serve max-age=0 — the update check's own transport was
// the one path left soft. CF Pages honors a static/_headers file; whether
// the edge applies it to this path is confirmable only post-deploy (the
// pipeline's probe step owns that half). Build-output presence is owned by
// GREEN's `pnpm build` gate — no SPIKE-settled unit check exists for it.
// ---------------------------------------------------------------------------

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

		// The header lines of a block are the indented lines that follow the
		// path line (CF Pages _headers format).
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

	it('is scoped to /service-worker.js ONLY — no blanket header rules ride along', () => {
		const content = readFileSync(headersPath, 'utf-8');
		// In the _headers format, every non-empty, non-indented, non-comment
		// line is a path rule. This slice's mandate is one path.
		const pathRules = content
			.split('\n')
			.filter((line) => line.trim() !== '' && !/^\s/.test(line) && !line.startsWith('#'));
		expect(pathRules).toEqual(['/service-worker.js']);
	});
});

// Adding static/_headers has a second, non-obvious effect: `$service-worker`'s
// `files` array is EVERYTHING under static/, and swPolicy.precacheUrls()
// spreads `files` straight into the single install-time `cache.addAll`. CF
// Pages CONSUMES _headers as deploy config and never serves it as an asset —
// https://mvox.eu/_headers answers 200 only because the SPA fallback hands
// back the shell. `cache.addAll` rejects ATOMICALLY on any non-OK response, so
// the whole install (and therefore every future worker activation) would rest
// on CF answering 200 for a path it does not serve — the exact wedge this
// slice exists to fix, and a break of #353's landed invariant that every
// precached URL is verified present in build output. The exclusion belongs in
// the worker manifest, not in static/ (the files must stay there to reach
// build output under adapter-static). Pinned as a pure call on the exported
// predicate — no build needed.
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

// ---------------------------------------------------------------------------
// 4. Wiring — the update-forcing module actually runs in the app (the
// integration pin: a pure module nobody imports forces nothing). SvelteKit
// auto-registers the worker itself (adapter-static + ssr=false, no app-owned
// register() call — see src/service-worker.ts header), so the forcing module
// must obtain the registration itself (navigator.serviceWorker) and must be
// started from the app's client boot path.
// ---------------------------------------------------------------------------

describe('#368 — startUpdateForcing is wired into the app boot path', () => {
	const bootCandidates = [
		'src/hooks.client.ts',
		'src/routes/+layout.svelte',
		'src/routes/+layout.ts'
	];

	it('some client boot file imports $lib/sw/swUpdate and calls startUpdateForcing', () => {
		const wired = bootCandidates.filter((candidate) => {
			const path = resolve(process.cwd(), candidate);
			if (!existsSync(path)) return false;
			const source = readFileSync(path, 'utf-8');
			return /\$lib\/sw\/swUpdate/.test(source) && /startUpdateForcing/.test(source);
		});
		expect(
			wired.length,
			`startUpdateForcing must be imported from $lib/sw/swUpdate and called in one of: ${bootCandidates.join(', ')}`
		).toBeGreaterThan(0);
	});

	it('swUpdate.ts drives the real DOM contract — registration.update(), visibilitychange, controllerchange — through the pinned decision core', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/lib/sw/swUpdate.ts'), 'utf-8');
		// The three platform hooks the fix levers name, verbatim:
		expect(source).toMatch(/\.update\(\)/);
		expect(source).toContain('visibilitychange');
		expect(source).toContain('controllerchange');
		// The impure starter must RUN the pinned pure core, not re-implement it
		// inline — otherwise every pin above holds a function the app never runs
		// (the #353 wiring-pin pattern).
		expect(source).toContain('decideUpdateCheck');
		expect(source).toContain('createSingleReloadGuard');
	});

	it('the update check handles its own rejection — registration.update() rejects whenever the script fetch fails, and offline is a normal state for an offline-first shell', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/lib/sw/swUpdate.ts'), 'utf-8');
		// The rejection must be RETURNED out of the .then (otherwise the .catch
		// never sees it) and then caught, not swallowed silently.
		expect(source).toMatch(/\.then\(\(registration\) => registration\?\.update\(\)\)/);
		expect(source).toMatch(/\.catch\(/);
		expect(source).toContain('console.warn');
	});
});

// ---------------------------------------------------------------------------
// 5. #353 fences, re-asserted untouched. This slice extends the update path;
// the landed worker policy must be byte-identical in behavior.
// ---------------------------------------------------------------------------

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

	it('the install-time precache stays the ONLY cache write — no cache.put anywhere, one addAll, inside install', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/service-worker.ts'), 'utf-8');
		expect(source).not.toMatch(/\.put\(/);
		expect(source.match(/addAll/g) ?? []).toHaveLength(1);
		const installIndex = source.indexOf("addEventListener('install'");
		const activateIndex = source.indexOf("addEventListener('activate'");
		const addAllIndex = source.indexOf('addAll');
		expect(installIndex).toBeGreaterThan(-1);
		expect(addAllIndex).toBeGreaterThan(installIndex);
		expect(addAllIndex).toBeLessThan(activateIndex);
	});

	it('swPolicy.spec.ts still carries the #353 pins — extension tests live HERE, the landed spec is not edited', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/lib/sw/swPolicy.spec.ts'), 'utf-8');
		expect(source).toContain(
			'#353 — the HARD FENCE: Entu API URLs are NEVER cached or served from cache'
		);
		expect(source).toContain("expect(decideFetch(get(`${ORIGIN}/version.json`), CTX)).toEqual");
		expect(source).toContain('(*MVOX:Tallis* — #353 RED)');
	});
});

// (*MVOX:Tallis* — #368 RED)
