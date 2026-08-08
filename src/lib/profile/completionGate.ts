// T4.8/#28 — the mandatory-completion gate (SSOT). A signed-in member without a
// visible `name` (domain OR public tier — #58) is directed to /profile and is NOT
// shown as a member anywhere until it is filled. This module is the ONE app-wide
// answer to "is she complete?" — every member-display surface consumes the same
// store, and the single layout read + single redirect enforce it, so no surface can
// re-derive the gate and open a hole.
//
// TWO-CASE SEPARATION (must NOT share a code path — #28 ruling):
//   Case 1 — genuinely no name yet (incl. the transition window): the PASSIVE
//            read/routing path. `hasVisibleName` returns 'incomplete'; the layout
//            redirects to /profile and member affordances are withheld. NEVER throws;
//            NEVER classifies Case 2. It cannot false-positive the transition window
//            because it never asks WHEN the entity was created — any nameless-at-
//            runtime domain+public pair is uniformly "not yet completed".
//   Case 2 — a completion WRITE that reports success yet does not persist the name:
//            the ACTIVE write path. `assertDomainNamePersisted` is a post-condition
//            called from applyProfileSave after a DOMAIN name-save specifically
//            reports success; it re-reads and THROWS `DomainNameInconsistencyError`
//            if the domain name is still absent (fail loud, never a silent empty
//            row). Deliberately stays domain-SPECIFIC (uses `hasDomainName`, not the
//            widened `hasVisibleName`) — it is verifying that *that* save persisted,
//            not re-deriving the general gate; widening it would let a stale public
//            name mask a genuine domain round-trip failure.
//
// #58 — Mihkel ruling (2026-08-08): "i got forced to profile page, because i didnt
// had domain shared name. but I have public, and that should also count as good." A
// name at domain OR public tier satisfies the READ-path gate (Case 1 /
// `hasVisibleName`) — a public name is readable by fellow members too, a fortiori.
// This does NOT touch Case 2 (`hasDomainName`/`assertDomainNamePersisted`), which
// stays domain-specific by design (see above).
//
// PREDICATE RULES (load-bearing):
//   - `hasDomainName` reads ONLY the entity whose OWN `_sharing === 'domain'`.
//   - `hasVisibleName` reads ONLY the entities whose OWN `_sharing` is 'domain' OR
//     'public' — 'complete' if EITHER holds a non-blank name. NEVER `private`.
//   - NEVER `resolveField` for either: narrower-wins would let a PRIVATE-only name
//     leak through (private sorts narrowest), contradicting both rulings.
//   - `''` (missing OR empty name; profileData.ts:192-193) does not count — both
//     Case 1, undistinguished on the read path.
//   - NEVER fall back to `person.name`/`person.email` (post-T4.3 they are unreadable
//     to other members anyway; the non-display IS the mechanism).
//
// FUTURE surfaces: a surface presenting the CURRENT user as a member subscribes to
// `completionGateStore`; a surface presenting OTHER members uses pure name-presence
// (`hasVisibleName`-style) — NEVER `_created` (private-bucket-only, unreadable
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
 * The domain-SPECIFIC predicate — pure. Reads ONLY the entity whose OWN
 * `_sharing === 'domain'`. Missing domain entity OR empty domain name → 'incomplete'.
 * NEVER `resolveField` (a public-only name must not pass this specific check). NEVER
 * `person.*`. NEVER throws.
 *
 * #58: this is now ONLY the domain-specific building block that `hasVisibleName`
 * (below) widens for the app-wide Case-1 gate, plus the exact predicate Case 2's
 * `assertDomainNamePersisted` needs (it verifies a DOMAIN save specifically
 * persisted — see the module header's two-case-separation note). It is no longer
 * the app-wide gate itself; callers wanting "is she complete" want `hasVisibleName`.
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
 * #58 — THE Case-1 app-wide "is she complete" predicate — pure, SSOT. Reads ONLY
 * the entities whose OWN `_sharing` is 'domain' or 'public'; 'complete' if EITHER
 * holds a non-blank (trimmed) name. Missing/empty on both → 'incomplete'. NEVER
 * `private`. NEVER `resolveField` (narrower-wins would let a PRIVATE-only name pass
 * — private sorts narrowest — which must never satisfy the gate).
 *
 * Widens `hasDomainName` per Mihkel's #58 ruling: a public-tier name is readable by
 * fellow members too, so it satisfies the read/routing gate exactly as a domain-tier
 * name does. Does NOT replace `hasDomainName` — that predicate remains the domain-
 * SPECIFIC check `assertDomainNamePersisted` (Case 2) needs.
 */
export function hasVisibleName(profiles: MyProfile[]): 'complete' | 'incomplete' {
	let domain: MyProfile | undefined;
	let pub: MyProfile | undefined;
	for (const p of profiles) {
		if (p._sharing === 'domain') domain = p;
		else if (p._sharing === 'public') pub = p;
	}
	const domainOk = domain !== undefined && domain.name.trim() !== '';
	const publicOk = pub !== undefined && pub.name.trim() !== '';
	return domainOk || publicOk ? 'complete' : 'incomplete';
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
	// #58: uses the WIDENED hasVisibleName (domain OR public), not hasDomainName.
	try {
		const { listMyProfiles } = await import('./profileData');
		return hasVisibleName(await listMyProfiles(cfg, personId, fetchImpl));
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
// (*MVOX:Palestrina* — #58: hasVisibleName widening, domain OR public)
