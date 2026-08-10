// Edition file/external_link prop-def widen + junction type verification/seeding.
// Authorization: Schema freedom (standing ruling). Edition file widen is Mihkel's
// explicit ruling 2026-08-10. Polyphony db is dev/test with synthetic data —
// routine mutations pre-authorized.
//
// Work items:
//   1. Edition prop-def widen: edition.file + edition.external_link _sharing
//      from absent/private to domain — members can see/download PDFs and links.
//   2. Re-aggregate edition entities: touch-save all editions so the new
//      prop-def sharing takes effect (same pattern as library-visibility T6.2).
//   3. Verify junction types: check if repertoire_item and program_item type
//      entities exist in polyphony. If missing, seed them with prop-defs per
//      v4E schema.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/edition-widen-junction-types-2026-08-10.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/edition-widen-junction-types-2026-08-10.ts       # ONLY after dry-run verified

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// Known IDs from prior migrations.
const EDITION_TYPE_ID = '69c7ea4e8489bfcb0e819f9c';
const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';
const DB_ROOT_PERSON_ID = '69bcfd8e9c031ab8e6ce8079';

// Edition prop-defs to widen.
const EDITION_PROPDEF_NAMES_TO_WIDEN = ['file', 'external_link'];

interface LedgerEntry {
	action: string;
	target: string;
	targetId: string;
	status: 'widened' | 'set' | 'created' | 'verified' | 'already-correct' | 'already-exists' | 'touched' | 'failed' | 'dry-run';
	before?: string | null;
	after?: string;
	error?: string;
	newPropId?: string;
}

const ledger: LedgerEntry[] = [];

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `edition-widen-junction-types-2026-08-10-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

/** List prop-defs under a type, returning a map of name -> { id, sharing, sharingPropId, list }. */
async function listPropDefs(cfg: EntuCfg, typeEntityId: string): Promise<Map<string, { id: string; sharing: string | null; sharingPropId: string | null; list: boolean }>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${typeEntityId}&props=name,_sharing,list&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`listPropDefs(${typeEntityId}) failed: ${res.status}`);
	const body = (await res.json()) as {
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ _id: string; string: string }>;
			list?: Array<{ boolean: boolean }>;
		}>;
	};
	const map = new Map<string, { id: string; sharing: string | null; sharingPropId: string | null; list: boolean }>();
	for (const e of body.entities) {
		const name = e.name?.[0]?.string;
		if (name) {
			map.set(name, {
				id: e._id,
				sharing: e._sharing?.[0]?.string ?? null,
				sharingPropId: e._sharing?.[0]?._id ?? null,
				list: e.list?.[0]?.boolean ?? false
			});
		}
	}
	return map;
}

/** Read an entity to get specific properties. */
async function readEntity(
	cfg: EntuCfg,
	id: string,
	props: string
): Promise<Record<string, unknown>> {
	const res = await entuFetch(cfg.db, `entity/${id}?props=${props}`, cfg.token);
	if (!res.ok) throw new Error(`readEntity GET ${id} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: Record<string, unknown> };
	return body.entity ?? {};
}

/** Resolve a type name to its type-definition entity ID. Returns null if not found. */
async function resolveTypeId(cfg: EntuCfg, typeName: string): Promise<string | null> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=entity&name.string=${encodeURIComponent(typeName)}&props=_id&limit=1`,
		cfg.token
	);
	if (!res.ok) throw new Error(`resolveTypeId(${typeName}) failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	return body.entities?.[0]?._id ?? null;
}

/** Resolve a type name to its type-definition entity ID. Throws if not found. */
async function resolveTypeIdStrict(cfg: EntuCfg, typeName: string): Promise<string> {
	const id = await resolveTypeId(cfg, typeName);
	if (!id) throw new Error(`resolveTypeIdStrict: type '${typeName}' not found in db '${cfg.db}'`);
	return id;
}

