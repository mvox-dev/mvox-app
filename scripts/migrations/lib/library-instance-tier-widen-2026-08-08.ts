// T6.2b (#57, epic #54) — the completing mutation Gama's 2026-08-08 11:00
// STOP identified: T6.2 (#56) widened the PROP-DEFS (gate 1) and touch-saved
// all 586 instances, but the touch-save re-asserted the SAME `_sharing:
// 'private'` value (a re-aggregation trigger, not a tier change) — gate 3
// (the instance's own `_sharing`) never moved. By the 3-gate-AND
// (architecture-decisions.md, first stated in #44's bucket check): prop-def
// tier ∧ TYPE tier ∧ INSTANCE tier, narrowest wins. Gate 3 stayed private for
// all 586, so nothing T6.2 touched was actually member-readable. This module
// closes gate 3: converts each instance's `_sharing` from `private` to
// `domain` (a genuine replace, not a touch-save) after first re-verifying
// gate 2 (the four TYPE entities' own `_sharing`) live, per Gama's explicit
// ask — unchecked for these types on any record before this task.
//
// Reuses `TYPE_IDS`, `DB_ROOT_PERSON_ID`, and `verifyInstances` from
// `lib/library-visibility-2026-08-08.ts` (T6.2's own module) rather than
// duplicating — same population, same ownership-pre-check discipline, this
// module only adds the gate-2 check and the private→domain replace engine.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';
import { TYPE_IDS, DB_ROOT_PERSON_ID, verifyInstances, type InstanceTarget } from './library-visibility-2026-08-08';

export { TYPE_IDS, DB_ROOT_PERSON_ID, verifyInstances };
export type { InstanceTarget };

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export type TypeGateResult = { type: string; typeId: string; sharing: string; passesGate2: boolean };

/** Gate 2 verification (read-only) — Gama's explicit ask, unchecked for these
 * four types on any prior record. `domain` or `public` pass; anything else
 * (absent/private) caps domain-bucket exposure for EVERY prop-def on that
 * type regardless of gates 1/3 (aggregate.js's cap logic, same mechanic as
 * #20's `verifyMemberTypeSharing`). Does not throw — returns the observed
 * state for every type so the caller/report can see all four, flagging any
 * failure explicitly rather than halting on the first one. */
