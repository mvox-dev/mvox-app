// Fills EN+ET `description` on all 20 type-defs and 140 prop-defs (#48).
// Cosmetic tier: no rights or data change, so drafts ship without pre-review.

import { readFileSync } from 'node:fs';
import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/entu/cfg';

const ENTITY_META_ID = '69bcfd8e9c031ab8e6ce8034';
const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';

const INVENTORY_ARTIFACT_PATH = 'scripts/migrations/seed-results/probe-48-structural-inventory-2026-08-08T22-16-47-000Z.json';
const CONTENT_MANIFEST_PATH = 'scripts/migrations/seed-sources/descriptions-48.json';
const EXPECTED_TYPE_COUNT = 20;
const EXPECTED_PROP_COUNT = 140;

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

type InventoryType = { type: string; typeId: string; props: Array<{ id: string; name: string; fieldType: string; mandatory: boolean }> };
type ContentManifest = {
	types: Array<{ typeId: string; type: string; en: string; et: string }>;
	props: Array<{ propId: string; type: string; name: string; en: string; et: string }>;
};

export type DescriptionTarget = { kind: 'type' | 'prop'; id: string; label: string; en: string; et: string };

/** Joins the structural inventory with the drafted content manifest; throws on any mismatch
 * or on either side drifting from the expected 20/140. */
export function loadTargets(): DescriptionTarget[] {
	const inventory = JSON.parse(readFileSync(INVENTORY_ARTIFACT_PATH, 'utf-8')) as InventoryType[];
	const content = JSON.parse(readFileSync(CONTENT_MANIFEST_PATH, 'utf-8')) as ContentManifest;

	if (inventory.length !== EXPECTED_TYPE_COUNT) throw new Error(`loadTargets: inventory has ${inventory.length} types, expected ${EXPECTED_TYPE_COUNT}`);
	const totalProps = inventory.reduce((s, t) => s + t.props.length, 0);
	if (totalProps !== EXPECTED_PROP_COUNT) throw new Error(`loadTargets: inventory has ${totalProps} props, expected ${EXPECTED_PROP_COUNT}`);
	if (content.types.length !== EXPECTED_TYPE_COUNT) throw new Error(`loadTargets: content manifest has ${content.types.length} type descriptions, expected ${EXPECTED_TYPE_COUNT}`);
	if (content.props.length !== EXPECTED_PROP_COUNT) throw new Error(`loadTargets: content manifest has ${content.props.length} prop descriptions, expected ${EXPECTED_PROP_COUNT}`);

	const contentByTypeId = new Map(content.types.map((c) => [c.typeId, c]));
	const contentByPropId = new Map(content.props.map((c) => [c.propId, c]));

	const targets: DescriptionTarget[] = [];
	for (const t of inventory) {
		const c = contentByTypeId.get(t.typeId);
		if (!c) throw new Error(`loadTargets: no content entry for type "${t.type}" (${t.typeId})`);
		if (!c.en.trim() || !c.et.trim()) throw new Error(`loadTargets: type "${t.type}" (${t.typeId}) has empty en/et content`);
		targets.push({ kind: 'type', id: t.typeId, label: t.type, en: c.en, et: c.et });
		for (const p of t.props) {
			const cp = contentByPropId.get(p.id);
			if (!cp) throw new Error(`loadTargets: no content entry for prop "${t.type}.${p.name}" (${p.id})`);
			if (!cp.en.trim() || !cp.et.trim()) throw new Error(`loadTargets: prop "${t.type}.${p.name}" (${p.id}) has empty en/et content`);
			targets.push({ kind: 'prop', id: p.id, label: `${t.type}.${p.name}`, en: cp.en, et: cp.et });
		}
	}
	if (targets.length !== EXPECTED_TYPE_COUNT + EXPECTED_PROP_COUNT) {
		throw new Error(`loadTargets: assembled ${targets.length} targets, expected ${EXPECTED_TYPE_COUNT + EXPECTED_PROP_COUNT}`);
	}
	return targets;
}

export type LiveCheck = { stillEmpty: DescriptionTarget[]; alreadyFilled: Array<{ id: string; label: string }> };

/** Re-verifies the empty baseline live, two list queries; already-filled targets are skipped
 * so a hand correction landed since drafting is not clobbered. */
