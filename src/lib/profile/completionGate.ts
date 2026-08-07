// T4.8/#28 — the mandatory-completion gate (SSOT). A signed-in member without a
// `name` on her DOMAIN-visibility profile entity is directed to /profile and is NOT
// shown as a member anywhere until it is filled. This module is the ONE app-wide
// answer to "is she complete?" — every member-display surface consumes the same
// store, and the single layout read + single redirect enforce it, so no surface can
// re-derive the gate and open a hole.
//
// TWO-CASE SEPARATION (must NOT share a code path — #28 ruling):
//   Case 1 — genuinely no name yet (incl. the transition window): the PASSIVE
//            read/routing path. `hasDomainName` returns 'incomplete'; the layout
//            redirects to /profile and member affordances are withheld. NEVER throws;
//            NEVER classifies Case 2. It cannot false-positive the transition window
//            because it never asks WHEN the entity was created — any nameless-at-
//            runtime domain profile is uniformly "not yet completed".
//   Case 2 — a completion WRITE that reports success yet does not persist the name:
//            the ACTIVE write path. `assertDomainNamePersisted` is a post-condition
//            called from applyProfileSave after the domain name-save reports success;
//            it re-reads and THROWS `DomainNameInconsistencyError` if the name is
//            still absent (fail loud, never a silent empty row).
//
// PREDICATE RULES (load-bearing):
//   - Read ONLY `profilesByLevel(profiles).domain?.name` — the entity whose OWN
//     `_sharing === 'domain'`. NEVER `resolveField`: a public-tier name is written to
//     BOTH the domain and public buckets (entu-api aggregate.js:152-155), so
//     `resolveField` would let a public-only name PASS, contradicting the ruling.
//   - `''` (missing OR empty name; profileData.ts:192-193) is 'incomplete' — both
//     Case 1, undistinguished on the read path.
//   - NEVER fall back to `person.name`/`person.email` (post-T4.3 they are unreadable
//     to other members anyway; the non-display IS the mechanism).
//
// FUTURE surfaces: a surface presenting the CURRENT user as a member subscribes to
// `completionGateStore`; a surface presenting OTHER members uses pure name-presence
// (hasDomainName-style) — NEVER `_created` (private-bucket-only, unreadable
// cross-member; entu-api aggregate.js:51-64 promote only `_parent`/`_type`).
//
// RED (T4.8): the decision helpers below are STUBS that throw 'not implemented' so
// the specs compile and FAIL on assertions. `completionGateStore`/`resetGate`/
// `DomainNameInconsistencyError` are real (consumers + tests reference them). GREEN
// (Josquin) fills the bodies, composing on T4.6's read helpers (listMyProfiles /
// profilesByLevel) — NO new create machinery (YELLOW-T4.4.1). This module reads
// only; it never carries the profile-create rights literal, so the sole-create-path
// structural guard's allowlist stays exactly the two T4.4/T4.5 entries.

import { writable, type Writable } from 'svelte/store';
import type { MyProfile } from './profileData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// NOTE (module-graph): the READ helpers (`listMyProfiles`) live in `profileData`,
// which statically pulls the Entu request/`$env` chain. This module is imported by
// every member-display surface JUST for `completionGateStore` (the SSOT), so it must
// NOT drag that chain into `+layout`/`+page` at module-eval time (doing so breaks the
// layout/page specs that legitimately never touch `$env`). Hence: the sync predicate
// inlines the domain-entity lookup (no `profilesByLevel` import), and the async
// helpers `import('./profileData')` LAZILY inside their bodies. Same behaviour, no
// eager $env dependency.

export type GateState = 'loading' | 'complete' | 'incomplete';

/** THE app-wide answer. 'loading' until a genuine read flips it (no-flash discipline). */
export const completionGateStore: Writable<GateState> = writable('loading');

/** Return the store to its unresolved state — called on every (re)selection. */
export function resetGate(): void {
	completionGateStore.set('loading');
}

/**
 * THE predicate — pure, SSOT. Reads ONLY the entity whose OWN `_sharing === 'domain'`.
 * Missing domain entity OR empty domain name → 'incomplete' (both Case 1). NEVER
 * `resolveField` (a public-only name must not pass). NEVER `person.*`. NEVER throws.
 */
export function hasDomainName(profiles: MyProfile[]): 'complete' | 'incomplete' {
	// Read ONLY the entity whose OWN _sharing === 'domain'. `''` (missing or empty
	// name; profileData.ts:192-193) → 'incomplete'. NEVER `resolveField` — a public-tier
	// name is written to BOTH the domain and public buckets, so resolveField would let a
	// public-only name wrongly PASS (RECON C Q2). The domain lookup is inlined (rather
	// than `profilesByLevel(profiles).domain`) to keep this module off the $env chain
	// (see module note); last-wins on a duplicate-domain anomaly matches profilesByLevel.
	let domain: MyProfile | undefined;
	for (const p of profiles) if (p._sharing === 'domain') domain = p;
	// TRIM before testing — a whitespace-only name ('   ') is effectively empty and must
	// NOT satisfy the mandatory-name gate (matches canSave's `.trim()` convention on the
	// edit form; profile/+page.svelte). Missing OR blank/whitespace domain name → Case 1.
	return domain && domain.name.trim() !== '' ? 'complete' : 'incomplete';
}

/**
 * Async read + classify for the layout store population. FAIL-SAFE: any
 * `listMyProfiles` throw (non-2xx / unknown `_sharing`) → 'loading', NEVER a false
 * 'incomplete' (a transient blip must not redirect a completed member). Does NOT
 * write the store; the caller writes under its own staleness guard.
 */
export async function resolveGate(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<GateState> {
	// FAIL-SAFE: any listMyProfiles throw (non-2xx / unknown _sharing) → 'loading',
	// NEVER a false 'incomplete' (a transient blip must not redirect a completed member).
	try {
		const { listMyProfiles } = await import('./profileData');
		return hasDomainName(await listMyProfiles(cfg, personId, fetchImpl));
	} catch {
		return 'loading';
	}
}

/** Case 2 — the write-path structural inconsistency (fail loud, never an empty row). */
export class DomainNameInconsistencyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DomainNameInconsistencyError';
	}
}

/**
 * Case 2 post-condition. Called from `applyProfileSave` AFTER a domain name-save
 * reports success: re-read and REQUIRE `hasDomainName === 'complete'`; if a create/
 * save reported success yet read-back shows no name, THROW
 * `DomainNameInconsistencyError` naming the object + operation. This is the ONLY
 * place a post-gate nameless domain profile can be caught — the passive read path
 * (Case 1) never runs it, so the transition window can never manufacture a false
 * Case 2.
 */
export async function assertDomainNamePersisted(
	cfg: EntuCfg,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const { listMyProfiles } = await import('./profileData');
	if (hasDomainName(await listMyProfiles(cfg, personId, fetchImpl)) !== 'complete') {
		throw new DomainNameInconsistencyError(
			`completion gate: domain profile for person ${personId} reported a successful ` +
				`name save but read-back returned no domain name`
		);
	}
}

// (*MVOX:Tallis* — RED stubs + interface)
// (*MVOX:Josquin* — GREEN implementation)
