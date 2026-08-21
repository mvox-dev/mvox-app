// #163 — global network guard, installed via vitest.config.ts `test.setupFiles`.
//
// STRUCTURAL isolation (not per-spec discipline): every data-layer function that
// talks to Entu defaults its `fetchImpl` parameter to the global `fetch` binding
// (`fetchImpl: typeof fetch = fetch`), resolved at CALL time. Overriding
// `globalThis.fetch` here — before any spec file runs — means any call that
// reaches the wire without an explicit mock (the exact shape of the leak the
// SPIKE measured: `entuFetch` / `resolveDatabaseEntityId` invoked with their
// default `fetchImpl`, e.g. from a mounted `+layout.svelte`) fails LOUDLY with a
// recognisable error instead of silently making a real HTTP request.
//
// This is deliberately the ONLY seam: specs that need to observe a fetch call
// pass their own `vi.fn()` as `fetchImpl` (the established pattern across the
// suite — see request.spec.ts), so they never touch this guard at all. Specs
// that assert directly against `globalThis.fetch` (testIsolation.guard.spec.ts,
// C2) exercise the guard itself.
const ISOLATION_MESSAGE =
	'test isolation: network access blocked — pnpm test must never reach a live Entu database. ' +
	'Pass an explicit fetchImpl mock instead of relying on the default global fetch.';

globalThis.fetch = (() => {
	return Promise.reject(new Error(ISOLATION_MESSAGE));
}) as typeof fetch;

// (*MVOX:Palestrina*)
