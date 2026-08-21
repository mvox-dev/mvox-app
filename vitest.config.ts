import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Reuse the app's Vite config (SvelteKit + Paraglide + Tailwind plugins) so that
// `$lib`, `$env/*`, and `$app/*` virtual modules resolve inside unit tests. Default
// environment is `node`; specs that touch localStorage/sessionStorage opt into
// happy-dom per-file via `// @vitest-environment happy-dom`.
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			// Colocated app specs, plus standalone ops/migration scripts (T4.10/#30 —
			// `scripts/migrations/**`). Scripts import the real `$lib` data layer and run
			// under Vite here (the tsx `$env` shim is only for standalone node execution).
			include: ['src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
			environment: 'node',
			globals: false,
			// #163 — STRUCTURAL test isolation: `pnpm test` must never be ABLE to
			// reach a live Entu database, regardless of individual spec mocking
			// discipline. setupFiles installs a global fetch guard (every spec file,
			// present and future) that rejects any call reaching the wire without an
			// explicit fetchImpl mock. `env` exports a machine-readable "no network"
			// contract to `process.env` — inherited by child node processes that
			// specs spawn directly (e.g. node-import-guard.spec.ts's execFileSync),
			// which sit outside the in-process fetch monkeypatch.
			setupFiles: ['./src/lib/testing/networkGuard.setup.ts'],
			env: {
				MVOX_TEST_NO_NETWORK: '1'
			}
		}
	})
);
