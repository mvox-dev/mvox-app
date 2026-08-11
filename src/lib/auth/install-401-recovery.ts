// #107 (review R2/F1) — the BROWSER half of the Entu 401 recovery.
//
// `$lib/entu/request` is shared code: the browser imports it, and so do the 37
// scripts under scripts/migrations/ that run under plain node/tsx (every shipped
// `pnpm migrate:*` target plus every polyphony probe). Their resolve hook
// (scripts/migrations/lib/loader.mjs) maps `$env/dynamic/public` and `$lib/*` and
// nothing else, so a top-level `$app/navigation` import in request.ts is an
// ERR_MODULE_NOT_FOUND for all of them — and `localStorage` does not exist under
// node either, so the teardown would throw even if resolution succeeded.
//
// Hence the split: request.ts keeps the latch, the tagged rejection and the
// call; THIS module owns the app-framework-bound effects and registers them.
// Install it exactly once, from the root layout's module scope — before any page
// component can issue an Entu read.
import { goto } from '$app/navigation';
import { endSession } from './session';
import { currentSessionExpiredSignInHref } from './session-expired';
import { setAuthExpiredHandler } from '$lib/entu/request';

/**
 * Wire the 401 recovery into `entuFetch`:
 *   1. end the stale session — storage AND the in-memory authStore, via the SAME
 *      `endSession` an explicit sign-out uses (provider preserved, so re-auth
 *      pre-selects it);
 *   2. redirect to sign-in carrying the session-expired flag AND the return path.
 *
 * The returned `goto` promise is what releases request.ts's single-flight latch,
 * so a concurrent burst still collapses to one redirect while a LATER 401 (the
 * navigation cancelled, or the user staying in the SPA) recovers again.
 */
export function install401Recovery(): void {
	setAuthExpiredHandler(() => {
		endSession({ preserveProvider: true });
		return goto(currentSessionExpiredSignInHref());
	});
}

// (*MVOX:Josquin*)