/** Create a prop-def entity as a child of a type entity. */
async function createPropDef(
	cfg: EntuCfg,
	parentTypeId: string,
	spec: { name: string; type: string; sharing: string; formula?: string; list?: boolean }
): Promise<string> {
	const body: Array<Record<string, unknown>> = [
		{ type: '_parent', reference: parentTypeId },
		{ type: '_type', reference: PROPERTY_META_ID },
		{ type: 'name', string: spec.name },
		{ type: 'type', string: spec.type },
		{ type: '_sharing', string: spec.sharing }
	];
	if (spec.list) {
		body.push({ type: 'list', boolean: true });
	}
	if (spec.formula) {
		body.push({ type: 'formula', string: spec.formula });
	}

	const res = await entuFetch(cfg.db, 'entity', cfg.token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`CREATE prop-def ${spec.name} failed: ${res.status} -- ${text}`);
	}
	const resBody = (await res.json()) as { _id?: string };
	if (!resBody._id) throw new Error(`CREATE prop-def ${spec.name} returned 2xx but no _id (apparent-success trap)`);
	return resBody._id;
}

/** Read-back verify a created prop-def. */
async function verifyPropDef(
	cfg: EntuCfg,
	id: string,
	expected: { name: string; type: string; sharing: string; formula?: string; list?: boolean }
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${id}?props=name,type,_sharing,formula,list`, cfg.token);
	if (!res.ok) throw new Error(`verify GET ${id} failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: {
			name?: Array<{ string: string }>;
			type?: Array<{ string: string }>;
			_sharing?: Array<{ string: string }>;
			formula?: Array<{ string: string }>;
			list?: Array<{ boolean: boolean }>;
		};
	};
	const liveName = body.entity?.name?.[0]?.string;
	const liveType = body.entity?.type?.[0]?.string;
	const liveSharing = body.entity?._sharing?.[0]?.string;
	const liveFormula = body.entity?.formula?.[0]?.string;
	const liveList = body.entity?.list?.[0]?.boolean;

	if (liveName !== expected.name) throw new Error(`verify FAILED for ${id}: name=${liveName}, expected ${expected.name}`);
	if (liveType !== expected.type) throw new Error(`verify FAILED for ${id}: type=${liveType}, expected ${expected.type}`);
	if (liveSharing !== expected.sharing) throw new Error(`verify FAILED for ${id}: _sharing=${liveSharing}, expected ${expected.sharing}`);
	if (expected.formula && liveFormula !== expected.formula) throw new Error(`verify FAILED for ${id}: formula=${liveFormula}, expected ${expected.formula}`);
	if (expected.list && liveList !== true) throw new Error(`verify FAILED for ${id}: list=${liveList}, expected true`);
}

// ==================== Work Item 1: Edition prop-def widen ====================

async function widenEditionPropDefs(cfg: EntuCfg): Promise<boolean> {
	console.log('=== Work Item 1: Edition prop-def _sharing widen (file, external_link) ===');
	console.log('Querying edition type prop-defs...');

	const propDefs = await listPropDefs(cfg, EDITION_TYPE_ID);
	console.log(`  Found ${propDefs.size} prop-defs on edition type:`);
	for (const [name, info] of propDefs) {
		console.log(`    ${name} (${info.id}): _sharing=${info.sharing ?? '(absent/private)'}`);
	}

	// Validate: both target prop-defs must exist.
	const targets: Array<{ name: string; id: string; currentSharing: string | null; sharingPropId: string | null }> = [];
	for (const name of EDITION_PROPDEF_NAMES_TO_WIDEN) {
		const info = propDefs.get(name);
		if (!info) {
			throw new Error(`HALT: edition prop-def '${name}' not found on type ${EDITION_TYPE_ID}`);
		}
		targets.push({ name, id: info.id, currentSharing: info.sharing, sharingPropId: info.sharingPropId });
	}

	console.log(`\n  Targets for _sharing widen to domain:`);
	for (const t of targets) {
		console.log(`    edition.${t.name} (${t.id}): current _sharing=${t.currentSharing ?? '(absent/private)'}`);
	}

	if (DRY_RUN) {
		for (const t of targets) {
			if (t.currentSharing === 'domain') {
				ledger.push({ action: 'edition-propdef-widen', target: `edition.${t.name}`, targetId: t.id, status: 'already-correct', before: t.currentSharing });
			} else {
				ledger.push({ action: 'edition-propdef-widen', target: `edition.${t.name}`, targetId: t.id, status: 'dry-run', before: t.currentSharing ?? '(absent/private)' });
			}
		}
		console.log(`  DRY_RUN: would widen ${targets.filter((t) => t.currentSharing !== 'domain').length} prop-defs`);
		return true;
	}

	// Live execution.
	let allOk = true;
	for (const t of targets) {
		if (t.currentSharing === 'domain') {
			console.log(`  SKIP: edition.${t.name} already domain`);
			ledger.push({ action: 'edition-propdef-widen', target: `edition.${t.name}`, targetId: t.id, status: 'already-correct', before: 'domain' });
			continue;
		}

		try {
			const writeBody: Array<Record<string, unknown>> = [];
			if (t.sharingPropId) {
				writeBody.push({ _id: t.sharingPropId, type: '_sharing', string: 'domain' });
			} else {
				writeBody.push({ type: '_sharing', string: 'domain' });
			}

			const writeRes = await entuFetch(cfg.db, `entity/${t.id}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(writeBody)
			});
			if (!writeRes.ok) {
				const text = await writeRes.text();
				throw new Error(`POST failed: ${writeRes.status} -- ${text}`);
			}

			// Read-back verify.
			const verifyEntity = (await readEntity(cfg, t.id, '_sharing')) as {
				_sharing?: Array<{ string: string }>;
			};
			const newSharing = verifyEntity._sharing?.[0]?.string;
			if (newSharing !== 'domain') {
				throw new Error(`verify FAILED: _sharing=${newSharing}, expected domain`);
			}

			console.log(`  WIDENED: edition.${t.name} (${t.id}): ${t.currentSharing ?? '(absent/private)'} -> domain`);
			ledger.push({
				action: 'edition-propdef-widen',
				target: `edition.${t.name}`,
				targetId: t.id,
				status: 'widened',
				before: t.currentSharing ?? '(absent/private)',
				after: 'domain'
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  FAILED: edition.${t.name} (${t.id}): ${msg}`);
			ledger.push({
				action: 'edition-propdef-widen',
				target: `edition.${t.name}`,
				targetId: t.id,
				status: 'failed',
				before: t.currentSharing ?? '(absent/private)',
				error: msg
			});
			allOk = false;
		}
	}
	return allOk;
}

