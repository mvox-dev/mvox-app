// #20 follow-up — close the roster rights-narrowing gap diagnosed in
// probe-person-propdef-sharing-2026-08-07.ts / probe-person-tier-invite-vs-t3-1-
// 2026-08-07.ts (committed c2f189f). `member.person` and `member.section`
// prop-defs carry NO explicit `_sharing`, so per entu-api's bucket-placement cap
// (`aggregate.js:113-121`), both properties are written ONLY into the private
// bucket at write-time aggregation — never the domain bucket a non-owner
// authenticated reader receives (`entity.js:573-586 cleanupEntity`). Uniform
// across every `member` instance by construction; not specific to any one
// population. The #36 invite-creation path is UNAFFECTED going forward: it
// writes `person._sharing:'domain'` as an explicit PER-VALUE override at create
// time (`inviteData.ts:213`), which bypasses the prop-def's default bucketing
// entirely — an explicit `_sharing` in the same POST always wins over
// inheritance/defaulting (confirmed mechanism, not luck; see
// `docs/architecture/entu-rights-and-visibility-model.md` §3 for the general
// rule this is an instance of).
//
// Two bundles, real separation (mirrors t3-1-singer-provision.ts's proven
// shape), because they have different blast radii and Bundle B depends on
// Bundle A having actually landed:
//
//   Bundle A (schema, tiny blast radius): POST `_sharing:'domain'` onto the
//   `member.person` and `member.section` prop-def ENTITIES. Both currently have
//   NO existing `_sharing` value (confirmed live — sharingValueId null for
//   both), so this is a plain create-POST, not a replace.
//
//   Bundle B (data, 245-instance blast radius, GATED on Bundle A succeeding for
//   BOTH prop-defs): buckets are write-time SNAPSHOTS, not read-time computed
//   (`entu-rights-and-visibility-model.md` §1) — Bundle A alone does not
//   retroactively fix any already-aggregated member. Every currently
//   domain-tier member needs a genuine write to re-trigger `aggregateEntity`.
//   Touch-save mechanic: an ATOMIC single `POST entity/{id}` carrying the
//   member's OWN EXISTING `_sharing` property `_id` plus its OWN EXISTING
//   string value (re-asserting, not changing, the value) — `insertProperties`
//   soft-deletes the value named by the included `_id` and inserts the new one
//   in the same call (`entity.js:440-444`), so this is a real write (fresh
//   aggregation) with ZERO multi-value risk, unlike a bare re-POST of the same
//   value (which would APPEND a duplicate — the Q5 multi-value-append trap).
//   `_sharing` was chosen over `status` (originally planned) because the 115
//   legacy orphan members carry NO `status` value at all (confirmed live — the
//   first dry-run attempt HALTed loudly on this rather than inventing one), but
//   EVERY domain-tier member by definition has an explicit `_sharing` value
//   (that's the filter criterion) — matches Q2's own canonical recommendation
//   ("pick `_sharing` re-write as the canonical touch-save",
//   `docs/migration/findings/phase-b-api-probes-2026-05-20.md` in the sibling
//   repo). `_sharing` is a rightType property (needs `_owner`, not just
//   `_editor`) — the executing credential (ENTU_API_KEY/PO db-root) has already
//   proven it holds `_owner` on the 128 T3.1-converted members (it performed
//   their private→domain `_sharing` conversion itself) and on script-created
//   entities generally; any per-entity exception is captured as a per-record
//   ledger failure, never aborts the whole sweep.
//   The 1 currently-private-tier member (fixture B) is explicitly excluded —
//   her private bucket already carries everything to her own _viewer/_owner,
//   unaffected by this gap.
//
// SCOPE — INTENDED, NOT INCIDENTAL (Gama, #20 18:11 comment): the touch-save
// population includes the 115 legacy orphan members (no `person` ref, carry a
// raw `name` string with no matching prop-def since bundle 3). Their `section`
// reference goes from private-bucketed to domain-readable as a DIRECT,
// INTENDED consequence of this fix — sections are roster-bound data, and
// domain-readability for `section` is exactly what this fix is FOR, applied
// uniformly (not carved out for orphans). Their `name` value stays invisible
// outside the private bucket regardless — it has no prop-def at all (removed
// in T3.1 bundle 3), and `aggregateEntity`'s bucket-placement loop iterates
// the TYPE's prop-def list (`aggregate.js:111` `for (const d in definition)`)
// — a raw property with no corresponding prop-def entry is never considered
// for domain/public placement, it only ever exists in `private` (seeded there
// unconditionally by `propertiesToEntity`). `verifyMemberNamePropDefAbsent`
// below re-confirms this live rather than relying on memory of bundle 3.
//
// VERIFICATION CAVEAT (read before trusting a "converted" ledger line): every
// call in this script runs under ENTU_API_KEY (PO/db-root), which is `_owner`
// on effectively all these entities and therefore ALWAYS reads the private
// bucket (cleanupEntity's first branch) — this credential can never observe
// what a plain non-owner domain-tier reader actually receives. Per-member
// "verified" below means: the touch-save POST returned 200 AND issued a NEW
// property `_id` for `_sharing` (proof a genuine write happened, which
// unconditionally re-runs `aggregateEntity` per source — not merely assumed).
// It does NOT mean "empirically confirmed a domain reader now sees `person`".
// That last-mile confirmation needs a real non-omniscient read (Mihkel's
// browser, same pattern as #20/#29) — same caveat this team has hit before on
// rights-tier work (session 32 `member-tier-rights-visibility` probe; the T3.1
// bundle-1+2 independent re-verification also ultimately relied on a
// db-root-vs-fresh-query cross-check, not a genuinely restricted credential).

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

