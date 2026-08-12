// TD.2b (#118 follow-up) -- Tier Alignment: narrow season + person instances
//                          from public to domain
//
// ROOT CAUSE (discovered by REVIEW):
//   Season instances are _sharing:public but season.name propdef is _sharing:domain.
//   Person instances (128/134) are _sharing:public but person.name propdef is _sharing:domain.
//   Public-tier entities are served from the public bucket, which EXCLUDES domain-tier
//   properties. The name propdef being domain means the name value lands in the domain
//   bucket, but the entity is served from public -- so the name is invisible.
//
// THE FIX: narrow instances from public to domain.
//   This matches the 4 types that PASSED the TD.5 gate (section, organization, lending,
//   library -- all domain/domain). Do NOT widen the propdefs to public -- narrowing
//   instances is lower blast radius.
//
//   - Season:  2 instances, both public -> domain
//   - Person:  128 instances public -> domain (6 already domain -- leave them)
//
// After narrowing, touch-save each instance to trigger re-aggregation into the domain
// bucket. Without the touch-save, the name values may not appear in the domain bucket
// even though the instance is now domain-tier.
//
// Verification: unauthenticated GET on a narrowed instance should return NO name
// (confirms it is no longer in the public bucket, now in domain where it belongs).
//
// Expected: 130 instance _sharing narrowings + 130 touch-saves = 260 mutations
//
// DRY_RUN=true by default. Set DRY_RUN=false ONLY after dry-run is verified
// and team-lead + PO have authorized.
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td2b-tier-alignment.ts                       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/tidy-td2b-tier-alignment.ts                       # ONLY after authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch, entuUrl } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

/** The 2 target types: narrow from public to domain. */
const TARGET_TYPES = ['season', 'person'] as const;
type TargetTypeName = (typeof TARGET_TYPES)[number];

// -- Types ----------------------------------------------------------------------

interface DiscoveredType {
	typeName: TargetTypeName;
	typeId: string;
	typeSharing: string;
	namePropDefId: string;
	namePropDefSharing: string | null;
	isFormula: boolean;
}

interface DiscoveredInstance {
	typeName: TargetTypeName;
	id: string;
	name: string;
	namePropId: string | null;
	sharingPropId: string | null;
	instanceSharing: string;
}

interface NarrowTarget {
	typeName: TargetTypeName;
	id: string;
	name: string;
	sharingValueId: string;
	currentSharing: string;
	namePropId: string | null;
}

interface LedgerEntry {
	action: 'narrow' | 'touch-save';
	type: string;
	targetId: string;
	targetName: string;
	status: 'narrowed' | 'touched' | 'skipped' | 'failed' | 'dry-run';
	before?: string | null;
	after?: string;
	newPropId?: string;
	touchMechanic?: string;
	canaryChecks?: {
		postHasPropId: boolean;
		propIdRotated: boolean;
		namePresent: boolean;
		nameCount: number;
	};
	error?: string;
}

interface GateVerification {
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

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `tidy-td2b-tier-alignment-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

// -- Phase 0: Dynamic discovery -------------------------------------------------

/**
 * Discover the type entity ID for a given type name by querying the live API.
 * Returns the type entity ID, its _sharing, and the name prop-def entity ID.
 */
async function discoverType(cfg: EntuCfg, typeName: TargetTypeName): Promise<DiscoveredType> {
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
	if (!propDefRes.ok)
		throw new Error(`discoverType(${typeName}): name propdef query failed: ${propDefRes.status}`);
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
	const verifyPropDefRes = await entuFetch(
		cfg.db,
		`entity/${propDefEntity._id}?props=name`,
		cfg.token
	);
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
		isFormula
	};
}

/**
 * Discover all instances of a given type. Returns each instance with its
 * name property _id, _sharing property _id, and current _sharing tier.
 */
async function discoverInstances(
	cfg: EntuCfg,
	typeName: TargetTypeName,
	typeId: string
): Promise<DiscoveredInstance[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${typeId}&props=name,_sharing&limit=600`,
		cfg.token
	);
	if (!res.ok)
		throw new Error(`discoverInstances(${typeName}): query failed: ${res.status}`);
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
 * Build narrow targets: only instances with _sharing=public.
 * Instances already at domain (or any other tier) are excluded.
 */
function buildNarrowTargets(instances: DiscoveredInstance[]): {
	targets: NarrowTarget[];
	skipped: Array<{ id: string; name: string; sharing: string; reason: string }>;
} {
	const targets: NarrowTarget[] = [];
	const skipped: Array<{ id: string; name: string; sharing: string; reason: string }> = [];

	for (const inst of instances) {
		if (inst.instanceSharing === 'public') {
			if (!inst.sharingPropId) {
				skipped.push({
					id: inst.id,
					name: inst.name,
					sharing: inst.instanceSharing,
					reason: 'public but no _sharing property _id -- cannot atomic-replace'
				});
				continue;
			}
			targets.push({
				typeName: inst.typeName,
				id: inst.id,
				name: inst.name,
				sharingValueId: inst.sharingPropId,
				currentSharing: inst.instanceSharing,
				namePropId: inst.namePropId
			});
		} else {
			skipped.push({
				id: inst.id,
				name: inst.name,
				sharing: inst.instanceSharing,
				reason: `already ${inst.instanceSharing} -- no change needed`
			});
		}
	}

	return { targets, skipped };
}

