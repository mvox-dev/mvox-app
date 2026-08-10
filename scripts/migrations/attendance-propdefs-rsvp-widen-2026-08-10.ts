// #77 Attendance 1.0 schema setup + RSVP sharing widen.
// Authorization: Schema freedom (standing ruling), RSVP widen authorized by
// PO (Mihkel's ruling 2026-08-10). Polyphony db is dev/test with synthetic
// data — routine mutations pre-authorized.
//
// Work items:
//   1. conductor prop-def on season + event (reference, _sharing:domain, list:true)
//   2. attendance sentinel prop-defs: present_ref, absent_ref, late_ref (reference, _sharing:public)
//   3. formula count prop-defs on event: attendance_present_count, attendance_absent_count, attendance_late_count
//   4. RSVP sharing widen: all rsvp entities _sharing private→domain
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/attendance-propdefs-rsvp-widen-2026-08-10.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/attendance-propdefs-rsvp-widen-2026-08-10.ts       # ONLY after dry-run verified

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// Type entity IDs — resolved dynamically below; these are asserted at startup.
const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';

interface PropDefSpec {
	parentTypeName: string;
	parentTypeId: string;
	name: string;
	type: string;
	sharing: string;
	formula?: string;
	list?: boolean;
}

interface LedgerEntry {
	action: string;
	spec: PropDefSpec | { entityId: string; type: string };
	createdId?: string;
	status: 'created' | 'verified' | 'skipped-exists' | 'failed' | 'widened' | 'already-domain' | 'dry-run';
	error?: string;
	before?: string;
	after?: string;
}

const ledger: LedgerEntry[] = [];

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `attendance-propdefs-rsvp-widen-2026-08-10-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

/** Resolve a type name to its type-definition entity ID. */
async function resolveTypeId(cfg: EntuCfg, typeName: string): Promise<string> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=entity&name.string=${encodeURIComponent(typeName)}&props=_id&limit=1`,
		cfg.token
	);
	if (!res.ok) throw new Error(`resolveTypeId(${typeName}) failed: ${res.status}`);
	const body = (await res.json()) as { entities?: Array<{ _id: string }> };
	const id = body.entities?.[0]?._id;
	if (!id) throw new Error(`resolveTypeId: type '${typeName}' not found in db '${cfg.db}'`);
	return id;
}

/** List existing prop-def names under a type entity. */
async function listPropDefNames(cfg: EntuCfg, typeEntityId: string): Promise<Map<string, string>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${typeEntityId}&props=name&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`listPropDefNames(${typeEntityId}) failed: ${res.status}`);
	const body = (await res.json()) as { entities: Array<{ _id: string; name?: Array<{ string: string }> }> };
	const map = new Map<string, string>();
	for (const e of body.entities) {
		const name = e.name?.[0]?.string;
		if (name) map.set(name, e._id);
	}
	return map;
}

/** Create a prop-def entity as a child of a type entity. */
async function createPropDef(cfg: EntuCfg, spec: PropDefSpec): Promise<string> {
	const body: Array<Record<string, unknown>> = [
		{ type: '_parent', reference: spec.parentTypeId },
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
		throw new Error(`CREATE ${spec.parentTypeName}.${spec.name} failed: ${res.status} — ${text}`);
	}
	const resBody = (await res.json()) as { _id?: string };
	if (!resBody._id) throw new Error(`CREATE ${spec.parentTypeName}.${spec.name} returned 2xx but no _id (apparent-success trap): ${JSON.stringify(resBody)}`);
	return resBody._id;
}

