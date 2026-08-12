// TD.3 (#119) — Entity type label consistency fix (LABELS ONLY).
// Scope: labels ONLY. Description field is NOT touched (already fully populated
// EN+ET from #48, 160/160 PO-approved).
//
// Fix: replace the single untagged `label` value on each of the 18 non-conformant
// type entities with a short, bilingual (EN + ET) pair matching the shape of
// `person` and `profile` (the 2 correct types).
//
// Two fix classes:
//   9 types with description-text duplicated into label (need short replacement)
//   9 types with short-but-untranslated or camelCase labels (need humanization + ET)
//
// Mechanic: Entu POST appends multi-value. To REPLACE, we must DELETE the existing
// property value first (by its property-value _id), then POST two new values with
// language tags. Deletion uses DELETE /property/{id}; creation uses POST /entity/{id}
// with JSON body [{type: 'label', language: 'en', string: ...}, ...].
//
// Safety: POST new labels BEFORE DELETE old. Verify POST succeeded via read-back
// before proceeding with DELETE. Never leave a type without a label.
//
// DRY_RUN=true by default. Cosmetic tier (no _sharing/rights/data mutation).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td3-type-labels.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td3-type-labels.ts       # ONLY after dry-run verified

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// ── Target manifest ────────────────────────────────────────────────────────────
// Each entry: type schema name, type entity ID, known label property-value _id,
// current label text (for verification), target EN label, target ET label.
//
// Source: live polyphony query 2026-08-12 + Dimension 2 audit from issue #117.
// Estonian choral domain terms validated against task brief.

interface LabelTarget {
	typeName: string;
	typeEntityId: string;
	currentLabelPropValueId: string;
	currentLabelText: string;
	targetEn: string;
	targetEt: string;
	fixClass: 'description-in-label' | 'untranslated';
}