export async function verifyStillEmpty(cfg: EntuCfg, targets: DescriptionTarget[], fetchImpl: typeof fetch = fetch): Promise<LiveCheck> {
	const typeTargets = targets.filter((t) => t.kind === 'type');
	const propTargets = targets.filter((t) => t.kind === 'prop');

	async function fetchDescriptions(metaTypeId: string, limit: number): Promise<Map<string, boolean>> {
		const res = await entuFetch(cfg.db, `entity?_type.reference=${metaTypeId}&props=description&limit=${limit}`, cfg.token, {}, fetchImpl);
		if (!res.ok) throw new Error(`verifyStillEmpty: GET failed for meta-type ${metaTypeId}: ${res.status}`);
		const body = (await res.json()) as { count: number; entities: Array<{ _id: string; description?: Array<{ string: string }> }> };
		if (body.count !== body.entities.length) throw new Error(`verifyStillEmpty: pagination mismatch for meta-type ${metaTypeId} — count=${body.count} entities=${body.entities.length}`);
		return new Map(body.entities.map((e) => [e._id, (e.description ?? []).some((d) => d.string.trim().length > 0)]));
	}

	const typeState = await fetchDescriptions(ENTITY_META_ID, 100);
	const propState = await fetchDescriptions(PROPERTY_META_ID, 300);

	const stillEmpty: DescriptionTarget[] = [];
	const alreadyFilled: Array<{ id: string; label: string }> = [];
	for (const t of typeTargets) {
		const filled = typeState.get(t.id);
		if (filled === undefined) throw new Error(`verifyStillEmpty: type target ${t.label} (${t.id}) not found in live type registry — refuse to proceed`);
		if (filled) {
			alreadyFilled.push({ id: t.id, label: t.label });
			continue;
		}
		stillEmpty.push(t);
	}
	for (const t of propTargets) {
		const filled = propState.get(t.id);
		if (filled === undefined) throw new Error(`verifyStillEmpty: prop target ${t.label} (${t.id}) not found in live prop-def registry — refuse to proceed`);
		if (filled) {
			alreadyFilled.push({ id: t.id, label: t.label });
			continue;
		}
		stillEmpty.push(t);
	}
	return { stillEmpty, alreadyFilled };
}

export type WriteLedgerEntry = { kind: 'type' | 'prop'; id: string; label: string; status: 'written' | 'skipped' | 'failed'; message?: string };

/** POSTs EN+ET in one call and reads back both exact strings, catching a partial write.
 * A fresh GET precedes every write; an existing description means SKIP, never a second value. */
export async function writeDescriptions(cfg: EntuCfg, targets: DescriptionTarget[], fetchImpl: typeof fetch = fetch): Promise<WriteLedgerEntry[]> {
	const entries: WriteLedgerEntry[] = [];
	for (const t of targets) {
		const freshRes = await entuFetch(cfg.db, `entity/${t.id}?props=description`, cfg.token, {}, fetchImpl);
		if (!freshRes.ok) {
			entries.push({ kind: t.kind, id: t.id, label: t.label, status: 'failed', message: `idempotency pre-check GET failed: ${freshRes.status}` });
			continue;
		}
		const freshBody = (await freshRes.json()) as { entity?: { description?: Array<{ string: string }> } };
		if ((freshBody.entity?.description ?? []).some((d) => d.string.trim().length > 0)) {
			entries.push({ kind: t.kind, id: t.id, label: t.label, status: 'skipped', message: 'description already present on fresh re-check — idempotency guard' });
			continue;
		}
		try {
			const res = await entuFetch(
				cfg.db,
				`entity/${t.id}`,
				cfg.token,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify([
						{ type: 'description', language: 'en', string: t.en },
						{ type: 'description', language: 'et', string: t.et }
					])
				},
				fetchImpl
			);
			if (!res.ok) {
				entries.push({ kind: t.kind, id: t.id, label: t.label, status: 'failed', message: `POST failed: ${res.status}` });
				continue;
			}
		} catch (err) {
			entries.push({ kind: t.kind, id: t.id, label: t.label, status: 'failed', message: errMsg(err) });
			continue;
		}
		const getRes = await entuFetch(cfg.db, `entity/${t.id}?props=description`, cfg.token, {}, fetchImpl);
		if (!getRes.ok) {
			entries.push({ kind: t.kind, id: t.id, label: t.label, status: 'failed', message: `read-back GET failed: ${getRes.status}` });
			continue;
		}
		const getBody = (await getRes.json()) as { entity?: { description?: Array<{ string: string; language?: string }> } };
		const values = getBody.entity?.description ?? [];
		const en = values.find((v) => v.language === 'en')?.string;
		const et = values.find((v) => v.language === 'et')?.string;
		if (en !== t.en || et !== t.et) {
			entries.push({
				kind: t.kind,
				id: t.id,
				label: t.label,
				status: 'failed',
				message: `read-back mismatch — en=${JSON.stringify(en)} et=${JSON.stringify(et)}, expected en=${JSON.stringify(t.en)} et=${JSON.stringify(t.et)}`
			});
			continue;
		}
		entries.push({ kind: t.kind, id: t.id, label: t.label, status: 'written' });
	}
	return entries;
}