export const PERSON_PROPDEF_ID = '69c7ea4b8489bfcb0e819f05';
export const SECTION_PROPDEF_ID = '69c7ea4c8489bfcb0e819f27';
export const MEMBER_TYPE_ID = '69c7ea4a8489bfcb0e819edd';

/** Frozen drift-check baseline — the exact 245 domain-tier member ids read
 * live during the #20 follow-up probe (2026-08-07, committed
 * `seed-results/widen-member-refs-2026-08-07-dry-2026-08-07T15-02-29-868Z.json`).
 * Per Gama's #20 18:11 comment: the touch-save population must be stated
 * explicitly, not left as bare arithmetic ("247"). `enumerateDomainMembers`
 * uses this as a set-based drift-check (C4-1/C5-1 discipline — the hardcoded
 * list is a check against live data, not itself authoritative): any baseline
 * id no longer domain-tier live is a HALT, named individually; any live
 * domain-tier member NOT in this list is a genuine delta since the probe,
 * surfaced separately as `newSinceBaselineIds` rather than silently folded
 * into the count. */
export const BASELINE_DOMAIN_MEMBER_IDS: string[] = [
	'69c7f8728489bfcb0e81b085', '69c7f8728489bfcb0e81b091', '69c7f8728489bfcb0e81b09b', '69c7f8738489bfcb0e81b0a5', '69c7f8738489bfcb0e81b0af', '69c7f8738489bfcb0e81b0b9',
	'69c7f8738489bfcb0e81b0c3', '69c7f8748489bfcb0e81b0d7', '69c7f8748489bfcb0e81b0e1', '69c7f8748489bfcb0e81b0eb', '69c7f8748489bfcb0e81b0f5', '69c7f8748489bfcb0e81b0ff',
	'69c7f8758489bfcb0e81b109', '69c7f8758489bfcb0e81b11d', '69c7f8758489bfcb0e81b127', '69c7f8758489bfcb0e81b131', '69c7f8768489bfcb0e81b13b', '69c7f8768489bfcb0e81b145',
	'69c7f8768489bfcb0e81b14f', '69c7f8768489bfcb0e81b159', '69c7f8778489bfcb0e81b16d', '69c7f8778489bfcb0e81b177', '69c7f8778489bfcb0e81b181', '69c7f8778489bfcb0e81b18b',
	'69c7f8778489bfcb0e81b195', '69c7f8778489bfcb0e81b19f', '69c7f8788489bfcb0e81b1c9', '69c7f8788489bfcb0e81b1d5', '69c7f8798489bfcb0e81b1df', '69c7f8798489bfcb0e81b1e9',
	'69c7f8798489bfcb0e81b1f3', '69c7f8798489bfcb0e81b1fd', '69c7f8798489bfcb0e81b211', '69c7f87a8489bfcb0e81b21b', '69c7f87a8489bfcb0e81b225', '69c7f87a8489bfcb0e81b22f',
	'69c7f87a8489bfcb0e81b239', '69c7f87a8489bfcb0e81b243', '69c7f87b8489bfcb0e81b24d', '69c7f87b8489bfcb0e81b261', '69c7f87b8489bfcb0e81b26b', '69c7f87b8489bfcb0e81b275',
	'69c7f87b8489bfcb0e81b27f', '69c7f87c8489bfcb0e81b289', '69c7f87c8489bfcb0e81b293', '69c7f87c8489bfcb0e81b29d', '69c7f87c8489bfcb0e81b2b1', '69c7f87c8489bfcb0e81b2bb',
	'69c7f87d8489bfcb0e81b2c5', '69c7f87d8489bfcb0e81b2cf', '69c7f87e8489bfcb0e81b304', '69c7f87e8489bfcb0e81b310', '69c7f87e8489bfcb0e81b31a', '69c7f87e8489bfcb0e81b324',
	'69c7f87f8489bfcb0e81b32e', '69c7f87f8489bfcb0e81b338', '69c7f87f8489bfcb0e81b342', '69c7f87f8489bfcb0e81b34c', '69c7f87f8489bfcb0e81b356', '69c7f87f8489bfcb0e81b360',
	'69c7f8808489bfcb0e81b36a', '69c7f8808489bfcb0e81b37e', '69c7f8808489bfcb0e81b388', '69c7f8808489bfcb0e81b392', '69c7f8808489bfcb0e81b39c', '69c7f8808489bfcb0e81b3a6',
	'69c7f8818489bfcb0e81b3b0', '69c7f8818489bfcb0e81b3ba', '69c7f8818489bfcb0e81b3c4', '69c7f8818489bfcb0e81b3ce', '69c7f8818489bfcb0e81b3d8', '69c7f8818489bfcb0e81b3e2',
	'69c7f8828489bfcb0e81b3f6', '69c7f8828489bfcb0e81b400', '69c7f8828489bfcb0e81b40a', '69c7f8828489bfcb0e81b414', '69c7f8828489bfcb0e81b41e', '69c7f8828489bfcb0e81b428',
	'69c7f8838489bfcb0e81b432', '69c7f8838489bfcb0e81b43c', '69c7f8838489bfcb0e81b446', '69c7f8838489bfcb0e81b450', '69c7f8838489bfcb0e81b45a', '69c7f8838489bfcb0e81b464',
	'69c7f8848489bfcb0e81b478', '69c7f8848489bfcb0e81b482', '69c7f8848489bfcb0e81b48c', '69c7f8858489bfcb0e81b496', '69c7f8858489bfcb0e81b4a0', '69c7f8858489bfcb0e81b4aa',
	'69c7f8858489bfcb0e81b4b4', '69c7f8858489bfcb0e81b4be', '69c7f8858489bfcb0e81b4c8', '69c7f8868489bfcb0e81b4d2', '69c7f8868489bfcb0e81b4dc', '69c7f8868489bfcb0e81b4e6',
	'69c7f8878489bfcb0e81b510', '69c7f8878489bfcb0e81b51c', '69c7f8878489bfcb0e81b526', '69c7f8878489bfcb0e81b530', '69c7f8888489bfcb0e81b53a', '69c7f8888489bfcb0e81b54e',
	'69c7f8888489bfcb0e81b558', '69c7f8888489bfcb0e81b562', '69c7f8888489bfcb0e81b56c', '69c7f8898489bfcb0e81b576', '69c7f8898489bfcb0e81b58a', '69c7f8898489bfcb0e81b594',
	'69c7f8898489bfcb0e81b59e', '69c7f88a8489bfcb0e81b5a8', '69c7f88a8489bfcb0e81b5b2', '69c7f88a8489bfcb0e81b5c6', '69c7f88a8489bfcb0e81b5d0', '69c7f88b8489bfcb0e81b5da',
	'69c7f88b8489bfcb0e81b5e4', '6a0dd24b4ff8277cd4306172', '6a0dd24b4ff8277cd430617c', '6a0dd24b4ff8277cd4306186', '6a0dd24c4ff8277cd4306190', '6a0dd24c4ff8277cd430619a',
	'6a0dd24c4ff8277cd43061a4', '6a0dd24c4ff8277cd43061ae', '6a0dd24c4ff8277cd43061b8', '6a0dd24d4ff8277cd43061c2', '6a0dd24d4ff8277cd43061cc', '6a0dd24d4ff8277cd43061d6',
	'6a0dd24d4ff8277cd43061e0', '6a0dd24d4ff8277cd43061ea', '6a0dd24d4ff8277cd43061f4', '6a0dd24d4ff8277cd43061fe', '6a0dd24e4ff8277cd4306208', '6a0dd24e4ff8277cd4306212',
	'6a0dd24e4ff8277cd430621c', '6a0dd24e4ff8277cd4306226', '6a0dd24f4ff8277cd4306230', '6a0dd24f4ff8277cd430623a', '6a0dd24f4ff8277cd4306244', '6a0dd24f4ff8277cd430624e',
	'6a0dd24f4ff8277cd4306258', '6a0dd24f4ff8277cd4306262', '6a0dd24f4ff8277cd430626c', '6a0dd2504ff8277cd4306276', '6a0dd2504ff8277cd4306280', '6a0dd2504ff8277cd430628a',
	'6a0dd2504ff8277cd4306294', '6a0dd2504ff8277cd430629e', '6a0dd2504ff8277cd43062a8', '6a0dd2514ff8277cd43062b2', '6a0dd2514ff8277cd43062bc', '6a0dd2514ff8277cd43062c6',
	'6a0dd2514ff8277cd43062d0', '6a0dd2524ff8277cd43062da', '6a0dd2524ff8277cd43062e4', '6a0dd2524ff8277cd43062ee', '6a0dd2524ff8277cd43062f8', '6a0dd2524ff8277cd4306302',
	'6a0dd2524ff8277cd430630c', '6a0dd2534ff8277cd4306316', '6a0dd2534ff8277cd4306320', '6a0dd2534ff8277cd430632a', '6a0dd2534ff8277cd4306334', '6a0dd2534ff8277cd430633e',
	'6a0dd2544ff8277cd4306348', '6a0dd2544ff8277cd4306352', '6a0dd2544ff8277cd430635c', '6a0dd2544ff8277cd4306366', '6a0dd2544ff8277cd4306370', '6a0dd2554ff8277cd430637a',
	'6a0dd2554ff8277cd4306384', '6a0dd2554ff8277cd430638e', '6a0dd2554ff8277cd4306398', '6a0dd2564ff8277cd43063a2', '6a0dd2564ff8277cd43063ac', '6a0dd2564ff8277cd43063b6',
	'6a0dd2564ff8277cd43063c0', '6a0dd2574ff8277cd43063ca', '6a0dd2574ff8277cd43063d4', '6a0dd2574ff8277cd43063de', '6a0dd2574ff8277cd43063e8', '6a0dd2574ff8277cd43063f2',
	'6a0dd2574ff8277cd43063fc', '6a0dd2584ff8277cd4306406', '6a0dd2584ff8277cd4306410', '6a0dd2584ff8277cd430641a', '6a0dd2584ff8277cd4306424', '6a0dd2584ff8277cd430642e',
	'6a0dd2584ff8277cd4306438', '6a0dd2594ff8277cd4306442', '6a0dd2594ff8277cd430644c', '6a0dd2594ff8277cd4306456', '6a0dd2594ff8277cd4306460', '6a0dd2594ff8277cd430646a',
	'6a0dd2594ff8277cd4306474', '6a0dd25a4ff8277cd430647e', '6a0dd25a4ff8277cd4306488', '6a0dd25a4ff8277cd4306492', '6a0dd25a4ff8277cd430649c', '6a0dd25a4ff8277cd43064a6',
	'6a0dd25a4ff8277cd43064b0', '6a0dd25b4ff8277cd43064ba', '6a0dd25b4ff8277cd43064c4', '6a0dd25b4ff8277cd43064ce', '6a0dd25b4ff8277cd43064d8', '6a0dd25b4ff8277cd43064e2',
	'6a0dd25b4ff8277cd43064ec', '6a0dd25c4ff8277cd43064f6', '6a0dd25c4ff8277cd4306500', '6a0dd25c4ff8277cd430650a', '6a0dd25c4ff8277cd4306514', '6a0dd25c4ff8277cd430651e',
	'6a0dd25d4ff8277cd4306528', '6a0dd25d4ff8277cd4306532', '6a0dd25d4ff8277cd430653c', '6a0dd25d4ff8277cd4306546', '6a0dd25d4ff8277cd4306550', '6a0dd25d4ff8277cd430655a',
	'6a0dd25e4ff8277cd4306564', '6a0dd25e4ff8277cd430656e', '6a0dd25e4ff8277cd4306578', '6a0dd25e4ff8277cd4306582', '6a0dd25e4ff8277cd430658c', '6a0dd25e4ff8277cd4306596',
	'6a0dd25e4ff8277cd43065a0', '6a0dd25f4ff8277cd43065aa', '6a0dd25f4ff8277cd43065b4', '6a0dd25f4ff8277cd43065be', '6a0dd25f4ff8277cd43065c8', '6a0dd25f4ff8277cd43065d2',
	'6a0dd25f4ff8277cd43065dc', '6a0dd2604ff8277cd43065e6', '6a0dd2604ff8277cd43065f0', '6a0dd2604ff8277cd43065fa', '6a0dd2604ff8277cd4306604', '6a0dd2604ff8277cd430660e',
	'6a0dd2604ff8277cd4306618', '6a12036c4ff8277cd4306b34', '6a12036c4ff8277cd4306b45', '6a12036d4ff8277cd4306b56', '6a12036d4ff8277cd4306b67', '6a12036d4ff8277cd4306b78',
	'6a12036d4ff8277cd4306b89', '6a12036e4ff8277cd4306b9a', '6a12036e4ff8277cd4306bab', '6a2ba6c84cd971291c5d5320', '6a2fdb434cd971291c5d5e85'
];

