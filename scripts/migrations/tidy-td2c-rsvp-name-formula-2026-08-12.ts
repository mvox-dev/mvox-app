// TD.2c (#118) — RSVP name formula creation + instance re-aggregation
//
// Scope: The RSVP type (6a0d2e8590c8df7a1cc7df1b) has NO name prop-def at all.
// RSVPs currently appear as hex entity IDs instead of human-readable names.
//
// PO ruling: create a name prop-def with a formula deriving from the RSVP's
// parent (person) name and its event reference name.
//
// Formula design:
//   _parent.*.name event.*.name ' — ' CONCAT_WS
//
//   Produces: "PersonName — EventName"
//   e.g. "Martti Raide — Jõulukontsert"
//
//   Rationale:
//   - RSVP._parent is always a person entity (RSVPs live under persons).
//     `_parent.*.name` follows the _parent reference to read the person's name.
//     Single-hop formula (proven: edition.work uses bare `_parent`; _child/_referrer
//     work as formula sources in section.member_count, event.rsvp_going_count).
//   - RSVP.event is a reference to the event entity. `event.*.name` follows the
//     reference and reads the event name. Single-hop formula (proven pattern).
//   - member.*.name was considered but rejected: member entities have NO name
//     property (removed in T3.1 bundle 3). Chaining member.*.person.*.name would
//     require two-hop traversal which Entu does not support (multi-hop probes
//     all returned null — see probe-formula-reverse-ref results).
//   - CONCAT_WS joins with ' — ' separator, same pattern as lending.name formula.
//
// Two operations:
//   1. CREATE a new name prop-def entity (child of the RSVP type entity) with:
//      _type = reference to "property" meta-type
//      _parent = reference to RSVP type entity
//      name = "name"
//      type = "string"
//      formula = "_parent.*.name event.*.name ' — ' CONCAT_WS"
//      _sharing = "domain"
//      label = "name" (single, no language tag — matches all other propdefs)
//      description EN = "Auto-formatted display name combining the member's name and the event."
//      description ET = "Automaatselt koostatud kuvanimi, mis ühendab liikme nime ja sündmuse."
//
//   2. Touch-save all 17 RSVP instances to trigger Entu re-aggregation, which
//      evaluates the new formula on each instance. Since name is a formula,
//      direct POST to name is silently dropped — use _sharing property for
//      touch-save (proven T6.2 mechanic, same as lending in tidy-td2).
//
// CRITICAL NOTES:
//   - All entity IDs are DISCOVERED DYNAMICALLY from the live API. No hardcoded IDs.
//   - Formula prop POST to name is silently dropped (re-evaluates but doesn't
//     trigger aggregation on other instances). Touch-save uses _sharing instead.
//   - T6.2 lesson: after creating a prop-def, touch-save every instance to ensure
//     the formula evaluates and the bucket assignment propagates.
//
// Touch-save 3-check canary verification (per T6.2 remediation discipline):
//   For each touch-save, verify:
//   (a) POST response contains the property _id (and _id rotated from input)
//   (b) Read-back of the instance shows the name value present
//   (c) Count of name values on the instance = exactly 1
//   HTTP 200 alone is NOT sufficient.
//
// Authorization: polyphony db is dev/test with synthetic data — routine
// mutations pre-authorized. Live execution still requires explicit
// team-lead + PO authorization per standing discipline.
//
// DRY_RUN=true by default. Set DRY_RUN=false ONLY after dry-run is verified
// and team-lead + PO have authorized.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td2c-rsvp-name-formula.ts                       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td2c-rsvp-name-formula.ts                       # ONLY after authorization

import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = readDryRun();

/**
 * The RSVP name formula: person name (via _parent) + event name, joined with ' — '.
 *
 * _parent.*.name — follows RSVP._parent (person entity), reads person.name
 * event.*.name   — follows RSVP.event (event entity), reads event.name
 * ' — ' CONCAT_WS — joins with em-dash separator
 */
const RSVP_NAME_FORMULA = "_parent.*.name event.*.name ' — ' CONCAT_WS";

/**
 * Bilingual metadata for the name propdef — matching all other propdefs in the db.
 * Without these, the propdef would be the only one missing metadata (#48 regression).
 */
