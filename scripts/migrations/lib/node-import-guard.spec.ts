// #107 review R2/F1 — REGRESSION GUARD: `$lib/entu/request` must stay importable
// from plain node/tsx.
//
// 37 scripts under scripts/migrations/ import `entuFetch` from that module,
// including all four shipped `pnpm migrate:*` targets and every polyphony probe.
// They run OUTSIDE Vite, through `register-loader.mjs`, whose resolve hook maps
// only `$env/dynamic/public` and `$lib/*`. Adding any `$app/*` import to
// request.ts (or to anything in its transitive graph) is therefore an instant
// `ERR_MODULE_NOT_FOUND: Cannot find package '$app'` for every one of them — a
// break vitest cannot see, because under Vite `$app/*` resolves fine.
//
// So this guard runs the REAL thing: a child process with the REAL loader
// importing the REAL module. It covers the whole transitive import graph, not
// just request.ts's own import list, and it fails for the localStorage /
// browser-global class of breakage too (the fixture calls entuUrl, and a 401
// handler that touched storage at module scope would blow up here).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..', '..');
// The fixture must live INSIDE the repo: tsx classifies a .ts file outside any
// `"type": "module"` package as CJS, which bypasses the ESM resolve hooks
// entirely and would make this guard test the wrong loader path.
const fixtureDir = mkdtempSync(join(repoRoot, 'scripts', 'migrations', '.node-import-guard-'));

afterAll(() => {
	rmSync(fixtureDir, { recursive: true, force: true });
});

function runUnderMigrationLoader(source: string): string {
	const fixture = join(fixtureDir, 'fixture.ts');
	writeFileSync(fixture, source, 'utf8');
	return execFileSync(
		process.execPath,
		[
			'--import',
			'tsx',
			'--import',
			'./scripts/migrations/lib/register-loader.mjs',
			fixture
		],
		{ cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	);
}

describe('migration scripts can import the shared Entu data layer under node/tsx', () => {
	it('imports $lib/entu/request and builds a URL — no $app, no browser globals', () => {
		const out = runUnderMigrationLoader(
			[
				"import { entuFetch, entuUrl, isAuthExpiredError } from '$lib/entu/request';",
				"if (typeof entuFetch !== 'function') throw new Error('entuFetch missing');",
				"if (typeof isAuthExpiredError !== 'function') throw new Error('isAuthExpiredError missing');",
				"console.log('URL', entuUrl('polyphony', 'entity?limit=1'));",
				"console.log('IMPORT OK');"
			].join('\n')
		);

		expect(out).toContain('IMPORT OK');
		expect(out).toContain('/polyphony/entity?limit=1');
	});

	it('a 401 under node rejects with the AuthExpiredError tag — no handler, no localStorage access', () => {
		const out = runUnderMigrationLoader(
			[
				"import { entuFetch, isAuthExpiredError } from '$lib/entu/request';",
				'const fetchImpl = async () => new Response("unauthorized", { status: 401 });',
				'let caught: unknown;',
				'try {',
				"  await entuFetch('polyphony', 'entity?limit=1', 'stale', {}, fetchImpl as typeof fetch);",
				'} catch (e) {',
				'  caught = e;',
				'}',
				"if (!isAuthExpiredError(caught)) throw new Error('expected AuthExpiredError, got ' + String(caught));",
				"console.log('TAGGED OK');"
			].join('\n')
		);

		expect(out).toContain('TAGGED OK');
	});

	// #163 C5 — the in-process `globalThis.fetch` monkeypatch (networkGuard.setup.ts)
	// never reaches this REAL child `node` process; `MVOX_TEST_NO_NETWORK=1` is the
	// only signal that survives the process boundary (vitest.config.ts `test.env`,
	// inherited by execFileSync's default env). Confirms register-loader.mjs installs
	// its own network-blocking `globalThis.fetch` here, so entuFetch's default
	// (unmocked) fetchImpl is blocked in this REAL child process too — not just
	// under vitest's in-process patch.
	it('MVOX_TEST_NO_NETWORK=1, inherited from the parent test process, blocks entuFetch with no explicit fetchImpl', () => {
		const out = runUnderMigrationLoader(
			[
				"import { entuFetch } from '$lib/entu/request';",
				"if (process.env.MVOX_TEST_NO_NETWORK !== '1') throw new Error('fixture did not inherit MVOX_TEST_NO_NETWORK=1');",
				'let caught: unknown;',
				'try {',
				"  await entuFetch('polyphony', 'entity?limit=1', 'fake-token');",
				'} catch (e) {',
				'  caught = e;',
				'}',
				"if (!(caught instanceof Error) || !/test isolation/i.test(caught.message)) {",
				"  throw new Error('expected a test-isolation rejection, got ' + String(caught));",
				'}',
				"console.log('ISOLATED OK');"
			].join('\n')
		);

		expect(out).toContain('ISOLATED OK');
	});
});

// (*MVOX:Josquin*)
