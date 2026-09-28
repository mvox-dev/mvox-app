// #434 — `entuFetch`'s per-call options, in a DEPENDENCY-FREE sibling.
//
// Same reasoning as `auth-expired.ts` (request.ts's own header spells it out):
// a consumer that only needs to NAME the read-cache opt-in must not inherit
// request.ts's `$lib/entu-config` -> `$env/dynamic/public` chain. `agendaData.ts`
// is exactly that consumer — a pure orchestration module whose spec mocks the
// readers precisely to stay off `$env` — and so is any future slice's screen
// module. Both symbols are re-exported from `$lib/entu/request`, so every
// existing `from '$lib/entu/request'` call site is unaffected.

export interface EntuFetchOptions {
	/**
	 * #434 — opt IN to the read-through cache ($lib/entu/readCache): an online
	 * GET stores its body, and a network rejection serves the last-seen copy
	 * instead of failing. Default OFF, and the default is load-bearing (#434
	 * review round 1): a cache-backed read is a decision taken per reader, for a
	 * reader a member is meant to still see offline. Off, this call keeps exactly
	 * the promise chain it had before #434 and touches no cache at all.
	 *
	 * Do NOT turn it on for a GET whose body is short-lived (`property/{id}`
	 * answers a signed file url valid for 60 seconds) or for a GET that is a STEP
	 * inside a write (the lookup of the property `_id`s a following POST or
	 * DELETE targets): a stale answer there is an expired url handed to the
	 * browser or a wrong write, not a last-seen screen. readCache.ts's header
	 * spells both out.
	 *
	 * #434 slice 2 review round, finding 2 — a SHARED reader never hard-wires
	 * this. It takes `opts` as a parameter defaulting to `{}` and threads it
	 * down; the flag is switched on at the call site that owns the screen with
	 * the "as of <time>" line. The allowlist of files that may name
	 * `CACHED_READ` at all is pinned in readCache.optin-fence.spec.ts.
	 */
	cache?: boolean;
}

/**
 * #434 — the opt-in read-cache flag, named so a reader's call site reads as the
 * decision it is: `entuFetch(db, path, token, {}, fetchImpl, CACHED_READ)`.
 */
export const CACHED_READ: EntuFetchOptions = { cache: true };

// (*MVOX:Josquin* — #434 slice 2 review round, finding 2)
