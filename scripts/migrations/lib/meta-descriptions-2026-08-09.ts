// #48 (#37-P3.6) — meta-polish: fill `description` on all 20 type-defs + 140
// prop-defs, both English and Estonian (Entu's `description` meta-field is
// declared `multilingual: true` on both the "entity" and "property"
// meta-types — probed and posted on #48). Cosmetic tier per the ruling: no
// §8.6 chain (no `_sharing`/rights/data mutation), "trust alternative" — the
// team drafts and ships all 160 from schema knowledge, no pre-ship review.
// Mihkel corrects opportunistically; corrections are ordinary small writes.
//
// Population: the structural inventory (20 types × their prop-defs, 140
// total) from the committed Phase-1 artifact, joined with drafted EN/ET
// content from the committed seed-source manifest.

import { readFileSync } from 'node:fs';
import { entuFetch } from '$lib/entu/request';
import { type EntuCfg } from '$lib/seasons/entuSeasons';

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

/** Joins the structural inventory (which entities exist) with the drafted
 * content manifest (what to write) — two independently-verifiable committed
 * artifacts, not one hand-assembled list. Throws on any mismatch: a
 * structural id with no matching content entry, or vice versa, or either
 * side's count drifting from the expected 20/140. */
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

/** Re-verifies live, per meta-type (2 list queries — all 20 type-defs live
 * under `_type.reference=ENTITY_META_ID`, all 140+ prop-defs live under
 * `_type.reference=PROPERTY_META_ID` — not 160 individual GETs). Confirms
 * the 0%-fill baseline still holds; distinguishes already-filled (skip, per
 * the "corrections land as ordinary small writes" model — don't clobber a
 * hand-correction that landed between drafting and shipping) from genuinely
 * empty. */
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

/** The write: POST both language values in one call (`description`/en +
 * `description`/et), read-back verifies BOTH are present with the exact
 * strings (not just count) — catches a partial write or a silent
 * single-language landing. Idempotency guard: a fresh GET immediately
 * precedes every write; if a description already exists (any language),
 * SKIP rather than append a duplicate/second value. */
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

/** Canary — one type-kind target + one prop-kind target, written + verified,
 * BEFORE the full sweep. Throws on either canary failing — refuses to run
 * the full ~160-write sweep on an unproven mechanic for that kind. */
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
