// #68 (epic #37) Phase 2 — db-root `_owner` backfill. Governance: Mihkel's
// ruling on #68, verbatim: "1 is correct -- all objects must be under dev
// team's control. this installation is sandbox now, but should transform to
// template at the finish line." Add-only: existing `_owner`/`_editor` values
// are never touched or removed — this is a pure POST-appends write (the
// natural multi-value semantics for a reference-type property), never a
// DELETE-then-POST replace. `_sharing` is untouched by construction (this
// module never writes that property).
//
// Population: the 72 entities Phase 1's probe flagged
// (scripts/migrations/probes/probe-68-db-root-owner-inventory-2026-08-09.ts),
// loaded from its committed result artifact — same frozen-baseline +
// live-drift-check discipline as #46's orphan pre-check, so a population
// that moved between Phase 1 and Phase 2 execution is caught, not silently
// missed.

import { readFileSync } from 'node:fs';
import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

export const DB_ROOT_PERSON_ID = '69bcfd8e9c031ab8e6ce8079';

const BASELINE_ARTIFACT_PATH = 'scripts/migrations/seed-results/probe-68-db-root-owner-inventory-2026-08-08T21-49-01-000Z.json';
const EXPECTED_BASELINE_COUNT = 72;

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export type OwnerRef = { reference: string; entity_type?: string; string?: string };
export type FlaggedTarget = { type: string; typeId: string; id: string; name: string; classification: string };

type BaselineArtifact = {
	flaggedByType: Array<{
		type: string;
		typeId: string;
		flagged: Array<{ id: string; name: string; classification: string }>;
	}>;
};

/** Loads the frozen Phase-1 baseline (72 targets) from its committed artifact
 * — not hand-transcribed, avoids transcription risk on a 72-entry id list
 * spanning 6 types. Throws if the artifact's shape drifted from what Phase 1
 * produced. */
export function loadFlaggedBaseline(): FlaggedTarget[] {
	const raw = readFileSync(BASELINE_ARTIFACT_PATH, 'utf-8');
	const artifact = JSON.parse(raw) as BaselineArtifact;
	const targets: FlaggedTarget[] = [];
	for (const group of artifact.flaggedByType) {
		for (const f of group.flagged) {
			targets.push({ type: group.type, typeId: group.typeId, id: f.id, name: f.name, classification: f.classification });
		}
	}
	if (targets.length !== EXPECTED_BASELINE_COUNT) {
		throw new Error(`loadFlaggedBaseline: expected ${EXPECTED_BASELINE_COUNT} targets from ${BASELINE_ARTIFACT_PATH}, got ${targets.length} — Phase 1 artifact may have changed`);
	}
	return targets;
}

export type PopulationCheck = {
	stillFlagged: FlaggedTarget[];
	alreadyFixed: Array<{ id: string; type: string }>;
	missing: Array<{ id: string; type: string }>;
	preOwnerCounts: Record<string, number>;
};

/** Re-verifies the baseline live, per type (one list query per type — not 72
 * individual GETs), before any write. Distinguishes: still flagged (needs the
 * backfill), already fixed since Phase 1 (someone else already added db-root
 * — skip, don't double-add), and missing (deleted since Phase 1 — flag, don't
 * silently drop). Also captures each target's CURRENT `_owner` value count,
 * so the post-write add-only check has a real pre-image to compare against. */