// ==================== Work Item 2: Re-aggregate edition entities ====================

async function reaggregateEditions(cfg: EntuCfg): Promise<boolean> {
	console.log('\n=== Work Item 2: Re-aggregate edition entities ===');
	console.log('Querying all edition entities...');

	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${EDITION_TYPE_ID}&props=_sharing,_owner&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`listEditions failed: ${res.status}`);
	const body = (await res.json()) as {
		count: number;
		entities: Array<{
			_id: string;
			_sharing?: Array<{ _id: string; string: string }>;
			_owner?: Array<{ reference: string }>;
		}>;
	};

	if (body.count !== body.entities.length) {
		throw new Error(`edition census truncated — count=${body.count} entities=${body.entities.length}`);
	}

	console.log(`  Found ${body.count} edition entities.`);

	// Pre-check: all must have an explicit _sharing value (needed for atomic replace touch-save).
	const editionTargets: Array<{ id: string; sharingValueId: string; currentSharing: string }> = [];
	const missingSharingIds: string[] = [];
	const nonDbRootOwned: Array<{ id: string; owners: string[] }> = [];

	for (const e of body.entities) {
		const sharing = e._sharing?.[0];
		if (!sharing?._id) {
			missingSharingIds.push(e._id);
			continue;
		}
		editionTargets.push({
			id: e._id,
			sharingValueId: sharing._id,
			currentSharing: sharing.string
		});

		const owners = (e._owner ?? []).map((o) => o.reference);
		if (!owners.includes(DB_ROOT_PERSON_ID)) {
			nonDbRootOwned.push({ id: e._id, owners });
		}
	}

	// Show tier distribution.
	const tierHistogram: Record<string, number> = {};
	for (const t of editionTargets) {
		tierHistogram[t.currentSharing] = (tierHistogram[t.currentSharing] ?? 0) + 1;
	}
	console.log(`  Tier histogram: ${JSON.stringify(tierHistogram)}`);

	if (missingSharingIds.length > 0) {
		console.log(`  WARNING: ${missingSharingIds.length} edition(s) have NO explicit _sharing value — cannot atomic-replace: ${JSON.stringify(missingSharingIds)}`);
	} else {
		console.log(`  All ${editionTargets.length} editions carry an explicit _sharing value — atomic-replace applies.`);
	}

	if (nonDbRootOwned.length > 0) {
		console.log(`  WARNING: ${nonDbRootOwned.length} edition(s) are NOT db-root-owned: ${JSON.stringify(nonDbRootOwned)}`);
	} else {
		console.log(`  All editions are db-root-owned.`);
	}

	if (DRY_RUN) {
		for (const t of editionTargets) {
			ledger.push({ action: 'edition-reaggregate', target: 'edition', targetId: t.id, status: 'dry-run', before: t.currentSharing });
		}
		console.log(`  DRY_RUN: would touch-save ${editionTargets.length} edition entities.`);
		return true;
	}

	if (nonDbRootOwned.length > 0) {
		console.error(`ABORT re-aggregation: ${nonDbRootOwned.length} edition(s) are not db-root-owned — refuse to proceed (same lesson as #44/#45).`);
		for (const e of nonDbRootOwned) {
			ledger.push({ action: 'edition-reaggregate', target: 'edition', targetId: e.id, status: 'failed', error: 'non-db-root-owned' });
		}
		return false;
	}

	// Canary: touch-save one edition first.
	if (editionTargets.length === 0) {
		console.log('  No editions to touch-save.');
		return true;
	}

	const [canary, ...rest] = editionTargets;
	console.log(`  Canary: touch-save edition ${canary.id}...`);

	try {
		const canaryRes = await entuFetch(cfg.db, `entity/${canary.id}`, cfg.token, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ _id: canary.sharingValueId, type: '_sharing', string: canary.currentSharing }])
		});
		if (!canaryRes.ok) throw new Error(`canary touch-save POST failed: ${canaryRes.status}`);
		const canaryBody = (await canaryRes.json()) as { properties?: Array<{ _id: string; type: string }> };
		const newSharingProp = (canaryBody.properties ?? []).find((p) => p.type === '_sharing');
		if (!newSharingProp?._id) throw new Error('canary touch-save POST returned 2xx but no _sharing property in response');
		if (newSharingProp._id === canary.sharingValueId) throw new Error(`canary touch-save POST returned the SAME property _id (${canary.sharingValueId}) — replace did not rotate`);

		// Read-back verify single _sharing value.
		const canaryVerify = await entuFetch(cfg.db, `entity/${canary.id}?props=_sharing`, cfg.token);
		if (!canaryVerify.ok) throw new Error(`canary read-back failed: ${canaryVerify.status}`);
		const canaryVerifyBody = (await canaryVerify.json()) as { entity?: { _sharing?: Array<{ string: string }> } };
		const sharingValues = canaryVerifyBody.entity?._sharing ?? [];
		if (sharingValues.length !== 1) {
			throw new Error(`canary ${canary.id} now carries ${sharingValues.length} _sharing values (expected exactly 1)`);
		}

		console.log(`  Canary PASSED: edition ${canary.id} — touch-save rotated _id and single _sharing value confirmed.`);
		ledger.push({ action: 'edition-reaggregate', target: 'edition', targetId: canary.id, status: 'touched', newPropId: newSharingProp._id });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`  Canary FAILED: edition ${canary.id}: ${msg}`);
		console.error('  Refusing to run the full sweep on an unproven mechanic.');
		ledger.push({ action: 'edition-reaggregate', target: 'edition', targetId: canary.id, status: 'failed', error: msg });
		return false;
	}

	// Touch-save the rest.
	console.log(`  Touch-saving remaining ${rest.length} editions...`);
	let allOk = true;
	for (const t of rest) {
		try {
			const touchRes = await entuFetch(cfg.db, `entity/${t.id}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ _id: t.sharingValueId, type: '_sharing', string: t.currentSharing }])
			});
			if (!touchRes.ok) throw new Error(`touch-save POST failed: ${touchRes.status}`);
			const touchBody = (await touchRes.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newProp = (touchBody.properties ?? []).find((p) => p.type === '_sharing');
			if (!newProp?._id) throw new Error('touch-save POST returned 2xx but no _sharing property (apparent-success trap)');
			if (newProp._id === t.sharingValueId) throw new Error(`touch-save POST returned the SAME property _id (${t.sharingValueId}) — replace did not rotate`);
			ledger.push({ action: 'edition-reaggregate', target: 'edition', targetId: t.id, status: 'touched', newPropId: newProp._id });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  FAILED: edition ${t.id}: ${msg}`);
			ledger.push({ action: 'edition-reaggregate', target: 'edition', targetId: t.id, status: 'failed', error: msg });
			allOk = false;
		}
	}

	const touched = ledger.filter((e) => e.action === 'edition-reaggregate' && e.status === 'touched').length;
	const failed = ledger.filter((e) => e.action === 'edition-reaggregate' && e.status === 'failed').length;
	console.log(`  Touch-save complete: ${touched} touched, ${failed} failed.`);
	return allOk;
}