/** Frozen drift tripwire — the live domain-tier member count as of the #20
 * follow-up probe (2026-08-07). `enumerateDomainMembers` HALTs loudly if the
 * live count is BELOW this (a baseline member deleted/converted). Derived
 * from `BASELINE_DOMAIN_MEMBER_IDS.length` so the two can never drift apart. */
export const EXPECTED_DOMAIN_MEMBER_COUNT = BASELINE_DOMAIN_MEMBER_IDS.length;

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ── Bundle A: prop-def _sharing writes ────────────────────────────────────────

export type PropDefTarget = { id: string; name: 'person' | 'section' };
export const PROPDEF_TARGETS: PropDefTarget[] = [
	{ id: PERSON_PROPDEF_ID, name: 'person' },
	{ id: SECTION_PROPDEF_ID, name: 'section' }
];

/** Step-0 enumeration (READ-ONLY) for Bundle A. Bentham YELLOW-A (pre-execution
 * review, 2026-08-07): bucket exposure is a three-gate AND — prop-def sharing
 * (what this script sets), the TYPE's own sharing (a CAP: `aggregate.js:94/115`
 * — if the type entity has no `_sharing` at all, it nukes exposure for EVERY
 * prop-def on that type regardless of what this script does), and the
 * instance's own sharing (already satisfied for the 245 domain-tier members).
 * Without this check, gate 2 being unset would make all 247 writes accomplish
 * nothing while the ledger reports "2 set, 245 touched" — an apparent-success
 * trap. HALTs if the `member` type entity's own `_sharing` is absent (neither
 * 'domain' nor 'public' — the only two values the cap logic in
 * aggregate.js:113-121 lets pass through to the propdef-level tier). Read-only;
 * no live mutation. Returns the OBSERVED value (Gama, #20 18:11 comment: the
 * ledger must record the actual value read, not just a pass/fail boolean) so
 * callers can put the real string in the ledger/artifact, e.g. `'domain'` —
 * not merely "guard passed". */
