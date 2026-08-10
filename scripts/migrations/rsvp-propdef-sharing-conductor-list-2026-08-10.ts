// Fix-forward migration: two TA.1 remediation items.
// Authorization: PO-authorized fixes (Gama 2026-08-10 15:52).
// Polyphony db is dev/test with synthetic data -- routine mutations pre-authorized.
//
// Fix 1: RSVP prop-def _sharing widen
//   The TA.1 migration widened RSVP ENTITY-level _sharing from private to domain,
//   but the RSVP PROP-DEFS (event, member, status, notes) on the rsvp type still
//   carry absent/private _sharing. Property VALUES are not readable at domain level
//   unless their PROP-DEFs also allow it. Widen these 4 prop-defs to _sharing:domain.
//   Does NOT touch sentinel props (going_ref, not_going_ref, maybe_ref, late_ref)
//   which already have _sharing:public.
//
// Fix 2: Conductor prop-def list:true
//   The TA.1 migration created conductor prop-defs on season and event types but
//   omitted the list:true flag. Add it now so conductors are multi-value.
//   - season.conductor: 6a79a39f23dc1d97bb8f179d
//   - event.conductor:  6a79a39f23dc1d97bb8f17a6
//
// Run (standalone node, outside Vite -- needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/rsvp-propdef-sharing-conductor-list-2026-08-10.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/rsvp-propdef-sharing-conductor-list-2026-08-10.ts       # ONLY after dry-run verified

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// Known IDs from the TA.1 ledger (attendance-propdefs-rsvp-widen-2026-08-10-live).
const RSVP_TYPE_ID = '6a0d2e8590c8df7a1cc7df1b';
const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';

const SEASON_CONDUCTOR_PROPDEF_ID = '6a79a39f23dc1d97bb8f179d';
const EVENT_CONDUCTOR_PROPDEF_ID = '6a79a39f23dc1d97bb8f17a6';

// The 4 RSVP prop-defs whose _sharing needs widening.
// We resolve these dynamically by querying the rsvp type's prop-defs.
const RSVP_PROPDEF_NAMES_TO_WIDEN = ['event', 'member', 'status', 'notes'];

interface LedgerEntry {
	action: string;
	target: string;
	targetId: string;
	status: 'widened' | 'set' | 'already-correct' | 'failed' | 'dry-run';
	before?: string | boolean | null;
	after?: string | boolean;
	error?: string;
}