export async function verifyPopulation(cfg: EntuCfg, baseline: FlaggedTarget[], fetchImpl: typeof fetch = fetch): Promise<PopulationCheck> {
	const byType = new Map<string, FlaggedTarget[]>();
	for (const t of baseline) {
		if (!byType.has(t.typeId)) byType.set(t.typeId, []);
		byType.get(t.typeId)!.push(t);
	}

	const stillFlagged: FlaggedTarget[] = [];
	const alreadyFixed: Array<{ id: string; type: string }> = [];
	const missing: Array<{ id: string; type: string }> = [];
	const preOwnerCounts: Record<string, number> = {};

	for (const [typeId, targets] of byType) {
		const typeName = targets[0].type;
		const res = await entuFetch(cfg.db, `entity?_type.reference=${typeId}&props=_owner&limit=1000`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`verifyPopulation: GET failed for type ${typeName} (${typeId}): ${res.status}`);
		const body = (await res.json()) as { count: number; entities: Array<{ _id: string; _owner?: OwnerRef[] }> };
		if (body.count !== body.entities.length) throw new Error(`verifyPopulation: pagination mismatch for type ${typeName} — count=${body.count} entities=${body.entities.length}`);
		const liveById = new Map(body.entities.map((e) => [e._id, e._owner ?? []]));

		for (const t of targets) {
			const owners = liveById.get(t.id);
			if (owners === undefined) {
				missing.push({ id: t.id, type: t.type });
				continue;
			}
			preOwnerCounts[t.id] = owners.length;
			if (owners.some((o) => o.reference === DB_ROOT_PERSON_ID)) {
				alreadyFixed.push({ id: t.id, type: t.type });
				continue;
			}
			stillFlagged.push(t);
		}
	}

	return { stillFlagged, alreadyFixed, missing, preOwnerCounts };
}

export type BackfillLedgerEntry = { type: string; id: string; status: 'added' | 'skipped' | 'failed'; message?: string };

/** The genuine mutation: POST `_owner` (add, never replace — reference-type
 * properties APPEND on POST by default, which is exactly the wanted
 * semantics here, no DELETE-then-POST). Read-back verifies (a) db-root's
 * reference is now present, AND (b) the owner count grew by EXACTLY 1 —
 * proves add-only, not an accidental replace or a duplicate-add.
 *
 * Idempotency guard (Bentham review, item 3 / YELLOW-T4.10.1 lesson): a
 * FRESH GET immediately precedes every write, independent of whatever
 * `verifyPopulation` already filtered upstream. If db-root is already
 * present, SKIP — never POST again. This makes the function safe to
 * re-run or call with a stale/unfiltered target list, not just safe when
 * the caller remembers to filter first. */
export async function backfillOwner(cfg: EntuCfg, targets: FlaggedTarget[], fetchImpl: typeof fetch = fetch): Promise<BackfillLedgerEntry[]> {
	const entries: BackfillLedgerEntry[] = [];
	for (const t of targets) {
		const freshRes = await entuFetch(cfg.db, `entity/${t.id}?props=_owner`, cfg.token, {}, fetchImpl);
		if (!freshRes.ok) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: `idempotency pre-check GET failed: ${freshRes.status}` });
			continue;
		}
		const freshBody = (await freshRes.json()) as { entity?: { _owner?: OwnerRef[] } };
		const freshOwners = freshBody.entity?._owner ?? [];
		if (freshOwners.some((o) => o.reference === DB_ROOT_PERSON_ID)) {
			entries.push({ type: t.type, id: t.id, status: 'skipped', message: 'db-root already present on fresh re-check — idempotency guard (not a re-add)' });
			continue;
		}
		const preCount = freshOwners.length;
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.id}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: '_owner', reference: DB_ROOT_PERSON_ID }]) },
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ type: t.type, id: t.id, status: 'failed', message: `POST failed: ${res.status}` });
				continue;
			}
		} catch (err) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: errMsg(err) });
			continue;
		}
		const getRes = await entuFetch(cfg.db, `entity/${t.id}?props=_owner`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: `read-back GET failed: ${getRes.status}` });
			continue;
		}
		const getBody = (await getRes.json()) as { entity?: { _owner?: OwnerRef[] } };
		const owners = getBody.entity?._owner ?? [];
		const hasDbRoot = owners.some((o) => o.reference === DB_ROOT_PERSON_ID);
		if (!hasDbRoot) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: 'read-back shows db-root still absent from _owner (apparent-success trap)' });
			continue;
		}
		if (owners.length !== preCount + 1) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: `read-back shows ${owners.length} owner(s), expected exactly ${preCount + 1} (pre=${preCount}) — not a clean add-only write` });
			continue;
		}
		entries.push({ type: t.type, id: t.id, status: 'added' });
	}
	return entries;
}

