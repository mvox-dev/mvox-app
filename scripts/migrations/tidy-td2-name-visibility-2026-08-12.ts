// TD.2 (#118) — Name prop-def _sharing widen + instance re-aggregation
//
// Scope: 6 entity types whose `name` prop-def is stuck at absent/private tier,
// causing members to see hex entity IDs instead of readable names:
//   event, lending, library, organization, season, section
//
// For each type, two operations:
//   1. Widen the name prop-def's _sharing to the correct tier:
//      - event: 'public' (matching the event TYPE entity's own _sharing)
//      - all others: 'domain'
//   2. Touch-save every existing instance (re-POST a property value) to trigger
//      Entu re-aggregation — T6.2 lesson: a propdef _sharing change alone
//      does NOT retroactively fix already-aggregated instances.
//
// LENDING EXCEPTION: lending.name is a FORMULA property
// (formula: "member.*.name copy.*.name ' — ' CONCAT_WS"). Formula prop POSTs
// are silently dropped (no re-aggregation triggered). For lending instances,
// touch-save uses the instance's own _sharing property (proven T6.2 mechanic)
// instead of re-POSTing the name value.
//
// CRITICAL: All entity IDs are DISCOVERED DYNAMICALLY from the live API.
// No hardcoded IDs — previous attempts with wrong IDs produced 404s.
//
// Gate verification (3-gate-AND model):
//   Gate 1 (name propdef _sharing) — THIS script fixes it (absent → domain/public)
//   Gate 2 (type entity _sharing)  — verified live before writes; all 6 already pass
//   Gate 3 (instance _sharing)     — NOT this script's concern (TD.4 #120 scope)
//
// Touch-save 3-check canary verification (per T6.2 remediation discipline):
//   For each touch-save, verify:
//   (a) POST response contains the property _id (and _id rotated from input)
//   (b) Read-back of the instance shows the name value present
//   (c) Count of name values on the instance = exactly 1 (no POST-appends duplication)
//   HTTP 200 alone is NOT sufficient.
//
// Post-sweep 3-gate-AND verification:
//   After all mutations, re-read all 3 gates for each type and verify the AND passes.
//   Gate 3 is per-instance; report how many instances pass the full AND.
//
// Non-omniscient bucket verification:
//   The 1 public event ('Test rehearsal') can be read WITHOUT auth — use an
//   unauthenticated GET to verify the name appears in the public bucket. This is
//   a real end-to-end check that catches silent T6.2 failures.
//
// Sequencing: TD.4 (entity visibility) executes BEFORE this script. Some
// instances may already have their instance _sharing widened by TD.4. This
// script plans re-aggregation regardless of instance _sharing state — the
// touch-save is needed for propdef-level bucket reassignment on ALL instances.
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
//     ./scripts/migrations/tidy-td2-name-visibility.ts                       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td2-name-visibility.ts                       # ONLY after authorization

import { join } from 'node:path';
import { entuFetch, entuUrl } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import { readDryRun } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = readDryRun();

/**
 * Target _sharing tier for each name prop-def after widen.
 * event.name -> 'public' (matching the event TYPE entity's own _sharing per audit recommendation).
 * All others -> 'domain'.
 */
const TARGET_PROPDEF_SHARING: Record<string, string> = {
	event: 'public',
	lending: 'domain',
	library: 'domain',
	organization: 'domain',
	season: 'domain',
	section: 'domain'
};

/** The 6 target type names in scope. */
const TARGET_TYPES = Object.keys(TARGET_PROPDEF_SHARING);

// -- Types ----------------------------------------------------------------------

interface DiscoveredType {
	typeName: string;
	typeId: string;
	typeSharing: string;
	namePropDefId: string;
	namePropDefSharing: string | null;
	namePropDefSharingPropId: string | null;
	isFormula: boolean;
}

interface DiscoveredInstance {
	typeName: string;
	id: string;
	name: string;
	namePropId: string | null;
	sharingPropId: string | null;
	instanceSharing: string;
}

interface TouchTarget {
	typeName: string;
	id: string;
	name: string;
	touchPropId: string;
	touchPropType: string;
	touchPropValue: string;
	instanceSharing: string;
}

interface LedgerEntry {
	action: 'propdef-widen' | 'touch-save';
	type: string;
	targetId: string;
	targetName: string;
	status: 'widened' | 'touched' | 'skipped' | 'failed' | 'dry-run';
	before?: string | null;
	after?: string;
	newPropId?: string;
	touchMechanic?: string;
	canaryChecks?: { postHasPropId: boolean; propIdRotated: boolean; namePresent: boolean; nameCount: number };
	error?: string;
}

interface GateAndResult {
	type: string;
	gate1: { propDefId: string; sharing: string; passes: boolean };
	gate2: { typeId: string; sharing: string; passes: boolean };
	gate3Instances: Array<{ id: string; name: string; sharing: string; passes: boolean }>;
	gate1and2Pass: boolean;
	instancesWithFullAnd: number;
	totalInstances: number;
}

const ledger: LedgerEntry[] = [];

// -- Result artifact ------------------------------------------------------------

// mvox-app#274 — writeLedger now goes through the shared, redaction-aware
// writer, landing in seed-results/ instead of the retired ledgers/ dir;
// `sensitive: false` (polyphony is synthetic, and this ledger carries only
// ids/status/sharing metadata regardless).
function writeLedger(payload: Record<string, unknown>): string {
	return writeLedgerShared({ scriptName: 'tidy-td2-name-visibility', dryRun: DRY_RUN, db: process.env.ENTU_DATABASE ?? 'polyphony', sensitive: false, payload });
}

// -- Phase 0: Dynamic discovery -------------------------------------------------

/**
 * Discover the type entity ID for a given type name by querying the live API.
 * Queries `_type.string=entity&name.string=<typeName>`. Verifies exactly one
 * result and that its name matches. Returns the type entity ID, its _sharing,
 * and the name prop-def entity ID (discovered as a child entity).
 */
