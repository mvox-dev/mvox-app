// T6.2 (#56, epic #54) — library visibility mutation. Final scope per Gama's
// 2026-08-08 rulings on #54 (grounded in Pérotin's T6.1 grooming pass, #55):
//
//   Bundle A — 12 prop-def writes:
//     11 WIDEN (private/absent → domain): work.name, work.composer,
//     edition.name, edition.publisher, copy.name, copy.copy_number,
//     lending.member, lending.assigned_at, lending.copy,
//     lending.assigned_until, lending.returned_at. All 11 currently carry NO
//     `_sharing` value at all (confirmed live) — plain CREATE-POSTs, no
//     existing value to replace.
//     1 NARROW (domain → private): edition.cost (Mihkel's ruling, PO session
//     2026-08-08 — "acquisition cost is bookkeeping, not browse data").
//     Currently `_sharing:'domain'` WITH an existing value `_id` — atomic
//     REPLACE-by-`_id`, same mechanic as #44's narrow.
//
//   Bundle B — 586-instance touch-save re-aggregation (work 13 + edition 17 +
//     copy 552 + lending 4), GATED on Bundle A succeeding for all 12. Every
//     instance across all four types carries an explicit `_sharing:'private'`
//     value (confirmed live, uniform, zero absent) — the atomic-replace
//     touch-save mechanic (#20/#44 lineage) applies uniformly, no edge cases.
//     Canary-first, ONE PER TYPE (four canaries) since this is the first time
//     this mechanic runs on these four types (unlike #44's `person`, this is
//     genuinely new ground) — not a single credential-holder-specific canary
//     like #44's (no evidence any of these entities are the executing
//     credential's own identity entity, so that specific extra gate doesn't
//     apply here; ownership pre-check below covers the actual risk class
//     learned from #44/#45 instead).
//
//   OWNERSHIP PRE-CHECK (the #44/#45 lesson, applied proactively): scanned all
//   586 instances live — 100% db-root-owned (`_owner` includes
//   69bcfd8e9c031ab8e6ce8079), 0 non-db-root-owned, 0 missing an explicit
//   `_sharing` value. Unlike #44 (person `6a2fc05e...5ddc`) and #45 (the
//   application specimen), there is NO known rights-gap risk for this batch —
//   these are all script/seed-created library entities, not entities created
//   via Mihkel's real OAuth account. Re-verified fresh in this script's own
//   Step-0 enumeration, not trusted from a prior scan.

import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export const DB_ROOT_PERSON_ID = '69bcfd8e9c031ab8e6ce8079';

export const TYPE_IDS: Record<string, string> = {
	work: '69c7ea4c8489bfcb0e819f3e',
	edition: '69c7ea4e8489bfcb0e819f9c',
	copy: '6a0d2e8190c8df7a1cc7ddb0',
	lending: '6a0d2e8190c8df7a1cc7dde8'
};

export type PropDefTarget = { type: string; name: string; id: string; action: 'widen' | 'narrow' };
export const PROPDEF_TARGETS: PropDefTarget[] = [
	{ type: 'work', name: 'name', id: '69c7ea4d8489bfcb0e819f45', action: 'widen' },
	{ type: 'work', name: 'composer', id: '69c7ea4d8489bfcb0e819f51', action: 'widen' },
	{ type: 'edition', name: 'name', id: '69c7ea4f8489bfcb0e819fa3', action: 'widen' },
	{ type: 'edition', name: 'publisher', id: '69c7ea4f8489bfcb0e819fce', action: 'widen' },
	{ type: 'copy', name: 'name', id: '6a0d2e8190c8df7a1cc7ddb9', action: 'widen' },
	{ type: 'copy', name: 'copy_number', id: '6a0d2e8190c8df7a1cc7ddc3', action: 'widen' },
	{ type: 'lending', name: 'member', id: '6a0d2e8290c8df7a1cc7de05', action: 'widen' },
	{ type: 'lending', name: 'assigned_at', id: '6a0d2e8290c8df7a1cc7de0f', action: 'widen' },
	{ type: 'lending', name: 'copy', id: '6a0d2e8190c8df7a1cc7ddfb', action: 'widen' },
	{ type: 'lending', name: 'assigned_until', id: '6a0d2e8290c8df7a1cc7de19', action: 'widen' },
	{ type: 'lending', name: 'returned_at', id: '6a0d2e8290c8df7a1cc7de22', action: 'widen' },
	{ type: 'edition', name: 'cost', id: '6a0d2e8990c8df7a1cc7e072', action: 'narrow' }
];