const ledger: LedgerEntry[] = [];

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `rsvp-propdef-sharing-conductor-list-2026-08-10-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

/** List prop-defs under the rsvp type, returning a map of name -> { id, sharing }. */
async function listRsvpPropDefs(cfg: EntuCfg): Promise<Map<string, { id: string; sharing: string | null; sharingPropId: string | null }>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${RSVP_TYPE_ID}&props=name,_sharing&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`listRsvpPropDefs failed: ${res.status}`);
	const body = (await res.json()) as {
		entities: Array<{
			_id: string;
			name?: Array<{ string: string }>;
			_sharing?: Array<{ _id: string; string: string }>;
		}>;
	};
	const map = new Map<string, { id: string; sharing: string | null; sharingPropId: string | null }>();
	for (const e of body.entities) {
		const name = e.name?.[0]?.string;
		if (name) {
			map.set(name, {
				id: e._id,
				sharing: e._sharing?.[0]?.string ?? null,
				sharingPropId: e._sharing?.[0]?._id ?? null
			});
		}
	}
	return map;
}

/** Read a prop-def entity to get specific properties. */
async function readPropDef(
	cfg: EntuCfg,
	id: string,
	props: string
): Promise<Record<string, unknown>> {
	const res = await entuFetch(cfg.db, `entity/${id}?props=${props}`, cfg.token);
	if (!res.ok) throw new Error(`readPropDef GET ${id} failed: ${res.status}`);
	const body = (await res.json()) as { entity?: Record<string, unknown> };
	return body.entity ?? {};
}

// ==================== Fix 1: RSVP prop-def _sharing widen ====================

async function fix1RsvpPropDefSharing(cfg: EntuCfg): Promise<boolean> {
	console.log('=== Fix 1: RSVP prop-def _sharing widen ===');
	console.log('Querying rsvp type prop-defs...');

	const propDefs = await listRsvpPropDefs(cfg);
	console.log(`  Found ${propDefs.size} prop-defs on rsvp type:`);
	for (const [name, info] of propDefs) {
		console.log(`    ${name} (${info.id}): _sharing=${info.sharing ?? '(absent/private)'}`);
	}

	// Validate: all 4 target prop-defs must exist.
	const targets: Array<{ name: string; id: string; currentSharing: string | null; sharingPropId: string | null }> = [];
	for (const name of RSVP_PROPDEF_NAMES_TO_WIDEN) {
		const info = propDefs.get(name);
		if (!info) {
			throw new Error(`HALT: rsvp prop-def '${name}' not found on type ${RSVP_TYPE_ID}`);
		}
		targets.push({ name, id: info.id, currentSharing: info.sharing, sharingPropId: info.sharingPropId });
	}

	// Dry-run report.
	console.log(`\n  Targets for _sharing widen to domain:`);
	for (const t of targets) {
		console.log(`    rsvp.${t.name} (${t.id}): current _sharing=${t.currentSharing ?? '(absent/private)'}`);
	}

	if (DRY_RUN) {
		for (const t of targets) {
			if (t.currentSharing === 'domain') {
				ledger.push({ action: 'rsvp-propdef-sharing-widen', target: `rsvp.${t.name}`, targetId: t.id, status: 'already-correct', before: t.currentSharing });
			} else {
				ledger.push({ action: 'rsvp-propdef-sharing-widen', target: `rsvp.${t.name}`, targetId: t.id, status: 'dry-run', before: t.currentSharing ?? '(absent/private)' });
			}
		}
		console.log(`  DRY_RUN: would widen ${targets.filter((t) => t.currentSharing !== 'domain').length} prop-defs`);
		return true;
	}

	// Live execution.
	let allOk = true;
	for (const t of targets) {
		if (t.currentSharing === 'domain') {
			console.log(`  SKIP: rsvp.${t.name} already domain`);
			ledger.push({ action: 'rsvp-propdef-sharing-widen', target: `rsvp.${t.name}`, targetId: t.id, status: 'already-correct', before: 'domain' });
			continue;
		}

		try {
			// POST _sharing:domain to the prop-def entity.
			// If _sharing prop exists, include _id for replace; otherwise create new.
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
			const verifyEntity = (await readPropDef(cfg, t.id, '_sharing')) as {
				_sharing?: Array<{ string: string }>;
			};
			const newSharing = verifyEntity._sharing?.[0]?.string;
			if (newSharing !== 'domain') {
				throw new Error(`verify FAILED: _sharing=${newSharing}, expected domain`);
			}

			console.log(`  WIDENED: rsvp.${t.name} (${t.id}): ${t.currentSharing ?? '(absent/private)'} -> domain`);
			ledger.push({
				action: 'rsvp-propdef-sharing-widen',
				target: `rsvp.${t.name}`,
				targetId: t.id,
				status: 'widened',
				before: t.currentSharing ?? '(absent/private)',
				after: 'domain'
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  FAILED: rsvp.${t.name} (${t.id}): ${msg}`);
			ledger.push({
				action: 'rsvp-propdef-sharing-widen',
				target: `rsvp.${t.name}`,
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

// ==================== Fix 2: Conductor prop-def list:true ====================

async function fix2ConductorList(cfg: EntuCfg): Promise<boolean> {
	console.log('\n=== Fix 2: Conductor prop-def list:true ===');

	const conductorPropDefs = [
		{ label: 'season.conductor', id: SEASON_CONDUCTOR_PROPDEF_ID },
		{ label: 'event.conductor', id: EVENT_CONDUCTOR_PROPDEF_ID }
	];

	// Pre-check: verify these are actually conductor prop-defs and read current list state.
	for (const pd of conductorPropDefs) {
		const entity = (await readPropDef(cfg, pd.id, 'name,list')) as {
			name?: Array<{ string: string }>;
			list?: Array<{ _id: string; boolean: boolean }>;
		};
		const liveName = entity.name?.[0]?.string;
		if (liveName !== 'conductor') {
			throw new Error(`HALT: ${pd.id} has name=${JSON.stringify(liveName)}, expected 'conductor' -- wrong id`);
		}
		const currentList = entity.list?.[0]?.boolean ?? null;
		const listPropId = entity.list?.[0]?._id ?? null;
		console.log(`  ${pd.label} (${pd.id}): name=conductor, list=${currentList ?? '(absent)'}`);
		(pd as Record<string, unknown>).currentList = currentList;
		(pd as Record<string, unknown>).listPropId = listPropId;
	}

	if (DRY_RUN) {
		for (const pd of conductorPropDefs) {
			const currentList = (pd as Record<string, unknown>).currentList as boolean | null;
			if (currentList === true) {
				ledger.push({ action: 'conductor-list-true', target: pd.label, targetId: pd.id, status: 'already-correct', before: true });
			} else {
				ledger.push({ action: 'conductor-list-true', target: pd.label, targetId: pd.id, status: 'dry-run', before: currentList });
			}
		}
		console.log(`  DRY_RUN: would set list:true on ${conductorPropDefs.filter((pd) => (pd as Record<string, unknown>).currentList !== true).length} prop-defs`);
		return true;
	}

	// Live execution.
	let allOk = true;
	for (const pd of conductorPropDefs) {
		const currentList = (pd as Record<string, unknown>).currentList as boolean | null;
		const listPropId = (pd as Record<string, unknown>).listPropId as string | null;

		if (currentList === true) {
			console.log(`  SKIP: ${pd.label} already has list:true`);
			ledger.push({ action: 'conductor-list-true', target: pd.label, targetId: pd.id, status: 'already-correct', before: true });
			continue;
		}

		try {
			const writeBody: Array<Record<string, unknown>> = [];
			if (listPropId) {
				writeBody.push({ _id: listPropId, type: 'list', boolean: true });
			} else {
				writeBody.push({ type: 'list', boolean: true });
			}

			const writeRes = await entuFetch(cfg.db, `entity/${pd.id}`, cfg.token, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(writeBody)
			});
			if (!writeRes.ok) {
				const text = await writeRes.text();
				throw new Error(`POST failed: ${writeRes.status} -- ${text}`);
			}

			// Read-back verify.
			const verifyEntity = (await readPropDef(cfg, pd.id, 'list')) as {
				list?: Array<{ boolean: boolean }>;
			};
			const newList = verifyEntity.list?.[0]?.boolean;
			if (newList !== true) {
				throw new Error(`verify FAILED: list=${newList}, expected true`);
			}

			console.log(`  SET: ${pd.label} (${pd.id}): list=(absent) -> true`);
			ledger.push({
				action: 'conductor-list-true',
				target: pd.label,
				targetId: pd.id,
				status: 'set',
				before: currentList,
				after: true
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`  FAILED: ${pd.label} (${pd.id}): ${msg}`);
			ledger.push({
				action: 'conductor-list-true',
				target: pd.label,
				targetId: pd.id,
				status: 'failed',
				before: currentList,
				error: msg
			});
			allOk = false;
		}
	}
	return allOk;
}

// ==================== Main ====================

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);

	const fix1Ok = await fix1RsvpPropDefSharing(cfg);

	if (!fix1Ok && !DRY_RUN) {
		console.error('\nFix 1 had failures -- Fix 2 will still proceed (independent fixes).');
	}

	const fix2Ok = await fix2ConductorList(cfg);

	// Summary.
	const fix1Entries = ledger.filter((e) => e.action === 'rsvp-propdef-sharing-widen');
	const fix2Entries = ledger.filter((e) => e.action === 'conductor-list-true');
	const fix1Failures = fix1Entries.filter((e) => e.status === 'failed');
	const fix2Failures = fix2Entries.filter((e) => e.status === 'failed');

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Fix 1 (RSVP prop-def sharing): ${fix1Entries.length} targets, ${fix1Failures.length} failures`);
	console.log(`Fix 2 (conductor list:true):    ${fix2Entries.length} targets, ${fix2Failures.length} failures`);

	const hasFailures = fix1Failures.length > 0 || fix2Failures.length > 0;
	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		authorization: 'PO-authorized fixes (Gama 2026-08-10 15:52)',
		fix1: {
			description: 'RSVP prop-def _sharing widen to domain (event, member, status, notes)',
			rsvpTypeId: RSVP_TYPE_ID,
			targets: fix1Entries.map((e) => ({ name: e.target, id: e.targetId, status: e.status, before: e.before, after: e.after, error: e.error }))
		},
		fix2: {
			description: 'Conductor prop-def list:true (season.conductor, event.conductor)',
			targets: fix2Entries.map((e) => ({ name: e.target, id: e.targetId, status: e.status, before: e.before, after: e.after, error: e.error }))
		},
		ledger,
		exitCode: hasFailures ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('rsvp-propdef-sharing-conductor-list ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