/** Read-back verify a created prop-def. */
async function verifyPropDef(cfg: EntuCfg, id: string, expected: { name: string; type: string; sharing: string; formula?: string; list?: boolean }): Promise<void> {
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

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step 0 — resolve all type IDs dynamically.
	console.log('Step 0: resolving type IDs...');
	const seasonTypeId = await resolveTypeId(cfg, 'season');
	const eventTypeId = await resolveTypeId(cfg, 'event');
	const attendanceTypeId = await resolveTypeId(cfg, 'attendance');
	const rsvpTypeId = await resolveTypeId(cfg, 'rsvp');
	console.log(`  season=${seasonTypeId}, event=${eventTypeId}, attendance=${attendanceTypeId}, rsvp=${rsvpTypeId}`);

	// Build the full spec list.
	const propDefSpecs: PropDefSpec[] = [
		// Work item 1: conductor on season + event (list: multi-value, per #82 acceptance criteria)
		{ parentTypeName: 'season', parentTypeId: seasonTypeId, name: 'conductor', type: 'reference', sharing: 'domain', list: true },
		{ parentTypeName: 'event', parentTypeId: eventTypeId, name: 'conductor', type: 'reference', sharing: 'domain', list: true },

		// Work item 2: attendance sentinel refs
		{ parentTypeName: 'attendance', parentTypeId: attendanceTypeId, name: 'present_ref', type: 'reference', sharing: 'public' },
		{ parentTypeName: 'attendance', parentTypeId: attendanceTypeId, name: 'absent_ref', type: 'reference', sharing: 'public' },
		{ parentTypeName: 'attendance', parentTypeId: attendanceTypeId, name: 'late_ref', type: 'reference', sharing: 'public' },

		// Work item 3: formula counts on event
		{ parentTypeName: 'event', parentTypeId: eventTypeId, name: 'attendance_present_count', type: 'number', sharing: 'public', formula: '_referrer.attendance.present_ref COUNT' },
		{ parentTypeName: 'event', parentTypeId: eventTypeId, name: 'attendance_absent_count', type: 'number', sharing: 'public', formula: '_referrer.attendance.absent_ref COUNT' },
		{ parentTypeName: 'event', parentTypeId: eventTypeId, name: 'attendance_late_count', type: 'number', sharing: 'public', formula: '_referrer.attendance.late_ref COUNT' }
	];

	// Step 1 — pre-check: enumerate existing prop-defs on each type; refuse if any target already exists.
	console.log('\nStep 1: pre-check for existing prop-defs...');
	const existingByType = new Map<string, Map<string, string>>();
	for (const typeId of [seasonTypeId, eventTypeId, attendanceTypeId]) {
		if (!existingByType.has(typeId)) {
			existingByType.set(typeId, await listPropDefNames(cfg, typeId));
		}
	}
	for (const spec of propDefSpecs) {
		const existing = existingByType.get(spec.parentTypeId)!;
		if (existing.has(spec.name)) {
			console.log(`  SKIP: ${spec.parentTypeName}.${spec.name} already exists (id=${existing.get(spec.name)})`);
			ledger.push({ action: 'create-propdef', spec, createdId: existing.get(spec.name), status: 'skipped-exists' });
		} else {
			console.log(`  OK: ${spec.parentTypeName}.${spec.name} does not exist yet`);
		}
	}
	const toCreate = propDefSpecs.filter((spec) => {
		const existing = existingByType.get(spec.parentTypeId)!;
		return !existing.has(spec.name);
	});

	if (toCreate.length === 0) {
		console.log('\nAll prop-defs already exist. Proceeding to RSVP widen only.');
	}

	// Step 2 — create prop-defs (if not DRY_RUN).
	if (toCreate.length > 0) {
		if (DRY_RUN) {
			console.log(`\nStep 2 DRY_RUN: would create ${toCreate.length} prop-def(s):`);
			for (const spec of toCreate) {
				console.log(`  ${spec.parentTypeName}.${spec.name} (type=${spec.type}, sharing=${spec.sharing}${spec.formula ? `, formula=${spec.formula}` : ''})`);
				ledger.push({ action: 'create-propdef', spec, status: 'dry-run' });
			}
		} else {
			console.log(`\nStep 2: creating ${toCreate.length} prop-def(s)...`);
			for (const spec of toCreate) {
				try {
					const newId = await createPropDef(cfg, spec);
					console.log(`  CREATED: ${spec.parentTypeName}.${spec.name} → ${newId}`);
					// Read-back verify
					await verifyPropDef(cfg, newId, { name: spec.name, type: spec.type, sharing: spec.sharing, formula: spec.formula, list: spec.list });
					console.log(`  VERIFIED: ${spec.parentTypeName}.${spec.name} (${newId})`);
					ledger.push({ action: 'create-propdef', spec, createdId: newId, status: 'verified' });
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`  FAILED: ${spec.parentTypeName}.${spec.name}: ${msg}`);
					ledger.push({ action: 'create-propdef', spec, status: 'failed', error: msg });
				}
			}
			const failures = ledger.filter((e) => e.action === 'create-propdef' && e.status === 'failed');
			if (failures.length > 0) {
				console.error(`\n${failures.length} prop-def creation(s) FAILED — RSVP widen will NOT proceed.`);
				const artifactPath = writeLedger({ dryRun: false, ledger, halted: 'propdef-creation-failed', exitCode: 1 });
				console.log(`Ledger: ${artifactPath}`);
				process.exit(1);
			}
		}
	}

	// Step 3 — RSVP sharing widen: query all rsvp entities, update _sharing from private to domain.
	console.log('\nStep 3: RSVP sharing widen...');
	console.log('  Querying all rsvp entities...');

	// Paginate through all rsvp entities.
	const allRsvps: Array<{ _id: string; _sharing?: string; _sharingPropId?: string }> = [];
	let skip = 0;
	const pageSize = 100;
	while (true) {
		const res = await entuFetch(
			cfg.db,
			`entity?_type.reference=${rsvpTypeId}&props=_sharing&limit=${pageSize}&skip=${skip}`,
			cfg.token
		);
		if (!res.ok) throw new Error(`RSVP query failed: ${res.status}`);
		const body = (await res.json()) as {
			entities: Array<{ _id: string; _sharing?: Array<{ _id: string; string: string }> }>;
			count: number;
		};
		for (const e of body.entities) {
			allRsvps.push({
				_id: e._id,
				_sharing: e._sharing?.[0]?.string,
				_sharingPropId: e._sharing?.[0]?._id
			});
		}
		if (body.entities.length < pageSize) break;
		skip += pageSize;
	}
	console.log(`  Found ${allRsvps.length} rsvp entities total.`);

	// Categorize
	const needsWiden = allRsvps.filter((r) => r._sharing !== 'domain');
	const alreadyDomain = allRsvps.filter((r) => r._sharing === 'domain');
	console.log(`  Already domain: ${alreadyDomain.length}`);
	console.log(`  Needs widen (non-domain): ${needsWiden.length}`);

	// Show sharing distribution
	const sharingDist = new Map<string, number>();
	for (const r of allRsvps) {
		const key = r._sharing ?? '(absent/private)';
		sharingDist.set(key, (sharingDist.get(key) ?? 0) + 1);
	}
	console.log(`  Sharing distribution: ${JSON.stringify(Object.fromEntries(sharingDist))}`);

	if (needsWiden.length === 0) {
		console.log('  All rsvp entities already at domain — nothing to widen.');
	} else if (DRY_RUN) {
		console.log(`\n  DRY_RUN: would widen ${needsWiden.length} rsvp entities to _sharing:domain`);
		for (const r of needsWiden) {
			console.log(`    ${r._id} (current: ${r._sharing ?? '(absent/private)'})`);
			ledger.push({
				action: 'rsvp-widen',
				spec: { entityId: r._id, type: 'rsvp' },
				status: 'dry-run',
				before: r._sharing ?? '(absent/private)'
			});
		}
	} else {
		console.log(`\n  LIVE: widening ${needsWiden.length} rsvp entities...`);
		let successCount = 0;
		let failCount = 0;
		for (const r of needsWiden) {
			try {
				// Build the write body. If _sharing prop already exists, we need to DELETE it first then POST.
				// If absent, just POST. But since Entu POST appends, and _sharing is special, we need to
				// handle the replace. For _sharing on entity level, we POST with the special property.
				const writeBody: Array<Record<string, unknown>> = [];
				if (r._sharingPropId) {
					// Replace: pass existing _id to update
					writeBody.push({ _id: r._sharingPropId, type: '_sharing', string: 'domain' });
				} else {
					// Create new
					writeBody.push({ type: '_sharing', string: 'domain' });
				}
				const writeRes = await entuFetch(cfg.db, `entity/${r._id}`, cfg.token, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(writeBody)
				});
				if (!writeRes.ok) {
					const text = await writeRes.text();
					throw new Error(`POST ${r._id} failed: ${writeRes.status} — ${text}`);
				}

				// Read-back verify
				const verifyRes = await entuFetch(cfg.db, `entity/${r._id}?props=_sharing`, cfg.token);
				if (!verifyRes.ok) throw new Error(`verify GET ${r._id} failed: ${verifyRes.status}`);
				const verifyBody = (await verifyRes.json()) as {
					entity?: { _sharing?: Array<{ string: string }> };
				};
				const newSharing = verifyBody.entity?._sharing?.[0]?.string;
				if (newSharing !== 'domain') {
					throw new Error(`verify FAILED: ${r._id} _sharing=${newSharing}, expected domain`);
				}

				ledger.push({
					action: 'rsvp-widen',
					spec: { entityId: r._id, type: 'rsvp' },
					status: 'widened',
					before: r._sharing ?? '(absent/private)',
					after: 'domain'
				});
				successCount++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`    FAILED: ${r._id}: ${msg}`);
				ledger.push({
					action: 'rsvp-widen',
					spec: { entityId: r._id, type: 'rsvp' },
					status: 'failed',
					error: msg,
					before: r._sharing ?? '(absent/private)'
				});
				failCount++;
			}
		}
		console.log(`  Widen complete: ${successCount} succeeded, ${failCount} failed`);
		for (const r of alreadyDomain) {
			ledger.push({
				action: 'rsvp-widen',
				spec: { entityId: r._id, type: 'rsvp' },
				status: 'already-domain'
			});
		}
	}

	// Summary
	const propDefCreated = ledger.filter((e) => e.action === 'create-propdef' && (e.status === 'verified' || e.status === 'skipped-exists'));
	const propDefFailed = ledger.filter((e) => e.action === 'create-propdef' && e.status === 'failed');
	const rsvpWidened = ledger.filter((e) => e.action === 'rsvp-widen' && e.status === 'widened');
	const rsvpFailed = ledger.filter((e) => e.action === 'rsvp-widen' && e.status === 'failed');

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Prop-defs created/existing: ${propDefCreated.length}/${propDefSpecs.length}`);
	console.log(`Prop-def failures: ${propDefFailed.length}`);
	console.log(`RSVP entities widened: ${rsvpWidened.length}`);
	console.log(`RSVP widen failures: ${rsvpFailed.length}`);
	console.log(`Total rsvp entities: ${allRsvps.length}`);

	const hasFailures = propDefFailed.length > 0 || rsvpFailed.length > 0;
	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		typeIds: { season: seasonTypeId, event: eventTypeId, attendance: attendanceTypeId, rsvp: rsvpTypeId },
		propDefSpecs,
		rsvpPopulation: { total: allRsvps.length, sharingDistribution: Object.fromEntries(sharingDist), needsWiden: needsWiden.length },
		ledger,
		exitCode: hasFailures ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('attendance-propdefs-rsvp-widen ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
