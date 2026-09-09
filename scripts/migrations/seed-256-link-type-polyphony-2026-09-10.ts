// mvox-app#256 — provision the `link` type-def + its 4 prop-defs (name, url,
// description, display_order) on polyphony, using the idempotent CREATE
// primitive (scripts/migrations/lib/ensure-schema-type.ts) against the
// mvox-side definition (scripts/migrations/lib/mvox-schema-extensions.ts).
//
// Authorization: PO-Approved 2026-09-09 (Gama, mvox-app#256, "Signed off as
// an app extension type", quoting Mihkel verbatim: "link entity is app
// extension. we are free from v4E.") for the definition; team-lead's
// explicit "I authorize this run" gates DRY_RUN=false separately, per the
// standing two-step gate.
//
// Empty structure only — this script creates zero `link` instances.
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-256-link-type-polyphony-2026-09-10.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-256-link-type-polyphony-2026-09-10.ts        # ONLY after dry-run verified + authorization

import { loadCfg } from './lib/creds';
import { resolveMetaTypeIds, resolveTypeIdByName, ensureEntityType, ensurePropDef, ensureAddFrom, type LedgerStep } from './lib/ensure-schema-type';
import { link } from './lib/mvox-schema-extensions';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';

const DRY_RUN = readDryRun();

// mvox-app#274 — writeLedger goes through the shared, redaction-aware writer;
// `sensitive: false` (polyphony is synthetic, and this ledger is schema-level
// regardless — type/prop-def ids and sharing metadata only, zero instances).
function writeLedger(payload: Record<string, unknown>): string {
	return writeLedgerShared({ scriptName: 'seed-256-link-type-polyphony', dryRun: DRY_RUN, db: process.env.ENTU_DATABASE ?? 'polyphony', sensitive: false, payload });
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const ledger: LedgerStep[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg);
	console.log(`entity meta-type: ${entityMetaTypeId}`);
	console.log(`property meta-type: ${propertyMetaTypeId}`);

	// `link.parents[0].entity` is 'database' — the collective root, verified
	// live (not 'organization', which #161 retired; see mvox-schema-extensions.ts
	// doc comment + probe-256-link-premise-check-2026-09-10.ts).
	const databaseTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, link.parents[0].entity);
	console.log(`database type-def: ${databaseTypeId}`);

	const typeId = await ensureEntityType(
		cfg,
		entityMetaTypeId,
		{
			name: link.name,
			sharing: link.sharing,
			inheritsRights: link.inheritsRights,
			labelEn: 'Link',
			labelEt: 'Link',
			descriptionEn:
				"A named URL kept for the collective's members — an external resource the choir shares (e.g. a recordings archive). mvox app extension — not part of the canonical v4E schema.",
			descriptionEt:
				'Nimetatud link kollektiivi liikmetele — koori jagatud väline ressurss (nt salvestuste arhiiv). Mvoxi rakenduse laiendus — ei kuulu v4E baasstruktuuri hulka.'
		},
		DRY_RUN,
		ledger
	);
	console.log(typeId ? `link type-def: ${typeId}` : 'link type-def: (would create — dry-run)');

	const resolvedTypeId = typeId ?? '<dry-run-unresolved>';
	if (typeId) {
		for (const prop of link.properties) {
			const propId = await ensurePropDef(cfg, propertyMetaTypeId, typeId, link.name, link.sharing, prop, DRY_RUN, ledger);
			console.log(`  ${link.name}.${prop.name}: ${propId ?? '(would create — dry-run)'}`);
		}
		if (link.addFrom) {
			await ensureAddFrom(cfg, typeId, link.name, databaseTypeId, link.addFrom, DRY_RUN, ledger);
			console.log(`  add_from: ${link.addFrom} (${databaseTypeId})`);
		}
	} else {
		// Dry-run with no existing type: still report what the prop-defs + add_from
		// WOULD be, without a real parent id to query existence against.
		for (const prop of link.properties) {
			ledger.push({ action: 'ensure-propdef', target: `${link.name}.${prop.name}`, outcome: 'dry-run', after: { type: prop.type, sharing: link.sharing, mandatory: prop.required ?? false } });
		}
		if (link.addFrom) {
			ledger.push({ action: 'ensure-add-from', target: `${link.name}.add_from`, outcome: 'dry-run', after: databaseTypeId });
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
		authorization: 'PO-Approved 2026-09-09 mvox-app#256 (Gama "Signed off as an app extension type", Mihkel verbatim "link entity is app extension. we are free from v4E.")',
		entityMetaTypeId,
		propertyMetaTypeId,
		databaseTypeId,
		linkTypeId: resolvedTypeId,
		instancesCreated: 0,
		ledger,
		exitCode: failures.length > 0 ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('seed-256-link-type-polyphony ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Perotin*)
