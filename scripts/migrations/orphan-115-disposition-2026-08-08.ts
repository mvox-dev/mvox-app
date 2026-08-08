// #46 (#37-P3.4) ENTRYPOINT — orphan-115 disposition: Phase A (loose-match,
// read-only, always runs), Phase B (delete corroborated twins, GATED,
// `PHASE=B`), Phase C (hide the remainder, GATED, `PHASE=C`). Authorized on
// #37 by Gama (upfront conditional); each mutation phase is its OWN §8.6
// authorization per the issue. This file enforces DRY_RUN=true by default AND
// refuses to run Phase B or C without DRY_RUN=false AND an explicit PHASE.
// The engine lives in `lib/orphan-115-disposition-2026-08-08.ts` — read its
// header comment first (it documents a structural finding: the section-
// consistency gate is unsatisfiable today, so Phase B's delete set is empty).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/orphan-115-disposition-2026-08-08.ts             # DRY_RUN=true default
//   DRY_RUN=false PHASE=B node --import tsx ... same-file                    # Phase B only, after its own authorization
//   DRY_RUN=false PHASE=C node --import tsx ... same-file                    # Phase C only, after its own authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import { enumerateAll, computeDispositions, phaseBDelete, phaseCHide, renderPlan } from './lib/orphan-115-disposition-2026-08-08';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const PHASE = process.env.PHASE ?? null;

function writeResultArtifact(payload: Record<string, unknown>, suffix: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `orphan-115-disposition-2026-08-08-${suffix}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Phase A always runs fresh (read-only, deterministic) — never trusted from a stale artifact.
	const data = await enumerateAll(cfg);
	const rows = computeDispositions(data);
	const deleteRows = rows.filter((r) => r.disposition === 'delete');
	const hideRows = rows.filter((r) => r.disposition === 'hide');

	if (DRY_RUN) {
		const plan = renderPlan(rows);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false AND PHASE=B|C to execute (each its own #46 §8.6 authorization + Bentham review — Phase B especially, per Gama\'s "strictest gate" note).');
		const artifactPath = writeResultArtifact({ dryRun: true, phaseA: rows, deleteCandidateCount: deleteRows.length, hideCandidateCount: hideRows.length, writesIssued: 0, exitCode: 0 }, 'dry');
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	if (PHASE !== 'B' && PHASE !== 'C') {
		throw new Error(`DRY_RUN=false requires PHASE set to exactly 'B' or 'C' (got ${JSON.stringify(process.env.PHASE)}) — each phase is its own §8.6 authorization, refuse to run unspecified or combined`);
	}

	if (PHASE === 'B') {
		if (deleteRows.length === 0) {
			console.log('PHASE B: 0 delete candidates per the mechanical criterion (recomputed fresh this run) — nothing to do. Not an error.');
			const artifactPath = writeResultArtifact({ dryRun: false, phase: 'B', deleteCandidateCount: 0, entries: [], failureCount: 0, exitCode: 0 }, 'phaseB-live');
			console.log(`Result artifact: ${artifactPath}`);
			process.exit(0);
		}
		const entries = await phaseBDelete(cfg, deleteRows);
		const failures = entries.filter((e) => e.status === 'failed');
		console.log(`\n── PHASE B: ${entries.length} attempted`);
		for (const e of entries) {
			const line = `${e.status.toUpperCase()} orphan=${e.orphanId}${e.message ? ` — ${e.message}` : ''}`;
			if (e.status === 'deleted') console.log(line);
			else console.error(line);
		}
		if (failures.length > 0) console.error(`\nPHASE B INCOMPLETE — ${failures.length} failure(s). Non-zero exit: do not claim success.`);
		const artifactPath = writeResultArtifact({ dryRun: false, phase: 'B', deleteCandidateCount: deleteRows.length, entries, failureCount: failures.length, exitCode: failures.length > 0 ? 1 : 0 }, 'phaseB-live');
		console.log(`Result artifact: ${artifactPath}`);
		process.exit(failures.length > 0 ? 1 : 0);
	}

	// PHASE === 'C': hide everything currently disposed 'hide' — recomputed fresh above, so
	// this automatically reflects any Phase B deletions that already landed (deleted rows
	// simply won't appear in `data.orphans` on a fresh enumerateAll re-run).
	const entries = await phaseCHide(cfg, data.orphans.filter((o) => hideRows.some((r) => r.orphanId === o.id)));
	const failures = entries.filter((e) => e.status === 'failed');
	console.log(`\n── PHASE C: ${entries.length} attempted`);
	for (const e of entries) {
		const line = `${e.status.toUpperCase()} orphan=${e.orphanId}${e.message ? ` — ${e.message}` : ''}`;
		if (e.status === 'hidden') console.log(line);
		else console.error(line);
	}
	if (failures.length > 0) console.error(`\nPHASE C INCOMPLETE — ${failures.length} failure(s). Non-zero exit: do not claim success.`);
	const artifactPath = writeResultArtifact({ dryRun: false, phase: 'C', hideCandidateCount: hideRows.length, entries, failureCount: failures.length, exitCode: failures.length > 0 ? 1 : 0 }, 'phaseC-live');
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#46 orphan-115-disposition ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