export async function verifyMemberTypeSharing(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${MEMBER_TYPE_ID}?props=_sharing,name`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`verifyMemberTypeSharing: GET ${MEMBER_TYPE_ID} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _sharing?: Array<{ string: string }>; name?: Array<{ string: string }> } };
	const name = body.entity?.name?.[0]?.string;
	if (name !== 'member') {
		throw new Error(`verifyMemberTypeSharing: ${MEMBER_TYPE_ID} has name=${JSON.stringify(name)}, expected 'member' — wrong entity id, refuse to proceed`);
	}
	const typeSharing = body.entity?._sharing?.[0]?.string;
	if (typeSharing !== 'domain' && typeSharing !== 'public') {
		throw new Error(
			`verifyMemberTypeSharing: member TYPE entity ${MEMBER_TYPE_ID} has _sharing=${JSON.stringify(typeSharing)} (expected 'domain' or 'public') — ` +
				`per aggregate.js's cap logic, an absent type-level _sharing nukes domain-bucket exposure for EVERY prop-def on this type regardless of ` +
				`the prop-def-level fix below. Proceeding would make all writes a no-op while the ledger falsely reports success. Refuse to proceed — ` +
				`re-verify manually / route back to a schema call before running this migration.`
		);
	}
	return typeSharing;
}

