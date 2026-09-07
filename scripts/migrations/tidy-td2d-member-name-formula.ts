// TD.2d (#118) — Member name formula creation + instance re-aggregation
//
// Scope: The member type (69c7ea4a8489bfcb0e819edd) has NO name prop-def.
// It was removed in T3.1 bundle 3 (identity via linked person entity).
// Members currently appear as hex entity IDs instead of human-readable names.
//
// PO ruling (TD.5 gate): create a formula name propdef that derives from the
// member's linked person entity — same approach as RSVP (TD.2c).
//
// Formula design:
//   person.*.name
//
//   Single-hop formula. Follows the member's `person` reference property to the
//   linked person entity, reads that person's `name` property.
//   e.g. member with person ref → "Aino Kask" → formula name = "Aino Kask"
//
//   Simpler than RSVP's formula (no CONCAT_WS needed — single reference, single
//   name source). Matches proven single-hop patterns in the codebase.
//
// Data split:
//   - 133 domain members: ALL have `person` references → formula will resolve
//   - 108 private members: NONE have `person` references → formula evaluates to
//     null (these are legacy/inactive members from the original import).
//     These 108 also carry orphaned `name` values from the old (removed) propdef;
//     creating a formula propdef and touch-saving may or may not clear those
//     orphaned values — the script handles both cases.
//
// Two operations:
//   1. CREATE a new name prop-def entity (child of the member type entity) with:
//      _type = reference to "property" meta-type
//      _parent = reference to member type entity
//      name = "name"
//      type = "string"
//      formula = "person.*.name"
//      _sharing = "domain"
//      label = "Name" (en) / "Nimi" (et)
//      description = bilingual EN+ET
//
//   2. Touch-save all 241 member instances to trigger Entu re-aggregation, which
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
//   - Bilingual description + label included per TD.2c review finding.
//
// Touch-save 3-check canary verification (per T6.2 remediation discipline):
//   For each touch-save on a DOMAIN member (has person ref), verify:
//   (a) POST response contains the property _id (and _id rotated from input)
//   (b) Read-back of the instance shows the name value present
//   (c) Count of name values on the instance = exactly 1
//   HTTP 200 alone is NOT sufficient.
//
//   For PRIVATE members (no person ref), verification is relaxed:
//   (a) POST response contains the property _id (and _id rotated from input)
//   (b)+(c) name may be absent (formula has no source) — logged, not failed
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
//     ./scripts/migrations/tidy-td2d-member-name-formula.ts                       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td2d-member-name-formula.ts                       # ONLY after authorization

import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = readDryRun();

/**
 * The member name formula: single-hop traversal from member.person to person.name.
 *
 * person.*.name — follows member.person reference, reads the linked person entity's name
 */
const MEMBER_NAME_FORMULA = 'person.*.name';

// -- Types -----------------------------------------------------------------------

interface DiscoveredMemberType {
	typeId: string;
	typeSharing: string;
	hasNamePropDef: boolean;
	namePropDefId: string | null;
	propertyMetaTypeId: string;
}

interface DiscoveredInstance {
	id: string;
	name: string | null;
	nameCount: number;
	sharingPropId: string | null;
	instanceSharing: string;
	personName: string | null;
	hasPersonRef: boolean;
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
	hasPersonRef?: boolean;
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
	return writeLedgerShared({ scriptName: 'tidy-td2d-member-name-formula', dryRun: DRY_RUN, db: process.env.ENTU_DATABASE ?? 'polyphony', sensitive: false, payload });
}

// -- Phase 0: Dynamic discovery --------------------------------------------------

/**
 * Discover the member type entity and check if it already has a name prop-def.
 * Also discovers the "property" meta-type entity ID for prop-def creation.
 */
