// #53 (#37-P3.4b) ENTRYPOINT — delete the 7 corroborated orphan member
// entities (hidden→deleted). Authorized on #37 by Gama (2026-08-08 07:33) —
// "the delete set fell out MECHANICALLY from the recorded criterion ... no
// judgment-call rows exist, so per the guard's own terms this authorization
// is the PO's." Mihkel's veto window stated explicitly as open through this
// §8.6 chain. This file enforces DRY_RUN=true by default. The engine lives in
// `lib/delete-corroborated-orphans-2026-08-08.ts`.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/delete-corroborated-orphans-2026-08-08.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                           # executes all 7, after authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import { verifyAll, executeDeletes, renderPlan } from './lib/delete-corroborated-orphans-2026-08-08';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>, suffix: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `delete-corroborated-orphans-2026-08-08-${suffix}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	const result = await verifyAll(cfg);

	if (DRY_RUN) {
		const plan = renderPlan(result);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated on #53 §8.6 authorization + Bentham review).');
		const artifactPath = writeResultArtifact({ dryRun: true, ...result, writesIssued: 0, exitCode: 0 }, 'dry');
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	const allVerified = result.targets.every((t) => t.verified);
	if (!allVerified) {
		console.error('One or more targets failed live re-verification — refuse to execute ANY delete. Repair or re-verify manually first.');
		writeResultArtifact({ dryRun: false, ...result, entries: [], writesIssued: 0, exitCode: 1, halted: 'pre-verification-failed' });
		process.exit(1);
	}

	const entries = await executeDeletes(cfg, result.targets);
	const failures = entries.filter((e) => e.status === 'failed');
	console.log(`\n── DELETE: ${entries.length} attempted`);
	for (const e of entries) {
		const line = `${e.status.toUpperCase()} orphan=${e.orphanId} "${e.matchedName}"${e.message ? ` — ${e.message}` : ''}`;
		if (e.status === 'deleted') console.log(line);
		else console.error(line);
	}
	if (failures.length > 0) console.error(`\nINCOMPLETE — ${failures.length} failure(s). Non-zero exit: do not claim success.`);
	const artifactPath = writeResultArtifact({ dryRun: false, entries, failureCount: failures.length, exitCode: failures.length > 0 ? 1 : 0 }, 'live');
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#53 delete-corroborated-orphans ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