const EXPECTED_INSTANCE_COUNTS: Record<string, number> = { work: 13, edition: 17, copy: 552, lending: 4 };

// ── Step-0 enumeration (READ-ONLY) ──────────────────────────────────────────────

export type VerifiedPropDef = PropDefTarget & { currentSharing: string; sharingValueId: string | null };

export async function verifyPropDefs(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<VerifiedPropDef[]> {
	const results: VerifiedPropDef[] = [];
	for (const t of PROPDEF_TARGETS) {
		const res = await entuFetch(cfg.db, `entity/${t.id}?props=name,_sharing`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`verifyPropDefs: GET ${t.id} (${t.type}.${t.name}) failed: ${res.status}`);
		const body = (await res.json()) as { entity?: { name?: Array<{ string: string }>; _sharing?: Array<{ _id: string; string: string }> } };
		const liveName = body.entity?.name?.[0]?.string;
		if (liveName !== t.name) {
			throw new Error(`verifyPropDefs: ${t.id} has name=${JSON.stringify(liveName)}, expected ${JSON.stringify(t.name)} — wrong id, refuse to proceed`);
		}
		const sharing = body.entity?._sharing?.[0];
		if (t.action === 'widen' && sharing != null) {
			throw new Error(`verifyPropDefs: ${t.type}.${t.name} (${t.id}) already has _sharing=${JSON.stringify(sharing.string)} — expected absent for a widen target, live state moved, refuse to proceed`);
		}
		if (t.action === 'narrow' && (sharing == null || sharing.string !== 'domain')) {
			throw new Error(`verifyPropDefs: ${t.type}.${t.name} (${t.id}) has _sharing=${JSON.stringify(sharing?.string ?? null)} — expected 'domain' for a narrow target, live state moved, refuse to proceed`);
		}
		results.push({ ...t, currentSharing: sharing?.string ?? '(absent)', sharingValueId: sharing?._id ?? null });
	}
	return results;
}

export type InstanceTarget = { type: string; id: string; sharingValueId: string };
export type OwnershipFlag = { type: string; id: string; owners: string[] };

export type VerifiedInstances = {
	targets: InstanceTarget[];
	countsByType: Record<string, number>;
	tierHistogram: Record<string, number>;
	missingSharingIds: Array<{ type: string; id: string }>;
	nonDbRootOwned: OwnershipFlag[];
};

/** Step-0 enumeration for Bundle B. Re-scans ALL instances of all 4 types live
 * — HALTs on any drift from the expected per-type counts (13/17/552/4). Also
 * re-runs the ownership pre-check fresh (not trusted from a prior scan). */
export async function verifyInstances(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<VerifiedInstances> {
	const targets: InstanceTarget[] = [];
	const countsByType: Record<string, number> = {};
	const tierHistogram: Record<string, number> = {};
	const missingSharingIds: Array<{ type: string; id: string }> = [];
	const nonDbRootOwned: OwnershipFlag[] = [];

	for (const [typeName, typeId] of Object.entries(TYPE_IDS)) {
		const res = await entuFetch(cfg.db, `entity?_type.reference=${typeId}&props=_id,_sharing,_owner&limit=1000`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`verifyInstances: census GET for ${typeName} failed: ${res.status}`);
		const body = (await res.json()) as {
			count: number;
			entities: Array<{ _id: string; _sharing?: Array<{ _id: string; string: string }>; _owner?: Array<{ reference: string; entity_type: string }> }>;
		};
		if (body.count !== body.entities.length) {
			throw new Error(`verifyInstances: ${typeName} census truncated — count=${body.count} entities=${body.entities.length}`);
		}
		if (body.count !== EXPECTED_INSTANCE_COUNTS[typeName]) {
			throw new Error(`verifyInstances: ${typeName} live count is ${body.count}, expected ${EXPECTED_INSTANCE_COUNTS[typeName]} — population drift, refuse to proceed`);
		}
		countsByType[typeName] = body.count;

		for (const e of body.entities) {
			const sharing = e._sharing?.[0];
			const tier = sharing?.string ?? '(absent)';
			tierHistogram[tier] = (tierHistogram[tier] ?? 0) + 1;
			if (!sharing?._id) {
				missingSharingIds.push({ type: typeName, id: e._id });
				continue;
			}
			targets.push({ type: typeName, id: e._id, sharingValueId: sharing._id });
			const owners = e._owner ?? [];
			if (!owners.some((o) => o.reference === DB_ROOT_PERSON_ID)) {
				nonDbRootOwned.push({ type: typeName, id: e._id, owners: owners.map((o) => `${o.entity_type}:${o.reference}`) });
			}
		}
	}

	return { targets, countsByType, tierHistogram, missingSharingIds, nonDbRootOwned };
}

// ── Bundle A: prop-def writes ────────────────────────────────────────────────

export type PropDefLedgerEntry = { propDefId: string; type: string; name: string; action: 'widen' | 'narrow'; status: 'set' | 'failed'; message?: string };

export async function writePropDefs(cfg: EntuCfg, verified: VerifiedPropDef[], fetchImpl: typeof fetch = fetch): Promise<PropDefLedgerEntry[]> {
	const entries: PropDefLedgerEntry[] = [];
	for (const t of verified) {
		const targetValue = t.action === 'widen' ? 'domain' : 'private';
		try {
			const body = t.action === 'widen' ? [{ type: '_sharing', string: 'domain' }] : [{ _id: t.sharingValueId, type: '_sharing', string: 'private' }];
			const res = await entuFetch(cfg.db, `entity/${t.id}`, cfg.token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl);
			if (!res.ok) {
				entries.push({ propDefId: t.id, type: t.type, name: t.name, action: t.action, status: 'failed', message: `POST failed: ${res.status}` });
				continue;
			}
			if (t.action === 'narrow') {
				const resBody = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
				const newSharingProp = (resBody.properties ?? []).find((p) => p.type === '_sharing');
				if (!newSharingProp?._id || newSharingProp._id === t.sharingValueId) {
					entries.push({ propDefId: t.id, type: t.type, name: t.name, action: t.action, status: 'failed', message: 'narrow replace did not rotate the property _id (apparent-success trap)' });
					continue;
				}
			}
		} catch (err) {
			entries.push({ propDefId: t.id, type: t.type, name: t.name, action: t.action, status: 'failed', message: errMsg(err) });
			continue;
		}

		const getRes = await entuFetch(cfg.db, `entity/${t.id}?props=_sharing`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) {
			entries.push({ propDefId: t.id, type: t.type, name: t.name, action: t.action, status: 'failed', message: `read-back GET failed: ${getRes.status}` });
			continue;
		}
		const getBody = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		const now = getBody.entity?._sharing?.[0]?.string;
		if (now !== targetValue) {
			entries.push({ propDefId: t.id, type: t.type, name: t.name, action: t.action, status: 'failed', message: `read-back shows _sharing=${JSON.stringify(now)}, expected ${JSON.stringify(targetValue)}` });
			continue;
		}
		entries.push({ propDefId: t.id, type: t.type, name: t.name, action: t.action, status: 'set' });
	}
	return entries;
}

// ── Bundle B: touch-save re-aggregation ─────────────────────────────────────────

export type TouchLedgerEntry = { type: string; id: string; status: 'touched' | 'failed'; newSharingPropId?: string; message?: string };

export async function touchSaveInstances(cfg: EntuCfg, targets: InstanceTarget[], fetchImpl: typeof fetch = fetch): Promise<TouchLedgerEntry[]> {
	const entries: TouchLedgerEntry[] = [];
	for (const t of targets) {
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.id}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ _id: t.sharingValueId, type: '_sharing', string: 'private' }]) },
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ type: t.type, id: t.id, status: 'failed', message: `touch-save POST failed: ${res.status}` });
				continue;
			}
			const body = (await res.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newSharingProp = (body.properties ?? []).find((p) => p.type === '_sharing');
			if (!newSharingProp?._id) {
				entries.push({ type: t.type, id: t.id, status: 'failed', message: 'touch-save POST returned 2xx but no _sharing property in response (apparent-success trap)' });
				continue;
			}
			if (newSharingProp._id === t.sharingValueId) {
				entries.push({ type: t.type, id: t.id, status: 'failed', message: `touch-save POST returned the SAME property _id (${t.sharingValueId}) — the replace did not actually rotate` });
				continue;
			}
			entries.push({ type: t.type, id: t.id, status: 'touched', newSharingPropId: newSharingProp._id });
		} catch (err) {
			entries.push({ type: t.type, id: t.id, status: 'failed', message: errMsg(err) });
		}
	}
	return entries;
}

