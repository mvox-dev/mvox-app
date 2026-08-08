// #47 (#37-P3.5) ENTRYPOINT — restrict repertoire_item/program_item/attendance
// menu entries to admin-only. Authorized on #37 by Gama (upfront conditional,
// "proceeds under the standing conditional authorization at the team's
// boundary"). This file enforces DRY_RUN=true by default. The engine lives in
// `lib/menu-empty-shells-2026-08-08.ts` — read its header comment first (it
// documents why member-seat verification can't be performed empirically this
// run, and quotes the known open 22-vs-11 discrepancy rather than diagnosing
// it).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/menu-empty-shells-2026-08-08.ts                 # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                          # executes all 3, after authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import { verifyAll, privatizeMenuEntries, renderPlan } from './lib/menu-empty-shells-2026-08-08';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>, suffix: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `menu-empty-shells-2026-08-08-${suffix}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	const verified = await verifyAll(cfg);

	if (DRY_RUN) {
		const plan = renderPlan(verified);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated on #47 §8.6 authorization + Bentham review).');
		const artifactPath = writeResultArtifact({ dryRun: true, verified, writesIssued: 0, exitCode: 0 }, 'dry');
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	const entries = await privatizeMenuEntries(cfg, verified.targets);
	const failures = entries.filter((e) => e.status === 'failed');
	console.log(`\n── PRIVATIZE: ${entries.length} attempted`);
	for (const e of entries) {
		const line = `${e.status.toUpperCase()} ${e.name} (${e.menuId})${e.message ? ` — ${e.message}` : ''}`;
		if (e.status === 'privatized') console.log(line);
		else console.error(line);
	}
	if (failures.length > 0) console.error(`\nINCOMPLETE — ${failures.length} failure(s). Non-zero exit: do not claim success.`);
	const artifactPath = writeResultArtifact({ dryRun: false, entries, failureCount: failures.length, exitCode: failures.length > 0 ? 1 : 0 }, 'live');
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#47 menu-empty-shells ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
