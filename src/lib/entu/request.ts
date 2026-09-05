// Entu request helpers — the runtime `db` is threaded in as the URL PATH SEGMENT
// (`{base}/{db}/...`), never a constant. The host is always PUBLIC_ENTU_API_BASE;
// only the db segment varies per selected collective (T4). Calls are browser-direct
// and carry the localStorage Entu JWT (aud=IP-bound — see entu-config.ts).
import { ENTU_API_BASE } from '$lib/entu-config';
import { AuthExpiredError } from './auth-expired';

// #107 — Entu 401 (expired/revoked/IP-mismatched JWT; the local `exp` check in
// guard.ts cannot catch those) recovery. This app is a pure client-side SPA
// (ssr = false, localStorage JWT, no BFF/cookie/server load — see
// request.auth-expired.spec.ts for the full adaptation note), so the
// "BFF entuFetch layer" the task describes lives HERE:
//   1. end the stale session — storage AND the in-memory authStore, via the
//      SAME `endSession` an explicit sign-out uses (provider preserved, so
//      re-auth pre-selects it — the choice hydrateAuth also makes for
//      locally-expired tokens);
//   2. redirect to sign-in carrying a session-expired flag AND the return path
//      — single-flight across concurrent 401s (an agenda load fans out many
//      requests; they must not stampede goto);
//   3. reject with a name-tagged error every caller can detect uniformly.
//
// (1) and (2) are BROWSER-ONLY concerns (localStorage, `$app/navigation`), and
// this module is NOT browser-only: 37 scripts under scripts/migrations/ — every
// shipped `pnpm migrate:*` target and every polyphony probe — import `entuFetch`
// under plain node/tsx via scripts/migrations/lib/loader.mjs, which maps only
// `$env/dynamic/public` and `$lib/*`. Importing `$app/navigation` here (a Vite
// virtual module with no on-disk package) hard-breaks every one of them at
// RESOLUTION time, and `endSession` -> `clearAll` would then ReferenceError on
// `localStorage` under node anyway (#107 review R2/F1).
//
// So the browser half is INVERTED behind a registration seam: this module owns
// the latch, the tagged rejection and the invocation; the app registers what to
// actually do via `setAuthExpiredHandler` ($lib/auth/install-401-recovery,
// installed once from src/routes/+layout.svelte). With no handler registered —
// the migration-script case — a 401 is still a clean tagged rejection, just
// without teardown or navigation. Guarded by request.node-import.spec.ts.
//
// WRITE PATHS (#107 review F6) — a 401 mid-save rejects exactly like a read, and
// the write queues (rsvp/attendance/repertoire, profile edit+move) keep showing
// their own "couldn't save" affordance for the frame before the redirect lands.
// That is the INTENDED handling for this slice: the redirect IS the recovery, and
// it bounds the damage. Re-routing every write surface's error copy through
// isAuthExpiredError is a separate change, deliberately not taken here. The
// write side of the recovery is pinned by "a 401 on a WRITE (POST) fires the
// same recovery as a read" in request.auth-expired.spec.ts.

// The tag itself lives in a dependency-free sibling so consumers that only need
// to RECOGNISE an expired session don't inherit this module's `$lib/entu-config`
// -> `$env/dynamic/public` chain. Re-exported so every existing
// `from '$lib/entu/request'` call site is unaffected.
export { AuthExpiredError, isAuthExpiredError } from './auth-expired';

// Module-scope single-flight guard: a fanned-out load (agenda et al.) can hit
// 401 on every concurrent request. Only the FIRST one ends the session and
// redirects; every caller still rejects with AuthExpiredError.
//
// The latch is RELEASED when the navigation settles (#107 review F5). Leaving it
// set collapses a concurrent burst — the point of the guard — but then
// permanently disables recovery for the rest of the page's lifetime as soon as
// the goto does NOT complete (a navigation cancelled or beaten by an in-flight
// one, or the user simply staying in the SPA): every later 401 would skip both
// the teardown and the redirect, silently. Releasing on settle keeps the burst
// collapsed (the whole burst resolves before the goto promise does) and restores
// recovery afterwards. `Promise.resolve(...)` wraps the goto because a mocked /
// void-returning navigation has no `.finally`.
let redirectingToSignIn = false;

/**
 * What to DO about an expired session — teardown + navigation. Registered by the
 * app shell (`$lib/auth/install-401-recovery`), left null everywhere else (node
 * migration scripts, unit tests of pure data modules). Returning a promise makes
 * the single-flight latch release when the navigation settles.
 */
export type AuthExpiredHandler = () => void | Promise<unknown>;

let onAuthExpired: AuthExpiredHandler | null = null;

/** Register (or, with `null`, unregister) the browser-side 401 recovery. */
export function setAuthExpiredHandler(fn: AuthExpiredHandler | null): void {
	onAuthExpired = fn;
}

function handleAuthExpired401(): never {
	// No handler → no latch either: nothing is in flight to collapse a burst
	// against, and latching would be a permanent no-op switch.
	if (onAuthExpired && !redirectingToSignIn) {
		redirectingToSignIn = true;
		void Promise.resolve(onAuthExpired()).finally(() => {
			redirectingToSignIn = false;
		});
	}
	throw new AuthExpiredError();
}

/**
 * Compose an Entu API URL for a given db. `pathAndQuery` is everything after the
 * db segment, e.g. `entity?_type.string=member&limit=1`. Leading slashes are
 * tolerated so callers can pass `/entity/...` or `entity/...`.
 */
export function entuUrl(db: string, pathAndQuery: string): string {
	if (!db) throw new Error('entuUrl: db (collective) is required — no default db exists');
	const path = pathAndQuery.replace(/^\/+/, '');
	// #258 — a path whose `entity` segment ends with NO id ('entity/' terminal,
	// or 'entity/?query') is never legitimate: entu-api resolves it to the
	// entity LIST route, which answers 200 with a plausible-looking
	// `{ entities: [...] }` body — an empty id silently becomes a wrong answer
	// instead of an error. This exact shape shipped twice: #255's B2 fail-open
	// rights read, and the library's blank copy names/chains from lending rows
	// with '' copy/member refs. Refuse it HERE, at the single composition
	// point, before any caller can even obtain the URL, let alone send it. Do
	// NOT "simplify" this away — the intentional list query ('entity?...',
	// no trailing slash) is a distinct, legitimate shape and must keep working.
	if (/^entity\/(\?|$)/.test(path)) {
		throw new Error(`entuUrl: empty entity id composed into path '${pathAndQuery}' (#258)`);
	}
	return `${ENTU_API_BASE}${db}/${path}`;
}

/**
 * Browser-direct authenticated fetch against a specific db. Merges the Bearer
 * token into headers; callers supply the token (from `$lib/auth/storage.getToken`)
 * so this stays a pure, testable seam.
 */
export function entuFetch(
	db: string,
	pathAndQuery: string,
	token: string,
	init: RequestInit = {},
	fetchImpl: typeof fetch = fetch
): Promise<Response> {
	return fetchImpl(entuUrl(db, pathAndQuery), {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
			...init.headers
		}
	}).then((res) => {
		// Only a 401 is auth-expiry; every other status (incl. 5xx) and any
		// network rejection stay exactly as they were — plain data-loading
		// failures for callers to handle as before (regression guard).
		if (res.status === 401) return handleAuthExpired401();
		return res;
	});
}

// (*MVOX:Josquin*)
