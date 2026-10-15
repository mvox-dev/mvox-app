import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadEnv } from 'vite';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';
import { entuFetch } from '$lib/entu/request';
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';

// `pnpm test` must not be able to reach a live Entu: a global fetch guard, a fake test host,
// and no production host literal in any spec. The probe host below is unresolvable (RFC 2606).

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'http://entu-guard-probe.invalid/' }));

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
		await expect(
			entuFetch('guard-probe-db', 'entity?_type.string=database&props=_id&limit=1', 'fake-token')
		).rejects.toThrow(ISOLATION_ERROR);
	});

	it('resolveDatabaseEntityId (dominant leak: +layout.svelte → resolveDbEditRight) is blocked by the guard', async () => {
		await expect(
			resolveDatabaseEntityId({ db: 'guard-probe-db', token: 'fake-token' })
		).rejects.toThrow(ISOLATION_ERROR);
	});
});

describe('#163 C4 — test-mode env cannot resolve a real Entu host', () => {
	it('loadEnv("test") yields a PUBLIC_ENTU_API_BASE override that is not the production host', () => {
		const env = loadEnv('test', projectRoot, 'PUBLIC_');
		const base = env.PUBLIC_ENTU_API_BASE;
		// Absence would fall back to the production URL in src/lib/entu-config.ts.
		expect(base, 'PUBLIC_ENTU_API_BASE must be overridden for test mode (.env.test)').toBeTruthy();
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