const TARGETS: LabelTarget[] = [
	// ── Fix class 1: description text duplicated into label ──────────────────
	{
		typeName: 'voice',
		typeEntityId: '6a0d2e8090c8df7a1cc7dd6a',
		currentLabelPropValueId: '6a0d2e8090c8df7a1cc7dd6e',
		currentLabelText: 'Global vocal-range taxonomy (one source of truth referenced by person and section).',
		targetEn: 'Voice',
		targetEt: 'Hääl',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'library',
		typeEntityId: '6a0d2e8090c8df7a1cc7dd9d',
		currentLabelPropValueId: '6a0d2e8090c8df7a1cc7dda1',
		currentLabelText: '1:1 container for an org\'s catalog + lending. Root of the librarian-scoped subtree.',
		targetEn: 'Library',
		targetEt: 'Noodikogu',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'copy',
		typeEntityId: '6a0d2e8190c8df7a1cc7ddb0',
		currentLabelPropValueId: '6a0d2e8190c8df7a1cc7ddb4',
		currentLabelText: 'Physical copy of an edition (was `inventory_copy` in v3).',
		targetEn: 'Copy',
		targetEt: 'Eksemplar',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'lending',
		typeEntityId: '6a0d2e8190c8df7a1cc7dde8',
		currentLabelPropValueId: '6a0d2e8190c8df7a1cc7ddec',
		currentLabelText: 'First-class loan record. Replaces v3 inline `inventory_copy.assigned_to`.',
		targetEn: 'Loan',
		targetEt: 'Laenutus',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'invitation',
		typeEntityId: '6a0d2e8290c8df7a1cc7de3e',
		currentLabelPropValueId: '6a0d2e8290c8df7a1cc7de42',
		currentLabelText: 'Org\'s consent. Admin creates; user accepts → member created + invitation deleted.',
		targetEn: 'Invitation',
		targetEt: 'Kutse',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'event_series',
		typeEntityId: '6a0d2e8490c8df7a1cc7deb1',
		currentLabelPropValueId: '6a0d2e8490c8df7a1cc7deb5',
		currentLabelText: 'Recurring pattern that materialises into events. Series defines defaults; events inherit + override.',
		targetEn: 'Event series',
		targetEt: 'Sündmuste sari',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'rsvp',
		typeEntityId: '6a0d2e8590c8df7a1cc7df1b',
		currentLabelPropValueId: '6a0d2e8590c8df7a1cc7df1f',
		currentLabelText: 'Member\'s pre-event commitment. Lives under person so member can create natively.',
		targetEn: 'RSVP',
		targetEt: 'Osalusteade',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'attendance',
		typeEntityId: '6a0d2e8690c8df7a1cc7df4b',
		currentLabelPropValueId: '6a0d2e8690c8df7a1cc7df4f',
		currentLabelText: 'Conductor\'s post-event record.',
		targetEn: 'Attendance',
		targetEt: 'Kohalolek',
		fixClass: 'description-in-label'
	},
	{
		typeName: 'mvox_collective',
		typeEntityId: '6a73880336c951d9114ec63d',
		currentLabelPropValueId: '6a73880336c951d9114ec641',
		currentLabelText: 'Mvox Collective (marker)',
		targetEn: 'Collective marker',
		targetEt: 'Kollektiivi märgis',
		fixClass: 'description-in-label'
	},

	// ── Fix class 2: short-but-untranslated or camelCase labels ─────────────
	{
		typeName: 'section',
		typeEntityId: '69c7ea498489bfcb0e819ea3',
		currentLabelPropValueId: '69c7ea498489bfcb0e819ea6',
		currentLabelText: 'Section',
		targetEn: 'Section',
		targetEt: 'Hääleliik',
		fixClass: 'untranslated'
	},
	{
		typeName: 'event',
		typeEntityId: '69c7ea548489bfcb0e81a0a2',
		currentLabelPropValueId: '69c7ea548489bfcb0e81a0a5',
		currentLabelText: 'Event',
		targetEn: 'Event',
		targetEt: 'Sündmus',
		fixClass: 'untranslated'
	},
	{
		typeName: 'season',
		typeEntityId: '69c7ea528489bfcb0e81a044',
		currentLabelPropValueId: '69c7ea528489bfcb0e81a047',
		currentLabelText: 'Season',
		targetEn: 'Season',
		targetEt: 'Hooaeg',
		fixClass: 'untranslated'
	},
	{
		typeName: 'organization',
		typeEntityId: '69c7ea478489bfcb0e819e3d',
		currentLabelPropValueId: '69c7ea478489bfcb0e819e40',
		currentLabelText: 'Organization',
		targetEn: 'Organisation',
		targetEt: 'Organisatsioon',
		fixClass: 'untranslated'
	},
	{
		typeName: 'member',
		typeEntityId: '69c7ea4a8489bfcb0e819edd',
		currentLabelPropValueId: '69c7ea4a8489bfcb0e819ee0',
		currentLabelText: 'Member',
		targetEn: 'Member',
		targetEt: 'Liige',
		fixClass: 'untranslated'
	},
	{
		typeName: 'work',
		typeEntityId: '69c7ea4c8489bfcb0e819f3e',
		currentLabelPropValueId: '69c7ea4c8489bfcb0e819f41',
		currentLabelText: 'Work',
		targetEn: 'Work',
		targetEt: 'Teos',
		fixClass: 'untranslated'
	},
	{
		typeName: 'edition',
		typeEntityId: '69c7ea4e8489bfcb0e819f9c',
		currentLabelPropValueId: '69c7ea4e8489bfcb0e819f9f',
		currentLabelText: 'Edition',
		targetEn: 'Edition',
		targetEt: 'Väljaanne',
		fixClass: 'untranslated'
	},
	{
		typeName: 'repertoire_item',
		typeEntityId: '69c7ea538489bfcb0e81a06e',
		currentLabelPropValueId: '69c7ea538489bfcb0e81a071',
		currentLabelText: 'RepertoireItem',
		targetEn: 'Repertoire item',
		targetEt: 'Repertuaarikirje',
		fixClass: 'untranslated'
	},
	{
		typeName: 'program_item',
		typeEntityId: '69c7ea568489bfcb0e81a103',
		currentLabelPropValueId: '69c7ea568489bfcb0e81a106',
		currentLabelText: 'ProgramItem',
		targetEn: 'Programme item',
		targetEt: 'Kavakirje',
		fixClass: 'untranslated'
	}
];

// ── Ledger ──────────────────────────────────────────────────────────────────────

interface LedgerEntry {
	action: 'delete-old-label' | 'post-new-labels' | 'verify-readback';
	typeName: string;
	typeEntityId: string;
	status: 'ok' | 'failed' | 'dry-run' | 'skipped';
	detail?: string;
}

