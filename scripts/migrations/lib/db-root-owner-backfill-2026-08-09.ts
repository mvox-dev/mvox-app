// #68: add db-root as `_owner` on the 72 entities the Phase-1 probe flagged.

// Mihkel's ruling on #68: "all objects must be under dev team's control" (sandbox db for now).
// Add-only: POST appends to a reference property, so existing owners and `_sharing` stay.

import { readFileSync } from 'node:fs';
import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/entu/cfg';

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

// Read from the committed artifact, not hand-copied, so the 72 ids cannot be mistyped.
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

// Splits targets into still flagged, already fixed (skip) and missing (flag, don't drop).
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

// A fresh GET before each write skips targets already owned by db-root: re-runs never double-add.
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

// Not props-scoped: the canary diff must see every property, not only `_owner`.
async function readFullEntity(cfg: EntuCfg, id: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
	const res = await entuFetch(cfg.db, `entity/${id}`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`readFullEntity: GET ${id} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: Record<string, unknown> };
	return body.entity ?? {};
}

function diffEntitiesExcludingOwner(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	keys.delete('_owner');
	const changed: string[] = [];
	for (const k of keys) {
		if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
	}
	return changed;
}

// Unowned canaries go first: the hardest case should fail before writes are spent on easier ones.
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

// Compares the value's `_id` too: a rotated id with the same string still means it was touched.
export async function readSharing(cfg: EntuCfg, id: string, fetchImpl: typeof fetch = fetch): Promise<{ string: string | null; valueId: string | null }> {
	const res = await entuFetch(cfg.db, `entity/${id}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`readSharing: GET ${id} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _sharing?: Array<{ string: string; _id: string }> } };
	const v = body.entity?._sharing?.[0];
	return { string: v?.string ?? null, valueId: v?._id ?? null };
}

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