/** One type-kind and one prop-kind canary before the full sweep; throws if either fails. */
export async function writeCanaries(cfg: EntuCfg, targets: DescriptionTarget[], fetchImpl: typeof fetch = fetch): Promise<{ canaryEntries: WriteLedgerEntry[]; remainingTargets: DescriptionTarget[] }> {
	const firstType = targets.find((t) => t.kind === 'type');
	const firstProp = targets.find((t) => t.kind === 'prop');
	const canaries = [firstType, firstProp].filter((t): t is DescriptionTarget => t !== undefined);
	const canaryEntries: WriteLedgerEntry[] = [];
	for (const c of canaries) {
		const [entry] = await writeDescriptions(cfg, [c], fetchImpl);
		if (entry.status === 'failed') {
			throw new Error(`writeCanaries: canary ${c.kind}/${c.label} FAILED — ${entry.message}. Refuse to run the full sweep on an unproven mechanic for this kind.`);
		}
		canaryEntries.push(entry);
	}
	const canaryIds = new Set(canaries.map((c) => c.id));
	const remainingTargets = targets.filter((t) => !canaryIds.has(t.id));
	return { canaryEntries, remainingTargets };
}

// ── Dry-run render + ledger ─────────────────────────────────────────────────────

export function renderPlan(check: LiveCheck): string {
	const lines: string[] = [];
	lines.push('#48 (#37-P3.6) — meta description fill DRY-RUN plan (NO writes issued)');
	lines.push('');
	lines.push(`Baseline: ${EXPECTED_TYPE_COUNT + EXPECTED_PROP_COUNT} targets (${EXPECTED_TYPE_COUNT} types + ${EXPECTED_PROP_COUNT} props).`);
	lines.push(`Live re-verify: ${check.stillEmpty.length} still empty (would write), ${check.alreadyFilled.length} already filled (would skip — trust-alternative model, don't clobber a hand-correction).`);
	if (check.alreadyFilled.length > 0) lines.push(`  Already filled: ${JSON.stringify(check.alreadyFilled)}`);
	lines.push('');
	lines.push('── WOULD POST description (en + et, one call per target, both languages)');
	const typeCount = check.stillEmpty.filter((t) => t.kind === 'type').length;
	const propCount = check.stillEmpty.filter((t) => t.kind === 'prop').length;
	lines.push(`   types: ${typeCount}`);
	lines.push(`   props: ${propCount}`);
	lines.push('   CANARY: one type + one prop, written + read-back verified (both languages, exact string match), before the full sweep.');
	lines.push('   IDEMPOTENCY GUARD: every write re-checks description fresh immediately before POSTing — an already-filled target is SKIPPED.');
	lines.push('');
	lines.push(`Totals: ${check.stillEmpty.length} description writes planned (${check.stillEmpty.length * 2} property values, en+et each). Writes issued this run: 0.`);
	return lines.join('\n');
}

export class WriteLedger {
	private entries: WriteLedgerEntry[] = [];
	record(entries: WriteLedgerEntry[]): void {
		this.entries.push(...entries);
	}
	failures(): WriteLedgerEntry[] {
		return this.entries.filter((e) => e.status === 'failed');
	}
	skipped(): WriteLedgerEntry[] {
		return this.entries.filter((e) => e.status === 'skipped');
	}
	hasFailures(): boolean {
		return this.failures().length > 0;
	}
	toJSON() {
		return { entries: this.entries, failureCount: this.failures().length, skippedCount: this.skipped().length };
	}
	printReport(): void {
		const failures = this.failures();
		const skipped = this.skipped();
		const written = this.entries.length - failures.length - skipped.length;
		console.log(`\n── Description fill: ${this.entries.length} attempted`);
		for (const e of failures) console.error(`FAILED ${e.kind}/${e.label} — ${e.message}`);
		if (skipped.length > 0) console.log(`${skipped.length} skipped (already filled): ${skipped.map((e) => e.label).join(', ')}`);
		console.log(`${written}/${this.entries.length} written cleanly.`);
		if (failures.length > 0) {
			console.error('');
			console.error(`#48 INCOMPLETE — ${failures.length} failure(s) need operator repair.`);
			console.error('Non-zero exit: this run did NOT complete. Do not claim success.');
		}
	}
}