/** Step-0 enumeration (READ-ONLY). Gama, #20 18:11 comment: confirm live —
 * don't assume from memory of bundle 3 — that `member.name` genuinely has no
 * prop-def, which is WHY the 115 orphan members' raw `name` string can never
 * reach the domain bucket (aggregate.js's bucket-placement loop iterates the
 * type's prop-def list; a value with no matching prop-def entry is never
 * considered, see the module header's SCOPE note). HALTs if a `name` prop-def
 * is unexpectedly found (would mean bundle 3 was reverted or never landed —
 * changes the scope statement above). */
export async function verifyMemberNamePropDefAbsent(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<void> {
	const res = await entuFetch(cfg.db, `entity?_parent.reference=${MEMBER_TYPE_ID}&name.string=name&props=_id&limit=10`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`verifyMemberNamePropDefAbsent: GET failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const found = body.entities ?? [];
	if (found.length > 0) {
		throw new Error(
			`verifyMemberNamePropDefAbsent: member.name prop-def UNEXPECTEDLY FOUND (${found.map((e) => e._id).join(', ')}) — ` +
				`the orphan-name-stays-invisible scope claim in this module's header no longer holds, refuse to proceed until re-verified manually`
		);
	}
}

/** Step-0 enumeration (READ-ONLY) for Bundle A. HALTs if either prop-def
 * already carries a `_sharing` value (live state has moved since the probe —
 * re-verify manually, don't blind-POST over an existing value). */
export async function verifyPropDefsAbsent(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	for (const t of PROPDEF_TARGETS) {
		const res = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing,name`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`verifyPropDefsAbsent: GET ${t.id} (${t.name}) failed: ${res.status}`);
		const body = (await res.json()) as { entity?: { _sharing?: Array<{ string: string }>; name?: Array<{ string: string }> } };
		const name = body.entity?.name?.[0]?.string;
		if (name !== t.name) {
			throw new Error(`verifyPropDefsAbsent: ${t.id} has name=${JSON.stringify(name)}, expected ${JSON.stringify(t.name)} — wrong entity id, refuse to proceed`);
		}
		const sharing = body.entity?._sharing?.[0]?.string;
		if (sharing != null) {
			throw new Error(
				`verifyPropDefsAbsent: member.${t.name} prop-def ${t.id} already has _sharing=${JSON.stringify(sharing)} — live state has moved since the #20 follow-up probe, refuse to proceed, re-verify manually`
			);
		}
	}
}

export type PropDefLedgerEntry = { propDefId: string; name: 'person' | 'section'; status: 'set' | 'failed'; message?: string };

/** Bundle A engine. Per prop-def: plain create-POST (no existing value to
 * replace), then read-back-PROVE it now reads `_sharing==='domain'`. */
