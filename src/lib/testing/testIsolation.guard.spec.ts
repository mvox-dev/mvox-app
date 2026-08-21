import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadEnv } from 'vite';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
import { entuFetch } from '$lib/entu/request';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';

// #163 RED — test isolation: `pnpm test` must not be ABLE to reach a live Entu
// database. The SPIKE measured 112–115 real GETs to https://api.entu-test.invalid/polyphony/
// per full run, from 8 spec files, all green — silent live traffic one forgotten
// `vi.mock` away from POSTing on the bulk-create path. Root causes, verified:
//
//   1. All 65 specs that mock `$lib/entu-config` pin ENTU_API_BASE to the REAL
//      production host — the mock does not isolate, it aims at production.
//   2. The other 89 specs fall through to `$env/dynamic/public`, which vite
//      resolves from .env → https://api.entu-test.invalid/ in test mode too (no .env.test).
//   3. vitest.config.ts has no setupFiles/globalSetup/test.env — nothing blocks
//      the network, and ~40 data-layer functions default `fetchImpl = fetch`,
//      so any unmocked call from a mounted page goes straight to the wire
//      (dominant leak: resolveDatabaseEntityId via resolveAdmin from
//      +layout.svelte, 91 of 115 calls).
//
// This guard pins the STRUCTURAL contract (isolation by default, not by
// per-spec discipline):
//
//   C1. vitest.config.ts registers `setupFiles` — the hook that installs the
//       global network guard for every spec file, present and future.
//   C2. During tests, `globalThis.fetch` is a guard that REJECTS every call
//       with an error whose message contains "test isolation" (and never
//       touches the network). Because data-layer defaults (`fetchImpl = fetch`)
//       resolve the global binding at call time, this single seam covers every
//       forgotten mock.
//   C3. The guard covers the real leak paths: `entuFetch` and
//       `resolveDatabaseEntityId` called WITHOUT an explicit fetchImpl (exactly
//       how +layout.svelte reaches them) must fail loudly with the isolation
//       error, not silently hit the wire.
//   C4. Env cannot re-aim tests at production: vite's test-mode env resolves
//       PUBLIC_ENTU_API_BASE to a non-real host (i.e. an .env.test override
//       exists), so even a guard bypass cannot construct a live URL.
//   C5. `MVOX_TEST_NO_NETWORK=1` is exported to the test process env, so child
//       processes spawned by specs (node-import-guard.spec.ts runs real `node`
//       via execFileSync — outside any in-process monkeypatch) inherit a
//       machine-readable "no network" contract they can honor.
//   C6. Source scan: no spec file may contain the production host literal at
//       all — the 65 `vi.mock('$lib/entu-config', … 'https://api.entu-test.invalid/')`
//       pins are rewritten to a fake host. Same walk-the-tree pattern as
//       noOrganizationReferences.spec.ts; comments count deliberately.
//
// This spec mocks `$lib/entu-config` to a guaranteed-unresolvable host
// (RFC 2606 `.invalid`) so that in the RED state its probes fail on DNS instead
// of sending real traffic to any live Entu install.

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'http://entu-guard-probe.invalid/' }));

/** The message contract for the network guard's rejection. */
const ISOLATION_ERROR = /test isolation/i;

/** Production host literal, assembled so this file itself never contains it verbatim. */
const PROD_HOST = ['api', 'entu', 'app'].join('.');

const projectRoot = join(import.meta.dirname, '..', '..', '..'); // src/lib/testing → repo root

describe('#163 C1 — vitest config installs the isolation setup', () => {
	it('vitest.config.ts declares test.setupFiles (the global network-guard hook)', () => {
		const config = readFileSync(join(projectRoot, 'vitest.config.ts'), 'utf-8');
		expect(config).toMatch(/setupFiles\s*:/);
	});
});

describe('#163 C2 — global fetch is a throwing guard, not the real network', () => {
	it('rejects any direct fetch with the isolation error (never resolves, never DNS-fails)', async () => {
		await expect(
			globalThis.fetch('http://entu-guard-probe.invalid/anything')
		).rejects.toThrow(ISOLATION_ERROR);
	});
});

describe('#163 C3 — the measured leak paths fail loudly without an explicit fetchImpl', () => {
	it('entuFetch with the DEFAULT fetchImpl is blocked by the guard', async () => {
		// Exactly the shape a page component reaches when a spec forgets a mock.
		await expect(
			entuFetch('guard-probe-db', 'entity?_type.string=database&props=_id&limit=1', 'fake-token')
		).rejects.toThrow(ISOLATION_ERROR);
	});

	it('resolveDatabaseEntityId (dominant leak: +layout.svelte → resolveAdmin) is blocked by the guard', async () => {
		await expect(
			resolveDatabaseEntityId({ db: 'guard-probe-db', token: 'fake-token' })
		).rejects.toThrow(ISOLATION_ERROR);
	});
});

describe('#163 C4 — test-mode env cannot resolve a real Entu host', () => {
	it('loadEnv("test") yields a PUBLIC_ENTU_API_BASE override that is not the production host', () => {
		const env = loadEnv('test', projectRoot, 'PUBLIC_');
		const base = env.PUBLIC_ENTU_API_BASE;
		// Must be SET (an explicit .env.test override, not absence — absence falls
		// back to the hardcoded production URL in src/lib/entu-config.ts)…
		expect(base, 'PUBLIC_ENTU_API_BASE must be overridden for test mode (.env.test)').toBeTruthy();
		// …and must not aim at the live install.
		expect(base).not.toContain(PROD_HOST);
	});
});

describe('#163 C5 — child-process contract', () => {
	it('MVOX_TEST_NO_NETWORK=1 is exported during test runs (spawned node children inherit it)', () => {
		expect(process.env.MVOX_TEST_NO_NETWORK).toBe('1');
	});
});

describe('#163 C6 — no spec file pins the production host', () => {
	it(`no *.spec.ts under src/ or scripts/ contains "${PROD_HOST}"`, () => {
		const selfRel = join('src', 'lib', 'testing', 'testIsolation.guard.spec.ts');
		const roots = [join(projectRoot, 'src'), join(projectRoot, 'scripts')];
		const violations: string[] = [];
		for (const root of roots) {
			for (const full of findSourceFiles(root, ['.spec.ts'])) {
				const rel = relative(projectRoot, full);
				if (rel === selfRel) continue; // this guard names the literal (assembled, but stay safe)
				if (readFileSync(full, 'utf-8').includes(PROD_HOST)) violations.push(rel);
			}
		}
		expect(violations, `spec files pinning the production Entu host:\n${violations.join('\n')}`).toEqual(
			[]
		);
	});
});

// (*MVOX:Tallis*)
