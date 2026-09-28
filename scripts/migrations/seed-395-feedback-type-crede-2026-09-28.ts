// mvox-app#395 slice 1/2 — provision the `feedback` type-def + its 3
// prop-defs (screenshot, doodle_layer, description) on mvox_crede, crede
// ONLY (the #233 estate ruling, 2026-09-18, ends the per-collective
// twin-script pattern for every schema change since). Identity (name,
// sharing, inheritsRights, field shapes/descriptions/ordinals) comes from
// `feedback` in `lib/mvox-schema-extensions.ts` — nothing hardcoded here.
//
// `runSeed395(cfg, dryRun, fetchImpl, authorizedBy?)` is the whole
// contract, pinned by `seed-395-feedback-type-crede-2026-09-28.spec.ts`:
// side-effect-free on import (no top-level network call — `main()` below
// only runs when this file is executed directly, guarded by the
// `isMainModule` check at the bottom, same pattern as
// seed-233-s1-event-name-propdef-crede.ts), so importing it from a test
// never attempts `loadCredeCfg` or a live fetch — the network guard would
// fail the suite loudly if it did.
//
// EMPTY STRUCTURE ONLY. mvox_crede is a real-life pilot holding real
// people's personal data — this script writes ONLY the type-def and its
// three prop-defs; it creates zero member records and zero feedback
// instances.
//
// `_sharing` is set EXPLICITLY (`domain`) on the type and on every prop-def
// — never omitted (the mvox-app#265 inherit-from-parent trap: omitting
// `_sharing` on create silently inherits the PARENT's tier, not private).
// Every write is read back afterward and its `_sharing` asserted to match,
// the same discipline #265 established (comment 5561754737) — a
// create-time write landing is not proof it landed AS WRITTEN.
//
// Ledger: schema/type-provisioning posture (mvox-app#274/#278) —
// `sensitive: false` (zero instances, zero real-person data),
// `acknowledgedNonSensitive: true` (required whenever `db` looks like
// crede and `sensitive: false`, per the #274 review round 1 cross-check).
//
// Authorization: PO-Approved via the #395 body (Gama's ruling settling the
// shape; Mihkel's "#395 go-ahead!", 2026-09-28, for the live run itself).
// Team-lead's explicit "I authorize this run" still gates DRY_RUN=false
// separately, per the standing two-step gate (crede is real PII — routine
// pre-authorization covers synthetic-db work only). NO LIVE RUN happens in
// this pipeline — this script is exercised dry-run-only here; the live
// run is a later, separately authorized step from the team-lead session.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-395-feedback-type-crede-2026-09-28.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-395-feedback-type-crede-2026-09-28.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import {
	resolveMetaTypeIds,
	resolveTypeIdByName,
	ensureEntityType,
	ensurePropDef,
	assertPropDefSharing,
	type LedgerStep
} from './lib/ensure-schema-type';
import { feedback, type PropertySpec } from './lib/mvox-schema-extensions';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

const TYPE_LABEL_EN = 'Feedback';
const TYPE_LABEL_ET = 'Tagasiside';
const TYPE_DESCRIPTION_EN =
	"A member's feedback on the app: a screenshot, ink drawn over it, and a description. Created by the member with their own key. mvox app extension — not part of the canonical v4E schema.";
const TYPE_DESCRIPTION_ET =
	'Liikme tagasiside rakenduse kohta: kuvatõmmis, sellele joonistatud märkused ja kirjeldus. Liige loob selle oma võtmega. Mvoxi rakenduse laiendus — ei kuulu v4E baasstruktuuri hulka.';

// Dry-run placeholder for a prop-def's `_parent` when the type itself
// doesn't exist yet and can't be created (dry run) — there is no real id to
// reference. Live runs always resolve a real typeId before reaching the
// per-field loop, so this literal never reaches a live POST.
const PENDING_TYPE = '<feedback type-def id, assigned at create>';

/** The exact CREATE body `ensureEntityType` would send for the `feedback`
 * type-def — reconstructed here (not exposed by that helper) purely to
 * populate `plannedWrites` with what a live run would/did issue. */
function typeCreateBody(entityMetaTypeId: string): unknown[] {
	return [
		{ type: '_type', reference: entityMetaTypeId },
		{ type: 'name', string: feedback.name },
		{ type: 'label', language: 'en', string: TYPE_LABEL_EN },
		{ type: 'label', language: 'et', string: TYPE_LABEL_ET },
		{ type: 'description', language: 'en', string: TYPE_DESCRIPTION_EN },
		{ type: 'description', language: 'et', string: TYPE_DESCRIPTION_ET },
		{ type: '_inheritrights', boolean: feedback.inheritsRights },
		{ type: '_sharing', string: feedback.sharing }
	];
}

/** The exact CREATE body `ensurePropDef` would send for one `feedback`
 * field — same reconstruction reason as `typeCreateBody` above. */
function propCreateBody(propertyMetaTypeId: string, parentId: string, prop: PropertySpec): unknown[] {
	const effectiveSharing = prop.sharing ?? feedback.sharing;
	const body: Array<Record<string, unknown>> = [
		{ type: '_type', reference: propertyMetaTypeId },
		{ type: '_parent', reference: parentId },
		{ type: 'name', string: prop.name },
		{ type: 'type', string: prop.type },
		{ type: '_sharing', string: effectiveSharing },
		{ type: 'description', language: 'en', string: prop.descriptionEn },
		{ type: 'description', language: 'et', string: prop.descriptionEt }
	];
	if (prop.required) body.push({ type: 'mandatory', boolean: true });
	if (prop.ordinal !== undefined) body.push({ type: 'ordinal', number: prop.ordinal });
	if (prop.table) body.push({ type: 'table', boolean: true });
	if (prop.search) body.push({ type: 'search', boolean: true });
	return body;
}