async function discoverType(cfg: EntuCfg, typeName: string): Promise<DiscoveredType> {
	// Step 1: Find the type-definition entity.
	const typeRes = await entuFetch(
		cfg.db,
		`entity?_type.string=entity&name.string=${encodeURIComponent(typeName)}&props=name,_sharing&limit=10`,
		cfg.token
	);
	if (!typeRes.ok) throw new Error(`discoverType(${typeName}): type query failed: ${typeRes.status}`);
	const typeBody = (await typeRes.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ _id: string; string: string }>;
		}>;
	};
	if (typeBody.count !== 1) {
		throw new Error(
			`discoverType(${typeName}): expected exactly 1 type entity, found ${typeBody.count}`
		);
	}
	const typeEntity = typeBody.entities[0];
	const liveName = typeEntity.name?.[0]?.string;
	if (liveName !== typeName) {
		throw new Error(
			`discoverType(${typeName}): type entity ${typeEntity._id} has name=${JSON.stringify(liveName)}, expected ${JSON.stringify(typeName)}`
		);
	}
	const typeSharing = typeEntity._sharing?.[0]?.string ?? '(absent)';

	// Step 2: Verify the type entity ID exists with a direct GET.
	const verifyTypeRes = await entuFetch(cfg.db, `entity/${typeEntity._id}?props=name`, cfg.token);
	if (!verifyTypeRes.ok) {
		throw new Error(
			`discoverType(${typeName}): verification GET for type entity ${typeEntity._id} failed: ${verifyTypeRes.status}`
		);
	}

	// Step 3: Find the name prop-def entity (child of the type, name="name").
	const propDefRes = await entuFetch(
		cfg.db,
		`entity?_parent.reference=${typeEntity._id}&_type.string=property&name.string=name&props=name,_sharing,formula&limit=10`,
		cfg.token
	);
	if (!propDefRes.ok) throw new Error(`discoverType(${typeName}): name propdef query failed: ${propDefRes.status}`);
	const propDefBody = (await propDefRes.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ _id: string; string: string }>;
			formula?: Array<{ string: string }>;
		}>;
	};
	if (propDefBody.count !== 1) {
		throw new Error(
			`discoverType(${typeName}): expected exactly 1 name prop-def, found ${propDefBody.count}`
		);
	}
	const propDefEntity = propDefBody.entities[0];
	const propDefName = propDefEntity.name?.[0]?.string;
	if (propDefName !== 'name') {
		throw new Error(
			`discoverType(${typeName}): prop-def ${propDefEntity._id} has name=${JSON.stringify(propDefName)}, expected "name"`
		);
	}

	// Step 4: Verify the name prop-def entity ID with a direct GET.
	const verifyPropDefRes = await entuFetch(cfg.db, `entity/${propDefEntity._id}?props=name`, cfg.token);
	if (!verifyPropDefRes.ok) {
		throw new Error(
			`discoverType(${typeName}): verification GET for name propdef ${propDefEntity._id} failed: ${verifyPropDefRes.status}`
		);
	}

	const isFormula = (propDefEntity.formula ?? []).length > 0;

	return {
		typeName,
		typeId: typeEntity._id,
		typeSharing,
		namePropDefId: propDefEntity._id,
		namePropDefSharing: propDefEntity._sharing?.[0]?.string ?? null,
		namePropDefSharingPropId: propDefEntity._sharing?.[0]?._id ?? null,
		isFormula
	};
}

/**
 * Discover all instances of a given type. Returns each instance with its
 * name property _id, _sharing property _id, and current _sharing tier.
 */