// ==================== Work Item 3: Verify/seed junction types ====================

interface JunctionTypeSpec {
	name: string;
	sharing: string;
	parentTypeName: string;
	propDefs: Array<{
		name: string;
		type: string;
		sharing: string;
		formula?: string;
		list?: boolean;
	}>;
}

const JUNCTION_TYPES: JunctionTypeSpec[] = [
	{
		name: 'repertoire_item',
		sharing: 'domain',
		parentTypeName: 'season',
		propDefs: [
			{ name: 'name', type: 'string', sharing: 'domain', formula: 'work.*.name CONCAT' },
			{ name: 'work', type: 'reference', sharing: 'domain' },
			{ name: 'edition', type: 'reference', sharing: 'domain' },
			{ name: 'ordinal', type: 'number', sharing: 'domain' },
			{ name: 'status', type: 'string', sharing: 'domain' }
		]
	},
	{
		name: 'program_item',
		sharing: 'domain',
		parentTypeName: 'event',
		propDefs: [
			{ name: 'name', type: 'string', sharing: 'domain', formula: 'edition.*.work CONCAT' },
			{ name: 'work', type: 'reference', sharing: 'domain' },
			{ name: 'edition', type: 'reference', sharing: 'domain' },
			{ name: 'ordinal', type: 'number', sharing: 'domain' },
			{ name: 'notes', type: 'text', sharing: 'domain' }
		]
	}
];

