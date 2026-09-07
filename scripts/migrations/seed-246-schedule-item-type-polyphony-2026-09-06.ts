// mvox-app#246 — provision the `schedule_item` type-def + its 2 prop-defs
// (name, datetime) on polyphony, using the new idempotent CREATE primitive
// (scripts/migrations/lib/ensure-schema-type.ts) against the mvox-side
// definition (scripts/migrations/lib/mvox-schema-extensions.ts).
//
// Authorization: PO-Approved 2026-09-06 (Gama SETTLE, mvox-app#246) + team-lead
// explicit "I authorize this run" (both polyphony and mvox_crede named in the
// ruling; all data on both is test data).
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-246-schedule-item-type-polyphony-2026-09-06.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-246-schedule-item-type-polyphony-2026-09-06.ts        # ONLY after dry-run verified + authorization

import { loadCfg } from './lib/creds';
import { resolveMetaTypeIds, resolveTypeIdByName, ensureEntityType, ensurePropDef, ensureAddFrom, type LedgerStep } from './lib/ensure-schema-type';
import { schedule_item } from './lib/mvox-schema-extensions';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';

const DRY_RUN = readDryRun();

// mvox-app#274 — writeLedger now goes through the shared, redaction-aware
// writer; `sensitive: false` (polyphony is synthetic, and this ledger is
// schema-level regardless).
function writeLedger(payload: Record<string, unknown>): string {
	return writeLedgerShared({ scriptName: 'seed-246-schedule-item-type-polyphony', dryRun: DRY_RUN, db: process.env.ENTU_DATABASE ?? 'polyphony', sensitive: false, payload });
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerStep[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg);
	console.log(`entity meta-type: ${entityMetaTypeId}`);
	console.log(`property meta-type: ${propertyMetaTypeId}`);

	const eventTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, 'event');
	console.log(`event type-def: ${eventTypeId}`);

	const typeId = await ensureEntityType(
		cfg,
		entityMetaTypeId,
		{
			name: schedule_item.name,
			sharing: schedule_item.sharing,
			inheritsRights: schedule_item.inheritsRights,
			labelEn: 'Schedule item',
			labelEt: 'Ajakava punkt',
			descriptionEn:
				'A single named point in time within an event (call, rehearsal start, performance start). mvox app extension — not part of the canonical v4E schema.',
			descriptionEt:
				'Sündmuse üksik nimetatud ajapunkt (kutse, proovi algus, esituse algus). Mvoxi rakenduse laiendus — ei kuulu v4E baasstruktuuri hulka.'
		},
		DRY_RUN,
		ledger
	);
	console.log(typeId ? `schedule_item type-def: ${typeId}` : 'schedule_item type-def: (would create — dry-run)');

	const resolvedTypeId = typeId ?? '<dry-run-unresolved>';
	if (typeId) {
		for (const prop of schedule_item.properties) {
			const propId = await ensurePropDef(cfg, propertyMetaTypeId, typeId, schedule_item.name, schedule_item.sharing, prop, DRY_RUN, ledger);
			console.log(`  ${schedule_item.name}.${prop.name}: ${propId ?? '(would create — dry-run)'}`);
		}
		if (schedule_item.addFrom) {
			await ensureAddFrom(cfg, typeId, schedule_item.name, eventTypeId, schedule_item.addFrom, DRY_RUN, ledger);
			console.log(`  add_from: ${schedule_item.addFrom} (${eventTypeId})`);
		}
	} else {
		// Dry-run with no existing type: still report what the prop-defs + add_from
		// WOULD be, without a real parent id to query existence against.
		for (const prop of schedule_item.properties) {
			ledger.push({ action: 'ensure-propdef', target: `${schedule_item.name}.${prop.name}`, outcome: 'dry-run', after: { type: prop.type, sharing: schedule_item.sharing, mandatory: prop.required ?? false } });
		}
		if (schedule_item.addFrom) {
			ledger.push({ action: 'ensure-add-from', target: `${schedule_item.name}.add_from`, outcome: 'dry-run', after: eventTypeId });
		}
	}

	const failures = ledger.filter((e) => e.outcome === 'failed');
	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	for (const e of ledger) console.log(`  ${e.action} ${e.target}: ${e.outcome}${e.id ? ` (${e.id})` : ''}`);
	console.log(`${ledger.length} steps, ${failures.length} failures`);

	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		db: cfg.db,
		authorization: 'PO-Approved 2026-09-06 mvox-app#246 (Gama settle comment)',
		entityMetaTypeId,
		propertyMetaTypeId,
		eventTypeId,
		scheduleItemTypeId: resolvedTypeId,
		ledger,
		exitCode: failures.length > 0 ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('seed-246-schedule-item-type-polyphony ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