export interface PlannedWrite {
	target: string;
	body: unknown[];
}

export interface RunSeed395Result {
	memberTypeId: string;
	typeId: string | null;
	propDefIds: { screenshot: string | null; doodle_layer: string | null; description: string | null };
	plannedWrites: PlannedWrite[];
	ledger: LedgerStep[];
	ledgerPath: string;
}

export async function runSeed395(
	cfg: EntuCfg,
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string
): Promise<RunSeed395Result> {
	// mvox-app#417 — before the first mutating call (ensureEntityType below),
	// and before ANY request at all: a refused live run must leave zero trace
	// on the wire.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	const ledger: LedgerStep[] = [];
	const plannedWrites: PlannedWrite[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);

	// The parent `member` type MUST already exist — fail loud rather than
	// wire an extension type against a parent that isn't there.
	const memberTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, feedback.parents[0].entity, fetchImpl);

	const typeId = await ensureEntityType(
		cfg,
		entityMetaTypeId,
		{
			name: feedback.name,
			sharing: feedback.sharing,
			inheritsRights: feedback.inheritsRights,
			labelEn: TYPE_LABEL_EN,
			labelEt: TYPE_LABEL_ET,
			descriptionEn: TYPE_DESCRIPTION_EN,
			descriptionEt: TYPE_DESCRIPTION_ET
		},
		dryRun,
		ledger,
		fetchImpl
	);

	const typeOutcome = ledger.find((e) => e.action === 'ensure-type' && e.target === feedback.name)?.outcome;
	if (typeOutcome !== 'found') {
		plannedWrites.push({ target: feedback.name, body: typeCreateBody(entityMetaTypeId) });
	}

	// Type readback runs whenever a real id is known — found OR just
	// created — never on the still-unresolved dry-run-absent case (there is
	// nothing to read back yet).
	if (typeId !== null) {
		await assertPropDefSharing(cfg, typeId, feedback.name, feedback.sharing, ledger, fetchImpl);
	}

	const propDefIds: { screenshot: string | null; doodle_layer: string | null; description: string | null } = {
		screenshot: null,
		doodle_layer: null,
		description: null
	};

	for (const prop of feedback.properties) {
		const label = `${feedback.name}.${prop.name}`;
		const effectiveSharing = prop.sharing ?? feedback.sharing;

		if (typeId === null) {
			// Type still absent (dry run only — a live run always resolves a
			// real typeId above, by creating it). No parent id exists to query
			// field existence against, so plan directly with the placeholder —
			// no request issued for this field at all.
			plannedWrites.push({ target: label, body: propCreateBody(propertyMetaTypeId, PENDING_TYPE, prop) });
			ledger.push({
				action: 'ensure-propdef',
				target: label,
				outcome: 'dry-run',
				after: { type: prop.type, sharing: effectiveSharing, mandatory: prop.required ?? false }
			});
			continue;
		}

		const propId = await ensurePropDef(cfg, propertyMetaTypeId, typeId, feedback.name, feedback.sharing, prop, dryRun, ledger, fetchImpl);
		const propOutcome = ledger.find((e) => e.action === 'ensure-propdef' && e.target === label)?.outcome;
		if (propOutcome !== 'found') {
			plannedWrites.push({ target: label, body: propCreateBody(propertyMetaTypeId, typeId, prop) });
		}
		(propDefIds as Record<string, string | null>)[prop.name] = propId;

		// Read-back runs on a found prop-def too, not just a freshly created
		// one — its live sharing must still match the intended posture.
		if (propId) {
			await assertPropDefSharing(cfg, propId, label, effectiveSharing, ledger, fetchImpl);
		}
	}

	const payload = {
		memberTypeId,
		typeId,
		propDefIds,
		plannedWrites,
		instancesCreated: 0,
		ledger
	};

	const ledgerPath = writeLedgerShared({
		scriptName: 'seed-395-feedback-type-crede',
		dryRun,
		db: cfg.db,
		sensitive: false,
		acknowledgedNonSensitive: true,
		authorizedBy,
		payload
	});

	return { memberTypeId, typeId, propDefIds, plannedWrites, ledger, ledgerPath };
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const AUTHORIZED_BY = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed395(cfg, DRY_RUN, fetch, AUTHORIZED_BY);

	console.log(`member type-def: ${result.memberTypeId}`);
	console.log(`feedback type-def: ${result.typeId ?? '(would create — dry-run)'}`);
	for (const prop of feedback.properties) {
		const id = result.propDefIds[prop.name as 'screenshot' | 'doodle_layer' | 'description'];
		console.log(`  feedback.${prop.name}: ${id ?? '(would create — dry-run)'}`);
	}
	console.log(`\n${result.plannedWrites.length} planned write(s), ${result.ledger.length} ledger step(s)`);
	console.log(`Ledger: ${result.ledgerPath}`);

	const failures = result.ledger.filter((e) => e.outcome === 'failed');
	process.exit(failures.length > 0 ? 1 : 0);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('seed-395-feedback-type-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