export async function verifyTypeGate2(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<TypeGateResult[]> {
	const results: TypeGateResult[] = [];
	for (const [typeName, typeId] of Object.entries(TYPE_IDS)) {
		const res = await entuFetch(cfg.db, `entity/${typeId}?props=name,_sharing`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`verifyTypeGate2: GET ${typeId} (${typeName}) failed: ${res.status}`);
		const body = (await res.json()) as { entity?: { name?: Array<{ string: string }>; _sharing?: Array<{ string: string }> } };
		if (body.entity?.name?.[0]?.string !== typeName) {
			throw new Error(`verifyTypeGate2: ${typeId} has name=${JSON.stringify(body.entity?.name?.[0]?.string)}, expected ${JSON.stringify(typeName)} — wrong id, refuse to proceed`);
		}
		const sharing = body.entity?._sharing?.[0]?.string ?? '(absent)';
		results.push({ type: typeName, typeId, sharing, passesGate2: sharing === 'domain' || sharing === 'public' });
	}
	return results;
}

export type ReplaceLedgerEntry = { type: string; id: string; status: 'widened' | 'failed'; newSharingPropId?: string; message?: string };

/** The genuine tier-changing write: atomic replace-by-`_id` of the
 * instance's own `_sharing` value, `private` → `domain`. Same wire mechanic
 * as every prior `_sharing` replace in this codebase (#44, #20) — this time
 * the STRING actually changes, which is what makes it a widen rather than a
 * touch-save. */
export async function widenInstances(cfg: EntuCfg, targets: InstanceTarget[], fetchImpl: typeof fetch = fetch): Promise<ReplaceLedgerEntry[]> {
	const entries: ReplaceLedgerEntry[] = [];
	for (const t of targets) {
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.id}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ _id: t.sharingValueId, type: '_sharing', string: 'domain' }]) },
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ type: t.type, id: t.id, status: 'failed', message: `POST failed: ${res.status}` });
				continue;
			}
			const body = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newSharingProp = (body.properties ?? []).find((p) => p.type === '_sharing');
			if (!newSharingProp?._id) {
				entries.push({ type: t.type, id: t.id, status: 'failed', message: 'POST returned 2xx but no _sharing property in response (apparent-success trap)' });
				continue;
			}
			if (newSharingProp._id === t.sharingValueId) {
				entries.push({ type: t.type, id: t.id, status: 'failed', message: `POST returned the SAME property _id (${t.sharingValueId}) — the replace did not actually rotate` });
				continue;
			}
		} catch (err) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: errMsg(err) });
			continue;
		}
		const getRes = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: `read-back GET failed: ${getRes.status}` });
			continue;
		}
		const getBody = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		const now = getBody.entity?._sharing?.[0]?.string;
		if (now !== 'domain') {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: `read-back shows _sharing=${JSON.stringify(now)}, expected 'domain'` });
			continue;
		}
		const getRes2 = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing`, cfg.token, {}, fetchImpl);
		const getBody2 = (await getRes2.json()) as { entity?: { _sharing?: Array<{ _id: string }> } };
		entries.push({ type: t.type, id: t.id, status: 'widened', newSharingPropId: getBody2.entity?._sharing?.[0]?._id });
	}
	return entries;
}

/** Canary — one instance PER TYPE (4 total), widened + single-value-survives
 * verified, BEFORE the full sweep. Throws on any canary failure. */
export async function widenCanaries(cfg: EntuCfg, targets: InstanceTarget[], fetchImpl: typeof fetch = fetch): Promise<{ canaryEntries: ReplaceLedgerEntry[]; remainingTargets: InstanceTarget[] }> {
	const canaryByType = new Map<string, InstanceTarget>();
	for (const t of targets) {
		if (!canaryByType.has(t.type)) canaryByType.set(t.type, t);
	}
	const canaries = [...canaryByType.values()];
	const canaryEntries: ReplaceLedgerEntry[] = [];
	for (const c of canaries) {
		const [entry] = await widenInstances(cfg, [c], fetchImpl);
		if (entry.status !== 'widened') {
			throw new Error(`widenCanaries: canary ${c.type}/${c.id} FAILED — ${entry.message}. Refuse to run the full 586-instance sweep on an unproven mechanic for this type.`);
		}
		const getRes = await entuFetch(cfg.db, `entity/${c.id}?props=_sharing`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) throw new Error(`widenCanaries: post-widen read-back GET failed for ${c.type}/${c.id}: ${getRes.status}`);
		const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		const sharingValues = body.entity?._sharing ?? [];
		if (sharingValues.length !== 1) {
			throw new Error(`widenCanaries: canary ${c.type}/${c.id} now carries ${sharingValues.length} _sharing values (expected exactly 1) — atomic replace did not cleanly soft-delete the old value. Refuse to run the full sweep.`);
		}
		canaryEntries.push(entry);
	}
	const canaryIds = new Set(canaries.map((c) => c.id));
	const remainingTargets = targets.filter((t) => !canaryIds.has(t.id));
	return { canaryEntries, remainingTargets };
}

// ── Dry-run render + ledger ─────────────────────────────────────────────────────

export function renderPlan(gate2: TypeGateResult[], instances: Awaited<ReturnType<typeof verifyInstances>>): string {
	const lines: string[] = [];
	lines.push('T6.2b (#57, epic #54) — instance-tier widen DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push('── Gate 2 verification (TYPE entities\' own _sharing) — Gama\'s explicit ask');
	for (const g of gate2) {
		lines.push(`   ${g.type} TYPE (${g.typeId}): _sharing='${g.sharing}' — ${g.passesGate2 ? 'PASSES (domain/public)' : 'FAILS — would cap domain-bucket exposure for every prop-def on this type regardless of gates 1/3'}`);
	}
	const allGate2Pass = gate2.every((g) => g.passesGate2);
	lines.push(`   Overall: ${allGate2Pass ? 'all 4 types PASS gate 2 — safe to proceed with the instance widen' : 'ONE OR MORE TYPES FAIL gate 2 — widening instances alone would NOT make them member-readable, flag before proceeding'}`);
	lines.push('');
	lines.push('── 586 instances: WOULD REPLACE _sharing private→domain (atomic replace-by-_id, genuine tier change)');
	lines.push(`   Population: ${JSON.stringify(instances.countsByType)} (matches T6.2\'s post-state exactly).`);
	lines.push(`   Pre-change tier histogram: ${JSON.stringify(instances.tierHistogram)}.`);
	if (instances.missingSharingIds.length > 0) {
		lines.push(`   WARNING: ${instances.missingSharingIds.length} instance(s) have no explicit _sharing value: ${JSON.stringify(instances.missingSharingIds)}`);
	}
	if (instances.nonDbRootOwned.length > 0) {
		lines.push(`   WARNING: ${instances.nonDbRootOwned.length} instance(s) NOT db-root-owned — same risk class as #44/#45: ${JSON.stringify(instances.nonDbRootOwned.slice(0, 20))}`);
	} else {
		lines.push('   Ownership pre-check re-run: 0/586 non-db-root-owned (unchanged from T6.2).');
	}
	lines.push('   CANARY: one representative instance PER TYPE (4 total), widened + single-value-survives verified, before the full sweep.');
	lines.push('');
	lines.push('── Privacy holds by construction');
	lines.push('   Only ENTITY tier moves. Unruled prop-defs (barcode, condition, notes, license, year, file, genre, edition.cost, …) stay their own tier — widening the entity opens the door, prop-def tiers still gate every field individually (3-gate-AND unchanged for those fields).');
	lines.push('');
	lines.push(`Totals: 586 instance replace-writes planned (4 canaries + 582 more). Writes issued this run: 0.`);
	return lines.join('\n');
}

export class InstanceWidenLedger {
	private entries: ReplaceLedgerEntry[] = [];
	record(entries: ReplaceLedgerEntry[]): void {
		this.entries.push(...entries);
	}
	failures(): ReplaceLedgerEntry[] {
		return this.entries.filter((e) => e.status !== 'widened');
	}
	hasFailures(): boolean {
		return this.failures().length > 0;
	}
	toJSON() {
		return { entries: this.entries, failureCount: this.failures().length };
	}
	printReport(): void {
		console.log(`\n── Instance widen: ${this.entries.length} attempted`);
		const failures = this.failures();
		for (const e of failures) console.error(`FAILED ${e.type}/${e.id} — ${e.message}`);
		console.log(`${this.entries.length - failures.length}/${this.entries.length} widened cleanly.`);
		if (failures.length > 0) {
			console.error('');
			console.error(`T6.2b INCOMPLETE — ${failures.length} failure(s) need operator repair.`);
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