export async function widenPropDefs(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<PropDefLedgerEntry[]> {
	const entries: PropDefLedgerEntry[] = [];
	for (const t of PROPDEF_TARGETS) {
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.id}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: '_sharing', string: 'domain' }]) },
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: `POST failed: ${res.status}` });
				continue;
			}
		} catch (err) {
			entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: errMsg(err) });
			continue;
		}

		try {
			const getRes = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing`, cfg.token, {}, fetchImpl);
			if (!getRes.ok) {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: `read-back GET failed: ${getRes.status} — POST may have succeeded, verify by API` });
				continue;
			}
			const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
			const now = body.entity?._sharing?.[0]?.string;
			if (now !== 'domain') {
				entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: `read-back shows _sharing=${JSON.stringify(now)}, expected 'domain'` });
				continue;
			}
		} catch (err) {
			entries.push({ propDefId: t.id, name: t.name, status: 'failed', message: errMsg(err) });
			continue;
		}

		entries.push({ propDefId: t.id, name: t.name, status: 'set' });
	}
	return entries;
}

// ── Bundle B: touch-save re-aggregation sweep ─────────────────────────────────

export type MemberTarget = { memberId: string; sharingPropId: string; sharingValue: string };

export type EnumerationResult = {
	targets: MemberTarget[];
	/** Live domain-tier member ids present in the frozen probe baseline (245, unchanged). */
	unchangedFromBaselineCount: number;
	/** Live domain-tier member ids NOT in the probe baseline — created/converted since
	 * 2026-08-07's probe. Named individually (Gama, #20 18:11) rather than silently
	 * folded into the touch-save count. Every one of these STILL needs touching:
	 * Bundle A for THIS run has not executed yet at enumeration time (script
	 * sequencing — Bundle A always runs before this function), so no member
	 * currently enumerated was ever aggregated under the fixed prop-def, regardless
	 * of whether it's a #36-created member whose OWN `person._sharing` is already
	 * an explicit per-value 'domain' — that only helps `person`'s own entity-level
	 * exposure, not whether THIS member's domain bucket carries the `person`
	 * reference at all (that's gated by member.person's prop-def, which Bundle A
	 * fixes, and by this member's own aggregation having run AFTER that fix). */
	newSinceBaselineIds: string[];
	/** Domain-tier members with NO `person` reference — the 115 legacy orphans (or
	 * whatever that population currently measures live). Their `section` value
	 * becomes domain-readable as an INTENDED consequence of this fix (see module
	 * header SCOPE note); their `name` value has no prop-def and stays invisible
	 * regardless (see `verifyMemberNamePropDefAbsent`). */
	orphanMemberIds: string[];
};

/** Step-0 enumeration (READ-ONLY) for Bundle B. One page of every `member`;
 * keep only `_sharing==='domain'`; HALT if the drift tripwire count doesn't
 * match, the page was truncated, any domain-tier member is somehow missing its
 * own `_sharing` value's `_id`, OR any baseline member from the 2026-08-07
 * probe is no longer domain-tier live (named individually, not just a count
 * mismatch — matches the C4-1/C5-1 discipline: the hardcoded baseline is a
 * drift-check, not blindly trusted, but a MISSING baseline id is real drift
 * that a bare count comparison could mask). */
export async function enumerateDomainMembers(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<EnumerationResult> {
	const res = await entuFetch(cfg.db, 'entity?_type.string=member&props=_id,_sharing,person&limit=1000', cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`enumerateDomainMembers: member census GET failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{ _id: string; _sharing?: Array<{ _id: string; string: string }>; person?: Array<{ reference: string }> }>;
	};
	const all = body.entities ?? [];
	if (typeof body.count === 'number' && body.count !== all.length) {
		throw new Error(`enumerateDomainMembers: member census page truncated — server count=${body.count} but entities.length=${all.length}; refuse a partial page`);
	}

	const domainMembers = all.filter((m) => m._sharing?.[0]?.string === 'domain');
	if (domainMembers.length < EXPECTED_DOMAIN_MEMBER_COUNT) {
		throw new Error(
			`enumerateDomainMembers: domain-tier member count DRIFT (shrunk) — expected at least ${EXPECTED_DOMAIN_MEMBER_COUNT} (probe baseline), got ${domainMembers.length}; refuse to proceed, re-verify before running again`
		);
	}

	const liveIds = new Set(domainMembers.map((m) => m._id));
	const missingFromBaseline = BASELINE_DOMAIN_MEMBER_IDS.filter((id) => !liveIds.has(id));
	if (missingFromBaseline.length > 0) {
		throw new Error(
			`enumerateDomainMembers: ${missingFromBaseline.length} member(s) from the 2026-08-07 probe baseline are no longer domain-tier live — ` +
				`${missingFromBaseline.join(', ')} — refuse to proceed, re-verify individually (deleted? converted back to private?)`
		);
	}
	const baselineSet = new Set(BASELINE_DOMAIN_MEMBER_IDS);
	const newSinceBaselineIds = domainMembers.filter((m) => !baselineSet.has(m._id)).map((m) => m._id);

	const targets: MemberTarget[] = [];
	const orphanMemberIds: string[] = [];
	for (const m of domainMembers) {
		const sharing = m._sharing?.[0];
		if (!sharing?._id || sharing.string !== 'domain') {
			throw new Error(`enumerateDomainMembers: member ${m._id} (filtered as domain-tier) has no readable _sharing._id — refuse to invent one, inspect manually`);
		}
		targets.push({ memberId: m._id, sharingPropId: sharing._id, sharingValue: sharing.string });
		if (!m.person?.[0]?.reference) {
			orphanMemberIds.push(m._id);
		}
	}

	return {
		targets,
		unchangedFromBaselineCount: BASELINE_DOMAIN_MEMBER_IDS.length,
		newSinceBaselineIds,
		orphanMemberIds
	};
}

export type TouchSaveLedgerEntry = { memberId: string; status: 'touched' | 'failed'; newSharingPropId?: string; message?: string };

