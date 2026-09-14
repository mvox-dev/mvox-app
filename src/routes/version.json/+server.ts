// #350 — build stamp: every deployment answers at the fixed unauthenticated
// URL /version.json with the branch name and FULL commit sha it was built
// from, read from CF Pages build env (CF_PAGES_BRANCH / CF_PAGES_COMMIT_SHA).
//
// SPIKE-settled fork (b): a prerendered +server.ts. The root layout sets
// ssr = false (this is a pure client-side SPA — see src/routes/+layout.ts),
// which would otherwise exclude every route from the adapter-static build.
// `prerender = true` opts THIS route back in: it is evaluated once, at build
// time, against the CF Pages build environment, and emitted as a static
// version.json asset. vite.config.ts is untouched (no fence repin needed).
//
// The pure stamp logic lives in ./build-stamp.ts, not here — see that file's
// header comment for why (SvelteKit's endpoint-export allow-list forbids any
// export on a +server.ts other than the HTTP verbs/prerender/config/etc., or
// an underscore-prefixed name).
import { buildStamp } from './build-stamp';

export const prerender = true;

export function GET(): Response {
	const stamp = buildStamp(process.env);
	return new Response(JSON.stringify(stamp), {
		headers: { 'content-type': 'application/json' }
	});
}