const ledger: LedgerEntry[] = [];

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `tidy-td3-type-labels-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

// ── Pre-flight: verify current label values match expectations ──────────────

async function preflight(cfg: EntuCfg): Promise<{ verified: LabelTarget[]; mismatches: Array<{ target: LabelTarget; actual: unknown }> }> {
	const verified: LabelTarget[] = [];
	const mismatches: Array<{ target: LabelTarget; actual: unknown }> = [];

	for (const t of TARGETS) {
		const res = await entuFetch(cfg.db, `entity/${t.typeEntityId}?props=label`, cfg.token);
		if (!res.ok) {
			mismatches.push({ target: t, actual: `GET failed: ${res.status}` });
			continue;
		}
		const body = (await res.json()) as { entity?: { label?: Array<{ _id: string; string: string; language?: string }> } };
		const labels = body.entity?.label ?? [];

		// Expect exactly 1 label value with the known _id and text, no language tag
		if (labels.length !== 1) {
			mismatches.push({ target: t, actual: `expected 1 label value, found ${labels.length}: ${JSON.stringify(labels)}` });
			continue;
		}
		const lbl = labels[0];
		if (lbl._id !== t.currentLabelPropValueId) {
			mismatches.push({ target: t, actual: `label prop-value _id mismatch: expected ${t.currentLabelPropValueId}, got ${lbl._id}` });
			continue;
		}
		if (lbl.string !== t.currentLabelText) {
			mismatches.push({ target: t, actual: `label text mismatch: expected ${JSON.stringify(t.currentLabelText)}, got ${JSON.stringify(lbl.string)}` });
			continue;
		}
		if (lbl.language) {
			mismatches.push({ target: t, actual: `label already has language tag '${lbl.language}' — may have been fixed already` });
			continue;
		}
		verified.push(t);
	}
	return { verified, mismatches };
}

// ── Single-type fix: POST new labels first, verify, then DELETE old ─────────
// Safety invariant: never leave a type without a label. POST appends (multi-value),
// so after POST the type has 3 labels (old untagged + new en + new et). Verify
// the new labels exist before deleting the old one.

async function fixOneType(cfg: EntuCfg, t: LabelTarget): Promise<boolean> {
	// Step 1: POST two new label values with language tags (appends — type keeps old label too)
	const postRes = await entuFetch(cfg.db, `entity/${t.typeEntityId}`, cfg.token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([
			{ type: 'label', language: 'en', string: t.targetEn },
			{ type: 'label', language: 'et', string: t.targetEt }
		])
	});
	if (!postRes.ok) {
		const text = await postRes.text().catch(() => '(no body)');
		ledger.push({
			action: 'post-new-labels',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `POST label (en+et) on entity ${t.typeEntityId} failed: ${postRes.status} — ${text}`
		});
		return false;
	}
	ledger.push({
		action: 'post-new-labels',
		typeName: t.typeName,
		typeEntityId: t.typeEntityId,
		status: 'ok',
		detail: `posted label en="${t.targetEn}" et="${t.targetEt}"`
	});

	// Step 2: Read-back verify — new labels exist before we delete the old one
	const midGetRes = await entuFetch(cfg.db, `entity/${t.typeEntityId}?props=label`, cfg.token);
	if (!midGetRes.ok) {
		ledger.push({
			action: 'verify-readback',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `mid-fix read-back GET failed: ${midGetRes.status} — aborting before DELETE`
		});
		return false;
	}
	const midBody = (await midGetRes.json()) as { entity?: { label?: Array<{ _id: string; string: string; language?: string }> } };
	const midLabels = midBody.entity?.label ?? [];
	const midEn = midLabels.find((v) => v.language === 'en' && v.string === t.targetEn);
	const midEt = midLabels.find((v) => v.language === 'et' && v.string === t.targetEt);

	if (!midEn || !midEt) {
		ledger.push({
			action: 'verify-readback',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `POST succeeded but read-back missing new labels (en=${!!midEn}, et=${!!midEt}) — refusing to DELETE old label`
		});
		return false;
	}

	// Step 3: DELETE the old untagged label property value (safe — new labels confirmed present)
	const delRes = await entuFetch(cfg.db, `property/${t.currentLabelPropValueId}`, cfg.token, {
		method: 'DELETE'
	});
	if (!delRes.ok) {
		const text = await delRes.text().catch(() => '(no body)');
		ledger.push({
			action: 'delete-old-label',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `DELETE /property/${t.currentLabelPropValueId} failed: ${delRes.status} — ${text} (new labels are present, old label remains as extra)`
		});
		return false;
	}
	ledger.push({
		action: 'delete-old-label',
		typeName: t.typeName,
		typeEntityId: t.typeEntityId,
		status: 'ok',
		detail: `deleted prop-value ${t.currentLabelPropValueId} (was: ${JSON.stringify(t.currentLabelText).slice(0, 60)})`
	});

	// Step 4: Final read-back verify — expect exactly 2 label values with correct text + language
	const getRes = await entuFetch(cfg.db, `entity/${t.typeEntityId}?props=label`, cfg.token);
	if (!getRes.ok) {
		ledger.push({
			action: 'verify-readback',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `final read-back GET failed: ${getRes.status}`
		});
		return false;
	}
	const getBody = (await getRes.json()) as { entity?: { label?: Array<{ string: string; language?: string }> } };
	const newLabels = getBody.entity?.label ?? [];
	const enLabel = newLabels.find((v) => v.language === 'en');
	const etLabel = newLabels.find((v) => v.language === 'et');
	const untagged = newLabels.filter((v) => !v.language);

	if (!enLabel || enLabel.string !== t.targetEn) {
		ledger.push({
			action: 'verify-readback',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `EN label mismatch: expected ${JSON.stringify(t.targetEn)}, got ${JSON.stringify(enLabel?.string)}`
		});
		return false;
	}
	if (!etLabel || etLabel.string !== t.targetEt) {
		ledger.push({
			action: 'verify-readback',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `ET label mismatch: expected ${JSON.stringify(t.targetEt)}, got ${JSON.stringify(etLabel?.string)}`
		});
		return false;
	}
	if (untagged.length > 0) {
		ledger.push({
			action: 'verify-readback',
			typeName: t.typeName,
			typeEntityId: t.typeEntityId,
			status: 'failed',
			detail: `${untagged.length} untagged label value(s) still present after fix — DELETE may not have taken effect`
		});
		return false;
	}

	ledger.push({
		action: 'verify-readback',
		typeName: t.typeName,
		typeEntityId: t.typeEntityId,
		status: 'ok',
		detail: `verified: en="${enLabel.string}" et="${etLabel.string}", ${newLabels.length} total values`
	});
	return true;
}

// ── Dry-run plan renderer ───────────────────────────────────────────────────

function renderDryRunPlan(
	verified: LabelTarget[],
	mismatches: Array<{ target: LabelTarget; actual: unknown }>
): string {
	const lines: string[] = [];
	lines.push('TD.3 (#119) — Entity type label consistency fix — DRY-RUN PLAN');
	lines.push('Scope: labels ONLY. Description field is NOT touched (already populated EN+ET from #48).');
	lines.push('');
	lines.push(`Total targets: ${TARGETS.length}`);
	lines.push(`Preflight verified (would fix): ${verified.length}`);
	lines.push(`Preflight mismatches (would SKIP): ${mismatches.length}`);
	lines.push('');

	if (mismatches.length > 0) {
		lines.push('== MISMATCHES (skipped) ==');
		for (const m of mismatches) {
			lines.push(`  ${m.target.typeName} (${m.target.typeEntityId}): ${m.actual}`);
		}
		lines.push('');
	}

	const descGroup = verified.filter((t) => t.fixClass === 'description-in-label');
	const untransGroup = verified.filter((t) => t.fixClass === 'untranslated');

	lines.push('== Fix class 1: description text duplicated into label (9 types) ==');
	lines.push('  Action per type: DELETE old untagged label, POST short EN + ET pair');
	for (const t of descGroup) {
		lines.push(`  ${t.typeName.padEnd(18)} | current: ${JSON.stringify(t.currentLabelText).slice(0, 50)}...`);
		lines.push(`  ${''.padEnd(18)} | target:  en="${t.targetEn}" et="${t.targetEt}"`);
	}
	lines.push('');

	lines.push('== Fix class 2: short-but-untranslated or camelCase labels (9 types) ==');
	lines.push('  Action per type: DELETE old untagged label, POST humanized EN + ET pair');
	for (const t of untransGroup) {
		lines.push(`  ${t.typeName.padEnd(18)} | current: ${JSON.stringify(t.currentLabelText)}`);
		lines.push(`  ${''.padEnd(18)} | target:  en="${t.targetEn}" et="${t.targetEt}"`);
	}
	lines.push('');

	lines.push('== Per-type operations ==');
	lines.push('  Each type: 1 DELETE /property/{id} + 1 POST /entity/{id} + 1 GET /entity/{id} (read-back verify)');
	lines.push(`  Total API calls: ${verified.length * 3} (${verified.length} deletes + ${verified.length} posts + ${verified.length} verifies)`);
	lines.push('');

	lines.push('== Mutation writes (excluding read-back GETs) ==');
	const totalWrites = verified.length * 2; // 1 DELETE + 1 POST per type
	lines.push(`  Total: ${totalWrites} (${verified.length} DELETEs + ${verified.length} POSTs)`);
	lines.push('');

	lines.push('== Canary strategy ==');
	lines.push('  First type from each fix class is treated as canary.');
	lines.push('  If either canary fails, the full sweep for that class is aborted.');
	lines.push('');

	lines.push(`Writes issued this run: 0 (DRY_RUN=true).`);
	lines.push('Set DRY_RUN=false to execute live.');
	return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}`);
	console.log(`Targets: ${TARGETS.length} type entities\n`);

	// Preflight: verify all current label values match expectations
	console.log('Preflight: verifying current label state...');
	const { verified, mismatches } = await preflight(cfg);
	console.log(`  ${verified.length} verified, ${mismatches.length} mismatches`);

	if (mismatches.length > 0) {
		console.log('  Mismatches:');
		for (const m of mismatches) {
			console.log(`    ${m.target.typeName}: ${m.actual}`);
		}
	}

	if (DRY_RUN) {
		const plan = renderDryRunPlan(verified, mismatches);
		console.log('\n' + plan);
		const totalLabelWrites = verified.length * 2;
		const artifactPath = writeLedger({
			dryRun: true,
			scope: 'labels-only (description field NOT touched -- already populated EN+ET from #48)',
			labels: {
				preflightVerified: verified.length,
				preflightMismatches: mismatches.map((m) => ({ typeName: m.target.typeName, reason: m.actual })),
				writesPlanned: totalLabelWrites
			},
			totalWritesPlanned: totalLabelWrites,
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`\nDry-run ledger: ${artifactPath}`);
		process.exit(0);
	}

	// Live execution
	if (verified.length === 0) {
		console.log('\nNo verified targets to fix. Exiting.');
		process.exit(0);
	}

	// Canary: one from each fix class
	const canaryDesc = verified.find((t) => t.fixClass === 'description-in-label');
	const canaryUntrans = verified.find((t) => t.fixClass === 'untranslated');
	const canaries = [canaryDesc, canaryUntrans].filter((t): t is LabelTarget => t !== undefined);

	console.log(`\n== Canary phase: ${canaries.length} canaries ==`);
	for (const c of canaries) {
		console.log(`  Canary: ${c.typeName} (${c.fixClass})`);
		const ok = await fixOneType(cfg, c);
		if (!ok) {
			console.error(`  CANARY FAILED: ${c.typeName} — refusing to run the full sweep for class '${c.fixClass}'.`);
			const failLedger = writeLedger({
				dryRun: false,
				canaryFailed: c.typeName,
				fixClass: c.fixClass,
				ledger,
				exitCode: 1
			});
			console.log(`Ledger: ${failLedger}`);
			process.exit(1);
		}
		console.log(`  Canary OK: ${c.typeName}`);
	}

	// Full sweep (skip canaries)
	const canaryIds = new Set(canaries.map((c) => c.typeEntityId));
	const remaining = verified.filter((t) => !canaryIds.has(t.typeEntityId));

	console.log(`\n== Full sweep: ${remaining.length} remaining types ==`);
	let successCount = 0;
	let failCount = 0;
	for (const t of remaining) {
		const ok = await fixOneType(cfg, t);
		if (ok) {
			console.log(`  OK: ${t.typeName}`);
			successCount++;
		} else {
			console.error(`  FAILED: ${t.typeName}`);
			failCount++;
		}
	}

	// Summary
	const totalLabelFixed = successCount + canaries.length;
	const hasFailures = failCount > 0;

	console.log('\n== SUMMARY ==');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Canaries: ${canaries.length} OK`);
	console.log(`Sweep: ${successCount} OK, ${failCount} failed`);
	console.log(`Total labels fixed: ${totalLabelFixed}/${verified.length}`);
	if (mismatches.length > 0) {
		console.log(`Skipped (preflight mismatch): ${mismatches.length}`);
	}
	const totalMutations = totalLabelFixed * 2;
	console.log(`Total mutation API calls: ${totalMutations} (${totalLabelFixed} DELETEs + ${totalLabelFixed} POSTs)`);

	const artifactPath = writeLedger({
		dryRun: false,
		scope: 'labels-only (description field NOT touched -- already populated EN+ET from #48)',
		labels: {
			preflightVerified: verified.length,
			preflightMismatches: mismatches.map((m) => ({ typeName: m.target.typeName, reason: m.actual })),
			canaries: canaries.map((c) => c.typeName),
			totalFixed: totalLabelFixed,
			totalFailed: failCount
		},
		totalMutationApiCalls: totalMutations,
		ledger,
		exitCode: hasFailures ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('TD.3 type-labels ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
