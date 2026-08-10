// Fix-forward migration: attendance prop-def _sharing widen.
// Authorization: same class as rsvp-propdef-sharing-conductor-list-2026-08-10.ts
// (PO-authorized fix — Gama 2026-08-10). Polyphony db is dev/test with synthetic
// data — routine mutations pre-authorized.
//
// The attendance type-def's `member` (reference), `status` (string), and `notes`
// (text) prop-defs report _sharing=None (absent/private). Entity-level
// `_sharing: domain` on createAttendance is not sufficient: the prop-def decides
// which bucket each PROPERTY VALUE lands in. Without widening, listAttendance's
// `props=member,status` returns rows whose member/status are invisible to any
// caller not _owner on the entity, so every such row is dropped by the fail-loud
// path at attendanceData.ts:211-220. The creating conductor still sees her own
// rows (she is _owner), but a second conductor or the singer's TA.4 view cannot.
//
// Fix: widen attendance.member, attendance.status, attendance.notes to
// _sharing:domain — exact mirror of the rsvp prop-def sharing fix (c95b050).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/attendance-propdef-sharing-widen-2026-08-10.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/attendance-propdef-sharing-widen-2026-08-10.ts       # ONLY after dry-run verified

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// Known IDs from the TA.1 ledger.
const ATTENDANCE_TYPE_ID = '6a0d2e8690c8df7a1cc7df4b';
const PROPERTY_META_ID = '69bcfd8e9c031ab8e6ce8048';

// The 3 attendance prop-defs whose _sharing needs widening.
// present_ref, absent_ref, late_ref already have _sharing:public (sentinels).
const ATTENDANCE_PROPDEF_NAMES_TO_WIDEN = ['member', 'status', 'notes'];

interface LedgerEntry {
	action: string;
	target: string;
	targetId: string;
	status: 'widened' | 'already-correct' | 'failed' | 'dry-run';
	before?: string | null;
	after?: string;
	error?: string;
}

const ledger: LedgerEntry[] = [];

function writeLedger(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'ledgers');
	const filename = `attendance-propdef-sharing-widen-2026-08-10-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

/** List prop-defs under the attendance type, returning a map of name -> { id, sharing }. */
async function listAttendancePropDefs(cfg: EntuCfg): Promise<Map<string, { id: string; sharing: string | null; sharingPropId: string | null }>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.reference=${PROPERTY_META_ID}&_parent.reference=${ATTENDANCE_TYPE_ID}&props=name,_sharing&limit=200`,
		cfg.token
	);
	if (!res.ok) throw new Error(`listAttendancePropDefs failed: ${res.status}`);
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

/** Read a prop-def entity to verify properties. */
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

async function main(): Promise<void> {
	const cfg = await loadCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}\n`);
	console.log('=== Attendance prop-def _sharing widen ===');
	console.log('Querying attendance type prop-defs...');

	const propDefs = await listAttendancePropDefs(cfg);
	console.log(`  Found ${propDefs.size} prop-defs on attendance type:`);
	for (const [name, info] of propDefs) {
		console.log(`    ${name} (${info.id}): _sharing=${info.sharing ?? '(absent/private)'}`);
	}

	// Validate: all 3 target prop-defs must exist.
	const targets: Array<{ name: string; id: string; currentSharing: string | null; sharingPropId: string | null }> = [];
	for (const name of ATTENDANCE_PROPDEF_NAMES_TO_WIDEN) {
		const info = propDefs.get(name);
		if (!info) {
			throw new Error(`HALT: attendance prop-def '${name}' not found on type ${ATTENDANCE_TYPE_ID}`);
		}
		targets.push({ name, id: info.id, currentSharing: info.sharing, sharingPropId: info.sharingPropId });
	}

	console.log(`\n  Targets for _sharing widen to domain:`);
	for (const t of targets) {
		console.log(`    attendance.${t.name} (${t.id}): current _sharing=${t.currentSharing ?? '(absent/private)'}`);
	}

	if (DRY_RUN) {
		for (const t of targets) {
			if (t.currentSharing === 'domain') {
				ledger.push({ action: 'attendance-propdef-sharing-widen', target: `attendance.${t.name}`, targetId: t.id, status: 'already-correct', before: t.currentSharing });
			} else {
				ledger.push({ action: 'attendance-propdef-sharing-widen', target: `attendance.${t.name}`, targetId: t.id, status: 'dry-run', before: t.currentSharing ?? '(absent/private)' });
			}
		}
		console.log(`  DRY_RUN: would widen ${targets.filter((t) => t.currentSharing !== 'domain').length} prop-defs`);
	} else {
		// Live execution.
		for (const t of targets) {
			if (t.currentSharing === 'domain') {
				console.log(`  SKIP: attendance.${t.name} already domain`);
				ledger.push({ action: 'attendance-propdef-sharing-widen', target: `attendance.${t.name}`, targetId: t.id, status: 'already-correct', before: 'domain' });
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
				const verifyEntity = (await readPropDef(cfg, t.id, '_sharing')) as {
					_sharing?: Array<{ string: string }>;
				};
				const newSharing = verifyEntity._sharing?.[0]?.string;
				if (newSharing !== 'domain') {
					throw new Error(`verify FAILED: _sharing=${newSharing}, expected domain`);
				}

				console.log(`  WIDENED: attendance.${t.name} (${t.id}): ${t.currentSharing ?? '(absent/private)'} -> domain`);
				ledger.push({
					action: 'attendance-propdef-sharing-widen',
					target: `attendance.${t.name}`,
					targetId: t.id,
					status: 'widened',
					before: t.currentSharing ?? '(absent/private)',
					after: 'domain'
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`  FAILED: attendance.${t.name} (${t.id}): ${msg}`);
				ledger.push({
					action: 'attendance-propdef-sharing-widen',
					target: `attendance.${t.name}`,
					targetId: t.id,
					status: 'failed',
					before: t.currentSharing ?? '(absent/private)',
					error: msg
				});
			}
		}
	}

	// Summary.
	const entries = ledger.filter((e) => e.action === 'attendance-propdef-sharing-widen');
	const failures = entries.filter((e) => e.status === 'failed');

	console.log('\n=== SUMMARY ===');
	console.log(`DRY_RUN: ${DRY_RUN}`);
	console.log(`Attendance prop-def sharing widen: ${entries.length} targets, ${failures.length} failures`);

	const hasFailures = failures.length > 0;
	const artifactPath = writeLedger({
		dryRun: DRY_RUN,
		authorization: 'PO-authorized fix — same class as rsvp prop-def sharing widen',
		description: 'Attendance prop-def _sharing widen to domain (member, status, notes)',
		attendanceTypeId: ATTENDANCE_TYPE_ID,
		targets: entries.map((e) => ({ name: e.target, id: e.targetId, status: e.status, before: e.before, after: e.after, error: e.error })),
		ledger,
		exitCode: hasFailures ? 1 : 0
	});
	console.log(`Ledger: ${artifactPath}`);
	process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
	console.error('attendance-propdef-sharing-widen ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});

// (*MVOX:Palestrina*)