/** Full-entity snapshot for the canary diff gate — deliberately NOT
 * `props=`-scoped, so it captures every property Entu returns (aggregated
 * buckets included) rather than only the one field we expect to change. */
async function readFullEntity(cfg: EntuCfg, id: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
	const res = await entuFetch(cfg.db, `entity/${id}`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`readFullEntity: GET ${id} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: Record<string, unknown> };
	return body.entity ?? {};
}

/** Diffs two full-entity snapshots with `_owner` stripped from both sides —
 * `_owner` is the ONLY field this module ever intends to change. Any other
 * difference (a re-aggregated `_sharing`/bucket, a mutated custom property,
 * anything) means the write had a side-effect nobody asked for. Returns the
 * list of top-level keys whose JSON representation differs. */
function diffEntitiesExcludingOwner(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	keys.delete('_owner');
	const changed: string[] = [];
	for (const k of keys) {
		if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
	}
	return changed;
}

/** Canary — one target PER TYPE (6 types in the flagged population), added +
 * add-only verified, BEFORE the full 72-entity sweep. Throws on any canary
 * failure — refuses to run the full sweep on an unproven mechanic for that
 * type.
 *
 * Ordering (Bentham review, item 1): `no-owner` canaries run FIRST. The 3
 * fully-unowned `profile` entities are the hardest case — if a POST can
 * establish `_owner` where NONE exists at all, every other cohort (which
 * already has SOME owner, just not db-root) is a weaker condition. Fail
 * fast on the hardest case before spending writes on the easier ones.
 *
 * Re-aggregation diff gate (Bentham review, item 2): each canary captures a
 * FULL entity snapshot before the write and after the read-back, then diffs
 * every field except `_owner`. Throws immediately if anything else moved —
 * this module has no business changing `_sharing` or any custom property. */
export async function backfillCanaries(cfg: EntuCfg, targets: FlaggedTarget[], fetchImpl: typeof fetch = fetch): Promise<{ canaryEntries: BackfillLedgerEntry[]; remainingTargets: FlaggedTarget[] }> {
	const canaryByType = new Map<string, FlaggedTarget>();
	for (const t of targets) {
		if (!canaryByType.has(t.type)) canaryByType.set(t.type, t);
	}
	const canaries = [...canaryByType.values()].sort((a, b) => {
		const aFirst = a.classification === 'no-owner' ? 0 : 1;
		const bFirst = b.classification === 'no-owner' ? 0 : 1;
		return aFirst - bFirst;
	});
	const canaryEntries: BackfillLedgerEntry[] = [];
	for (const c of canaries) {
		const before = await readFullEntity(cfg, c.id, fetchImpl);
		const [entry] = await backfillOwner(cfg, [c], fetchImpl);
		if (entry.status !== 'added') {
			throw new Error(`backfillCanaries: canary ${c.type}/${c.id} (classification=${c.classification}) FAILED — ${entry.message}. Refuse to run the full ${targets.length}-entity sweep on an unproven mechanic for this type.`);
		}
		const after = await readFullEntity(cfg, c.id, fetchImpl);
		const changed = diffEntitiesExcludingOwner(before, after);
		if (changed.length > 0) {
			throw new Error(
				`backfillCanaries: canary ${c.type}/${c.id} added _owner cleanly BUT re-aggregation moved other field(s): ${JSON.stringify(changed)}. before=${JSON.stringify(before)} after=${JSON.stringify(after)}. Refuse to run the full sweep — this write is not side-effect-free.`
			);
		}
		canaryEntries.push(entry);
	}
	const canaryIds = new Set(canaries.map((c) => c.id));
	const remainingTargets = targets.filter((t) => !canaryIds.has(t.id));
	return { canaryEntries, remainingTargets };
}

/** Constraint spot-check (issue #68's own ask): confirm `_sharing` on one
 * specimen is bit-for-bit unchanged across the backfill — this module never
 * writes `_sharing`, so an unexpected re-aggregation side-effect would show
 * here. Compares both the string VALUE and the value's own `_id` (an `_id`
 * rotation with the same string would still mean something touched it). */
export async function readSharing(cfg: EntuCfg, id: string, fetchImpl: typeof fetch = fetch): Promise<{ string: string | null; valueId: string | null }> {
	const res = await entuFetch(cfg.db, `entity/${id}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`readSharing: GET ${id} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _sharing?: Array<{ string: string; _id: string }> } };
	const v = body.entity?._sharing?.[0];
	return { string: v?.string ?? null, valueId: v?._id ?? null };
}

// ── Dry-run render + ledger ─────────────────────────────────────────────────────

export function renderPlan(check: PopulationCheck): string {
	const lines: string[] = [];
	lines.push('#68 (epic #37) Phase 2 — db-root _owner backfill DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push(`Baseline (Phase 1 artifact): ${EXPECTED_BASELINE_COUNT} flagged targets.`);
	lines.push(`Live re-verify: ${check.stillFlagged.length} still flagged, ${check.alreadyFixed.length} already fixed since Phase 1, ${check.missing.length} missing (deleted since Phase 1).`);
	if (check.alreadyFixed.length > 0) lines.push(`  Already fixed (would be SKIPPED, not double-added): ${JSON.stringify(check.alreadyFixed)}`);
	if (check.missing.length > 0) lines.push(`  MISSING since Phase 1 (flagging, not silently dropping): ${JSON.stringify(check.missing)}`);
	lines.push('');
	lines.push('── WOULD POST _owner=db-root (ADD-ONLY: reference-type POST-appends, no DELETE, existing owners preserved)');
	const byType = new Map<string, number>();
	for (const t of check.stillFlagged) byType.set(t.type, (byType.get(t.type) ?? 0) + 1);
	for (const [type, count] of byType) lines.push(`   ${type}: ${count}`);
	lines.push('   CANARY: one target PER TYPE, no-owner cohort FIRST (hardest case), added + add-only-verified before the full sweep.');
	lines.push('   RE-AGGREGATION DIFF GATE: each canary\'s full entity is snapshotted before/after; any field other than _owner moving HALTS the run.');
	lines.push('   IDEMPOTENCY GUARD: every write (canary or bulk) re-checks _owner fresh immediately before POSTing — an already-db-root-owned target is SKIPPED, never re-added.');
	lines.push('');
	lines.push('── Constraint: _sharing untouched by construction (this module never writes that property) — spot-checked on one specimen pre/post.');
	lines.push('');
	lines.push(`Totals: ${check.stillFlagged.length} owner-add writes planned. Writes issued this run: 0.`);
	return lines.join('\n');
}

export class BackfillLedger {
	private entries: BackfillLedgerEntry[] = [];
	record(entries: BackfillLedgerEntry[]): void {
		this.entries.push(...entries);
	}
	failures(): BackfillLedgerEntry[] {
		return this.entries.filter((e) => e.status === 'failed');
	}
	skipped(): BackfillLedgerEntry[] {
		return this.entries.filter((e) => e.status === 'skipped');
	}
	hasFailures(): boolean {
		return this.failures().length > 0;
	}
	toJSON() {
		return { entries: this.entries, failureCount: this.failures().length, skippedCount: this.skipped().length };
	}
	printReport(): void {
		console.log(`\n── Owner backfill: ${this.entries.length} attempted`);
		const failures = this.failures();
		const skipped = this.skipped();
		const added = this.entries.length - failures.length - skipped.length;
		for (const e of failures) console.error(`FAILED ${e.type}/${e.id} — ${e.message}`);
		if (skipped.length > 0) console.log(`${skipped.length} skipped (idempotency guard — db-root already present): ${skipped.map((e) => `${e.type}/${e.id}`).join(', ')}`);
		console.log(`${added}/${this.entries.length} added cleanly.`);
		if (failures.length > 0) {
			console.error('');
			console.error(`#68 Phase 2 INCOMPLETE — ${failures.length} failure(s) need operator repair.`);
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
