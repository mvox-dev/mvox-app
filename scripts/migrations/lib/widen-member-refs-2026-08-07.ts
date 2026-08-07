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
/** Frozen drift tripwire — the live domain-tier member count as of the #20
 * follow-up probe (2026-08-07). `enumerateDomainMembers` HALTs loudly if the
 * live count differs (a member added/converted/deleted since the probe). */
export const EXPECTED_DOMAIN_MEMBER_COUNT = 245;

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ── Bundle A: prop-def _sharing writes ────────────────────────────────────────

export type PropDefTarget = { id: string; name: 'person' | 'section' };
export const PROPDEF_TARGETS: PropDefTarget[] = [
	{ id: PERSON_PROPDEF_ID, name: 'person' },
	{ id: SECTION_PROPDEF_ID, name: 'section' }
];

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

/** Step-0 enumeration (READ-ONLY) for Bundle B. One page of every `member`;
 * keep only `_sharing==='domain'`; HALT if the drift tripwire count doesn't
 * match, or the page was truncated, or any domain-tier member is somehow
 * missing its own `_sharing` value's `_id` (would mean the filter itself is
 * unreliable — refuse to invent one). */
export async function enumerateDomainMembers(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<MemberTarget[]> {
	const res = await entuFetch(cfg.db, 'entity?_type.string=member&props=_id,_sharing&limit=1000', cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`enumerateDomainMembers: member census GET failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{ _id: string; _sharing?: Array<{ _id: string; string: string }> }>;
	};
	const all = body.entities ?? [];
	if (typeof body.count === 'number' && body.count !== all.length) {
		throw new Error(`enumerateDomainMembers: member census page truncated — server count=${body.count} but entities.length=${all.length}; refuse a partial page`);
	}

	const domainMembers = all.filter((m) => m._sharing?.[0]?.string === 'domain');
	if (domainMembers.length !== EXPECTED_DOMAIN_MEMBER_COUNT) {
		throw new Error(
			`enumerateDomainMembers: domain-tier member count DRIFT — expected ${EXPECTED_DOMAIN_MEMBER_COUNT}, got ${domainMembers.length}; refuse to proceed, re-verify before running again`
		);
	}

	const targets: MemberTarget[] = [];
	for (const m of domainMembers) {
		const sharing = m._sharing?.[0];
		if (!sharing?._id || sharing.string !== 'domain') {
			throw new Error(`enumerateDomainMembers: member ${m._id} (filtered as domain-tier) has no readable _sharing._id — refuse to invent one, inspect manually`);
		}
		targets.push({ memberId: m._id, sharingPropId: sharing._id, sharingValue: sharing.string });
	}
	return targets;
}

export type TouchSaveLedgerEntry = { memberId: string; status: 'touched' | 'failed'; newSharingPropId?: string; message?: string };

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
 * bundles. Carries the explicit prop-def ids + the 245 count per PO's ask
 * (Gama, #20 17:54 comment) — not just "re-aggregate affected members". */
export function renderPlan(memberTargets: MemberTarget[]): string {
	const lines: string[] = [];
	lines.push('#20 follow-up — widen member.person/section refs DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push('── Bundle A: WOULD SET _sharing:domain on 2 member prop-defs (schema-level, both currently absent)');
	for (const t of PROPDEF_TARGETS) {
		lines.push(`   member.${t.name} prop-def ${t.id}: WOULD POST _sharing:'domain' (currently absent — plain create, no replace)`);
	}
	lines.push('');
	lines.push('── Bundle B: WOULD TOUCH-SAVE every domain-tier member to re-trigger aggregation (GATED on Bundle A succeeding for BOTH prop-defs)');
	lines.push(`   ${memberTargets.length} domain-tier members in scope (expected ${EXPECTED_DOMAIN_MEMBER_COUNT}). Excludes the 1 private-tier member (fixture B) — unaffected by this gap.`);
	lines.push('   Mechanic: atomic single POST per member, re-asserting its OWN existing `_sharing:domain` value under its OWN existing property _id (insertProperties soft-deletes + re-inserts in one call — no multi-value risk). `_sharing` chosen over `status` because the 115 legacy orphan members carry no `status` value at all.');
	lines.push('');
	lines.push('WHY #36 new-member creation needs no fix: inviteData.ts:213 writes person._sharing as an explicit PER-VALUE override in the SAME create POST — that bypasses the prop-def default-bucketing path entirely (explicit _sharing always wins over prop-def-driven inheritance/defaulting). Confirmed mechanism, not a coincidence. member.section still has no per-value override on that path though — the schema fix (Bundle A) covers it going forward for every member, invite-created or not.');
	lines.push('');
	lines.push(`Totals: 2 prop-def writes planned, ${memberTargets.length} member touch-saves planned. Writes issued this run: 0.`);
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