const RSVP_NAME_DESCRIPTION_EN = "Auto-formatted display name combining the member's name and the event.";
const RSVP_NAME_DESCRIPTION_ET = 'Automaatselt koostatud kuvanimi, mis ühendab liikme nime ja sündmuse.';
const RSVP_NAME_LABEL = 'name';

// -- Types -----------------------------------------------------------------------

interface DiscoveredRsvpType {
	typeId: string;
	typeSharing: string;
	hasNamePropDef: boolean;
	namePropDefId: string | null;
	propertyMetaTypeId: string;
}

interface DiscoveredInstance {
	id: string;
	name: string | null;
	sharingPropId: string | null;
	instanceSharing: string;
	eventName: string | null;
	parentName: string | null;
}

interface LedgerEntry {
	action: 'create-propdef' | 'touch-save';
	targetId: string;
	targetName: string;
	status: 'created' | 'touched' | 'skipped' | 'failed' | 'dry-run';
	newEntityId?: string;
	before?: string | null;
	after?: string;
	touchMechanic?: string;
	canaryChecks?: {
		postHasPropId: boolean;
		propIdRotated: boolean;
		namePresent: boolean;
		nameCount: number;
		nameValue?: string;
	};
	error?: string;
}

const ledger: LedgerEntry[] = [];

// -- Result artifact -------------------------------------------------------------

// mvox-app#274 — writeLedger now goes through the shared, redaction-aware
// writer, landing in seed-results/ instead of the retired ledgers/ dir;
// `sensitive: false` (polyphony is synthetic, and this ledger carries only
// ids/status/sharing metadata regardless).
function writeLedger(payload: Record<string, unknown>): string {
	return writeLedgerShared({ scriptName: 'tidy-td2c-rsvp-name-formula', dryRun: DRY_RUN, db: process.env.ENTU_DATABASE ?? 'polyphony', sensitive: false, payload });
}

// -- Phase 0: Dynamic discovery --------------------------------------------------

/**
 * Discover the RSVP type entity and check if it already has a name prop-def.
 * Also discovers the "property" meta-type entity ID for prop-def creation.
 */
async function discoverRsvpType(cfg: EntuCfg): Promise<DiscoveredRsvpType> {
	// Step 1: Find the RSVP type-definition entity.
	const typeRes = await entuFetch(
		cfg.db,
		'entity?_type.string=entity&name.string=rsvp&props=name,_sharing&limit=10',
		cfg.token
	);
	if (!typeRes.ok) throw new Error(`discoverRsvpType: type query failed: ${typeRes.status}`);
	const typeBody = (await typeRes.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
		}>;
	};
	if (typeBody.count !== 1) {
		throw new Error(`discoverRsvpType: expected 1 rsvp type entity, found ${typeBody.count}`);
	}
	const typeEntity = typeBody.entities[0];
	if (typeEntity.name?.[0]?.string !== 'rsvp') {
		throw new Error(
			`discoverRsvpType: type entity ${typeEntity._id} has name='${typeEntity.name?.[0]?.string}', expected 'rsvp'`
		);
	}
	const typeSharing = typeEntity._sharing?.[0]?.string ?? '(absent)';

	// Step 2: Check if a name prop-def already exists (child of type, name="name").
	const propDefRes = await entuFetch(
		cfg.db,
		`entity?_parent.reference=${typeEntity._id}&_type.string=property&name.string=name&props=name,_sharing,formula&limit=10`,
		cfg.token
	);
	if (!propDefRes.ok) throw new Error(`discoverRsvpType: name propdef query failed: ${propDefRes.status}`);
	const propDefBody = (await propDefRes.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
		}>;
	};
	const hasNamePropDef = propDefBody.count > 0;
	const namePropDefId = hasNamePropDef ? propDefBody.entities[0]._id : null;

	// Step 3: Discover the "property" meta-type entity ID.
	const metaTypeRes = await entuFetch(
		cfg.db,
		'entity?_type.string=entity&name.string=property&props=name&limit=5',
		cfg.token
	);
	if (!metaTypeRes.ok) throw new Error(`discoverRsvpType: property meta-type query failed: ${metaTypeRes.status}`);
	const metaTypeBody = (await metaTypeRes.json()) as {
		count: number;
		entities: Array<{ _id: string; name?: Array<{ string: string }> }>;
	};
	const propMetaType = metaTypeBody.entities.find((e) => e.name?.[0]?.string === 'property');
	if (!propMetaType) {
		throw new Error('discoverRsvpType: "property" meta-type entity not found');
	}

	return {
		typeId: typeEntity._id,
		typeSharing,
		hasNamePropDef,
		namePropDefId,
		propertyMetaTypeId: propMetaType._id
	};
}