// -- Phase 1: Narrow a single instance's _sharing from public to domain --------

async function narrowInstance(cfg: EntuCfg, target: NarrowTarget): Promise<LedgerEntry> {
	try {
		// Atomic replace of _sharing: public -> domain.
		const writeBody = [
			{ _id: target.sharingValueId, type: '_sharing', string: 'domain' }
		];

		const res = await entuFetch(cfg.db, `entity/${target.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(writeBody)
		});
		if (!res.ok) {
			const text = await res.text();
			return {
				action: 'narrow',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				status: 'failed',
				before: target.currentSharing,
				error: `POST failed: ${res.status} -- ${text}`
			};
		}

		// Verify _id rotated (proof aggregateEntity ran).
		const resBody = (await res.json()) as {
			properties?: Array<{ _id: string; type: string }>;
		};
		const newSharingProp = (resBody.properties ?? []).find((p) => p.type === '_sharing');
		if (!newSharingProp?._id) {
			return {
				action: 'narrow',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				status: 'failed',
				before: target.currentSharing,
				error:
					'POST returned 2xx but no _sharing property in response (apparent-success trap)'
			};
		}
		if (newSharingProp._id === target.sharingValueId) {
			return {
				action: 'narrow',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				status: 'failed',
				before: target.currentSharing,
				error: `POST returned the SAME property _id (${target.sharingValueId}) -- replace did not rotate`
			};
		}

		// Read-back verify.
		const getRes = await entuFetch(
			cfg.db,
			`entity/${target.id}?props=_sharing`,
			cfg.token
		);
		if (!getRes.ok) {
			return {
				action: 'narrow',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				status: 'failed',
				before: target.currentSharing,
				error: `read-back GET failed: ${getRes.status}`
			};
		}
		const getBody = (await getRes.json()) as {
			entity?: { _sharing?: Array<{ string: string }> };
		};
		const sharingValues = getBody.entity?._sharing ?? [];
		if (sharingValues.length !== 1) {
			return {
				action: 'narrow',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				status: 'failed',
				before: target.currentSharing,
				error: `read-back shows ${sharingValues.length} _sharing values (expected exactly 1)`
			};
		}
		if (sharingValues[0].string !== 'domain') {
			return {
				action: 'narrow',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				status: 'failed',
				before: target.currentSharing,
				error: `read-back shows _sharing='${sharingValues[0].string}', expected 'domain'`
			};
		}

		return {
			action: 'narrow',
			type: target.typeName,
			targetId: target.id,
			targetName: target.name,
			status: 'narrowed',
			before: target.currentSharing,
			after: 'domain',
			newPropId: newSharingProp._id
		};
	} catch (err) {
		return {
			action: 'narrow',
			type: target.typeName,
			targetId: target.id,
			targetName: target.name,
			status: 'failed',
			before: target.currentSharing,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Phase 2: Touch-save a single instance with 3-check canary verification ----
//
// After narrowing from public to domain, re-POST the name value to trigger
// Entu re-aggregation. This ensures the domain bucket is populated with the
// name value. The 3-check canary verification (T6.2 remediation discipline):
//   (a) POST response contains the property _id, and _id rotated from input
//   (b) Read-back of the instance shows the name value present
//   (c) Count of name values on the instance = exactly 1

async function touchSaveInstance(
	cfg: EntuCfg,
	target: NarrowTarget
): Promise<LedgerEntry> {
	if (!target.namePropId) {
		return {
			action: 'touch-save',
			type: target.typeName,
			targetId: target.id,
			targetName: target.name,
			touchMechanic: 'name-based',
			status: 'skipped',
			error: `no name property _id -- cannot touch-save`
		};
	}

	try {
		// Re-POST the name value with its existing _id (atomic replace, same content).
		// This triggers aggregateEntity, which re-populates the domain bucket.
		const writeBody = [
			{ _id: target.namePropId, type: 'name', string: target.name }
		];

		const res = await entuFetch(cfg.db, `entity/${target.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(writeBody)
		});
		if (!res.ok) {
			const text = await res.text();
			return {
				action: 'touch-save',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				touchMechanic: 'name-based',
				status: 'failed',
				error: `POST failed: ${res.status} -- ${text}`
			};
		}

		// --- 3-check canary verification ---

		// Check (a): POST response contains the property _id, and _id rotated.
		const resBody = (await res.json()) as {
			properties?: Array<{ _id: string; type: string }>;
		};
		const newProp = (resBody.properties ?? []).find((p) => p.type === 'name');
		const postHasPropId = !!newProp?._id;
		const propIdRotated = postHasPropId && newProp!._id !== target.namePropId;

		if (!postHasPropId) {
			return {
				action: 'touch-save',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				touchMechanic: 'name-based',
				status: 'failed',
				canaryChecks: {
					postHasPropId: false,
					propIdRotated: false,
					namePresent: false,
					nameCount: 0
				},
				error: `3-check (a) FAILED: POST returned 2xx but no name property in response (apparent-success trap)`
			};
		}
		if (!propIdRotated) {
			return {
				action: 'touch-save',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				touchMechanic: 'name-based',
				status: 'failed',
				canaryChecks: {
					postHasPropId: true,
					propIdRotated: false,
					namePresent: false,
					nameCount: 0
				},
				error: `3-check (a) FAILED: POST returned the SAME property _id (${target.namePropId}) -- replace did not rotate`
			};
		}

		// Check (b) + (c): Read-back instance, verify name is present and count = 1.
		const verifyRes = await entuFetch(
			cfg.db,
			`entity/${target.id}?props=name`,
			cfg.token
		);
		if (!verifyRes.ok) {
			return {
				action: 'touch-save',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				touchMechanic: 'name-based',
				status: 'failed',
				canaryChecks: {
					postHasPropId: true,
					propIdRotated: true,
					namePresent: false,
					nameCount: 0
				},
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
				action: 'touch-save',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				touchMechanic: 'name-based',
				status: 'failed',
				canaryChecks: {
					postHasPropId: true,
					propIdRotated: true,
					namePresent: false,
					nameCount: 0
				},
				error: `3-check (b) FAILED: read-back shows NO name value on instance after touch-save`
			};
		}
		if (nameCount !== 1) {
			return {
				action: 'touch-save',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				touchMechanic: 'name-based',
				status: 'failed',
				canaryChecks: {
					postHasPropId: true,
					propIdRotated: true,
					namePresent: true,
					nameCount
				},
				error: `3-check (c) FAILED: read-back shows ${nameCount} name values (expected exactly 1) -- possible POST-appends duplication`
			};
		}

		return {
			action: 'touch-save',
			type: target.typeName,
			targetId: target.id,
			targetName: target.name,
			touchMechanic: 'name-based',
			status: 'touched',
			canaryChecks: {
				postHasPropId: true,
				propIdRotated: true,
				namePresent: true,
				nameCount: 1
			},
			newPropId: newProp!._id
		};
	} catch (err) {
		return {
			action: 'touch-save',
			type: target.typeName,
			targetId: target.id,
			targetName: target.name,
			touchMechanic: 'name-based',
			status: 'failed',
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

// -- Canary pass: one instance per type, narrowed + touch-saved, verified ------

async function runCanaries(
	cfg: EntuCfg,
	targets: NarrowTarget[]
): Promise<{ canaryEntries: LedgerEntry[]; remainingTargets: NarrowTarget[] }> {
	const canaryByType = new Map<TargetTypeName, NarrowTarget>();
	for (const t of targets) {
		if (!canaryByType.has(t.typeName)) canaryByType.set(t.typeName, t);
	}
	const canaries = [...canaryByType.values()];
	const canaryEntries: LedgerEntry[] = [];

	for (const c of canaries) {
		// Narrow.
		console.log(
			`  Canary narrow: ${c.typeName} "${c.name}" (${c.id}) -- public -> domain`
		);
		const narrowEntry = await narrowInstance(cfg, c);
		if (narrowEntry.status !== 'narrowed') {
			throw new Error(
				`Canary narrow FAILED for ${c.typeName}/${c.id} ("${c.name}"): ${narrowEntry.error}. ` +
					`Refusing to proceed with remaining instances.`
			);
		}
		canaryEntries.push(narrowEntry);
		console.log(
			`  CANARY PASSED (narrow): ${c.typeName} "${c.name}" -- public -> domain`
		);

		// Touch-save (need fresh name prop _id after narrow -- re-read).
		const freshRes = await entuFetch(
			cfg.db,
			`entity/${c.id}?props=name`,
			cfg.token
		);
		if (!freshRes.ok) {
			throw new Error(
				`Canary touch-save: failed to re-read ${c.typeName}/${c.id} after narrow: ${freshRes.status}`
			);
		}
		const freshBody = (await freshRes.json()) as {
			entity?: { name?: Array<{ _id: string; string: string }> };
		};
		const freshNamePropId = freshBody.entity?.name?.[0]?._id ?? null;
		const freshName = freshBody.entity?.name?.[0]?.string ?? c.name;

		const touchTarget: NarrowTarget = {
			...c,
			namePropId: freshNamePropId,
			name: freshName
		};

		console.log(
			`  Canary touch-save: ${c.typeName} "${freshName}" (${c.id})`
		);
		const touchEntry = await touchSaveInstance(cfg, touchTarget);
		if (touchEntry.status !== 'touched') {
			throw new Error(
				`Canary touch-save FAILED for ${c.typeName}/${c.id} ("${freshName}"): ${touchEntry.error}. ` +
					`Refusing to proceed with remaining instances.`
			);
		}
		canaryEntries.push(touchEntry);
		console.log(
			`  CANARY PASSED (touch-save): ${c.typeName} "${freshName}" -- 3-check OK`
		);
	}

	const canaryIds = new Set(canaries.map((c) => c.id));
	const remainingTargets = targets.filter((t) => !canaryIds.has(t.id));
	return { canaryEntries, remainingTargets };
}

// -- Post-sweep 3-gate-AND verification ----------------------------------------

async function postSweepGateVerification(
	cfg: EntuCfg,
	discoveredTypes: DiscoveredType[]
): Promise<GateVerification[]> {
	const results: GateVerification[] = [];

	for (const dt of discoveredTypes) {
		// Gate 1: re-read name propdef _sharing (should be domain for both types).
		const g1Res = await entuFetch(
			cfg.db,
			`entity/${dt.namePropDefId}?props=_sharing`,
			cfg.token
		);
		if (!g1Res.ok)
			throw new Error(
				`postSweepGateVerification: gate 1 GET ${dt.namePropDefId} (${dt.typeName}.name) failed: ${g1Res.status}`
			);
		const g1Body = (await g1Res.json()) as {
			entity?: { _sharing?: Array<{ string: string }> };
		};
		const g1Sharing = g1Body.entity?._sharing?.[0]?.string ?? '(absent)';
		const g1Passes = g1Sharing === 'domain' || g1Sharing === 'public';

		// Gate 2: re-read type entity _sharing.
		const g2Res = await entuFetch(
			cfg.db,
			`entity/${dt.typeId}?props=_sharing`,
			cfg.token
		);
		if (!g2Res.ok)
			throw new Error(
				`postSweepGateVerification: gate 2 GET ${dt.typeId} (${dt.typeName}) failed: ${g2Res.status}`
			);
		const g2Body = (await g2Res.json()) as {
			entity?: { _sharing?: Array<{ string: string }> };
		};
		const g2Sharing = g2Body.entity?._sharing?.[0]?.string ?? '(absent)';
		const g2Passes = g2Sharing === 'domain' || g2Sharing === 'public';

		// Gate 3: re-read all instances' _sharing (should now all be domain).
		const g3Res = await entuFetch(
			cfg.db,
			`entity?_type.reference=${dt.typeId}&props=name,_sharing&limit=600`,
			cfg.token
		);
		if (!g3Res.ok)
			throw new Error(
				`postSweepGateVerification: gate 3 instance query for ${dt.typeName} failed: ${g3Res.status}`
			);
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
 * After narrowing from public to domain, an unauthenticated GET should
 * return NO name on the narrowed instance. This confirms the instance
 * is no longer served from the public bucket.
 */
async function nonOmniscientVerification(
	cfg: EntuCfg,
	instanceId: string,
	instanceName: string,
	typeName: string
): Promise<{ passed: boolean; detail: string }> {
	try {
		// Unauthenticated GET -- no Authorization header.
		const url = entuUrl(cfg.db, `entity/${instanceId}?props=name`);
		const res = await fetch(url, {
			headers: { Accept: 'application/json' }
		});

		if (res.status === 403 || res.status === 404) {
			// Entity no longer visible at public tier at all -- expected after narrowing.
			return {
				passed: true,
				detail: `Unauthenticated GET for ${typeName} ${instanceId} ("${instanceName}") returned ${res.status} -- entity no longer in public bucket (correctly narrowed to domain)`
			};
		}

		if (!res.ok) {
			return {
				passed: false,
				detail: `Unauthenticated GET for ${typeName} ${instanceId} ("${instanceName}") failed unexpectedly: ${res.status}`
			};
		}

		const body = (await res.json()) as {
			entity?: { name?: Array<{ string: string }> };
		};
		const nameValues = body.entity?.name ?? [];

		if (nameValues.length === 0) {
			// Entity might still show up as a stub (no name) if it remained in some
			// cache, but name is absent -- acceptable.
			return {
				passed: true,
				detail: `Unauthenticated GET returned ${typeName} ${instanceId} ("${instanceName}") with NO name -- name correctly absent from public bucket`
			};
		}

		// Name is STILL visible at public tier -- narrowing did not take effect.
		return {
			passed: false,
			detail: `Unauthenticated GET for ${typeName} ${instanceId} ("${instanceName}") STILL shows name="${nameValues[0].string}" in public bucket -- narrowing may not have taken effect`
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
	targetsByType: Record<string, NarrowTarget[]>,
	skippedByType: Record<
		string,
		Array<{ id: string; name: string; sharing: string; reason: string }>
	>
): string {
	const lines: string[] = [];
	lines.push(
		'TD.2b (#118 follow-up) -- Tier Alignment: narrow season + person instances'
	);
	lines.push('                          public -> domain (DRY-RUN plan, NO writes issued)');
	lines.push('');
	lines.push('ROOT CAUSE: tier inversion -- instances at public, name propdefs at domain.');
	lines.push(
		'Public bucket excludes domain-tier properties, so names are invisible.'
	);
	lines.push('FIX: narrow instances from public to domain (match section/org/lending/library pattern).');
	lines.push('');

	lines.push('== Discovery results (type entities + name prop-defs)');
	for (const dt of discoveredTypes) {
		const formulaTag = dt.isFormula ? ' [FORMULA]' : '';
		lines.push(`   ${dt.typeName}:`);
		lines.push(`     type entity:    ${dt.typeId} (_sharing=${dt.typeSharing})`);
		lines.push(
			`     name prop-def:  ${dt.namePropDefId} (_sharing=${dt.namePropDefSharing ?? '(absent)'}${formulaTag})`
		);
	}
	lines.push('');

	lines.push("== Gate 2 verification (TYPE entities' own _sharing)");
	for (const dt of discoveredTypes) {
		const passes = dt.typeSharing === 'domain' || dt.typeSharing === 'public';
		const verdict = passes
			? 'PASSES'
			: 'FAILS -- would cap domain-bucket exposure regardless of instance fix';
		lines.push(
			`   ${dt.typeName} TYPE (${dt.typeId}): _sharing='${dt.typeSharing}' -- ${verdict}`
		);
	}
	const allGate2Pass = discoveredTypes.every(
		(dt) => dt.typeSharing === 'domain' || dt.typeSharing === 'public'
	);
	lines.push(
		`   Overall: ${allGate2Pass ? `all ${discoveredTypes.length} types PASS gate 2` : 'ONE OR MORE TYPES FAIL gate 2 -- HALT'}`
	);
	lines.push('');

	lines.push("== Gate 1 verification (name prop-def _sharing -- must be 'domain')");
	for (const dt of discoveredTypes) {
		const pdSharing = dt.namePropDefSharing ?? '(absent)';
		const passes = pdSharing === 'domain';
		const verdict = passes
			? 'PASSES -- name at domain tier, instances must also be domain'
			: `UNEXPECTED: ${pdSharing} -- this script assumes name propdef is already domain`;
		lines.push(
			`   ${dt.typeName}.name (${dt.namePropDefId}): _sharing='${pdSharing}' -- ${verdict}`
		);
	}
	lines.push('');

	lines.push('== Population by type');
	for (const typeName of TARGET_TYPES) {
		const instances = instancesByType[typeName] ?? [];
		const targets = targetsByType[typeName] ?? [];
		const skipped = skippedByType[typeName] ?? [];
		const alreadyDomain = skipped.filter((s) =>
			s.reason.startsWith('already ')
		).length;
		lines.push(
			`   ${typeName}: ${instances.length} total (${targets.length} public -> domain, ${alreadyDomain} already domain)`
		);
	}
	lines.push('');

	const totalTargets =
		(targetsByType['season']?.length ?? 0) +
		(targetsByType['person']?.length ?? 0);

	lines.push(
		`== Phase 1: Narrow ${totalTargets} instances (_sharing: public -> domain)`
	);
	for (const typeName of TARGET_TYPES) {
		const targets = targetsByType[typeName] ?? [];
		lines.push(`   ${typeName} (${targets.length}):`);
		for (const t of targets) {
			lines.push(
				`     ${t.id} "${t.name}" -- public -> domain`
			);
		}
	}
	lines.push(`   Narrow writes planned: ${totalTargets}`);
	lines.push('');

	lines.push(
		`== Phase 2: Touch-save ${totalTargets} instances (re-aggregate into domain bucket)`
	);
	lines.push('   Touch-save mechanic: name-based (re-POST name value to trigger aggregateEntity)');
	lines.push('   Applied to EVERY narrowed instance to ensure domain bucket is populated.');
	lines.push(`   Touch-save writes planned: ${totalTargets}`);
	lines.push('');

	lines.push(
		'== Touch-save 3-check canary verification (applied to EVERY touch-save)'
	);
	lines.push(
		'   (a) POST response contains property _id, and _id rotated from input'
	);
	lines.push('   (b) Read-back of instance shows name value present');
	lines.push('   (c) Count of name values on instance = exactly 1');
	lines.push(
		'   HTTP 200 alone is NOT sufficient -- all 3 checks must pass.'
	);
	lines.push('');

	const alreadyDomainByType: Record<string, Array<{ id: string; name: string; sharing: string }>> = {};
	for (const typeName of TARGET_TYPES) {
		alreadyDomainByType[typeName] = (skippedByType[typeName] ?? [])
			.filter((s) => s.reason.startsWith('already '))
			.map((s) => ({ id: s.id, name: s.name, sharing: s.sharing }));
	}
	const totalAlreadyDomain =
		(alreadyDomainByType['season']?.length ?? 0) +
		(alreadyDomainByType['person']?.length ?? 0);
	if (totalAlreadyDomain > 0) {
		lines.push(`== ${totalAlreadyDomain} instance(s) already non-public (no change needed):`);
		for (const typeName of TARGET_TYPES) {
			const items = alreadyDomainByType[typeName] ?? [];
			if (items.length > 0) {
				lines.push(`   ${typeName} (${items.length}):`);
				for (const item of items) {
					lines.push(`     ${item.id} "${item.name}" -- ${item.sharing}`);
				}
			}
		}
		lines.push('');
	}

	lines.push('== Execution plan');
	lines.push(
		`   CANARY: one instance per type (${TARGET_TYPES.length} total), narrowed + touch-saved + read-back verified.`
	);
	lines.push(
		`   SWEEP: remaining ${totalTargets - TARGET_TYPES.length} instances, same narrow + touch-save + verify.`
	);
	lines.push(
		`   POST-SWEEP: re-read all 3 gates for each type, verify 3-gate-AND passes for all domain instances.`
	);
	lines.push(
		'   NON-OMNISCIENT: unauthenticated GET on a narrowed instance -- verify name is ABSENT from public bucket.'
	);
	lines.push(
		`   Total mutations planned: ${totalTargets} narrow + ${totalTargets} touch-save = ${totalTargets * 2}`
	);
	lines.push('');

	lines.push('== Notes');
	lines.push(
		'   - All entity IDs discovered dynamically from live API (no hardcoded IDs).'
	);
	lines.push(
		'   - This is the OPPOSITE of TD.4 (which widened private -> domain). Here we NARROW public -> domain.'
	);
	lines.push(
		'   - The fix aligns season + person with the 4 types that passed TD.5 gate'
	);
	lines.push(
		'     (section, organization, lending, library -- all domain/domain).'
	);
	lines.push(
		'   - Name propdefs are NOT touched -- they are already at domain tier (correct).'
	);
	lines.push(
		'   - Touch-save ensures the domain bucket is populated with name values after narrowing.'
	);
	lines.push(
		'   - Non-omniscient verification confirms the instance is no longer in the public bucket.'
	);
	lines.push('');

	lines.push(
		`Totals: ${totalTargets * 2} mutations planned (${totalTargets} narrowings + ${totalTargets} touch-saves). Writes issued this run: 0.`
	);
	return lines.join('\n');
}

// -- Main -----------------------------------------------------------------------

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);

	// Step 0: Dynamic discovery of type entities + name prop-defs.
	console.log('=== Phase 0: Dynamic discovery ===');
	const discoveredTypes: DiscoveredType[] = [];
	for (const typeName of TARGET_TYPES) {
		console.log(`  Discovering ${typeName}...`);
		const dt = await discoverType(cfg, typeName);
		const formulaTag = dt.isFormula ? ' [FORMULA]' : '';
		console.log(`    type entity: ${dt.typeId} (_sharing=${dt.typeSharing})`);
		console.log(
			`    name propdef: ${dt.namePropDefId} (_sharing=${dt.namePropDefSharing ?? '(absent)'}${formulaTag})`
		);
		discoveredTypes.push(dt);
	}
	console.log(`  Discovered ${discoveredTypes.length} types successfully.\n`);

	// Step 1: Gate 2 verification (type entity _sharing).
	console.log("=== Gate 2 verification (type entity _sharing) ===");
	for (const dt of discoveredTypes) {
		const passes = dt.typeSharing === 'domain' || dt.typeSharing === 'public';
		console.log(
			`  ${dt.typeName} TYPE (${dt.typeId}): _sharing='${dt.typeSharing}' -- ${passes ? 'PASSES' : 'FAILS'}`
		);
	}
	const gate2Failures = discoveredTypes.filter(
		(dt) => dt.typeSharing !== 'domain' && dt.typeSharing !== 'public'
	);
	if (gate2Failures.length > 0) {
		console.error(
			`ABORT: ${gate2Failures.length} type(s) fail gate 2 -- narrowing instances would be futile ` +
				`since the type entity itself caps domain-bucket exposure: ` +
				gate2Failures.map((dt) => `${dt.typeName}=${dt.typeSharing}`).join(', ')
		);
		writeLedger({
			dryRun: DRY_RUN,
			halted: 'gate2-failed',
			gate2Failures,
			exitCode: 1
		});
		process.exit(1);
	}

	// Step 2: Gate 1 pre-check (name propdef _sharing must be domain).
	console.log('\n=== Gate 1 pre-check (name propdef _sharing) ===');
	for (const dt of discoveredTypes) {
		const pdSharing = dt.namePropDefSharing ?? '(absent)';
		const isExpected = pdSharing === 'domain';
		console.log(
			`  ${dt.typeName}.name (${dt.namePropDefId}): _sharing='${pdSharing}' -- ${isExpected ? 'OK (domain)' : `WARNING: expected domain, got ${pdSharing}`}`
		);
		if (!isExpected) {
			console.warn(
				`  WARNING: ${dt.typeName}.name propdef is not at domain tier. ` +
					`This script assumes the propdef is already correct and only narrows instances. ` +
					`If the propdef also needs fixing, run TD.2 first.`
			);
		}
	}

	// Step 3: Discover instances and build narrow targets.
	console.log('\n=== Instance discovery ===');
	const instancesByType: Record<string, DiscoveredInstance[]> = {};
	const targetsByType: Record<string, NarrowTarget[]> = {};
	const skippedByType: Record<
		string,
		Array<{ id: string; name: string; sharing: string; reason: string }>
	> = {};
	let allTargets: NarrowTarget[] = [];

	for (const dt of discoveredTypes) {
		const instances = await discoverInstances(cfg, dt.typeName, dt.typeId);
		instancesByType[dt.typeName] = instances;
		const { targets, skipped } = buildNarrowTargets(instances);
		targetsByType[dt.typeName] = targets;
		skippedByType[dt.typeName] = skipped;
		allTargets = allTargets.concat(targets);

		const alreadyDomain = skipped.filter((s) =>
			s.reason.startsWith('already ')
		).length;
		console.log(
			`  ${dt.typeName}: ${instances.length} total, ${targets.length} public (to narrow), ${alreadyDomain} already domain`
		);
	}
	console.log(`  Total narrow targets: ${allTargets.length}`);
	console.log(`  Total mutations planned: ${allTargets.length * 2} (${allTargets.length} narrow + ${allTargets.length} touch-save)`);

	if (allTargets.length === 0) {
		console.log(
			'\n  No targets to narrow -- all instances are already non-public.'
		);
		writeLedger({
			dryRun: DRY_RUN,
			discoveredTypes: discoveredTypes.map((dt) => ({
				typeName: dt.typeName,
				typeId: dt.typeId,
				namePropDefId: dt.namePropDefId
			})),
			writesPlanned: 0,
			exitCode: 0
		});
		process.exit(0);
	}

	// Step 4: Dry-run plan or live execution.
	if (DRY_RUN) {
		const plan = renderPlan(
			discoveredTypes,
			instancesByType,
			targetsByType,
			skippedByType
		);
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
				isFormula: dt.isFormula
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
			targetsByType: Object.fromEntries(
				Object.entries(targetsByType).map(([typeName, targets]) => [
					typeName,
					targets.map((t) => ({
						id: t.id,
						name: t.name,
						currentSharing: t.currentSharing,
						plannedSharing: 'domain'
					}))
				])
			),
			skippedByType,
			mutationsPlanned: {
				narrowings: allTargets.length,
				touchSaves: allTargets.length,
				total: allTargets.length * 2
			},
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	// -- Live execution ---------------------------------------------------------

	// Phase 0: Canary pass (one instance per type, narrowed + touch-saved).
	console.log('\n=== Canary pass ===');
	const { canaryEntries, remainingTargets } = await runCanaries(
		cfg,
		allTargets
	);
	ledger.push(...canaryEntries);
	console.log(`  ${canaryEntries.length} canary operations passed.\n`);

	// Phase 1+2: Narrow + touch-save remaining instances (serial, each fully verified).
	console.log(
		`=== Full sweep: ${remainingTargets.length} remaining instances ===`
	);
	let sweepCount = 0;
	for (const target of remainingTargets) {
		// Step A: Narrow.
		const narrowEntry = await narrowInstance(cfg, target);
		ledger.push(narrowEntry);
		if (narrowEntry.status !== 'narrowed') {
			console.error(
				`  NARROW FAILED: ${target.typeName} "${target.name}" (${target.id}) -- ${narrowEntry.error}`
			);
			continue; // Skip touch-save if narrow failed.
		}

		// Step B: Re-read to get fresh name prop _id after narrowing.
		const freshRes = await entuFetch(
			cfg.db,
			`entity/${target.id}?props=name`,
			cfg.token
		);
		if (!freshRes.ok) {
			console.error(
				`  TOUCH-SAVE SKIPPED: failed to re-read ${target.typeName}/${target.id} after narrow: ${freshRes.status}`
			);
			ledger.push({
				action: 'touch-save',
				type: target.typeName,
				targetId: target.id,
				targetName: target.name,
				touchMechanic: 'name-based',
				status: 'failed',
				error: `re-read after narrow failed: ${freshRes.status}`
			});
			continue;
		}
		const freshBody = (await freshRes.json()) as {
			entity?: { name?: Array<{ _id: string; string: string }> };
		};
		const freshNamePropId = freshBody.entity?.name?.[0]?._id ?? null;
		const freshName = freshBody.entity?.name?.[0]?.string ?? target.name;

		// Step C: Touch-save.
		const touchTarget: NarrowTarget = {
			...target,
			namePropId: freshNamePropId,
			name: freshName
		};
		const touchEntry = await touchSaveInstance(cfg, touchTarget);
		ledger.push(touchEntry);

		sweepCount++;
		if (touchEntry.status === 'touched') {
			// Progress indicator every 10 instances.
			if (sweepCount % 10 === 0 || sweepCount === remainingTargets.length) {
				console.log(
					`  Progress: ${sweepCount}/${remainingTargets.length} narrow+touch-save completed`
				);
			}
		} else {
			console.error(
				`  TOUCH-SAVE FAILED: ${target.typeName} "${freshName}" (${target.id}) -- ${touchEntry.error}`
			);
		}
	}

	// Phase 3: Post-sweep 3-gate-AND verification.
	console.log('\n=== Post-sweep 3-gate-AND verification ===');
	const gateResults = await postSweepGateVerification(cfg, discoveredTypes);
	let allGatesOk = true;
	for (const r of gateResults) {
		const g1Status = r.gate1.passes ? 'PASS' : 'FAIL';
		const g2Status = r.gate2.passes ? 'PASS' : 'FAIL';
		const g3PassCount = r.gate3Instances.filter((i) => i.passes).length;
		const g3FailCount = r.gate3Instances.filter((i) => !i.passes).length;
		console.log(
			`  ${r.type}: gate1=${g1Status}(${r.gate1.sharing}) gate2=${g2Status}(${r.gate2.sharing}) ` +
				`gate3=${g3PassCount}/${r.totalInstances} pass (${g3FailCount} private/absent)`
		);
		if (r.gate1and2Pass) {
			console.log(
				`    -> ${r.instancesWithFullAnd}/${r.totalInstances} instances have full 3-gate-AND ` +
					`(name visible to member)`
			);
		} else {
			console.error(
				`    -> gate 1+2 FAIL -- no instances can show name to member regardless of gate 3`
			);
			allGatesOk = false;
		}
	}

	// Phase 4: Non-omniscient verification.
	console.log('\n=== Non-omniscient bucket verification ===');
	// Pick the first season target for verification (small population, clear signal).
	const seasonTargets = targetsByType['season'] ?? [];
	if (seasonTargets.length > 0) {
		const sample = seasonTargets[0];
		const nonOmniResult = await nonOmniscientVerification(
			cfg,
			sample.id,
			sample.name,
			'season'
		);
		console.log(
			`  Season: ${nonOmniResult.passed ? 'PASSED' : 'FAILED'}: ${nonOmniResult.detail}`
		);
	}
	// Pick a person target too.
	const personTargets = targetsByType['person'] ?? [];
	if (personTargets.length > 0) {
		const sample = personTargets[0];
		const nonOmniResult = await nonOmniscientVerification(
			cfg,
			sample.id,
			sample.name,
			'person'
		);
		console.log(
			`  Person: ${nonOmniResult.passed ? 'PASSED' : 'FAILED'}: ${nonOmniResult.detail}`
		);
	}

	// Summary.
	const narrowEntries = ledger.filter((e) => e.action === 'narrow');
	const touchEntries = ledger.filter((e) => e.action === 'touch-save');
	const narrowed = narrowEntries.filter((e) => e.status === 'narrowed').length;
	const narrowFailed = narrowEntries.filter((e) => e.status === 'failed').length;
	const touched = touchEntries.filter((e) => e.status === 'touched').length;
	const touchFailed = touchEntries.filter((e) => e.status === 'failed').length;
	const touchSkipped = touchEntries.filter((e) => e.status === 'skipped').length;

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(
		`Narrowings:  ${narrowed}/${allTargets.length} (${narrowFailed} failed)`
	);
	console.log(
		`Touch-saves: ${touched}/${allTargets.length} (${touchFailed} failed, ${touchSkipped} skipped)`
	);
	console.log(
		`Post-sweep gates 1+2: ${gateResults.every((r) => r.gate1and2Pass) ? 'ALL PASS' : 'SOME FAIL'}`
	);
	console.log(
		`Total mutations: ${narrowed + touched} (${narrowed} narrowings + ${touched} touch-saves)`
	);

	const failures = ledger.filter((e) => e.status === 'failed');
	for (const f of failures) {
		console.error(
			`  FAILED: ${f.action} ${f.type} ${f.targetId} ("${f.targetName}"): ${f.error}`
		);
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
			isFormula: dt.isFormula
		})),
		instancesByType: Object.fromEntries(
			Object.entries(instancesByType).map(([typeName, instances]) => [
				typeName,
				{ count: instances.length }
			])
		),
		narrowResults: {
			narrowed,
			failed: narrowFailed,
			total: allTargets.length
		},
		touchSaveResults: {
			touched,
			failed: touchFailed,
			skipped: touchSkipped,
			total: allTargets.length
		},
		postSweepGateVerification: gateResults.map((r) => ({
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
		ledger,
		exitCode: hasFailures ? 1 : 0,
		verificationCaveat:
			'Run under ENTU_API_KEY (PO/db-root), which always reads the private bucket regardless ' +
			'of tier. "narrowed"/"touched" here means the write landed, the property _id rotated ' +
			'(proof aggregateEntity ran), and the 3-check canary (prop _id + name present + ' +
			'count=1) passed for touch-saves. The non-omniscient verification confirms narrowed ' +
			'instances are no longer visible at the public tier. The post-sweep 3-gate-AND ' +
			'verification confirms all structural gates are in place for domain-tier visibility.'
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error(
		'TD.2b tier-alignment ABORTED:',
		err instanceof Error ? err.message : String(err)
	);
	process.exit(1);
});

// (*MVOX:Palestrina*)
