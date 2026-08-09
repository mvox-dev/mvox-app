// #48 (#37-P3.6) ENTRYPOINT — fill `description` (en+et) on all 20 type-defs
// + 140 prop-defs. DRY_RUN=true by default. Cosmetic tier per the ruling: NO
// §8.6 chain required (no _sharing/rights/data mutation, "trust
// alternative" — team drafts+ships, no pre-ship review). Still dry-run
// first as standing good practice, then live directly under this task's own
// authorization (Owner: Pérotin, per team-lead's dispatch) — no separate
// "I authorize this run" gate for this specific task, per the explicit
// carve-out on #48/#37.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/meta-descriptions-2026-08-09.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                # live

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import { loadTargets, verifyStillEmpty, writeCanaries, writeDescriptions, renderPlan, WriteLedger } from './lib/meta-descriptions-2026-08-09';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `meta-descriptions-2026-08-09-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	const targets = loadTargets();
	const check = await verifyStillEmpty(cfg, targets);

	if (DRY_RUN) {
		const plan = renderPlan(check);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute live.');
		const artifactPath = writeResultArtifact({ dryRun: true, stillEmptyCount: check.stillEmpty.length, alreadyFilled: check.alreadyFilled, writesIssued: 0, exitCode: 0 });
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	const ledger = new WriteLedger();
	const { canaryEntries, remainingTargets } = await writeCanaries(cfg, check.stillEmpty);
	const restEntries = await writeDescriptions(cfg, remainingTargets);
	ledger.record([...canaryEntries, ...restEntries]);
	ledger.printReport();

	const artifactPath = writeResultArtifact({
		dryRun: false,
		alreadyFilled: check.alreadyFilled,
		...ledger.toJSON(),
		exitCode: ledger.hasFailures() ? 1 : 0
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('#48 meta-descriptions ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