async function discoverMemberType(cfg: EntuCfg): Promise<DiscoveredMemberType> {
	// Step 1: Find the member type-definition entity.
	const typeRes = await entuFetch(
		cfg.db,
		'entity?_type.string=entity&name.string=member&props=name,_sharing&limit=10',
		cfg.token
	);
	if (!typeRes.ok) throw new Error(`discoverMemberType: type query failed: ${typeRes.status}`);
	const typeBody = (await typeRes.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
		}>;
	};
	if (typeBody.count !== 1) {
		throw new Error(`discoverMemberType: expected 1 member type entity, found ${typeBody.count}`);
	}
	const typeEntity = typeBody.entities[0];
	if (typeEntity.name?.[0]?.string !== 'member') {
		throw new Error(
			`discoverMemberType: type entity ${typeEntity._id} has name='${typeEntity.name?.[0]?.string}', expected 'member'`
		);
	}
	const typeSharing = typeEntity._sharing?.[0]?.string ?? '(absent)';

	// Step 2: Check if a name prop-def already exists (child of type, name="name").
	const propDefRes = await entuFetch(
		cfg.db,
		`entity?_parent.reference=${typeEntity._id}&_type.string=property&name.string=name&props=name,_sharing,formula&limit=10`,
		cfg.token
	);
	if (!propDefRes.ok) throw new Error(`discoverMemberType: name propdef query failed: ${propDefRes.status}`);
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
	if (!metaTypeRes.ok) throw new Error(`discoverMemberType: property meta-type query failed: ${metaTypeRes.status}`);
	const metaTypeBody = (await metaTypeRes.json()) as {
		count: number;
		entities: Array<{ _id: string; name?: Array<{ string: string }> }>;
	};
	const propMetaType = metaTypeBody.entities.find((e) => e.name?.[0]?.string === 'property');
	if (!propMetaType) {
		throw new Error('discoverMemberType: "property" meta-type entity not found');
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
 * Discover all member instances with their _sharing, person ref, and name info.
 *
 * Paginated — member count (241) exceeds the safe single-page limit.
 */
async function discoverInstances(
	cfg: EntuCfg,
	typeId: string
): Promise<DiscoveredInstance[]> {
	const all: DiscoveredInstance[] = [];
	let skip = 0;
	const pageSize = 100;

	while (true) {
		const res = await entuFetch(
			cfg.db,
			`entity?_type.reference=${typeId}&props=name,_sharing,person,_parent&limit=${pageSize}&skip=${skip}`,
			cfg.token
		);
		if (!res.ok) throw new Error(`discoverInstances: query failed: ${res.status} (skip=${skip})`);
		const body = (await res.json()) as {
			count: number;
			entities: Array<{
				_id: string;
				name?: Array<{ _id: string; string: string }>;
				_sharing?: Array<{ _id: string; string: string }>;
				person?: Array<{ reference: string; string: string }>;
				_parent?: Array<{ string: string }>;
			}>;
		};

		for (const e of body.entities) {
			all.push({
				id: e._id,
				name: e.name?.[0]?.string ?? null,
				nameCount: e.name?.length ?? 0,
				sharingPropId: e._sharing?.[0]?._id ?? null,
				instanceSharing: e._sharing?.[0]?.string ?? '(absent)',
				personName: e.person?.[0]?.string ?? null,
				hasPersonRef: (e.person?.length ?? 0) > 0,
				parentName: e._parent?.[0]?.string ?? null
			});
		}

		if (all.length >= body.count || body.entities.length < pageSize) break;
		skip += pageSize;
	}

	return all;
}

// -- Phase 1: Create the name prop-def entity ------------------------------------

async function createNamePropDef(
	cfg: EntuCfg,
	memberTypeId: string,
	propertyMetaTypeId: string
): Promise<LedgerEntry> {
	const properties = [
		{ type: '_type', reference: propertyMetaTypeId },
		{ type: '_parent', reference: memberTypeId },
		{ type: 'name', string: 'name' },
		{ type: 'type', string: 'string' },
		{ type: 'formula', string: MEMBER_NAME_FORMULA },
		{ type: '_sharing', string: 'domain' },
		{ type: 'label', string: 'Name', language: 'en' },
		{ type: 'label', string: 'Nimi', language: 'et' },
		{ type: 'description', string: 'Display name derived from the linked person entity.', language: 'en' },
		{ type: 'description', string: 'Kuvatav nimi, tuletatud seotud isikuobjekti nimest.', language: 'et' }
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
				targetId: memberTypeId,
				targetName: 'member.name propdef',
				status: 'failed',
				error: `POST entity creation failed: ${res.status} -- ${text}`
			};
		}

		const resBody = (await res.json()) as { _id?: string };
		if (!resBody._id) {
			return {
				action: 'create-propdef',
				targetId: memberTypeId,
				targetName: 'member.name propdef',
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
				targetName: 'member.name propdef',
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
				label?: Array<{ string: string; language?: string }>;
				description?: Array<{ string: string; language?: string }>;
			};
		};

		const vName = verifyBody.entity?.name?.[0]?.string;
		const vType = verifyBody.entity?.type?.[0]?.string;
		const vFormula = verifyBody.entity?.formula?.[0]?.string;
		const vSharing = verifyBody.entity?._sharing?.[0]?.string;
		const vParent = verifyBody.entity?._parent?.[0]?.reference;
		const vLabelCount = verifyBody.entity?.label?.length ?? 0;
		const vDescCount = verifyBody.entity?.description?.length ?? 0;

		const checks: string[] = [];
		if (vName !== 'name') checks.push(`name='${vName}' (expected 'name')`);
		if (vType !== 'string') checks.push(`type='${vType}' (expected 'string')`);
		if (vFormula !== MEMBER_NAME_FORMULA) checks.push(`formula='${vFormula}' (expected '${MEMBER_NAME_FORMULA}')`);
		if (vSharing !== 'domain') checks.push(`_sharing='${vSharing}' (expected 'domain')`);
		if (vParent !== memberTypeId) checks.push(`_parent='${vParent}' (expected '${memberTypeId}')`);
		if (vLabelCount < 2) checks.push(`label count=${vLabelCount} (expected 2 — en+et)`);
		if (vDescCount < 2) checks.push(`description count=${vDescCount} (expected 2 — en+et)`);

		if (checks.length > 0) {
			return {
				action: 'create-propdef',
				targetId: newPropDefId,
				targetName: 'member.name propdef',
				status: 'failed',
				newEntityId: newPropDefId,
				error: `read-back verification FAILED: ${checks.join('; ')}`
			};
		}

		return {
			action: 'create-propdef',
			targetId: newPropDefId,
			targetName: 'member.name propdef',
			status: 'created',
			newEntityId: newPropDefId,
			before: '(absent)',
			after: `formula: ${MEMBER_NAME_FORMULA}, _sharing: domain, label: en+et, description: en+et`
		};
	} catch (err) {
		return {
			action: 'create-propdef',
			targetId: memberTypeId,
			targetName: 'member.name propdef',
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Phase 2: Touch-save a single member instance --------------------------------
//
// Since member.name is now a formula, direct POST to name is silently dropped.
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
			targetName: `member ${instance.id} (${instance.personName ?? instance.name ?? 'unknown'})`,
			touchMechanic: '_sharing-based (formula name)',
			hasPersonRef: instance.hasPersonRef,
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
				targetName: `member ${instance.id} (${instance.personName ?? instance.name ?? 'unknown'})`,
				touchMechanic: '_sharing-based (formula name)',
				hasPersonRef: instance.hasPersonRef,
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
				targetName: `member ${instance.id} (${instance.personName ?? instance.name ?? 'unknown'})`,
				touchMechanic: '_sharing-based (formula name)',
				hasPersonRef: instance.hasPersonRef,
				status: 'failed',
				canaryChecks: { postHasPropId: false, propIdRotated: false, namePresent: false, nameCount: 0 },
				error: '3-check (a) FAILED: POST returned 2xx but no _sharing property in response'
			};
		}
		if (!propIdRotated) {
			return {
				action: 'touch-save',
				targetId: instance.id,
				targetName: `member ${instance.id} (${instance.personName ?? instance.name ?? 'unknown'})`,
				touchMechanic: '_sharing-based (formula name)',
				hasPersonRef: instance.hasPersonRef,
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
				targetName: `member ${instance.id} (${instance.personName ?? instance.name ?? 'unknown'})`,
				touchMechanic: '_sharing-based (formula name)',
				hasPersonRef: instance.hasPersonRef,
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

		// For DOMAIN members (with person ref), formula MUST resolve — name must be present.
		// For PRIVATE members (no person ref), formula may not resolve — name absence is expected.
		if (instance.hasPersonRef) {
			if (!namePresent) {
				return {
					action: 'touch-save',
					targetId: instance.id,
					targetName: `member ${instance.id} (${instance.personName ?? 'unknown'})`,
					touchMechanic: '_sharing-based (formula name)',
					hasPersonRef: true,
					status: 'failed',
					canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: false, nameCount: 0 },
					error: '3-check (b) FAILED: domain member with person ref but read-back shows NO name -- formula may not have resolved'
				};
			}
			if (nameCount !== 1) {
				return {
					action: 'touch-save',
					targetId: instance.id,
					targetName: `member ${instance.id} (${instance.personName ?? 'unknown'})`,
					touchMechanic: '_sharing-based (formula name)',
					hasPersonRef: true,
					status: 'failed',
					canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: true, nameCount, nameValue: nameValue ?? undefined },
					error: `3-check (c) FAILED: read-back shows ${nameCount} name values (expected exactly 1)`
				};
			}
		}
		// For members WITHOUT person ref, we don't fail on absent name — it's expected.

		return {
			action: 'touch-save',
			targetId: instance.id,
			targetName: `member ${instance.id} (${instance.personName ?? instance.name ?? 'unknown'})`,
			touchMechanic: '_sharing-based (formula name)',
			hasPersonRef: instance.hasPersonRef,
			status: 'touched',
			canaryChecks: {
				postHasPropId: true,
				propIdRotated: true,
				namePresent,
				nameCount,
				nameValue: nameValue ?? undefined
			},
			after: nameValue ?? '(formula did not resolve — no person ref)'
		};
	} catch (err) {
		return {
			action: 'touch-save',
			targetId: instance.id,
			targetName: `member ${instance.id} (${instance.personName ?? instance.name ?? 'unknown'})`,
			touchMechanic: '_sharing-based (formula name)',
			hasPersonRef: instance.hasPersonRef,
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Dry-run plan ----------------------------------------------------------------

function renderPlan(
	discovered: DiscoveredMemberType,
	instances: DiscoveredInstance[]
): string {
	const lines: string[] = [];
	lines.push('TD.2d (#118) -- Member name formula creation + re-aggregation DRY-RUN plan');
	lines.push('All entity IDs DISCOVERED DYNAMICALLY from live API (no hardcoded IDs).');
	lines.push('NO writes issued.');
	lines.push('');

	lines.push('== Discovery results');
	lines.push(`   Member type entity:   ${discovered.typeId} (_sharing=${discovered.typeSharing})`);
	lines.push(`   Has name prop-def:    ${discovered.hasNamePropDef ? `YES (${discovered.namePropDefId}) -- ABORT: already exists` : 'NO (as expected — removed in T3.1)'}`);
	lines.push(`   Property meta-type:   ${discovered.propertyMetaTypeId}`);
	lines.push('');

	const domainInstances = instances.filter((i) => i.hasPersonRef);
	const privateInstances = instances.filter((i) => !i.hasPersonRef);

	lines.push('== Instance census');
	lines.push(`   Total:   ${instances.length}`);
	lines.push(`   Domain (with person ref):  ${domainInstances.length} — formula WILL resolve`);
	lines.push(`   Private (no person ref):   ${privateInstances.length} — formula will NOT resolve (legacy/inactive)`);
	lines.push(`   With orphaned name values: ${instances.filter((i) => i.nameCount > 0).length}`);
	lines.push('');

	lines.push('== Phase 1: Create name prop-def entity');
	lines.push(`   _type:        reference to property meta-type (${discovered.propertyMetaTypeId})`);
	lines.push(`   _parent:      reference to member type (${discovered.typeId})`);
	lines.push(`   name:         "name"`);
	lines.push(`   type:         "string"`);
	lines.push(`   formula:      "${MEMBER_NAME_FORMULA}"`);
	lines.push(`   _sharing:     "domain"`);
	lines.push('   label:        "Name" (en) / "Nimi" (et)');
	lines.push('   description:  "Display name derived from the linked person entity." (en)');
	lines.push('                 "Kuvatav nimi, tuletatud seotud isikuobjekti nimest." (et)');
	lines.push('');

	lines.push('== Phase 2: Touch-save member instances (_sharing-based, formula name)');
	lines.push(`   Instance count: ${instances.length}`);
	lines.push('');

	lines.push('   --- Domain members (person ref present, formula will resolve) ---');
	for (const inst of domainInstances.slice(0, 10)) {
		lines.push(`   ${inst.id}: person="${inst.personName}" _sharing=${inst.instanceSharing}`);
		lines.push(`     expected formula name: "${inst.personName ?? '(null)'}"`);
	}
	if (domainInstances.length > 10) {
		lines.push(`   ... and ${domainInstances.length - 10} more domain members`);
	}
	lines.push('');

	lines.push('   --- Private members (no person ref, formula will NOT resolve) ---');
	for (const inst of privateInstances.slice(0, 5)) {
		lines.push(`   ${inst.id}: orphanedName="${inst.name}" _sharing=${inst.instanceSharing}`);
		lines.push(`     expected formula name: "(null — no person ref)"`);
	}
	if (privateInstances.length > 5) {
		lines.push(`   ... and ${privateInstances.length - 5} more private members`);
	}
	lines.push('');

	const touchable = instances.filter((i) => i.sharingPropId != null);
	const untouchable = instances.filter((i) => i.sharingPropId == null);
	lines.push(`   Touchable: ${touchable.length} (have _sharing prop ID)`);
	if (untouchable.length > 0) {
		lines.push(`   Untouchable: ${untouchable.length} (missing _sharing prop ID -- SKIPPED)`);
	}
	lines.push('');

	lines.push('== Formula design rationale');
	lines.push(`   Formula: ${MEMBER_NAME_FORMULA}`);
	lines.push('   person.*.name — follows member.person reference (reference prop on member type),');
	lines.push('                   reads the linked person entity\'s name property.');
	lines.push('                   Single-hop (proven pattern, matches existing formulas).');
	lines.push('');
	lines.push('   SIMPLER than RSVP formula (no CONCAT_WS, single reference source).');
	lines.push('   RSVP uses: _parent.*.name event.*.name \' — \' CONCAT_WS');
	lines.push('   Member uses: person.*.name (just one reference, one name)');
	lines.push('');
	lines.push('   Data split:');
	lines.push(`   - ${domainInstances.length} domain members have person refs → formula resolves`);
	lines.push(`   - ${privateInstances.length} private members lack person refs → formula evaluates to null`);
	lines.push('     (legacy/inactive; no person entities linked)');
	lines.push('');

	lines.push('== Execution plan');
	lines.push('   PHASE 1: Create 1 name prop-def entity under member type.');
	lines.push(`   PHASE 2 CANARY: Touch-save 1 DOMAIN member instance, verify formula resolved (3-check).`);
	lines.push(`   PHASE 2 SWEEP: Touch-save remaining ${Math.max(0, touchable.length - 1)} instances (serial, 3-check each).`);
	lines.push(`     - Domain members: full 3-check (name must resolve)`);
	lines.push(`     - Private members: relaxed check (name may be absent — no person ref)`);
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
	const discovered = await discoverMemberType(cfg);
	console.log(`  Member type entity:   ${discovered.typeId} (_sharing=${discovered.typeSharing})`);
	console.log(`  Has name prop-def:    ${discovered.hasNamePropDef ? `YES (${discovered.namePropDefId})` : 'NO'}`);
	console.log(`  Property meta-type:   ${discovered.propertyMetaTypeId}`);

	// Guard: if name prop-def already exists, abort.
	if (discovered.hasNamePropDef) {
		console.log(`\nABORT: Member type already has a name prop-def (${discovered.namePropDefId}).`);
		console.log('This script creates a new one; if the existing one is wrong, delete it first.');
		writeLedger({
			dryRun: DRY_RUN,
			halted: 'name-propdef-already-exists',
			existingPropDefId: discovered.namePropDefId,
			exitCode: 1
		});
		process.exit(1);
	}

	// Step 1: Discover member instances.
	console.log('\n=== Instance discovery ===');
	const instances = await discoverInstances(cfg, discovered.typeId);
	const domainInstances = instances.filter((i) => i.hasPersonRef);
	const privateInstances = instances.filter((i) => !i.hasPersonRef);
	console.log(`  Found ${instances.length} member instances`);
	console.log(`    Domain (with person ref):  ${domainInstances.length}`);
	console.log(`    Private (no person ref):   ${privateInstances.length}`);
	console.log(`    With orphaned name values: ${instances.filter((i) => i.nameCount > 0).length}`);

	// Show a few samples.
	console.log('\n  Sample domain members:');
	for (const inst of domainInstances.slice(0, 3)) {
		console.log(`    ${inst.id}: person="${inst.personName}" _sharing=${inst.instanceSharing}`);
	}
	console.log('  Sample private members:');
	for (const inst of privateInstances.slice(0, 3)) {
		console.log(`    ${inst.id}: orphanedName="${inst.name}" _sharing=${inst.instanceSharing}`);
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
			formula: MEMBER_NAME_FORMULA,
			instances: {
				total: instances.length,
				domainWithPersonRef: domainInstances.length,
				privateNoPersonRef: privateInstances.length,
				withOrphanedName: instances.filter((i) => i.nameCount > 0).length
			},
			instanceDetail: instances.map((i) => ({
				id: i.id,
				personName: i.personName,
				hasPersonRef: i.hasPersonRef,
				instanceSharing: i.instanceSharing,
				orphanedName: i.name,
				orphanedNameCount: i.nameCount,
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
	console.log(`  Formula: ${MEMBER_NAME_FORMULA}`);
	const createEntry = await createNamePropDef(cfg, discovered.typeId, discovered.propertyMetaTypeId);
	ledger.push(createEntry);
	if (createEntry.status !== 'created') {
		console.error(`  FAILED: ${createEntry.error}`);
		console.error('  ABORT: prop-def creation failed, not proceeding to touch-saves.');
		const artifactPath = writeLedger({
			dryRun: false,
			halted: 'propdef-creation-failed',
			formula: MEMBER_NAME_FORMULA,
			ledger,
			exitCode: 1
		});
		console.log(`Result artifact: ${artifactPath}`);
		process.exit(1);
	}
	console.log(`  CREATED: member.name prop-def (${createEntry.newEntityId})`);
	console.log(`  Verified: name='name', type='string', formula='${MEMBER_NAME_FORMULA}', _sharing='domain', label=en+et, description=en+et`);

	// Phase 2: Touch-save instances (canary first with a DOMAIN member, then sweep).
	const touchable = instances.filter((i) => i.sharingPropId != null);
	const untouchable = instances.filter((i) => i.sharingPropId == null);

	if (untouchable.length > 0) {
		console.warn(`\n  WARNING: ${untouchable.length} instance(s) have no _sharing prop ID -- skipping:`);
		for (const inst of untouchable) {
			console.warn(`    ${inst.id}`);
			ledger.push({
				action: 'touch-save',
				targetId: inst.id,
				targetName: `member ${inst.id}`,
				touchMechanic: '_sharing-based (formula name)',
				hasPersonRef: inst.hasPersonRef,
				status: 'skipped',
				error: 'No _sharing property _id for touch-save'
			});
		}
	}

	if (touchable.length === 0) {
		console.log('\n  No touchable instances -- skipping phase 2.');
	} else {
		// Canary: touch-save the first DOMAIN member (with person ref) to verify formula.
		const canaryPool = touchable.filter((i) => i.hasPersonRef);
		if (canaryPool.length === 0) {
			console.error('  ABORT: No domain members with person refs available for canary test.');
			const artifactPath = writeLedger({
				dryRun: false,
				halted: 'no-canary-candidates',
				formula: MEMBER_NAME_FORMULA,
				newPropDefId: createEntry.newEntityId,
				ledger,
				exitCode: 1
			});
			console.log(`Result artifact: ${artifactPath}`);
			process.exit(1);
		}

		console.log(`\n=== Phase 2 Canary: touch-save first domain member ===`);
		const canaryInstance = canaryPool[0];
		console.log(`  Canary: ${canaryInstance.id} (person="${canaryInstance.personName}")`);
		const canaryEntry = await touchSaveInstance(cfg, canaryInstance);
		ledger.push(canaryEntry);

		if (canaryEntry.status !== 'touched') {
			console.error(`  CANARY FAILED: ${canaryEntry.error}`);
			console.error('  ABORT: canary touch-save failed. Formula may not resolve.');
			console.error('  Check formula syntax and person.*.name traversal support.');
			const artifactPath = writeLedger({
				dryRun: false,
				halted: 'canary-touch-save-failed',
				formula: MEMBER_NAME_FORMULA,
				newPropDefId: createEntry.newEntityId,
				ledger,
				exitCode: 1
			});
			console.log(`Result artifact: ${artifactPath}`);
			process.exit(1);
		}
		console.log(`  CANARY PASSED: name="${canaryEntry.canaryChecks?.nameValue}" (3-check OK)`);

		// Sweep: touch-save remaining instances.
		// Sort: domain members first (with person ref), then private (without).
		const remaining = touchable.filter((i) => i.id !== canaryInstance.id);
		const sortedRemaining = [
			...remaining.filter((i) => i.hasPersonRef),
			...remaining.filter((i) => !i.hasPersonRef)
		];

		if (sortedRemaining.length > 0) {
			console.log(`\n=== Phase 2 Sweep: touch-save ${sortedRemaining.length} remaining instances ===`);
			console.log(`    (${remaining.filter((i) => i.hasPersonRef).length} domain + ${remaining.filter((i) => !i.hasPersonRef).length} private)`);
			let touchCount = 0;
			let lastProgressAt = 0;
			for (const inst of sortedRemaining) {
				const entry = await touchSaveInstance(cfg, inst);
				ledger.push(entry);
				touchCount++;
				if (entry.status === 'touched') {
					if (touchCount - lastProgressAt >= 20 || touchCount === sortedRemaining.length) {
						console.log(`  Progress: ${touchCount}/${sortedRemaining.length} touch-saves completed`);
						lastProgressAt = touchCount;
					}
				} else {
					console.error(`  FAILED: member ${inst.id} (person="${inst.personName ?? inst.name ?? 'unknown'}"): ${entry.error}`);
				}
			}
		}
	}

	// Summary.
	const touchEntries = ledger.filter((e) => e.action === 'touch-save');
	const touchSucceeded = touchEntries.filter((e) => e.status === 'touched').length;
	const touchFailed = touchEntries.filter((e) => e.status === 'failed').length;
	const touchSkipped = touchEntries.filter((e) => e.status === 'skipped').length;
	const domainTouched = touchEntries.filter((e) => e.status === 'touched' && e.hasPersonRef).length;
	const privateTouched = touchEntries.filter((e) => e.status === 'touched' && !e.hasPersonRef).length;

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Prop-def creation: ${createEntry.status === 'created' ? 'CREATED' : 'FAILED'} (${createEntry.newEntityId ?? 'N/A'})`);
	console.log(`Formula: ${MEMBER_NAME_FORMULA}`);
	console.log(`Touch-saves: ${touchSucceeded}/${touchable.length} succeeded, ${touchFailed} failed, ${touchSkipped} skipped`);
	console.log(`  Domain members touched: ${domainTouched}`);
	console.log(`  Private members touched: ${privateTouched}`);

	// Report formula resolution.
	const resolvedNames = touchEntries
		.filter((e) => e.status === 'touched' && e.hasPersonRef && e.canaryChecks?.nameValue)
		.map((e) => e.canaryChecks!.nameValue!);
	const uniqueNames = [...new Set(resolvedNames)];
	console.log(`\nFormula-resolved names (${uniqueNames.length} unique from ${resolvedNames.length} domain members):`);
	for (const name of uniqueNames.slice(0, 20)) {
		const count = resolvedNames.filter((n) => n === name).length;
		console.log(`  "${name}" (${count} instance${count > 1 ? 's' : ''})`);
	}
	if (uniqueNames.length > 20) {
		console.log(`  ... and ${uniqueNames.length - 20} more unique names`);
	}

	// Report private members (no person ref, formula may not have resolved).
	const unresolvedPrivate = touchEntries
		.filter((e) => e.status === 'touched' && !e.hasPersonRef && !e.canaryChecks?.namePresent);
	const resolvedPrivate = touchEntries
		.filter((e) => e.status === 'touched' && !e.hasPersonRef && e.canaryChecks?.namePresent);
	if (unresolvedPrivate.length > 0 || resolvedPrivate.length > 0) {
		console.log(`\nPrivate members (no person ref):`);
		console.log(`  Formula resolved (unexpected): ${resolvedPrivate.length}`);
		console.log(`  Formula empty (expected):      ${unresolvedPrivate.length}`);
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
		formula: MEMBER_NAME_FORMULA,
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
			domainTouched,
			privateTouched,
			failed: touchFailed,
			skipped: touchSkipped
		},
		resolvedNames: uniqueNames,
		ledger,
		exitCode: hasFailures ? 1 : 0,
		verificationCaveat:
			'Run under ENTU_API_KEY (PO/db-root seat). Formula name verification is ' +
			'3-check canary: (a) _sharing prop _id rotated, (b) name present on read-back, ' +
			'(c) name count = 1. Domain members (with person ref) get full 3-check; private ' +
			'members (no person ref) get relaxed check (name absence is expected). ' +
			'The resolved name value is logged for visual confirmation.'
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('TD.2d tidy-member-name-formula ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
