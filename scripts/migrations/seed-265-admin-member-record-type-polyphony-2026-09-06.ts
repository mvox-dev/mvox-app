// mvox-app#265 — provision the `admin_member_record` type-def + its 5
// prop-defs (person, name, phone, email, birthdate) on polyphony, plus the
// `roster_show_real_names` property addition on the existing `database`
// type, using the idempotent CREATE primitive (scripts/migrations/lib/ensure-
// schema-type.ts) against the mvox-side definitions (scripts/migrations/lib/
// mvox-schema-extensions.ts).
//
// Per-property sharing (the load-bearing part, per Mihkel's shape-review
// ruling comment 5561754737 + posture ruling comment 5561632474 — mvox_crede
// is a real-life pilot, not synthetic, so this is a genuine privacy control):
// `person`/`name` -> domain, `phone`/`email`/`birthdate` -> private, ALL set
// EXPLICITLY via `PropertySpec.sharing` on every admin_member_record
// prop-def, INCLUDING `roster_show_real_names` (`domain`, also explicit) —
// see that definition's doc comment for why an earlier omit-and-inherit
// version was wrong: the `database` type's own `_sharing` (what omission
// inherits) is `public` on both databases, a platform-generic constant, NOT
// representative of the sibling prop-defs' actual posture (empirically
// `domain`, checked live). After every prop-def is ensured, its effective
// `_sharing` is read back and asserted against intent (PO addition, same
// comment) — Entu's own create-time inherit-from-parent behavior can
// silently substitute a different value when `_sharing` is omitted
// (mvox-app#265 live-probe finding), so a create landing is not proof it
// landed AS WRITTEN.
//
// Empty structure ONLY — this script creates zero admin_member_record
// instances. Real names/phones/emails/birthdates are a separate, later
// decision requiring Mihkel's explicit say-so (still binding, both rulings).
//
// Authorization: PO-Approved 2026-09-06 (Mihkel shape review, mvox-app#265,
// comment 5561754737) for the definition; team-lead's explicit "I authorize
// this run" gates DRY_RUN=false separately, per the standing two-step gate.
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-265-admin-member-record-type-polyphony-2026-09-06.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-265-admin-member-record-type-polyphony-2026-09-06.ts        # ONLY after dry-run verified + authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import {
	resolveMetaTypeIds,
	resolveTypeIdByName,
	ensureEntityType,
	ensurePropDef,
	assertPropDefSharing,
	type LedgerStep
} from './lib/ensure-schema-type';
import { admin_member_record, roster_show_real_names } from './lib/mvox-schema-extensions';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `seed-265-admin-member-record-type-polyphony-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerStep[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg);
	console.log(`entity meta-type: ${entityMetaTypeId}`);
	console.log(`property meta-type: ${propertyMetaTypeId}`);

	const databaseTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, admin_member_record.parents[0].entity);
	console.log(`database type-def: ${databaseTypeId} (attachment point for roster_show_real_names; its sharing is explicit on the property itself, not resolved from this type — see mvox-schema-extensions.ts)`);

	// --- admin_member_record type + prop-defs ---

	const typeId = await ensureEntityType(
		cfg,
		entityMetaTypeId,
		{
			name: admin_member_record.name,
			sharing: admin_member_record.sharing,
			inheritsRights: admin_member_record.inheritsRights,
			labelEn: 'Admin member record',
			labelEt: 'Admini liikmekirje',
			descriptionEn:
				"Admin-owned record of a member's real identity — real name, phone, email, birth date — independent of the member's own profile. mvox app extension — not part of the canonical v4E schema.",
			descriptionEt:
				'Admini enda hallatav liikme pärisandmete kirje — pärisnimi, telefon, e-post, sünnikuupäev — sõltumatu liikme enda profiilist. Mvoxi rakenduse laiendus — ei kuulu v4E baasstruktuuri hulka.'
		},
		DRY_RUN,
		ledger
	);
	console.log(typeId ? `admin_member_record type-def: ${typeId}` : 'admin_member_record type-def: (would create — dry-run)');

	if (typeId) {
		for (const prop of admin_member_record.properties) {
			const propId = await ensurePropDef(cfg, propertyMetaTypeId, typeId, admin_member_record.name, admin_member_record.sharing, prop, DRY_RUN, ledger);
			const expectedSharing = prop.sharing ?? admin_member_record.sharing;
			console.log(`  ${admin_member_record.name}.${prop.name}: ${propId ?? '(would create — dry-run)'} (expected sharing: ${expectedSharing})`);
			if (propId) {
				await assertPropDefSharing(cfg, propId, `${admin_member_record.name}.${prop.name}`, expectedSharing, ledger);
				console.log(`    read-back-asserted: ${expectedSharing} ✓`);
			}
		}
	} else {
		for (const prop of admin_member_record.properties) {
			const expectedSharing = prop.sharing ?? admin_member_record.sharing;
			ledger.push({ action: 'ensure-propdef', target: `${admin_member_record.name}.${prop.name}`, outcome: 'dry-run', after: { type: prop.type, sharing: expectedSharing, mandatory: prop.required ?? false } });
		}
	}

	// --- roster_show_real_names property addition on database (the collective root) ---
	// Sharing is explicit on the property (`domain`) — NOT resolved from the
	// `database` type's own `_sharing` (which is `public`, a platform-generic
	// constant, not the sibling prop-defs' actual posture). See the doc
	// comment on `roster_show_real_names` in mvox-schema-extensions.ts for the
	// dry-run finding that corrected this from an earlier inherit-via-omission
	// design. The `sharing` parameter below is the ensurePropDef type-level
	// fallback; it's inert here since `prop.sharing` is always set, but a
	// value is still required by the function signature.
	const toggleExpectedSharing = roster_show_real_names.property.sharing ?? 'domain';
	const togglePropId = await ensurePropDef(
		cfg,
		propertyMetaTypeId,
		databaseTypeId,
		'database',
		toggleExpectedSharing,
		roster_show_real_names.property,
		DRY_RUN,
		ledger
	);
	console.log(`  database.${roster_show_real_names.property.name}: ${togglePropId ?? '(would create — dry-run)'} (expected sharing, explicit: ${toggleExpectedSharing})`);
	if (togglePropId) {
		// null only happens on DRY_RUN + not-yet-existing, and ensurePropDef has
		// already pushed the correct dry-run ledger entry itself in that case —
		// no separate push needed here (a prior version of this script double-
		// logged this exact step; fixed after the polyphony dry-run surfaced it).
		await assertPropDefSharing(cfg, togglePropId, `database.${roster_show_real_names.property.name}`, toggleExpectedSharing, ledger);
		console.log(`    read-back-asserted: ${toggleExpectedSharing} ✓`);
	}

	const failures = ledger.filter((e) => e.outcome === 'failed');
	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	for (const e of ledger) console.log(`  ${e.action} ${e.target}: ${e.outcome}${e.id ? ` (${e.id})` : ''}`);
	console.log(`${ledger.length} steps, ${failures.length} failures`);

	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		db: cfg.db,
		authorization: 'PO-Approved 2026-09-06 mvox-app#265 comment 5561754737 (Mihkel shape review)',
		entityMetaTypeId,
		propertyMetaTypeId,
		databaseTypeId,
		toggleExpectedSharing,
		adminMemberRecordTypeId: typeId ?? '<dry-run-unresolved>',
		instancesCreated: 0,
		ledger,
		exitCode: failures.length > 0 ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('seed-265-admin-member-record-type-polyphony ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
