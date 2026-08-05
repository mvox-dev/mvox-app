// Entu API base URL. Sourced from PUBLIC_ENTU_API_BASE so deploys can point at a
// different Entu install without a code change; the hardcoded value is only a
// dev fallback when the env var is unset. Dynamic (not static) public env so a
// missing var degrades to the fallback instead of failing `svelte-check`/build.
//
// Entu is called BROWSER-DIRECT (no BFF): Entu JWTs are aud=IP-bound, so only the
// browser that completed the OAuth round-trip can use the issued token. That is the
// whole reason this app is a client-side SPA with ssr = false.
import { env } from '$env/dynamic/public';

// Trailing slash required: callers build `${ENTU_API_BASE}auth`, `${ENTU_API_BASE}{db}/entity`.
export const ENTU_API_BASE = env.PUBLIC_ENTU_API_BASE ?? 'https://api.entu.app/';

// (*MVOX:Josquin*)