/** Canary — one representative instance PER TYPE (4 total), touched + hard
 * single-value-survives verified, BEFORE the full 586-instance sweep. Throws
 * on any canary failure (hard gate, not a ledger entry). */
export async function touchSaveCanaries(cfg: EntuCfg, targets: InstanceTarget[], fetchImpl: typeof fetch = fetch): Promise<{ canaryEntries: TouchLedgerEntry[]; remainingTargets: InstanceTarget[] }> {
	const canaryByType = new Map<string, InstanceTarget>();
	for (const t of targets) {
		if (!canaryByType.has(t.type)) canaryByType.set(t.type, t);
	}
	const canaries = [...canaryByType.values()];
	const canaryEntries: TouchLedgerEntry[] = [];
	for (const c of canaries) {
		const [entry] = await touchSaveInstances(cfg, [c], fetchImpl);
		if (entry.status !== 'touched') {
			throw new Error(`touchSaveCanaries: canary ${c.type}/${c.id} FAILED — ${entry.message}. Refuse to run the full 586-instance sweep on an unproven mechanic for this type.`);
		}
		const getRes = await entuFetch(cfg.db, `entity/${c.id}?props=_sharing`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) throw new Error(`touchSaveCanaries: post-touch read-back GET failed for ${c.type}/${c.id}: ${getRes.status}`);
		const body = (await getRes.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		const sharingValues = body.entity?._sharing ?? [];
		if (sharingValues.length !== 1) {
			throw new Error(`touchSaveCanaries: canary ${c.type}/${c.id} now carries ${sharingValues.length} _sharing values (expected exactly 1) — atomic replace did not cleanly soft-delete the old value. Refuse to run the full sweep.`);
		}
		canaryEntries.push(entry);
	}
	const canaryIds = new Set(canaries.map((c) => c.id));
	const remainingTargets = targets.filter((t) => !canaryIds.has(t.id));
	return { canaryEntries, remainingTargets };
}

// ── Dry-run render + ledger ─────────────────────────────────────────────────────

export function renderPlan(propDefs: VerifiedPropDef[], instances: VerifiedInstances): string {
	const lines: string[] = [];
	lines.push('T6.2 (#56, epic #54) — library visibility mutation DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push('── Bundle A: 12 prop-def writes (11 widen, 1 narrow) — all re-verified live');
	for (const t of propDefs) {
		if (t.action === 'widen') {
			lines.push(`   ${t.type}.${t.name} (${t.id}): WOULD POST create _sharing:'domain' (currently absent, plain create).`);
		} else {
			lines.push(`   ${t.type}.${t.name} (${t.id}): WOULD POST replace _sharing:'private' (current value _id ${t.sharingValueId}, currently 'domain').`);
		}
	}
	lines.push('');
	lines.push('── Bundle B: WOULD TOUCH-SAVE all 586 instances (GATED on Bundle A succeeding for all 12)');
	lines.push(`   Counts: ${JSON.stringify(instances.countsByType)} (matches the ruled 13+17+552+4 exactly).`);
	lines.push(`   Own-_sharing tier histogram (pre-change): ${JSON.stringify(instances.tierHistogram)} — uniformly private, as expected.`);
	if (instances.missingSharingIds.length > 0) {
		lines.push(`   WARNING: ${instances.missingSharingIds.length} instance(s) have NO explicit _sharing value (cannot atomic-replace): ${JSON.stringify(instances.missingSharingIds)}`);
	} else {
		lines.push('   All 586 instances carry an explicit _sharing value — the atomic-replace touch-save mechanic applies uniformly.');
	}
	lines.push('   CANARY: one representative instance PER TYPE (4 total) touched + single-value-survives verified BEFORE the full sweep.');
	lines.push('');
	lines.push('── Ownership pre-check (the #44/#45 lesson, applied proactively)');
	if (instances.nonDbRootOwned.length === 0) {
		lines.push('   0/586 non-db-root-owned. Unlike #44/#45, NO known rights-gap risk for this batch — all are script/seed-created library entities.');
	} else {
		lines.push(`   WARNING: ${instances.nonDbRootOwned.length} instance(s) are NOT db-root-owned — likely to 403 on touch-save, same pattern as #44/#45: ${JSON.stringify(instances.nonDbRootOwned.slice(0, 20))}`);
	}
	lines.push('');
	lines.push(`Totals: 12 prop-def writes planned, 586 instance touch-saves planned (4 canaries + 582 more). Writes issued this run: 0.`);
	return lines.join('\n');
}

export class LibraryVisibilityLedger {
	private propDefEntries: PropDefLedgerEntry[] = [];
	private touchEntries: TouchLedgerEntry[] = [];
	recordPropDef(entries: PropDefLedgerEntry[]): void {
		this.propDefEntries.push(...entries);
	}
	recordTouch(entries: TouchLedgerEntry[]): void {
		this.touchEntries.push(...entries);
	}
	propDefFailures(): PropDefLedgerEntry[] {
		return this.propDefEntries.filter((e) => e.status !== 'set');
	}
	touchFailures(): TouchLedgerEntry[] {
		return this.touchEntries.filter((e) => e.status !== 'touched');
	}
	hasFailures(): boolean {
		return this.propDefFailures().length > 0 || this.touchFailures().length > 0;
	}
	toJSON() {
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
			const line = `${e.status.toUpperCase()} ${e.type}.${e.name} (${e.action}) (${e.propDefId})${e.message ? ` — ${e.message}` : ''}`;
			if (e.status === 'set') console.log(line);
			else console.error(line);
		}
		if (this.touchEntries.length > 0) {
			console.log(`\n── Bundle B (touch-save sweep): ${this.touchEntries.length} attempted`);
			const failures = this.touchFailures();
			for (const e of failures) console.error(`${e.status.toUpperCase()} ${e.type}/${e.id} — ${e.message}`);
			console.log(`${this.touchEntries.length - failures.length}/${this.touchEntries.length} touched cleanly.`);
		}
		const pFail = this.propDefFailures();
		const tFail = this.touchFailures();
		if (pFail.length > 0 || tFail.length > 0) {
			console.error('');
			console.error(`T6.2 INCOMPLETE — ${pFail.length} prop-def failure(s), ${tFail.length} touch-save failure(s) need operator repair.`);
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
