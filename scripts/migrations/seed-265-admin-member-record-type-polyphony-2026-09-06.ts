// mvox-app#265 — provision the `admin_member_record` type-def + its 5
// prop-defs (person, name, phone, email, birthdate) on polyphony, plus the
// `roster_show_real_names` property addition on the existing `organization`
// type, using the idempotent CREATE primitive (scripts/migrations/lib/ensure-
// schema-type.ts) against the mvox-side definitions (scripts/migrations/lib/
// mvox-schema-extensions.ts).
//
// Per-property sharing (the load-bearing part, per Mihkel's shape-review
// ruling comment 5561754737 + posture ruling comment 5561632474 — mvox_crede
// is a real-life pilot, not synthetic, so this is a genuine privacy control):
// `person`/`name` -> domain, `phone`/`email`/`birthdate` -> private, set
// EXPLICITLY via `PropertySpec.sharing` on every admin_member_record
// prop-def. `roster_show_real_names` deliberately carries NO explicit
// override — it inherits `organization`'s own current `_sharing`, resolved
// live below rather than assumed, per Mihkel's correction 4 ("no special
// case"). After every prop-def is ensured, its effective `_sharing` is read
// back and asserted against intent (PO addition, same comment) — Entu's own
// create-time inherit-from-parent behavior can silently substitute a
// different value when `_sharing` is omitted (mvox-app#265 live-probe
// finding), so a create landing is not proof it landed AS WRITTEN.
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
import { entuFetch } from '$lib/entu/request';
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
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

/** One-off read of an existing type-def's own `_sharing` — used only for
 * property additions to a type this file doesn't own the definition of
 * (organization is canonical, not an mvox-schema-extensions.ts entry). Not
 * promoted to the shared primitive yet: one use doesn't earn it. */
async function resolveTypeSharing(cfg: EntuCfg, typeId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${typeId}?props=_sharing`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`resolveTypeSharing(${typeId}): GET failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _sharing?: Array<{ string?: string }> } };
	const sharing = body.entity?._sharing?.at(0)?.string;
	if (!sharing) throw new Error(`resolveTypeSharing(${typeId}): type has no _sharing set — cannot resolve a fallback for a property that inherits it`);
	return sharing;
}

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

	const organizationTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, admin_member_record.parents[0].entity);
	console.log(`organization type-def: ${organizationTypeId}`);
	const organizationSharing = await resolveTypeSharing(cfg, organizationTypeId);
	console.log(`organization type-def _sharing (live, resolved for the R2 toggle fallback): ${organizationSharing}`);

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

	// --- roster_show_real_names property addition on organization ---

	const togglePropId = await ensurePropDef(
		cfg,
		propertyMetaTypeId,
		organizationTypeId,
		'organization',
		organizationSharing as 'private' | 'domain' | 'public',
		roster_show_real_names.property,
		DRY_RUN,
		ledger
	);
	console.log(`  organization.${roster_show_real_names.property.name}: ${togglePropId ?? '(would create — dry-run)'} (expected sharing, inherited: ${organizationSharing})`);
	if (togglePropId) {
		await assertPropDefSharing(cfg, togglePropId, `organization.${roster_show_real_names.property.name}`, organizationSharing as 'private' | 'domain' | 'public', ledger);
		console.log(`    read-back-asserted: ${organizationSharing} ✓`);
	} else {
		ledger.push({ action: 'ensure-propdef', target: `organization.${roster_show_real_names.property.name}`, outcome: 'dry-run', after: { type: roster_show_real_names.property.type, sharing: organizationSharing, mandatory: false } });
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
		organizationTypeId,
		organizationSharingResolvedLive: organizationSharing,
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