/**
 * Discover all RSVP instances with their _sharing, event, and _parent info.
 */
async function discoverInstances(
	cfg: EntuCfg,
	typeId: string
): Promise<DiscoveredInstance[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${typeId}&props=name,_sharing,event,_parent&limit=100`,
		cfg.token
	);
	if (!res.ok) throw new Error(`discoverInstances: query failed: ${res.status}`);
	const body = (await res.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ _id: string; string: string }>;
			_sharing?: Array<{ _id: string; string: string }>;
			event?: Array<{ string: string }>;
			_parent?: Array<{ string: string }>;
		}>;
	};

	if (body.count !== body.entities.length) {
		throw new Error(
			`discoverInstances: census truncated -- count=${body.count} entities=${body.entities.length}. Raise limit.`
		);
	}

	return body.entities.map((e) => ({
		id: e._id,
		name: e.name?.[0]?.string ?? null,
		sharingPropId: e._sharing?.[0]?._id ?? null,
		instanceSharing: e._sharing?.[0]?.string ?? '(absent)',
		eventName: e.event?.[0]?.string ?? null,
		parentName: e._parent?.[0]?.string ?? null
	}));
}

// -- Phase 1: Create the name prop-def entity ------------------------------------

async function createNamePropDef(
	cfg: EntuCfg,
	rsvpTypeId: string,
	propertyMetaTypeId: string
): Promise<LedgerEntry> {
	const properties = [
		{ type: '_type', reference: propertyMetaTypeId },
		{ type: '_parent', reference: rsvpTypeId },
		{ type: 'name', string: 'name' },
		{ type: 'type', string: 'string' },
		{ type: 'formula', string: RSVP_NAME_FORMULA },
		{ type: '_sharing', string: 'domain' },
		{ type: 'label', string: RSVP_NAME_LABEL },
		{ type: 'description', language: 'en', string: RSVP_NAME_DESCRIPTION_EN },
		{ type: 'description', language: 'et', string: RSVP_NAME_DESCRIPTION_ET }
	];

	try {
		const res = await entuFetch(cfg.db, 'entity', cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(properties)
		});
		if (!res.ok) {
			const text = await res.text();
			return {
				action: 'create-propdef',
				targetId: rsvpTypeId,
				targetName: 'rsvp.name propdef',
				status: 'failed',
				error: `POST entity creation failed: ${res.status} -- ${text}`
			};
		}

		const resBody = (await res.json()) as { _id?: string };
		if (!resBody._id) {
			return {
				action: 'create-propdef',
				targetId: rsvpTypeId,
				targetName: 'rsvp.name propdef',
				status: 'failed',
				error: 'POST returned 2xx but no _id in response (apparent-success trap)'
			};
		}

		const newPropDefId = resBody._id;

		// Read-back verification: confirm the prop-def entity exists with correct properties.
		const verifyRes = await entuFetch(
			cfg.db,
			`entity/${newPropDefId}?props=name,type,formula,_sharing,_parent,label,description`,
			cfg.token
		);
		if (!verifyRes.ok) {
			return {
				action: 'create-propdef',
				targetId: newPropDefId,
				targetName: 'rsvp.name propdef',
				status: 'failed',
				error: `read-back GET failed: ${verifyRes.status}`
			};
		}
		const verifyBody = (await verifyRes.json()) as {
			entity?: {
				name?: Array<{ string: string }>;
				type?: Array<{ string: string }>;
				formula?: Array<{ string: string }>;
				_sharing?: Array<{ string: string }>;
				_parent?: Array<{ reference: string }>;
				label?: Array<{ string: string }>;
				description?: Array<{ string: string; language?: string }>;
			};
		};

		const vName = verifyBody.entity?.name?.[0]?.string;
		const vType = verifyBody.entity?.type?.[0]?.string;
		const vFormula = verifyBody.entity?.formula?.[0]?.string;
		const vSharing = verifyBody.entity?._sharing?.[0]?.string;
		const vParent = verifyBody.entity?._parent?.[0]?.reference;
		const vLabel = verifyBody.entity?.label?.[0]?.string;
		const vDescriptions = verifyBody.entity?.description ?? [];
		const vDescEn = vDescriptions.find((d) => d.language === 'en')?.string;
		const vDescEt = vDescriptions.find((d) => d.language === 'et')?.string;

		const checks: string[] = [];
		if (vName !== 'name') checks.push(`name='${vName}' (expected 'name')`);
		if (vType !== 'string') checks.push(`type='${vType}' (expected 'string')`);
		if (vFormula !== RSVP_NAME_FORMULA) checks.push(`formula='${vFormula}' (expected '${RSVP_NAME_FORMULA}')`);
		if (vSharing !== 'domain') checks.push(`_sharing='${vSharing}' (expected 'domain')`);
		if (vParent !== rsvpTypeId) checks.push(`_parent='${vParent}' (expected '${rsvpTypeId}')`);
		if (vLabel !== RSVP_NAME_LABEL) checks.push(`label='${vLabel}' (expected '${RSVP_NAME_LABEL}')`);
		if (vDescEn !== RSVP_NAME_DESCRIPTION_EN) checks.push(`description[en]='${vDescEn}' (expected '${RSVP_NAME_DESCRIPTION_EN}')`);
		if (vDescEt !== RSVP_NAME_DESCRIPTION_ET) checks.push(`description[et]='${vDescEt}' (expected '${RSVP_NAME_DESCRIPTION_ET}')`);

		if (checks.length > 0) {
			return {
				action: 'create-propdef',
				targetId: newPropDefId,
				targetName: 'rsvp.name propdef',
				status: 'failed',
				newEntityId: newPropDefId,
				error: `read-back verification FAILED: ${checks.join('; ')}`
			};
		}

		return {
			action: 'create-propdef',
			targetId: newPropDefId,
			targetName: 'rsvp.name propdef',
			status: 'created',
			newEntityId: newPropDefId,
			before: '(absent)',
			after: `formula: ${RSVP_NAME_FORMULA}, _sharing: domain, label: ${RSVP_NAME_LABEL}, description: en+et`
		};
	} catch (err) {
		return {
			action: 'create-propdef',
			targetId: rsvpTypeId,
			targetName: 'rsvp.name propdef',
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Phase 2: Touch-save a single RSVP instance ----------------------------------
//
// Since rsvp.name is now a formula, direct POST to name is silently dropped.
// Use _sharing for touch-save (proven T6.2 mechanic, same as lending in tidy-td2).
// Atomic replace of _sharing with same content triggers re-aggregation and formula
// evaluation.

async function touchSaveInstance(
	cfg: EntuCfg,
	instance: DiscoveredInstance
): Promise<LedgerEntry> {
	if (!instance.sharingPropId) {
		return {
			action: 'touch-save',
			targetId: instance.id,
			targetName: `rsvp ${instance.id}`,
			touchMechanic: '_sharing-based (formula name)',
			status: 'failed',
			error: 'Instance has no _sharing property _id -- cannot touch-save'
		};
	}

	try {
		const writeBody = [{ _id: instance.sharingPropId, type: '_sharing', string: instance.instanceSharing }];

		const res = await entuFetch(cfg.db, `entity/${instance.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(writeBody)
		});
		if (!res.ok) {
			const text = await res.text();
			return {
				action: 'touch-save',
				targetId: instance.id,
				targetName: `rsvp ${instance.id}`,
				touchMechanic: '_sharing-based (formula name)',
				status: 'failed',
				error: `POST failed: ${res.status} -- ${text}`
			};
		}

		// --- 3-check canary verification ---

		// Check (a): POST response contains the _sharing property _id, and _id rotated.
		const resBody = (await res.json()) as {
			properties?: Array<{ _id: string; type: string }>;
		};
		const newProp = (resBody.properties ?? []).find((p) => p.type === '_sharing');
		const postHasPropId = !!newProp?._id;
		const propIdRotated = postHasPropId && newProp!._id !== instance.sharingPropId;

		if (!postHasPropId) {
			return {
				action: 'touch-save',
				targetId: instance.id,
				targetName: `rsvp ${instance.id}`,
				touchMechanic: '_sharing-based (formula name)',
				status: 'failed',
				canaryChecks: { postHasPropId: false, propIdRotated: false, namePresent: false, nameCount: 0 },
				error: '3-check (a) FAILED: POST returned 2xx but no _sharing property in response'
			};
		}
		if (!propIdRotated) {
			return {
				action: 'touch-save',
				targetId: instance.id,
				targetName: `rsvp ${instance.id}`,
				touchMechanic: '_sharing-based (formula name)',
				status: 'failed',
				canaryChecks: { postHasPropId: true, propIdRotated: false, namePresent: false, nameCount: 0 },
				error: `3-check (a) FAILED: POST returned SAME _sharing _id (${instance.sharingPropId}) -- no rotation`
			};
		}

		// Check (b) + (c): Read-back instance, verify formula name resolved.
		const verifyRes = await entuFetch(cfg.db, `entity/${instance.id}?props=name`, cfg.token);
		if (!verifyRes.ok) {
			return {
				action: 'touch-save',
				targetId: instance.id,
				targetName: `rsvp ${instance.id}`,
				touchMechanic: '_sharing-based (formula name)',
				status: 'failed',
				canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: false, nameCount: 0 },
				error: `3-check (b) FAILED: read-back GET failed: ${verifyRes.status}`
			};
		}
		const verifyBody = (await verifyRes.json()) as {
			entity?: { name?: Array<{ string: string }> };
		};
		const nameValues = verifyBody.entity?.name ?? [];
		const namePresent = nameValues.length > 0;
		const nameCount = nameValues.length;
		const nameValue = nameValues[0]?.string ?? null;

		// Note: if the formula didn't resolve, namePresent will be false.
		// This is a critical verification — it tells us whether the formula syntax works.
		if (!namePresent) {
			return {
				action: 'touch-save',
				targetId: instance.id,
				targetName: `rsvp ${instance.id}`,
				touchMechanic: '_sharing-based (formula name)',
				status: 'failed',
				canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: false, nameCount: 0 },
				error: '3-check (b) FAILED: read-back shows NO name value -- formula may not have resolved (check formula syntax)'
			};
		}
		if (nameCount !== 1) {
			return {
				action: 'touch-save',
				targetId: instance.id,
				targetName: `rsvp ${instance.id}`,
				touchMechanic: '_sharing-based (formula name)',
				status: 'failed',
				canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: true, nameCount, nameValue: nameValue ?? undefined },
				error: `3-check (c) FAILED: read-back shows ${nameCount} name values (expected exactly 1)`
			};
		}

		return {
			action: 'touch-save',
			targetId: instance.id,
			targetName: `rsvp ${instance.id}`,
			touchMechanic: '_sharing-based (formula name)',
			status: 'touched',
			canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: true, nameCount: 1, nameValue: nameValue ?? undefined },
			after: nameValue ?? undefined
		};
	} catch (err) {
		return {
			action: 'touch-save',
			targetId: instance.id,
			targetName: `rsvp ${instance.id}`,
			touchMechanic: '_sharing-based (formula name)',
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Dry-run plan ----------------------------------------------------------------

function renderPlan(
	discovered: DiscoveredRsvpType,
	instances: DiscoveredInstance[]
): string {
	const lines: string[] = [];
	lines.push('TD.2c (#118) -- RSVP name formula creation + re-aggregation DRY-RUN plan');
	lines.push('All entity IDs DISCOVERED DYNAMICALLY from live API (no hardcoded IDs).');
	lines.push('NO writes issued.');
	lines.push('');

	lines.push('== Discovery results');
	lines.push(`   RSVP type entity:     ${discovered.typeId} (_sharing=${discovered.typeSharing})`);
	lines.push(`   Has name prop-def:    ${discovered.hasNamePropDef ? `YES (${discovered.namePropDefId}) -- ABORT: already exists` : 'NO (as expected)'}`);
	lines.push(`   Property meta-type:   ${discovered.propertyMetaTypeId}`);
	lines.push('');

	lines.push('== Phase 1: Create name prop-def entity');
	lines.push(`   _type:          reference to property meta-type (${discovered.propertyMetaTypeId})`);
	lines.push(`   _parent:        reference to RSVP type (${discovered.typeId})`);
	lines.push(`   name:           "name"`);
	lines.push(`   type:           "string"`);
	lines.push(`   formula:        "${RSVP_NAME_FORMULA}"`);
	lines.push(`   _sharing:       "domain"`);
	lines.push(`   label:          "${RSVP_NAME_LABEL}"`);
	lines.push(`   description[en]: "${RSVP_NAME_DESCRIPTION_EN}"`);
	lines.push(`   description[et]: "${RSVP_NAME_DESCRIPTION_ET}"`);
	lines.push('');

	lines.push('== Phase 2: Touch-save RSVP instances (_sharing-based, formula name)');
	lines.push(`   Instance count: ${instances.length}`);
	for (const inst of instances) {
		const expectedName = [inst.parentName, inst.eventName]
			.filter((s) => s != null && s.length > 0)
			.join(' — ');
		lines.push(`   ${inst.id}: parent="${inst.parentName ?? '(null)'}" event="${inst.eventName ?? '(null)'}"`);
		lines.push(`     _sharing=${inst.instanceSharing} (propId=${inst.sharingPropId ?? '(none)'})`);
		lines.push(`     expected formula name: "${expectedName || '(empty -- formula may not resolve)'}"`);
	}
	const touchable = instances.filter((i) => i.sharingPropId != null);
	const untouchable = instances.filter((i) => i.sharingPropId == null);
	lines.push(`   Touchable: ${touchable.length} (have _sharing prop ID)`);
	if (untouchable.length > 0) {
		lines.push(`   Untouchable: ${untouchable.length} (missing _sharing prop ID -- SKIPPED)`);
	}
	lines.push('');

	lines.push('== Formula design rationale');
	lines.push(`   Formula: ${RSVP_NAME_FORMULA}`);
	lines.push('   _parent.*.name  -- RSVP._parent is always a person entity');
	lines.push('                      follows _parent reference, reads person.name');
	lines.push('                      single-hop (proven: _parent, _child, _referrer all');
	lines.push('                      work as formula sources in production formulas)');
	lines.push('   event.*.name    -- follows RSVP.event reference, reads event.name');
	lines.push('                      single-hop (proven pattern, matches lending formula)');
	lines.push("   ' — ' CONCAT_WS -- joins with em-dash separator");
	lines.push('');
	lines.push('   REJECTED alternatives:');
	lines.push('   - member.*.name: member entities have NO name property (removed T3.1)');
	lines.push('   - member.*.person.*.name: two-hop traversal, Entu returns null');
	lines.push('');

	lines.push('== Execution plan');
	lines.push('   PHASE 1: Create 1 name prop-def entity under RSVP type.');
	lines.push(`   PHASE 2 CANARY: Touch-save 1 RSVP instance, verify formula resolved (3-check).`);
	lines.push(`   PHASE 2 SWEEP: Touch-save remaining ${Math.max(0, touchable.length - 1)} instances (serial, 3-check each).`);
	lines.push(`   Total writes planned: 1 entity creation + ${touchable.length} touch-saves = ${1 + touchable.length}`);
	lines.push('');

	lines.push(`Totals: ${1 + touchable.length} writes planned. Writes issued this run: 0.`);
	return lines.join('\n');
}

// -- Main ------------------------------------------------------------------------

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);

	// Step 0: Dynamic discovery.
	console.log('=== Phase 0: Dynamic discovery ===');
	const discovered = await discoverRsvpType(cfg);
	console.log(`  RSVP type entity:   ${discovered.typeId} (_sharing=${discovered.typeSharing})`);
	console.log(`  Has name prop-def:  ${discovered.hasNamePropDef ? `YES (${discovered.namePropDefId})` : 'NO'}`);
	console.log(`  Property meta-type: ${discovered.propertyMetaTypeId}`);

	// Guard: if name prop-def already exists, abort.
	if (discovered.hasNamePropDef) {
		console.log(`\nABORT: RSVP type already has a name prop-def (${discovered.namePropDefId}).`);
		console.log('This script creates a new one; if the existing one is wrong, delete it first.');
		writeLedger({
			dryRun: DRY_RUN,
			halted: 'name-propdef-already-exists',
			existingPropDefId: discovered.namePropDefId,
			exitCode: 1
		});
		process.exit(1);
	}

	// Step 1: Discover RSVP instances.
	console.log('\n=== Instance discovery ===');
	const instances = await discoverInstances(cfg, discovered.typeId);
	console.log(`  Found ${instances.length} RSVP instances`);
	for (const inst of instances) {
		console.log(`    ${inst.id}: parent="${inst.parentName ?? '(null)'}" event="${inst.eventName ?? '(null)'}" _sharing=${inst.instanceSharing}`);
	}

	// Dry-run plan or live execution.
	if (DRY_RUN) {
		const plan = renderPlan(discovered, instances);
		console.log(`\n${plan}`);
		console.log(
			'\nDRY_RUN=true -- no writes issued. Set DRY_RUN=false to execute ONLY after ' +
			'team-lead + PO authorization (per standing discipline).'
		);
		const artifactPath = writeLedger({
			dryRun: true,
			discovered: {
				typeId: discovered.typeId,
				typeSharing: discovered.typeSharing,
				hasNamePropDef: discovered.hasNamePropDef,
				propertyMetaTypeId: discovered.propertyMetaTypeId
			},
			formula: RSVP_NAME_FORMULA,
			metadata: {
				label: RSVP_NAME_LABEL,
				descriptionEn: RSVP_NAME_DESCRIPTION_EN,
				descriptionEt: RSVP_NAME_DESCRIPTION_ET
			},
			instances: instances.map((i) => ({
				id: i.id,
				parentName: i.parentName,
				eventName: i.eventName,
				instanceSharing: i.instanceSharing,
				hasSharingPropId: !!i.sharingPropId
			})),
			writesPlanned: {
				propdefCreation: 1,
				touchSaves: instances.filter((i) => i.sharingPropId != null).length,
				total: 1 + instances.filter((i) => i.sharingPropId != null).length
			},
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	// -- Live execution -----------------------------------------------------------

	// Phase 1: Create the name prop-def.
	console.log('\n=== Phase 1: Create name prop-def ===');
	console.log(`  Formula: ${RSVP_NAME_FORMULA}`);
	const createEntry = await createNamePropDef(cfg, discovered.typeId, discovered.propertyMetaTypeId);
	ledger.push(createEntry);
	if (createEntry.status !== 'created') {
		console.error(`  FAILED: ${createEntry.error}`);
		console.error('  ABORT: prop-def creation failed, not proceeding to touch-saves.');
		const artifactPath = writeLedger({
			dryRun: false,
			halted: 'propdef-creation-failed',
			formula: RSVP_NAME_FORMULA,
			ledger,
			exitCode: 1
		});
		console.log(`Result artifact: ${artifactPath}`);
		process.exit(1);
	}
	console.log(`  CREATED: rsvp.name prop-def (${createEntry.newEntityId})`);
	console.log(`  Verified: name='name', type='string', formula='${RSVP_NAME_FORMULA}', _sharing='domain', label='${RSVP_NAME_LABEL}', description=en+et`);

	// Phase 2: Touch-save instances (canary first, then sweep).
	const touchable = instances.filter((i) => i.sharingPropId != null);
	const untouchable = instances.filter((i) => i.sharingPropId == null);

	if (untouchable.length > 0) {
		console.warn(`\n  WARNING: ${untouchable.length} instance(s) have no _sharing prop ID -- skipping:`);
		for (const inst of untouchable) {
			console.warn(`    ${inst.id}`);
			ledger.push({
				action: 'touch-save',
				targetId: inst.id,
				targetName: `rsvp ${inst.id}`,
				touchMechanic: '_sharing-based (formula name)',
				status: 'skipped',
				error: 'No _sharing property _id for touch-save'
			});
		}
	}

	if (touchable.length === 0) {
		console.log('\n  No touchable instances -- skipping phase 2.');
	} else {
		// Canary: touch-save the first instance and verify formula resolved.
		console.log(`\n=== Phase 2 Canary: touch-save first instance ===`);
		const canaryInstance = touchable[0];
		console.log(`  Canary: ${canaryInstance.id} (parent="${canaryInstance.parentName}", event="${canaryInstance.eventName}")`);
		const canaryEntry = await touchSaveInstance(cfg, canaryInstance);
		ledger.push(canaryEntry);

		if (canaryEntry.status !== 'touched') {
			console.error(`  CANARY FAILED: ${canaryEntry.error}`);
			console.error('  ABORT: canary touch-save failed. Formula may not resolve.');
			console.error('  Check formula syntax and Entu _parent traversal support.');
			const artifactPath = writeLedger({
				dryRun: false,
				halted: 'canary-touch-save-failed',
				formula: RSVP_NAME_FORMULA,
				newPropDefId: createEntry.newEntityId,
				ledger,
				exitCode: 1
			});
			console.log(`Result artifact: ${artifactPath}`);
			process.exit(1);
		}
		console.log(`  CANARY PASSED: name="${canaryEntry.canaryChecks?.nameValue}" (3-check OK)`);

		// Sweep: touch-save remaining instances.
		const remaining = touchable.slice(1);
		if (remaining.length > 0) {
			console.log(`\n=== Phase 2 Sweep: touch-save ${remaining.length} remaining instances ===`);
			let touchCount = 0;
			for (const inst of remaining) {
				const entry = await touchSaveInstance(cfg, inst);
				ledger.push(entry);
				touchCount++;
				if (entry.status === 'touched') {
					if (touchCount % 5 === 0 || touchCount === remaining.length) {
						console.log(`  Progress: ${touchCount}/${remaining.length} touch-saves completed`);
					}
				} else {
					console.error(`  FAILED: rsvp ${inst.id}: ${entry.error}`);
				}
			}
		}
	}

	// Summary.
	const touchEntries = ledger.filter((e) => e.action === 'touch-save');
	const touchSucceeded = touchEntries.filter((e) => e.status === 'touched').length;
	const touchFailed = touchEntries.filter((e) => e.status === 'failed').length;
	const touchSkipped = touchEntries.filter((e) => e.status === 'skipped').length;

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Prop-def creation: ${createEntry.status === 'created' ? 'CREATED' : 'FAILED'} (${createEntry.newEntityId ?? 'N/A'})`);
	console.log(`Formula: ${RSVP_NAME_FORMULA}`);
	console.log(`Touch-saves: ${touchSucceeded}/${touchable.length} succeeded, ${touchFailed} failed, ${touchSkipped} skipped`);

	// Report formula resolution.
	const resolvedNames = touchEntries
		.filter((e) => e.status === 'touched' && e.canaryChecks?.nameValue)
		.map((e) => e.canaryChecks!.nameValue!);
	const uniqueNames = [...new Set(resolvedNames)];
	console.log(`\nFormula-resolved names (${uniqueNames.length} unique):`);
	for (const name of uniqueNames) {
		const count = resolvedNames.filter((n) => n === name).length;
		console.log(`  "${name}" (${count} instance${count > 1 ? 's' : ''})`);
	}

	const failures = ledger.filter((e) => e.status === 'failed');
	if (failures.length > 0) {
		console.error(`\n${failures.length} FAILURE(s):`);
		for (const f of failures) {
			console.error(`  ${f.action} ${f.targetId}: ${f.error}`);
		}
	}

	const hasFailures = failures.length > 0;
	const artifactPath = writeLedger({
		dryRun: false,
		authorization:
			'Polyphony db is dev/test with synthetic data -- routine mutations pre-authorized. ' +
			'Per-run team-lead + PO authorization obtained.',
		formula: RSVP_NAME_FORMULA,
		discovered: {
			typeId: discovered.typeId,
			typeSharing: discovered.typeSharing,
			propertyMetaTypeId: discovered.propertyMetaTypeId
		},
		propdefCreation: {
			newEntityId: createEntry.newEntityId,
			status: createEntry.status
		},
		touchSaveResults: {
			total: touchable.length,
			touched: touchSucceeded,
			failed: touchFailed,
			skipped: touchSkipped
		},
		resolvedNames: uniqueNames,
		ledger,
		exitCode: hasFailures ? 1 : 0,
		verificationCaveat:
			'Run under ENTU_API_KEY (PO/db-root seat). Formula name verification is ' +
			'3-check canary: (a) _sharing prop _id rotated, (b) name present on read-back, ' +
			'(c) name count = 1. The resolved name value is logged for visual confirmation.'
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('TD.2c tidy-rsvp-name-formula ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
