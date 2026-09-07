// mvox-app#282 — provision the `id_code` prop-def on the EXISTING
// `admin_member_record` type-def on polyphony, using the same idempotent
// CREATE primitive as #265's provisioning (scripts/migrations/lib/
// ensure-schema-type.ts) against the mvox-side definition
// (scripts/migrations/lib/mvox-schema-extensions.ts).
//
// Unlike #265, this does NOT create a type — admin_member_record already
// exists live on both dbs. This is a single ensurePropDef call adding one
// more field to it, exactly the operation ensurePropDef already supports
// (idempotent check-then-create against an EXISTING parent type-def).
//
// EMPTY STRUCTURE ONLY, zero instances. polyphony is the synthetic dev/test
// db — same posture as every #265/#246 provisioning run there.
//
// `_sharing: private`, explicit on the prop-def — same discipline as
// phone/email/birthdate, for the same reason (#265's two same-night
// defects are the standing precedent: omitting `_sharing` inherits the
// parent TYPE's tier, not private). Read back and asserted after creation
// via `assertPropDefSharing`, same as every #265 prop-def.
//
// READ-BACK ASSERTION KEYING (team-lead requirement, 2026-09-07): the
// ledger's read-back line must be keyed to an identifier that SURVIVES
// redaction — with 'name' in DEFAULT_REDACT_FIELDS since #278, any ledger
// field literally called `name` renders as [REDACTED], which would make a
// name-keyed assertion prove nothing about which field was checked.
// `ensurePropDef`/`assertPropDefSharing`'s own LedgerStep shape
// (`{action, target, id, outcome, after}`) uses NONE of DEFAULT_REDACT_
// FIELDS as a key — `target` (holding the human-readable label string),
// `id` (the prop-def's own Entu _id) and `after.sharing` all survive
// untouched. Verified by inspecting ensure-schema-type.ts's ledger.push
// call sites before writing this script, not assumed.
//
// Authorization: PO-Approved 2026-09-07 (Gama, mvox-app#282, comment
// 5573048456; Mihkel verbatim GO) for the definition; team-lead's explicit
// "I authorize this run" gates DRY_RUN=false separately, per the standing
// two-step gate.
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-282-id-code-propdef-polyphony-2026-09-07.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-282-id-code-propdef-polyphony-2026-09-07.ts        # ONLY after dry-run verified + authorization

import {
	resolveMetaTypeIds,
	resolveTypeIdByName,
	ensurePropDef,
	assertPropDefSharing,
	type LedgerStep
} from './lib/ensure-schema-type';
import { admin_member_record } from './lib/mvox-schema-extensions';
import { loadCfg } from './lib/creds';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';

const DRY_RUN = readDryRun();

// mvox-app#274/#278/#282 — writeLedger goes through the shared, redaction-
// aware writer; `sensitive: false` (polyphony is synthetic, and this
// ledger is schema-level regardless).
function writeLedger(payload: Record<string, unknown>): string {
	return writeLedgerShared({
		scriptName: 'seed-282-id-code-propdef-polyphony',
		dryRun: DRY_RUN,
		db: process.env.ENTU_DATABASE ?? 'polyphony',
		sensitive: false,
		payload
	});
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerStep[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg);
	console.log(`entity meta-type: ${entityMetaTypeId}`);
	console.log(`property meta-type: ${propertyMetaTypeId}`);

	const typeId = await resolveTypeIdByName(cfg, entityMetaTypeId, admin_member_record.name);
	console.log(`admin_member_record type-def (existing, #265): ${typeId}`);

	const idCodeProp = admin_member_record.properties.find((p) => p.name === 'id_code');
	if (!idCodeProp) throw new Error('id_code PropertySpec not found on admin_member_record.properties — schema-extensions.ts drifted from this script');
	const expectedSharing = idCodeProp.sharing ?? admin_member_record.sharing;

	const propId = await ensurePropDef(cfg, propertyMetaTypeId, typeId, admin_member_record.name, admin_member_record.sharing, idCodeProp, DRY_RUN, ledger);
	console.log(`  ${admin_member_record.name}.${idCodeProp.name}: ${propId ?? '(would create — dry-run)'} (expected sharing: ${expectedSharing})`);

	if (propId) {
		await assertPropDefSharing(cfg, propId, `${admin_member_record.name}.${idCodeProp.name}`, expectedSharing, ledger);
		console.log(`    read-back-asserted: propDefId=${propId} sharing=${expectedSharing} ordinal=${idCodeProp.ordinal} ✓`);
	} else {
		console.log(`    read-back: skipped (dry-run, no propDefId to read back yet)`);
	}

	const failures = ledger.filter((e) => e.outcome === 'failed');
	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	for (const e of ledger) console.log(`  ${e.action} ${e.target}: ${e.outcome}${e.id ? ` (${e.id})` : ''}`);
	console.log(`${ledger.length} steps, ${failures.length} failures`);

	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		db: cfg.db,
		authorization: 'PO-Approved 2026-09-07 mvox-app#282 comment 5573048456 (Gama, Mihkel verbatim GO)',
		entityMetaTypeId,
		propertyMetaTypeId,
		adminMemberRecordTypeId: typeId,
		idCodePropDefId: propId ?? '<dry-run-unresolved>',
		idCodeOrdinal: idCodeProp.ordinal,
		idCodeExpectedSharing: expectedSharing,
		instancesCreated: 0,
		ledger,
		exitCode: failures.length > 0 ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('seed-282-id-code-propdef-polyphony ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