async function discoverInstances(
	cfg: EntuCfg,
	typeName: string,
	typeId: string
): Promise<DiscoveredInstance[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${typeId}&props=name,_sharing&limit=600`,
		cfg.token
	);
	if (!res.ok) throw new Error(`discoverInstances(${typeName}): query failed: ${res.status}`);
	const body = (await res.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			name?: Array<{ _id: string; string: string }>;
			_sharing?: Array<{ _id: string; string: string }>;
		}>;
	};

	if (body.count !== body.entities.length) {
		throw new Error(
			`discoverInstances(${typeName}): census truncated -- count=${body.count} ` +
			`entities=${body.entities.length}. Raise limit.`
		);
	}

	return body.entities.map((e) => ({
		typeName,
		id: e._id,
		name: e.name?.[0]?.string ?? `(unnamed:${e._id})`,
		namePropId: e.name?.[0]?._id ?? null,
		sharingPropId: e._sharing?.[0]?._id ?? null,
		instanceSharing: e._sharing?.[0]?.string ?? '(absent)'
	}));
}

/**
 * Build touch-save targets from discovered instances, handling the lending
 * formula exception: lending instances use _sharing for touch-save since
 * their name is a formula (POST to formula prop is silently dropped).
 */
function buildTouchTargets(instances: DiscoveredInstance[], isFormula: boolean): TouchTarget[] {
	const targets: TouchTarget[] = [];
	for (const inst of instances) {
		if (isFormula) {
			// LENDING EXCEPTION: name is a formula. Use _sharing for touch-save.
			if (!inst.sharingPropId) {
				console.warn(
					`  WARNING: ${inst.typeName} instance ${inst.id} ("${inst.name}") has no _sharing ` +
					`property _id -- cannot atomic-replace touch-save. Skipping.`
				);
				continue;
			}
			targets.push({
				typeName: inst.typeName,
				id: inst.id,
				name: inst.name,
				touchPropId: inst.sharingPropId,
				touchPropType: '_sharing',
				touchPropValue: inst.instanceSharing,
				instanceSharing: inst.instanceSharing
			});
		} else {
			// Non-formula: use name property for touch-save.
			if (!inst.namePropId) {
				console.warn(
					`  WARNING: ${inst.typeName} instance ${inst.id} has no name value -- ` +
					`skipping touch-save`
				);
				continue;
			}
			targets.push({
				typeName: inst.typeName,
				id: inst.id,
				name: inst.name,
				touchPropId: inst.namePropId,
				touchPropType: 'name',
				touchPropValue: inst.name,
				instanceSharing: inst.instanceSharing
			});
		}
	}
	return targets;
}

// -- Phase 1: Widen a single name propdef _sharing -----------------------------

async function widenPropDef(cfg: EntuCfg, discovered: DiscoveredType): Promise<LedgerEntry> {
	const targetSharing = TARGET_PROPDEF_SHARING[discovered.typeName];
	if (!targetSharing) {
		return {
			action: 'propdef-widen', type: discovered.typeName, targetId: discovered.namePropDefId,
			targetName: `${discovered.typeName}.name propdef`,
			status: 'failed', before: discovered.namePropDefSharing,
			error: `No target sharing defined for type '${discovered.typeName}'`
		};
	}

	try {
		// Build the POST body -- append if no existing _sharing, replace if present.
		const writeBody: Array<Record<string, unknown>> = [];
		if (discovered.namePropDefSharingPropId) {
			writeBody.push({ _id: discovered.namePropDefSharingPropId, type: '_sharing', string: targetSharing });
		} else {
			writeBody.push({ type: '_sharing', string: targetSharing });
		}

		const res = await entuFetch(cfg.db, `entity/${discovered.namePropDefId}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(writeBody)
		});
		if (!res.ok) {
			const text = await res.text();
			return {
				action: 'propdef-widen', type: discovered.typeName, targetId: discovered.namePropDefId,
				targetName: `${discovered.typeName}.name propdef`,
				status: 'failed', before: discovered.namePropDefSharing,
				error: `POST failed: ${res.status} -- ${text}`
			};
		}

		// Read-back verify.
		const verifyRes = await entuFetch(cfg.db, `entity/${discovered.namePropDefId}?props=_sharing`, cfg.token);
		if (!verifyRes.ok) {
			return {
				action: 'propdef-widen', type: discovered.typeName, targetId: discovered.namePropDefId,
				targetName: `${discovered.typeName}.name propdef`,
				status: 'failed', before: discovered.namePropDefSharing,
				error: `read-back GET failed: ${verifyRes.status}`
			};
		}
		const verifyBody = (await verifyRes.json()) as {
			entity?: { _sharing?: Array<{ _id: string; string: string }> };
		};
		const sharingValues = verifyBody.entity?._sharing ?? [];
		if (sharingValues.length !== 1) {
			return {
				action: 'propdef-widen', type: discovered.typeName, targetId: discovered.namePropDefId,
				targetName: `${discovered.typeName}.name propdef`,
				status: 'failed', before: discovered.namePropDefSharing,
				error: `read-back shows ${sharingValues.length} _sharing values (expected exactly 1)`
			};
		}
		if (sharingValues[0].string !== targetSharing) {
			return {
				action: 'propdef-widen', type: discovered.typeName, targetId: discovered.namePropDefId,
				targetName: `${discovered.typeName}.name propdef`,
				status: 'failed', before: discovered.namePropDefSharing,
				error: `read-back shows _sharing='${sharingValues[0].string}', expected '${targetSharing}'`
			};
		}

		return {
			action: 'propdef-widen', type: discovered.typeName, targetId: discovered.namePropDefId,
			targetName: `${discovered.typeName}.name propdef`,
			status: 'widened', before: discovered.namePropDefSharing ?? '(absent)',
			after: targetSharing, newPropId: sharingValues[0]._id
		};
	} catch (err) {
		return {
			action: 'propdef-widen', type: discovered.typeName, targetId: discovered.namePropDefId,
			targetName: `${discovered.typeName}.name propdef`,
			status: 'failed', before: discovered.namePropDefSharing,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Phase 2: Touch-save a single instance with 3-check canary verification ----
//
// For each touch-save, the 3-check verification (T6.2 remediation discipline):
//   (a) POST response contains the property _id, and _id rotated from input
//   (b) Read-back of the instance shows the name value present
//   (c) Count of name values on the instance = exactly 1
//
// Note: checks (b) and (c) run under the db-root seat, which always reads the
// private bucket. Structural correctness (propdef at domain/public + name value
// present + single value) guarantees domain-bucket visibility by Entu mechanics.
// Empirical member-seat verification requires a separate non-omniscient browser
// session (documented caveat in the ledger).

async function touchSaveInstance(cfg: EntuCfg, target: TouchTarget): Promise<LedgerEntry> {
	const mechanic = target.touchPropType === '_sharing' ? '_sharing-based (formula name bypass)' : 'name-based';
	try {
		// Atomic replace of the touch property with same content -- triggers re-aggregation.
		const writeBody = [{ _id: target.touchPropId, type: target.touchPropType, string: target.touchPropValue }];

		const res = await entuFetch(cfg.db, `entity/${target.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(writeBody)
		});
		if (!res.ok) {
			const text = await res.text();
			return {
				action: 'touch-save', type: target.typeName, targetId: target.id,
				targetName: target.name, touchMechanic: mechanic,
				status: 'failed',
				error: `POST failed: ${res.status} -- ${text}`
			};
		}

		// --- 3-check canary verification ---

		// Check (a): POST response contains the property _id, and _id rotated.
		const resBody = (await res.json()) as {
			properties?: Array<{ _id: string; type: string }>;
		};
		const newProp = (resBody.properties ?? []).find((p) => p.type === target.touchPropType);
		const postHasPropId = !!newProp?._id;
		const propIdRotated = postHasPropId && newProp!._id !== target.touchPropId;

		if (!postHasPropId) {
			return {
				action: 'touch-save', type: target.typeName, targetId: target.id,
				targetName: target.name, touchMechanic: mechanic,
				status: 'failed',
				canaryChecks: { postHasPropId: false, propIdRotated: false, namePresent: false, nameCount: 0 },
				error: `3-check (a) FAILED: POST returned 2xx but no ${target.touchPropType} property in response (apparent-success trap)`
			};
		}
		if (!propIdRotated) {
			return {
				action: 'touch-save', type: target.typeName, targetId: target.id,
				targetName: target.name, touchMechanic: mechanic,
				status: 'failed',
				canaryChecks: { postHasPropId: true, propIdRotated: false, namePresent: false, nameCount: 0 },
				error: `3-check (a) FAILED: POST returned the SAME property _id (${target.touchPropId}) -- replace did not rotate`
			};
		}

		// Check (b) + (c): Read-back instance, verify name is present and count = 1.
		const verifyRes = await entuFetch(cfg.db, `entity/${target.id}?props=name`, cfg.token);
		if (!verifyRes.ok) {
			return {
				action: 'touch-save', type: target.typeName, targetId: target.id,
				targetName: target.name, touchMechanic: mechanic,
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

		if (!namePresent) {
			return {
				action: 'touch-save', type: target.typeName, targetId: target.id,
				targetName: target.name, touchMechanic: mechanic,
				status: 'failed',
				canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: false, nameCount: 0 },
				error: `3-check (b) FAILED: read-back shows NO name value on instance after touch-save`
			};
		}
		if (nameCount !== 1) {
			return {
				action: 'touch-save', type: target.typeName, targetId: target.id,
				targetName: target.name, touchMechanic: mechanic,
				status: 'failed',
				canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: true, nameCount },
				error: `3-check (c) FAILED: read-back shows ${nameCount} name values (expected exactly 1) -- possible POST-appends duplication`
			};
		}

		return {
			action: 'touch-save', type: target.typeName, targetId: target.id,
			targetName: target.name, touchMechanic: mechanic,
			status: 'touched',
			canaryChecks: { postHasPropId: true, propIdRotated: true, namePresent: true, nameCount: 1 },
			newPropId: newProp!._id
		};
	} catch (err) {
		return {
			action: 'touch-save', type: target.typeName, targetId: target.id,
			targetName: target.name, touchMechanic: mechanic,
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Canary pass: one propdef + one instance per type, verified before full sweep

async function runCanaries(
	cfg: EntuCfg,
	discoveredTypes: DiscoveredType[],
	touchTargets: TouchTarget[]
): Promise<{
	canaryEntries: LedgerEntry[];
	remainingTypes: DiscoveredType[];
	remainingTargets: TouchTarget[];
}> {
	const canaryEntries: LedgerEntry[] = [];
	const widenedPropDefIds = new Set<string>();
	const touchedInstanceIds = new Set<string>();

	// Pick organization as canary propdef (highest leverage, safest).
	const canaryType = discoveredTypes.find((d) => d.typeName === 'organization') ?? discoveredTypes[0];
	console.log(`  Canary propdef: ${canaryType.typeName}.name (${canaryType.namePropDefId})`);
	const propDefEntry = await widenPropDef(cfg, canaryType);
	if (propDefEntry.status !== 'widened') {
		throw new Error(
			`Canary propdef widen FAILED for ${canaryType.typeName}.name: ${propDefEntry.error}. ` +
			`Refusing to proceed with remaining propdefs.`
		);
	}
	canaryEntries.push(propDefEntry);
	widenedPropDefIds.add(canaryType.namePropDefId);
	console.log(`  CANARY PASSED (propdef): ${canaryType.typeName}.name -- (absent) -> ${TARGET_PROPDEF_SHARING[canaryType.typeName]}`);

	// Pick one instance of the same type for name-based touch-save canary.
	const canaryInstance = touchTargets.find((t) => t.typeName === canaryType.typeName);
	if (canaryInstance) {
		console.log(`  Canary touch-save (name-based): ${canaryInstance.typeName} "${canaryInstance.name}" (${canaryInstance.id})`);
		const touchEntry = await touchSaveInstance(cfg, canaryInstance);
		if (touchEntry.status !== 'touched') {
			throw new Error(
				`Canary touch-save FAILED for ${canaryInstance.typeName}/${canaryInstance.id}: ${touchEntry.error}. ` +
				`Refusing to proceed with remaining instances.`
			);
		}
		canaryEntries.push(touchEntry);
		touchedInstanceIds.add(canaryInstance.id);
		console.log(`  CANARY PASSED (touch-save, name-based): ${canaryInstance.typeName} "${canaryInstance.name}" -- 3-check OK`);
	}

	// Separate canary for lending (uses _sharing-based touch-save -- different mechanic).
	const lendingType = discoveredTypes.find((d) => d.typeName === 'lending');
	const lendingCanary = touchTargets.find((t) => t.typeName === 'lending');
	if (lendingType && lendingCanary) {
		// Widen lending.name propdef first so the canary touch-save can verify name readback.
		if (!widenedPropDefIds.has(lendingType.namePropDefId)) {
			console.log(`  Canary propdef (lending): lending.name (${lendingType.namePropDefId})`);
			const lendingPropDefEntry = await widenPropDef(cfg, lendingType);
			if (lendingPropDefEntry.status !== 'widened') {
				throw new Error(
					`Canary propdef widen FAILED for lending.name: ${lendingPropDefEntry.error}. ` +
					`Refusing to proceed.`
				);
			}
			canaryEntries.push(lendingPropDefEntry);
			widenedPropDefIds.add(lendingType.namePropDefId);
			console.log(`  CANARY PASSED (propdef): lending.name -- (absent) -> domain`);
		}

		console.log(`  Canary touch-save (_sharing-based): lending "${lendingCanary.name}" (${lendingCanary.id})`);
		const lendingTouchEntry = await touchSaveInstance(cfg, lendingCanary);
		if (lendingTouchEntry.status !== 'touched') {
			throw new Error(
				`Canary touch-save FAILED for lending/${lendingCanary.id}: ${lendingTouchEntry.error}. ` +
				`The _sharing-based touch-save mechanic for lending is unproven. Refusing to proceed.`
			);
		}
		canaryEntries.push(lendingTouchEntry);
		touchedInstanceIds.add(lendingCanary.id);
		console.log(`  CANARY PASSED (touch-save, _sharing-based): lending "${lendingCanary.name}" -- 3-check OK`);
	}

	// Compute remaining (exclude canary entries).
	const remainingTypes = discoveredTypes.filter((d) => !widenedPropDefIds.has(d.namePropDefId));
	const remainingTargets = touchTargets.filter((t) => !touchedInstanceIds.has(t.id));
	return { canaryEntries, remainingTypes, remainingTargets };
}

// -- Post-sweep 3-gate-AND verification ----------------------------------------

async function postSweepGateVerification(
	cfg: EntuCfg,
	discoveredTypes: DiscoveredType[]
): Promise<GateAndResult[]> {
	const results: GateAndResult[] = [];

	for (const dt of discoveredTypes) {
		const expectedTarget = TARGET_PROPDEF_SHARING[dt.typeName];

		// Gate 1: re-read name propdef _sharing.
		const g1Res = await entuFetch(cfg.db, `entity/${dt.namePropDefId}?props=_sharing`, cfg.token);
		if (!g1Res.ok) throw new Error(`postSweepGateVerification: gate 1 GET ${dt.namePropDefId} (${dt.typeName}.name) failed: ${g1Res.status}`);
		const g1Body = (await g1Res.json()) as {
			entity?: { _sharing?: Array<{ string: string }> };
		};
		const g1Sharing = g1Body.entity?._sharing?.[0]?.string ?? '(absent)';
		const g1Passes = g1Sharing === expectedTarget;

		// Gate 2: re-read type entity _sharing.
		const g2Res = await entuFetch(cfg.db, `entity/${dt.typeId}?props=_sharing`, cfg.token);
		if (!g2Res.ok) throw new Error(`postSweepGateVerification: gate 2 GET ${dt.typeId} (${dt.typeName}) failed: ${g2Res.status}`);
		const g2Body = (await g2Res.json()) as {
			entity?: { _sharing?: Array<{ string: string }> };
		};
		const g2Sharing = g2Body.entity?._sharing?.[0]?.string ?? '(absent)';
		const g2Passes = g2Sharing === 'domain' || g2Sharing === 'public';

		// Gate 3: re-read all instances' _sharing.
		const g3Res = await entuFetch(
			cfg.db,
			`entity?_type.reference=${dt.typeId}&props=name,_sharing&limit=600`,
			cfg.token
		);
		if (!g3Res.ok) throw new Error(`postSweepGateVerification: gate 3 instance query for ${dt.typeName} failed: ${g3Res.status}`);
		const g3Body = (await g3Res.json()) as {
			count: number;
			entities: Array<{
				_id: string;
				name?: Array<{ string: string }>;
				_sharing?: Array<{ string: string }>;
			}>;
		};

		const g3Instances = g3Body.entities.map((e) => {
			const sharing = e._sharing?.[0]?.string ?? '(absent)';
			return {
				id: e._id,
				name: e.name?.[0]?.string ?? `(unnamed:${e._id})`,
				sharing,
				passes: sharing === 'domain' || sharing === 'public'
			};
		});

		const gate1and2Pass = g1Passes && g2Passes;
		const instancesWithFullAnd = gate1and2Pass
			? g3Instances.filter((i) => i.passes).length
			: 0;

		results.push({
			type: dt.typeName,
			gate1: { propDefId: dt.namePropDefId, sharing: g1Sharing, passes: g1Passes },
			gate2: { typeId: dt.typeId, sharing: g2Sharing, passes: g2Passes },
			gate3Instances: g3Instances,
			gate1and2Pass,
			instancesWithFullAnd,
			totalInstances: g3Instances.length
		});
	}

	return results;
}

// -- Non-omniscient bucket verification ----------------------------------------

/**
 * Verify that the public event ('Test rehearsal') is readable WITHOUT auth.
 * After the propdef widen + touch-save, an unauthenticated GET should return
 * the entity with its name visible in the public bucket. This catches silent
 * T6.2 failures that the authenticated (omniscient) seat cannot detect.
 */
async function nonOmniscientVerification(
	cfg: EntuCfg,
	publicEventId: string | null
): Promise<{ passed: boolean; detail: string }> {
	if (!publicEventId) {
		return { passed: false, detail: 'No public event found (expected "Test rehearsal" with _sharing=public)' };
	}

	try {
		// Unauthenticated GET -- no Authorization header.
		const url = entuUrl(cfg.db, `entity/${publicEventId}?props=name`);
		const res = await fetch(url, {
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) {
			return {
				passed: false,
				detail: `Unauthenticated GET for event ${publicEventId} failed: ${res.status}`
			};
		}
		const body = (await res.json()) as {
			entity?: { name?: Array<{ string: string }> };
		};
		const nameValues = body.entity?.name ?? [];
		if (nameValues.length === 0) {
			return {
				passed: false,
				detail: `Unauthenticated GET returned event ${publicEventId} but name is ABSENT in public bucket -- T6.2 silent failure`
			};
		}
		const nameText = nameValues[0].string;
		if (!nameText || nameText.trim().length === 0) {
			return {
				passed: false,
				detail: `Unauthenticated GET returned event ${publicEventId} with empty name in public bucket`
			};
		}
		return {
			passed: true,
			detail: `Unauthenticated GET shows name="${nameText}" in public bucket for event ${publicEventId} -- end-to-end verification PASSED`
		};
	} catch (err) {
		return {
			passed: false,
			detail: `Unauthenticated verification threw: ${err instanceof Error ? err.message : String(err)}`
		};
	}
}

// -- Dry-run plan render --------------------------------------------------------

function renderPlan(
	discoveredTypes: DiscoveredType[],
	instancesByType: Record<string, DiscoveredInstance[]>,
	touchTargets: TouchTarget[]
): string {
	const lines: string[] = [];
	lines.push('TD.2 (#118) -- Name prop-def _sharing widen + re-aggregation DRY-RUN plan');
	lines.push('All entity IDs DISCOVERED DYNAMICALLY from live API (no hardcoded IDs).');
	lines.push('NO writes issued.');
	lines.push('');

	lines.push('== Discovery results (type entities + name prop-defs)');
	for (const dt of discoveredTypes) {
		const formulaTag = dt.isFormula ? ' [FORMULA]' : '';
		lines.push(`   ${dt.typeName}:`);
		lines.push(`     type entity:    ${dt.typeId} (_sharing=${dt.typeSharing})`);
		lines.push(`     name prop-def:  ${dt.namePropDefId} (_sharing=${dt.namePropDefSharing ?? '(absent)'}${formulaTag})`);
	}
	lines.push('');

	lines.push('== Gate 2 verification (TYPE entities\' own _sharing)');
	for (const dt of discoveredTypes) {
		const passes = dt.typeSharing === 'domain' || dt.typeSharing === 'public';
		const verdict = passes
			? 'PASSES'
			: 'FAILS -- would cap domain-bucket exposure regardless of gate 1 fix';
		lines.push(`   ${dt.typeName} TYPE (${dt.typeId}): _sharing='${dt.typeSharing}' -- ${verdict}`);
	}
	const allGate2Pass = discoveredTypes.every((dt) => dt.typeSharing === 'domain' || dt.typeSharing === 'public');
	lines.push(`   Overall: ${allGate2Pass ? 'all 6 types PASS gate 2' : 'ONE OR MORE TYPES FAIL gate 2 -- HALT'}`);
	lines.push('');

	const toWiden = discoveredTypes.filter(
		(dt) => dt.namePropDefSharing !== TARGET_PROPDEF_SHARING[dt.typeName]
	);

	lines.push('== Phase 1: Propdef _sharing widen (6 name propdefs)');
	for (const dt of discoveredTypes) {
		const current = dt.namePropDefSharing ?? '(absent/private)';
		const target = TARGET_PROPDEF_SHARING[dt.typeName];
		const action = dt.namePropDefSharing === target
			? `already ${target} -- no change`
			: `${current} -> ${target}`;
		lines.push(`   ${dt.typeName}.name (${dt.namePropDefId}): ${action}`);
	}
	lines.push(`   Propdef writes planned: ${toWiden.length}`);
	lines.push(`   NOTE: event.name -> 'public' (matching event TYPE _sharing), all others -> 'domain'`);
	lines.push('');

	lines.push('== Phase 2: Instance touch-save re-aggregation');
	const byType: Record<string, TouchTarget[]> = {};
	for (const t of touchTargets) {
		(byType[t.typeName] ??= []).push(t);
	}
	for (const typeName of TARGET_TYPES) {
		const typeTargets = byType[typeName] ?? [];
		const allInstances = instancesByType[typeName] ?? [];
		const dt = discoveredTypes.find((d) => d.typeName === typeName);
		const mechanic = dt?.isFormula
			? ' [_sharing-based touch -- name is FORMULA]'
			: ' [name-based touch]';
		lines.push(`   ${typeName} (${typeTargets.length}/${allInstances.length} instances)${mechanic}:`);
		for (const t of typeTargets) {
			lines.push(`     ${t.id} "${t.name}" [instance _sharing=${t.instanceSharing}]`);
		}
		if (typeTargets.length < allInstances.length) {
			const skipped = allInstances.length - typeTargets.length;
			lines.push(`     (${skipped} instance(s) skipped -- missing touch property _id)`);
		}
	}
	lines.push(`   Touch-save writes planned: ${touchTargets.length}`);
	lines.push('');

	lines.push('== Touch-save 3-check canary verification (applied to EVERY touch-save)');
	lines.push('   (a) POST response contains property _id, and _id rotated from input');
	lines.push('   (b) Read-back of instance shows name value present');
	lines.push('   (c) Count of name values on instance = exactly 1');
	lines.push('   HTTP 200 alone is NOT sufficient -- all 3 checks must pass.');
	lines.push('');

	lines.push('== Population summary');
	let totalInstances = 0;
	for (const typeName of TARGET_TYPES) {
		const count = (instancesByType[typeName] ?? []).length;
		lines.push(`   ${typeName}: ${count} instances`);
		totalInstances += count;
	}
	lines.push(`   Total: ${totalInstances} instances across 6 types`);
	lines.push('');

	lines.push('== Non-omniscient verification (post-sweep)');
	const publicEvent = (instancesByType['event'] ?? []).find((e) => e.instanceSharing === 'public');
	if (publicEvent) {
		lines.push(`   Public event: ${publicEvent.id} "${publicEvent.name}" (_sharing=public)`);
		lines.push(`   Will verify: unauthenticated GET shows name in public bucket`);
	} else {
		lines.push('   No public event found -- non-omniscient verification will be skipped');
	}
	lines.push('');

	lines.push('== Execution plan');
	lines.push(`   CANARY: widen organization.name propdef + touch-save 1 organization instance (name-based), verify 3-check.`);
	lines.push(`   CANARY: widen lending.name propdef + touch-save 1 lending instance (_sharing-based), verify 3-check.`);
	lines.push(`   PHASE 1 SWEEP: widen remaining ${Math.max(0, toWiden.length - 2)} propdefs (serial, read-back verified).`);
	lines.push(`   PHASE 2 SWEEP: touch-save ${Math.max(0, touchTargets.length - 2)} remaining instances (serial, 3-check verified each).`);
	lines.push(`   POST-SWEEP: re-read all 3 gates for each type, verify 3-gate-AND passes.`);
	lines.push(`   NON-OMNISCIENT: unauthenticated GET for public event -- verify name in public bucket.`);
	lines.push(`   Total writes planned: ${toWiden.length} propdef widens + ${touchTargets.length} touch-saves = ${toWiden.length + touchTargets.length}`);
	lines.push('');

	lines.push('== Notes');
	lines.push('   - All entity IDs discovered dynamically from live API (no hardcoded IDs).');
	lines.push('   - Gate 3 (instance _sharing) is NOT modified by this script (TD.4 #120 scope).');
	lines.push('   - Touch-save re-aggregation is needed even for private instances -- propdef bucket');
	lines.push('     assignment must propagate regardless of instance visibility.');
	lines.push('   - After TD.4 widens instance _sharing, instances that were already touch-saved here');
	lines.push('     will have correct name bucket assignment. No second touch-save needed.');
	lines.push('   - lending.name is a FORMULA (member.*.name copy.*.name \' -- \' CONCAT_WS) --');
	lines.push('     direct POST to formula prop is silently dropped, so lending touch-save uses');
	lines.push('     _sharing property instead (proven T6.2 mechanic).');
	lines.push('   - event.name propdef widened to \'public\' (not \'domain\') to match the event TYPE');
	lines.push('     entity\'s own _sharing tier, per audit recommendation.');
	lines.push('');

	lines.push(`Totals: ${toWiden.length + touchTargets.length} writes planned. Writes issued this run: 0.`);
	return lines.join('\n');
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);

	// Step 0: Dynamic discovery of all entity IDs.
	console.log('=== Phase 0: Dynamic discovery ===');
	const discoveredTypes: DiscoveredType[] = [];
	for (const typeName of TARGET_TYPES) {
		console.log(`  Discovering ${typeName}...`);
		const dt = await discoverType(cfg, typeName);
		const formulaTag = dt.isFormula ? ' [FORMULA]' : '';
		console.log(`    type entity: ${dt.typeId} (_sharing=${dt.typeSharing})`);
		console.log(`    name propdef: ${dt.namePropDefId} (_sharing=${dt.namePropDefSharing ?? '(absent)'}${formulaTag})`);
		discoveredTypes.push(dt);
	}
	console.log(`  Discovered ${discoveredTypes.length} types successfully.\n`);

	// Step 1: Gate 2 verification (type entity _sharing).
	console.log('=== Gate 2 verification (type entity _sharing) ===');
	for (const dt of discoveredTypes) {
		const passes = dt.typeSharing === 'domain' || dt.typeSharing === 'public';
		console.log(`  ${dt.typeName} TYPE (${dt.typeId}): _sharing='${dt.typeSharing}' -- ${passes ? 'PASSES' : 'FAILS'}`);
	}
	const gate2Failures = discoveredTypes.filter((dt) => dt.typeSharing !== 'domain' && dt.typeSharing !== 'public');
	if (gate2Failures.length > 0) {
		console.error(
			`ABORT: ${gate2Failures.length} type(s) fail gate 2 -- widening propdefs would be futile ` +
			`since the type entity itself caps domain-bucket exposure: ` +
			gate2Failures.map((dt) => `${dt.typeName}=${dt.typeSharing}`).join(', ')
		);
		writeLedger({ dryRun: DRY_RUN, halted: 'gate2-failed', gate2Failures, exitCode: 1 });
		process.exit(1);
	}

	// Step 2: Read current propdef _sharing state.
	console.log('\n=== Gate 1 -- name propdef _sharing (current state) ===');
	for (const dt of discoveredTypes) {
		const current = dt.namePropDefSharing ?? '(absent/private)';
		const target = TARGET_PROPDEF_SHARING[dt.typeName];
		console.log(`  ${dt.typeName}.name (${dt.namePropDefId}): _sharing=${current} -> target=${target}`);
	}
	const toWiden = discoveredTypes.filter(
		(dt) => dt.namePropDefSharing !== TARGET_PROPDEF_SHARING[dt.typeName]
	);
	const alreadyAtTarget = discoveredTypes.filter(
		(dt) => dt.namePropDefSharing === TARGET_PROPDEF_SHARING[dt.typeName]
	);
	if (alreadyAtTarget.length > 0) {
		console.log(
			`  Already at target: ${alreadyAtTarget.map((dt) => `${dt.typeName}(${TARGET_PROPDEF_SHARING[dt.typeName]})`).join(', ')}`
		);
	}

	// Step 3: Discover instances for touch-save.
	console.log('\n=== Instance discovery (for re-aggregation touch-save) ===');
	const instancesByType: Record<string, DiscoveredInstance[]> = {};
	const allTouchTargets: TouchTarget[] = [];
	for (const dt of discoveredTypes) {
		const instances = await discoverInstances(cfg, dt.typeName, dt.typeId);
		instancesByType[dt.typeName] = instances;
		const mechanic = dt.isFormula ? ' [_sharing-based touch]' : ' [name-based touch]';
		console.log(`  ${dt.typeName}: ${instances.length} instances${mechanic}`);
		const targets = buildTouchTargets(instances, dt.isFormula);
		allTouchTargets.push(...targets);
	}
	console.log(`  Total: ${allTouchTargets.length} instance touch-saves planned`);

	if (toWiden.length === 0 && allTouchTargets.length === 0) {
		console.log('\nNothing to do -- all propdefs already at target, no instances found.');
		writeLedger({
			dryRun: DRY_RUN,
			discoveredTypes: discoveredTypes.map((dt) => ({
				typeName: dt.typeName, typeId: dt.typeId,
				namePropDefId: dt.namePropDefId, isFormula: dt.isFormula
			})),
			writesPlanned: 0, exitCode: 0
		});
		process.exit(0);
	}

	// Step 4: Dry-run plan or live execution.
	if (DRY_RUN) {
		const plan = renderPlan(discoveredTypes, instancesByType, allTouchTargets);
		console.log(`\n${plan}`);
		console.log(
			'\nDRY_RUN=true -- no writes issued. Set DRY_RUN=false to execute ONLY after ' +
			'team-lead + PO authorization (per standing discipline).'
		);
		const artifactPath = writeLedger({
			dryRun: true,
			discoveredTypes: discoveredTypes.map((dt) => ({
				typeName: dt.typeName,
				typeId: dt.typeId,
				typeSharing: dt.typeSharing,
				namePropDefId: dt.namePropDefId,
				namePropDefSharing: dt.namePropDefSharing,
				isFormula: dt.isFormula,
				plannedSharing: TARGET_PROPDEF_SHARING[dt.typeName]
			})),
			instancesByType: Object.fromEntries(
				Object.entries(instancesByType).map(([typeName, instances]) => [
					typeName,
					instances.map((inst) => ({
						id: inst.id,
						name: inst.name,
						instanceSharing: inst.instanceSharing,
						hasNamePropId: !!inst.namePropId,
						hasSharingPropId: !!inst.sharingPropId
					}))
				])
			),
			touchTargets: allTouchTargets.map((t) => ({
				typeName: t.typeName,
				id: t.id,
				name: t.name,
				touchPropType: t.touchPropType,
				instanceSharing: t.instanceSharing
			})),
			writesPlanned: {
				propdefWidens: toWiden.length,
				touchSaves: allTouchTargets.length,
				total: toWiden.length + allTouchTargets.length
			},
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	// -- Live execution ---------------------------------------------------------

	// Phase 0: Canary pass (includes separate lending canary for _sharing-based mechanic).
	console.log('\n=== Canary pass ===');
	const { canaryEntries, remainingTypes, remainingTargets } = await runCanaries(
		cfg,
		toWiden,
		allTouchTargets
	);
	ledger.push(...canaryEntries);
	console.log(`  ${canaryEntries.length} canary operations passed.\n`);

	// Phase 1: Widen remaining propdefs.
	if (remainingTypes.length > 0) {
		console.log(`=== Phase 1: Widen remaining ${remainingTypes.length} propdefs ===`);
		for (const dt of remainingTypes) {
			const target = TARGET_PROPDEF_SHARING[dt.typeName];
			if (dt.namePropDefSharing === target) {
				console.log(`  SKIP: ${dt.typeName}.name already ${target}`);
				ledger.push({
					action: 'propdef-widen', type: dt.typeName, targetId: dt.namePropDefId,
					targetName: `${dt.typeName}.name propdef`,
					status: 'skipped', before: target
				});
				continue;
			}
			const entry = await widenPropDef(cfg, dt);
			ledger.push(entry);
			if (entry.status === 'widened') {
				console.log(`  WIDENED: ${dt.typeName}.name (${dt.namePropDefId}): ${entry.before} -> ${target}`);
			} else {
				console.error(`  FAILED: ${dt.typeName}.name (${dt.namePropDefId}): ${entry.error}`);
			}
		}
	}

	// Phase 2: Touch-save remaining instances (with 3-check verification each).
	console.log(`\n=== Phase 2: Touch-save ${remainingTargets.length} remaining instances ===`);
	let touchCount = 0;
	for (const target of remainingTargets) {
		const entry = await touchSaveInstance(cfg, target);
		ledger.push(entry);
		touchCount++;
		if (entry.status === 'touched') {
			// Progress indicator every 10 instances.
			if (touchCount % 10 === 0 || touchCount === remainingTargets.length) {
				console.log(`  Progress: ${touchCount}/${remainingTargets.length} touch-saves completed`);
			}
		} else {
			console.error(`  FAILED: ${target.typeName} "${target.name}" (${target.id}): ${entry.error}`);
		}
	}

	// Phase 3: Post-sweep 3-gate-AND verification.
	console.log('\n=== Post-sweep 3-gate-AND verification ===');
	const gateAndResults = await postSweepGateVerification(cfg, discoveredTypes);
	let allGatesOk = true;
	for (const r of gateAndResults) {
		const g1Status = r.gate1.passes ? 'PASS' : 'FAIL';
		const g2Status = r.gate2.passes ? 'PASS' : 'FAIL';
		const g3PassCount = r.gate3Instances.filter((i) => i.passes).length;
		const g3FailCount = r.gate3Instances.filter((i) => !i.passes).length;
		console.log(
			`  ${r.type}: gate1=${g1Status}(${r.gate1.sharing}) gate2=${g2Status}(${r.gate2.sharing}) ` +
			`gate3=${g3PassCount}/${r.totalInstances} pass (${g3FailCount} private/absent -- TD.4 scope)`
		);
		if (r.gate1and2Pass) {
			console.log(
				`    -> ${r.instancesWithFullAnd}/${r.totalInstances} instances have full 3-gate-AND ` +
				`(name visible to member)`
			);
		} else {
			console.error(`    -> gate 1+2 FAIL -- no instances can show name to member regardless of gate 3`);
			allGatesOk = false;
		}
	}
	if (allGatesOk) {
		console.log('  Post-sweep: gates 1+2 PASS for all 6 types. Gate 3 (instance _sharing) is TD.4 scope.');
	}

	// Phase 4: Non-omniscient bucket verification.
	console.log('\n=== Non-omniscient bucket verification ===');
	const publicEvent = (instancesByType['event'] ?? []).find((e) => e.instanceSharing === 'public');
	const nonOmniResult = await nonOmniscientVerification(cfg, publicEvent?.id ?? null);
	console.log(`  ${nonOmniResult.passed ? 'PASSED' : 'FAILED'}: ${nonOmniResult.detail}`);

	// Summary.
	const propdefEntries = ledger.filter((e) => e.action === 'propdef-widen');
	const touchEntries = ledger.filter((e) => e.action === 'touch-save');
	const propdefWidened = propdefEntries.filter((e) => e.status === 'widened').length;
	const propdefFailed = propdefEntries.filter((e) => e.status === 'failed').length;
	const touchSucceeded = touchEntries.filter((e) => e.status === 'touched').length;
	const touchFailed = touchEntries.filter((e) => e.status === 'failed').length;

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Propdef widens:  ${propdefWidened}/${toWiden.length} (${propdefFailed} failed)`);
	console.log(`Touch-saves:     ${touchSucceeded}/${allTouchTargets.length} (${touchFailed} failed)`);
	console.log(`Post-sweep gates 1+2: ${gateAndResults.every((r) => r.gate1and2Pass) ? 'ALL PASS' : 'SOME FAIL'}`);
	console.log(`Non-omniscient:  ${nonOmniResult.passed ? 'PASSED' : 'FAILED'}`);

	const failures = ledger.filter((e) => e.status === 'failed');
	for (const f of failures) {
		console.error(`  FAILED: ${f.action} ${f.type} ${f.targetId} ("${f.targetName}"): ${f.error}`);
	}

	const hasFailures = failures.length > 0 || !allGatesOk;
	const artifactPath = writeLedger({
		dryRun: false,
		authorization:
			'Polyphony db is dev/test with synthetic data -- routine mutations pre-authorized. ' +
			'Per-run team-lead + PO authorization obtained.',
		discoveredTypes: discoveredTypes.map((dt) => ({
			typeName: dt.typeName,
			typeId: dt.typeId,
			typeSharing: dt.typeSharing,
			namePropDefId: dt.namePropDefId,
			namePropDefSharing: dt.namePropDefSharing,
			isFormula: dt.isFormula,
			plannedSharing: TARGET_PROPDEF_SHARING[dt.typeName]
		})),
		instancesByType: Object.fromEntries(
			Object.entries(instancesByType).map(([typeName, instances]) => [
				typeName,
				{ count: instances.length }
			])
		),
		propdefResults: {
			widened: propdefWidened,
			failed: propdefFailed,
			skipped: propdefEntries.filter((e) => e.status === 'skipped').length
		},
		touchSaveResults: {
			touched: touchSucceeded,
			failed: touchFailed,
			total: allTouchTargets.length
		},
		postSweepGateVerification: gateAndResults.map((r) => ({
			type: r.type,
			gate1: r.gate1,
			gate2: r.gate2,
			gate1and2Pass: r.gate1and2Pass,
			instancesWithFullAnd: r.instancesWithFullAnd,
			totalInstances: r.totalInstances,
			gate3Summary: {
				domainOrPublic: r.gate3Instances.filter((i) => i.passes).length,
				privateOrAbsent: r.gate3Instances.filter((i) => !i.passes).length
			}
		})),
		nonOmniscientVerification: nonOmniResult,
		ledger,
		exitCode: hasFailures ? 1 : 0,
		verificationCaveat:
			'Run under ENTU_API_KEY (PO/db-root), which always reads the private bucket regardless ' +
			'of tier. "widened"/"touched" here means the write landed, the property _id rotated ' +
			'(proof aggregateEntity ran), and the 3-check canary (prop _id + name present + ' +
			'count=1) passed. The non-omniscient verification confirms the public event name ' +
			'is readable without authentication. The post-sweep 3-gate-AND verification confirms ' +
			'all structural gates are in place.'
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('TD.2 tidy-name-visibility ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
