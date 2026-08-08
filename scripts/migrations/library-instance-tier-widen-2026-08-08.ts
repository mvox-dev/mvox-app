// T6.2b (#57, epic #54) ENTRYPOINT — the completing mutation Gama's STOP
// identified: converts all 586 library instances' `_sharing` from `private`
// to `domain` (gate 3), after verifying gate 2 (the 4 TYPE entities' own
// `_sharing`) live. DRY_RUN=true by default. Per the dispatch: dry-run may
// proceed immediately; LIVE EXECUTION HOLDS on Mihkel's explicit nod even
// after Bentham + team-lead authorization — do not flip DRY_RUN=false until
// that nod is separately confirmed by team-lead.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/library-instance-tier-widen-2026-08-08.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                          # ONLY after Mihkel's nod + full §8.6

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import { verifyTypeGate2, verifyInstances, widenCanaries, widenInstances, renderPlan, InstanceWidenLedger } from './lib/library-instance-tier-widen-2026-08-08';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `library-instance-tier-widen-2026-08-08-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	const gate2 = await verifyTypeGate2(cfg);
	const instances = await verifyInstances(cfg);

	if (DRY_RUN) {
		const plan = renderPlan(gate2, instances);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute ONLY after Mihkel\'s explicit nod (per the dispatch, this holds even past Bentham/team-lead authorization).');
		const artifactPath = writeResultArtifact({
			dryRun: true,
			gate2,
			instancePopulation: { countsByType: instances.countsByType, tierHistogram: instances.tierHistogram, missingSharingIds: instances.missingSharingIds, nonDbRootOwned: instances.nonDbRootOwned },
			instanceIds: instances.targets,
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	const gate2Failures = gate2.filter((g) => !g.passesGate2);
	if (gate2Failures.length > 0) {
		console.error(`ABORT: ${gate2Failures.length} type(s) fail gate 2 — widening instances would not make them member-readable: ${JSON.stringify(gate2Failures)}`);
		writeResultArtifact({ dryRun: false, halted: 'gate2-failed', gate2Failures, exitCode: 1 });
		process.exit(1);
	}
	if (instances.nonDbRootOwned.length > 0) {
		console.error(`ABORT: ${instances.nonDbRootOwned.length} instance(s) not db-root-owned — refuse to proceed without explicit direction.`);
		writeResultArtifact({ dryRun: false, halted: 'non-db-root-owned-instances-found', nonDbRootOwned: instances.nonDbRootOwned, exitCode: 1 });
		process.exit(1);
	}

	const ledger = new InstanceWidenLedger();
	const { canaryEntries, remainingTargets } = await widenCanaries(cfg, instances.targets);
	const restEntries = await widenInstances(cfg, remainingTargets);
	ledger.record([...canaryEntries, ...restEntries]);

	ledger.printReport();
	const artifactPath = writeResultArtifact({
		dryRun: false,
		gate2,
		instancePopulation: { countsByType: instances.countsByType, tierHistogram: instances.tierHistogram },
		...ledger.toJSON(),
		exitCode: ledger.hasFailures() ? 1 : 0,
		verificationCaveat:
			"Run under ENTU_API_KEY (PO/db-root), which always reads the private bucket regardless of tier. 'widened' here means the write landed, the read-back confirms _sharing='domain', and the property _id rotated (fresh aggregation) — NOT an empirically-confirmed non-owner domain read. That last-mile confirmation is T6.5's live gate."
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('T6.2b library-instance-tier-widen ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
