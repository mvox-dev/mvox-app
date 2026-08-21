// Registers the T4.10 resolve hook (`loader.mjs`) with Node's module system so a
// standalone `node`/`tsx` run can resolve the `$env/dynamic/public` virtual module.
// Used via `node --import tsx --import ./scripts/migrations/lib/register-loader.mjs`.
// (A hooks module exporting `resolve` must be REGISTERED, not merely imported — Node
// runs hooks in a separate loader thread.)
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);

// #163 C5 — STRUCTURAL test isolation for STANDALONE node/tsx executions.
// vitest.config.ts exports `MVOX_TEST_NO_NETWORK=1` to `process.env` for every
// test run; a REAL child process spawned mid test-suite (node-import-guard.spec.ts's
// execFileSync, or a `pnpm migrate:*` script run by accident) inherits it by
// default (execFileSync's env option defaults to the parent's env). Every one
// of those standalone executions passes through THIS loader — the entrypoint
// registered via `node --import tsx --import
// ./scripts/migrations/lib/register-loader.mjs <file>` — and it never loads
// inside vitest/the browser bundle. That makes it the correct seam: it can
// install a network-blocking `globalThis.fetch` without touching
// `$lib/entu/request.ts`'s shared `entuFetch`, which also runs IN-PROCESS
// under vitest, where specs legitimately replace `globalThis.fetch` themselves
// (`vi.stubGlobal('fetch', ...)`, the established pattern in the page-level
// integration specs) to simulate a live wire — gating there on
// `fetchImpl === globalThis.fetch` cannot tell that apart from an unguarded
// default and would block those legitimate specs too.
if (process.env.MVOX_TEST_NO_NETWORK === '1') {
	globalThis.fetch = () =>
		Promise.reject(
			new Error(
				'test isolation: network access blocked — MVOX_TEST_NO_NETWORK=1 is set, so this ' +
					'standalone script must never reach a live Entu database. Pass an explicit ' +
					'fetchImpl mock instead of relying on the default global fetch.'
			)
		);
}