/** Bentham note B (pre-execution review, non-blocking, cheap to close):
 * touch-save ONE member as a canary before the full 245-sweep. Performs the
 * SAME atomic replace as `touchSaveDomainMembers`, then an EXTRA read-back
 * asserting the member now carries EXACTLY ONE `_sharing` value (not two —
 * would mean the atomic replace didn't actually soft-delete the old value,
 * i.e. the multi-value-append trap fired despite the `_id`-carrying replace).
 * Throws on ANY failure (canary is a hard gate, not a per-record ledger entry
 * — if the canary fails, the full sweep must not run at all). Callers should
 * invoke this on `targets[0]` before `touchSaveDomainMembers(cfg, targets.slice(1), ...)`
 * and merge the canary's own ledger entry in front of the rest. */
export async function touchSaveCanary(cfg: EntuCfg, target: MemberTarget, fetchImpl: typeof fetch = fetch): Promise<TouchSaveLedgerEntry> {
	const [entry] = await touchSaveDomainMembers(cfg, [target], fetchImpl);
	if (entry.status !== 'touched') {
		throw new Error(`touchSaveCanary: canary member ${target.memberId} FAILED — ${entry.message}. Refuse to run the full 245-sweep on an unproven mechanic.`);
	}

	const getRes = await entuFetch(cfg.db, `entity/${target.memberId}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`touchSaveCanary: post-touch read-back GET failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ _id: string; string: string }> } };
	const sharingValues = body.entity?._sharing ?? [];
	if (sharingValues.length !== 1) {
		throw new Error(
			`touchSaveCanary: canary member ${target.memberId} now carries ${sharingValues.length} _sharing values (expected exactly 1) — ` +
				`the atomic replace did not cleanly soft-delete the old value. Refuse to run the full 245-sweep; this member needs manual repair first.`
		);
	}
	if (sharingValues[0].string !== 'domain') {
		throw new Error(`touchSaveCanary: canary member ${target.memberId}'s single surviving _sharing value is ${JSON.stringify(sharingValues[0].string)}, expected 'domain'`);
	}

	return entry;
}

/** Bundle B engine. Per member: atomic single-POST replace of `_sharing` (same
 * `_id`, same string 'domain') — a genuine write with zero multi-value risk.
 * `_sharing` is a rightType property (needs `_owner` on this specific entity,
 * not just `_editor`) — a 403 here is a real, informative per-record failure
 * (this credential doesn't own that particular member), captured in the
 * ledger, never aborts the sweep. See the module header's VERIFICATION
 * CAVEAT: "touched" means the write landed and issued a fresh property `_id`
 * (proof a real aggregation re-run happened), NOT an empirically-confirmed
 * domain-bucket read. */