async function verifyAndSeedJunctionTypes(cfg: EntuCfg): Promise<boolean> {
	console.log('\n=== Work Item 3: Verify/seed junction types (repertoire_item, program_item) ===');

	// Resolve the "entity" meta-type ID (types are entities whose _type points to this).
	const entityMetaTypeId = await resolveTypeIdStrict(cfg, 'entity');
	console.log(`  entity meta-type ID: ${entityMetaTypeId}`);

	let allOk = true;

	for (const spec of JUNCTION_TYPES) {
		console.log(`\n  --- ${spec.name} ---`);
		const existingTypeId = await resolveTypeId(cfg, spec.name);

		if (existingTypeId) {
			console.log(`  TYPE EXISTS: ${spec.name} (${existingTypeId})`);

			// Verify prop-defs.
			const existingPropDefs = await listPropDefs(cfg, existingTypeId);
			console.log(`  Existing prop-defs on ${spec.name}:`);
			for (const [name, info] of existingPropDefs) {
				console.log(`    ${name} (${info.id}): _sharing=${info.sharing ?? '(absent/private)'}${info.list ? ', list=true' : ''}`);
			}

			// Check for missing prop-defs.
			const missingPropDefs = spec.propDefs.filter((pd) => !existingPropDefs.has(pd.name));
			if (missingPropDefs.length > 0) {
				console.log(`  Missing prop-defs: ${missingPropDefs.map((pd) => pd.name).join(', ')}`);
				if (DRY_RUN) {
					for (const pd of missingPropDefs) {
						ledger.push({ action: 'junction-propdef-create', target: `${spec.name}.${pd.name}`, targetId: existingTypeId, status: 'dry-run' });
					}
				} else {
					for (const pd of missingPropDefs) {
						try {
							const newId = await createPropDef(cfg, existingTypeId, pd);
							await verifyPropDef(cfg, newId, pd);
							console.log(`    CREATED + VERIFIED: ${spec.name}.${pd.name} -> ${newId}`);
							ledger.push({ action: 'junction-propdef-create', target: `${spec.name}.${pd.name}`, targetId: newId, status: 'verified' });
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.error(`    FAILED: ${spec.name}.${pd.name}: ${msg}`);
							ledger.push({ action: 'junction-propdef-create', target: `${spec.name}.${pd.name}`, targetId: existingTypeId, status: 'failed', error: msg });
							allOk = false;
						}
					}
				}
			} else {
				console.log(`  All expected prop-defs present.`);
			}

			// _sharing mismatch pass: for each spec prop-def that exists, compare
			// live _sharing to spec sharing. On mismatch, widen (POST new _sharing).
			const sharingMismatches = spec.propDefs.filter((pd) => {
				const live = existingPropDefs.get(pd.name);
				return live && live.sharing !== pd.sharing;
			});
			if (sharingMismatches.length > 0) {
				console.log(`  _sharing mismatches: ${sharingMismatches.map((pd) => `${pd.name} (live=${existingPropDefs.get(pd.name)!.sharing ?? '(absent/private)'}, spec=${pd.sharing})`).join(', ')}`);
				if (DRY_RUN) {
					for (const pd of sharingMismatches) {
						const live = existingPropDefs.get(pd.name)!;
						ledger.push({
							action: 'junction-propdef-widen',
							target: `${spec.name}.${pd.name}`,
							targetId: live.id,
							status: 'dry-run',
							before: live.sharing ?? '(absent/private)',
							after: pd.sharing
						});
					}
				} else {
					for (const pd of sharingMismatches) {
						const live = existingPropDefs.get(pd.name)!;
						try {
							const writeBody: Array<Record<string, unknown>> = [];
							if (live.sharingPropId) {
								writeBody.push({ _id: live.sharingPropId, type: '_sharing', string: pd.sharing });
							} else {
								writeBody.push({ type: '_sharing', string: pd.sharing });
							}
							const writeRes = await entuFetch(cfg.db, `entity/${live.id}`, cfg.token, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify(writeBody)
							});
							if (!writeRes.ok) {
								const text = await writeRes.text();
								throw new Error(`POST failed: ${writeRes.status} -- ${text}`);
							}

							// Read-back verify.
							const verifyEntity = (await readEntity(cfg, live.id, '_sharing')) as {
								_sharing?: Array<{ string: string }>;
							};
							const newSharing = verifyEntity._sharing?.[0]?.string;
							if (newSharing !== pd.sharing) {
								throw new Error(`verify FAILED: _sharing=${newSharing}, expected ${pd.sharing}`);
							}

							console.log(`    WIDENED: ${spec.name}.${pd.name} (${live.id}): ${live.sharing ?? '(absent/private)'} -> ${pd.sharing}`);
							ledger.push({
								action: 'junction-propdef-widen',
								target: `${spec.name}.${pd.name}`,
								targetId: live.id,
								status: 'widened',
								before: live.sharing ?? '(absent/private)',
								after: pd.sharing
							});
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.error(`    FAILED: ${spec.name}.${pd.name} (${live.id}): ${msg}`);
							ledger.push({
								action: 'junction-propdef-widen',
								target: `${spec.name}.${pd.name}`,
								targetId: live.id,
								status: 'failed',
								before: live.sharing ?? '(absent/private)',
								error: msg
							});
							allOk = false;
						}
					}
				}
			} else {
				console.log(`  All prop-def _sharing values match spec.`);
			}

			ledger.push({ action: 'junction-type-check', target: spec.name, targetId: existingTypeId, status: 'already-exists' });
			continue;
		}

		// Type does not exist — seed it.
		console.log(`  TYPE MISSING: ${spec.name} — will seed.`);

		if (DRY_RUN) {
			ledger.push({ action: 'junction-type-create', target: spec.name, targetId: '(would-create)', status: 'dry-run' });
			for (const pd of spec.propDefs) {
				ledger.push({ action: 'junction-propdef-create', target: `${spec.name}.${pd.name}`, targetId: '(would-create)', status: 'dry-run' });
			}
			continue;
		}

		// Create the type entity.
		try {
			// Type entities are children of the entity meta-type. In Entu, a type
			// definition entity has _type pointing to the "entity" meta-entity.
			// The type entity's name becomes the type name for instances.
			const typeBody: Array<Record<string, unknown>> = [
				{ type: '_type', reference: entityMetaTypeId },
				{ type: 'name', string: spec.name },
				{ type: '_sharing', string: spec.sharing }
			];

			const typeRes = await entuFetch(cfg.db, 'entity', cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(typeBody)
			});
			if (!typeRes.ok) {
				const text = await typeRes.text();
				throw new Error(`CREATE type ${spec.name} failed: ${typeRes.status} -- ${text}`);
			}
			const typeResBody = (await typeRes.json()) as { _id?: string };
			if (!typeResBody._id) throw new Error(`CREATE type ${spec.name} returned 2xx but no _id`);
			const newTypeId = typeResBody._id;

			// Read-back verify the type.
			const typeVerify = (await readEntity(cfg, newTypeId, 'name,_sharing')) as {
				name?: Array<{ string: string }>;
				_sharing?: Array<{ string: string }>;
			};
			if (typeVerify.name?.[0]?.string !== spec.name) throw new Error(`type verify FAILED: name=${typeVerify.name?.[0]?.string}`);
			if (typeVerify._sharing?.[0]?.string !== spec.sharing) throw new Error(`type verify FAILED: _sharing=${typeVerify._sharing?.[0]?.string}`);

			console.log(`  CREATED TYPE: ${spec.name} -> ${newTypeId}`);
			ledger.push({ action: 'junction-type-create', target: spec.name, targetId: newTypeId, status: 'created' });

			// Create prop-defs under the new type.
			for (const pd of spec.propDefs) {
				try {
					const pdId = await createPropDef(cfg, newTypeId, pd);
					await verifyPropDef(cfg, pdId, pd);
					console.log(`    CREATED + VERIFIED: ${spec.name}.${pd.name} -> ${pdId}`);
					ledger.push({ action: 'junction-propdef-create', target: `${spec.name}.${pd.name}`, targetId: pdId, status: 'verified' });
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`    FAILED: ${spec.name}.${pd.name}: ${msg}`);
					ledger.push({ action: 'junction-propdef-create', target: `${spec.name}.${pd.name}`, targetId: newTypeId, status: 'failed', error: msg });
					allOk = false;
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  FAILED to create type ${spec.name}: ${msg}`);
			ledger.push({ action: 'junction-type-create', target: spec.name, targetId: '(failed)', status: 'failed', error: msg });
			allOk = false;
		}
	}

	return allOk;
}

// ==================== Main ====================

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);

	// Work item 1: Edition prop-def widen.
	const widen1Ok = await widenEditionPropDefs(cfg);

	if (!widen1Ok && !DRY_RUN) {
		console.error('\nWork item 1 had failures — work item 2 (re-aggregation) will NOT run.');
		// Skip re-aggregation but continue to junction types.
	}

	// Work item 2: Re-aggregate editions (gated on work item 1 success).
	let reaggOk = true;
	if (widen1Ok || DRY_RUN) {
		reaggOk = await reaggregateEditions(cfg);
	}

	// Work item 3: Junction types (independent of work items 1+2).
	const junctionOk = await verifyAndSeedJunctionTypes(cfg);

	// Summary.
	const widenEntries = ledger.filter((e) => e.action === 'edition-propdef-widen');
	const reaggEntries = ledger.filter((e) => e.action === 'edition-reaggregate');
	const typeEntries = ledger.filter((e) => e.action.startsWith('junction-'));
	const widenFailures = widenEntries.filter((e) => e.status === 'failed');
	const reaggFailures = reaggEntries.filter((e) => e.status === 'failed');
	const typeFailures = typeEntries.filter((e) => e.status === 'failed');

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Work item 1 (edition prop-def widen):  ${widenEntries.length} targets, ${widenFailures.length} failures`);
	console.log(`Work item 2 (edition re-aggregation):  ${reaggEntries.length} targets, ${reaggFailures.length} failures`);
	console.log(`Work item 3 (junction types):          ${typeEntries.length} entries, ${typeFailures.length} failures`);

	const hasFailures = widenFailures.length > 0 || reaggFailures.length > 0 || typeFailures.length > 0;
	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		authorization: 'Schema freedom (standing ruling). Edition file widen: Mihkel ruling 2026-08-10. Polyphony db: dev/test, synthetic data, routine mutations pre-authorized.',
		workItem1: {
			description: 'Edition prop-def _sharing widen to domain (file, external_link)',
			editionTypeId: EDITION_TYPE_ID,
			targets: widenEntries.map((e) => ({ name: e.target, id: e.targetId, status: e.status, before: e.before, after: e.after, error: e.error }))
		},
		workItem2: {
			description: 'Edition entity re-aggregation (touch-save to pick up new prop-def sharing)',
			editionCount: reaggEntries.length,
			touched: reaggEntries.filter((e) => e.status === 'touched').length,
			failed: reaggFailures.length,
			entries: reaggEntries.map((e) => ({ id: e.targetId, status: e.status, error: e.error }))
		},
		workItem3: {
			description: 'Junction types (repertoire_item, program_item) — verify + seed if missing',
			entries: typeEntries.map((e) => ({ name: e.target, id: e.targetId, status: e.status, error: e.error }))
		},
		ledger,
		exitCode: hasFailures ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('edition-widen-junction-types ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
