// $env/dynamic/public shim for STANDALONE node execution (T4.10 migration, #30).
//
// `$env/dynamic/public` is a Vite VIRTUAL module — no on-disk file. Vitest resolves
// it through Vite, but plain `node`/`tsx` does not. `loader.mjs` rewrites the
// specifier to this file so `$lib/entu-config` (which imports `env` from it) works
// outside Vite. RECON C proved this exact shim runs the real createProfile chain.
export const env = { PUBLIC_ENTU_API_BASE: process.env.PUBLIC_ENTU_API_BASE };