export async function touchSaveDomainMembers(cfg: EntuCfg, targets: MemberTarget[], fetchImpl: typeof fetch = fetch): Promise<TouchSaveLedgerEntry[]> {
	const entries: TouchSaveLedgerEntry[] = [];
	for (const t of targets) {
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.memberId}`,
				cfg.token,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify([{ _id: t.sharingPropId, type: '_sharing', string: t.sharingValue }])
				},
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ memberId: t.memberId, status: 'failed', message: `touch-save POST failed: ${res.status}` });
				continue;
			}
			const body = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newSharingProp = (body.properties ?? []).find((p) => p.type === '_sharing');
			if (!newSharingProp?._id) {
				entries.push({ memberId: t.memberId, status: 'failed', message: 'touch-save POST returned 2xx but no _sharing property in response (apparent-success trap)' });
				continue;
			}
			if (newSharingProp._id === t.sharingPropId) {
				entries.push({ memberId: t.memberId, status: 'failed', message: `touch-save POST returned the SAME property _id (${t.sharingPropId}) — the replace did not actually rotate, no fresh write occurred` });
				continue;
			}
			entries.push({ memberId: t.memberId, status: 'touched', newSharingPropId: newSharingProp._id });
		} catch (err) {
			entries.push({ memberId: t.memberId, status: 'failed', message: errMsg(err) });
		}
	}
	return entries;
}

// ── Dry-run render + ledger ────────────────────────────────────────────────────

/** PURE dry-run render — the operator's per-run verify surface for both
 * bundles. Carries the explicit prop-def ids + the disambiguated touch-save
 * population (unchanged-from-baseline count, individually-named deltas,
 * orphan-section-visibility scope statement) per Gama's #20 18:11 comment —
 * not bare "247" arithmetic. `observedMemberTypeSharing` is the ACTUAL value
 * read live (Gama: record the observed value, not a pass/fail boolean). */
export function renderPlan(enumeration: EnumerationResult, observedMemberTypeSharing: string): string {
	const { targets, unchangedFromBaselineCount, newSinceBaselineIds, orphanMemberIds } = enumeration;
	const lines: string[] = [];
	lines.push('#20 follow-up — widen member.person/section refs DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push(`── Pre-check: member TYPE entity's own _sharing observed live = '${observedMemberTypeSharing}' (gate 2 of the 3-gate AND — PASSED, not assumed)`);
	lines.push('');
	lines.push('── Bundle A: WOULD SET _sharing:domain on 2 member prop-defs (schema-level, both currently absent)');
	for (const t of PROPDEF_TARGETS) {
		lines.push(`   member.${t.name} prop-def ${t.id}: WOULD POST _sharing:'domain' (currently absent — plain create, no replace)`);
	}
	lines.push('');
	lines.push('── Bundle B: WOULD TOUCH-SAVE every domain-tier member to re-trigger aggregation (GATED on Bundle A succeeding for BOTH prop-defs)');
	lines.push(`   Touch-save population: ${targets.length} domain-tier members total.`);
	lines.push(`     - ${unchangedFromBaselineCount} unchanged from the 2026-08-07 probe baseline.`);
	if (newSinceBaselineIds.length === 0) {
		lines.push('     - 0 new since the probe — population is EXACTLY the probe baseline, unchanged.');
	} else {
		lines.push(`     - ${newSinceBaselineIds.length} NEW since the probe (named individually, not folded silently into the count):`);
		for (const id of newSinceBaselineIds) {
			lines.push(`         ${id}: STILL NEEDS touching. Bundle A for THIS run has not executed yet at enumeration time (script sequencing), so no member enumerated here was ever aggregated under the fixed prop-def — true regardless of creation path, including a #36-created member whose own person._sharing is already an explicit per-value 'domain' (that only covers person's own exposure, not whether THIS member's domain bucket carries the person/section references).`);
		}
	}
	lines.push(`   ${orphanMemberIds.length} of these are legacy orphan members (no \`person\` ref) — their \`section\` value becomes domain-readable as an INTENDED consequence of this fix (sections are roster-bound data; see module header SCOPE note), their \`name\` value has no prop-def and stays invisible regardless (verifyMemberNamePropDefAbsent confirmed this live, not from memory of bundle 3).`);
	lines.push('   Excludes the 1 private-tier member (fixture B) — unaffected by this gap.');
	lines.push('   Mechanic: atomic single POST per member, re-asserting its OWN existing `_sharing:domain` value under its OWN existing property _id (insertProperties soft-deletes + re-inserts in one call — no multi-value risk). `_sharing` chosen over `status` because the 115 legacy orphan members carry no `status` value at all.');
	lines.push('');
	lines.push('WHY #36 new-member creation needs no fix going forward (AFTER this migration lands): inviteData.ts:213 writes person._sharing as an explicit PER-VALUE override in the SAME create POST — that bypasses the prop-def default-bucketing path entirely (explicit _sharing always wins over prop-def-driven inheritance/defaulting). Confirmed mechanism, not a coincidence. member.section still has no per-value override on that path though — the schema fix (Bundle A) covers it going forward for every member, invite-created or not.');
	lines.push('');
	lines.push(`Totals: 2 prop-def writes planned, ${targets.length} member touch-saves planned. Writes issued this run: 0.`);
	return lines.join('\n');
}

/** Collects + reports per-record outcomes loudly — no aggregate "done" substitutes. */
export class WidenLedger {
	private propDefEntries: PropDefLedgerEntry[] = [];
	private touchEntries: TouchSaveLedgerEntry[] = [];

	recordPropDef(entries: PropDefLedgerEntry[]): void {
		this.propDefEntries.push(...entries);
	}
	recordTouch(entries: TouchSaveLedgerEntry[]): void {
		this.touchEntries.push(...entries);
	}

	propDefFailures(): PropDefLedgerEntry[] {
		return this.propDefEntries.filter((e) => e.status !== 'set');
	}
	touchFailures(): TouchSaveLedgerEntry[] {
		return this.touchEntries.filter((e) => e.status !== 'touched');
	}
	hasFailures(): boolean {
		return this.propDefFailures().length > 0 || this.touchFailures().length > 0;
	}

	toJSON(): {
		propDefEntries: PropDefLedgerEntry[];
		touchEntries: TouchSaveLedgerEntry[];
		propDefFailureCount: number;
		touchFailureCount: number;
	} {
		return {
			propDefEntries: this.propDefEntries,
			touchEntries: this.touchEntries,
			propDefFailureCount: this.propDefFailures().length,
			touchFailureCount: this.touchFailures().length
		};
	}

	printReport(): void {
		console.log(`\n── Bundle A (prop-defs): ${this.propDefEntries.length} attempted`);
		for (const e of this.propDefEntries) {
			const line = `${e.status.toUpperCase()} member.${e.name} (${e.propDefId})${e.message ? ` — ${e.message}` : ''}`;
			if (e.status === 'set') console.log(line);
			else console.error(line);
		}
		if (this.touchEntries.length > 0) {
			console.log(`\n── Bundle B (touch-save sweep): ${this.touchEntries.length} attempted`);
			const failures = this.touchFailures();
			for (const e of failures) {
				console.error(`${e.status.toUpperCase()} member=${e.memberId} — ${e.message}`);
			}
			console.log(`${this.touchEntries.length - failures.length}/${this.touchEntries.length} touched cleanly.`);
		}

		const pFail = this.propDefFailures();
		const tFail = this.touchFailures();
		if (pFail.length > 0 || tFail.length > 0) {
			console.error('');
			console.error(`WIDEN INCOMPLETE — ${pFail.length} prop-def failure(s), ${tFail.length} touch-save failure(s) need operator repair.`);
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
