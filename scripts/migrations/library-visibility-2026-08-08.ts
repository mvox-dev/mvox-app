// T6.2 (#56, epic #54) ENTRYPOINT — library visibility mutation. Authorized
// scope per Gama's rulings on #54 (2026-08-08 10:48 + follow-up). This file
// enforces DRY_RUN=true by default; do not flip without team-lead's explicit
// "I authorize this run" AND Bentham's pre-execution review (586-instance
// blast radius). The engine lives in `lib/library-visibility-2026-08-08.ts` —
// read its header comment first, it documents the #44/#45 ownership lesson
// applied proactively here.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/library-visibility-2026-08-08.ts               # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                         # ONLY after §8.6 authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import { verifyPropDefs, verifyInstances, writePropDefs, touchSaveCanaries, touchSaveInstances, renderPlan, LibraryVisibilityLedger } from './lib/library-visibility-2026-08-08';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `library-visibility-2026-08-08-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step-0 enumeration (READ-ONLY) — HALTs loudly on any drift.
	const propDefs = await verifyPropDefs(cfg);
	const instances = await verifyInstances(cfg);

	if (DRY_RUN) {
		const plan = renderPlan(propDefs, instances);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated on T6.2 §8.6 authorization).');
		const artifactPath = writeResultArtifact({
			dryRun: true,
			propDefTargets: propDefs,
			instancePopulation: { countsByType: instances.countsByType, tierHistogram: instances.tierHistogram, missingSharingIds: instances.missingSharingIds, nonDbRootOwned: instances.nonDbRootOwned },
			instanceIds: instances.targets,
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	if (instances.nonDbRootOwned.length > 0) {
		console.error(`ABORT: ${instances.nonDbRootOwned.length} instance(s) are not db-root-owned — refuse to proceed without explicit direction (same lesson as #44/#45).`);
		writeResultArtifact({ dryRun: false, halted: 'non-db-root-owned-instances-found', nonDbRootOwned: instances.nonDbRootOwned, exitCode: 1 });
		process.exit(1);
	}

	const ledger = new LibraryVisibilityLedger();

	// Bundle A — prop-def writes. Run for ALL 12 before touching Bundle B.
	const propDefEntries = await writePropDefs(cfg, propDefs);
	ledger.recordPropDef(propDefEntries);

	if (ledger.propDefFailures().length > 0) {
		console.error(`Bundle A had ${ledger.propDefFailures().length} failure(s) — Bundle B (touch-save sweep) will NOT run.`);
		ledger.printReport();
		writeResultArtifact({ dryRun: false, ...ledger.toJSON(), exitCode: 1, halted: 'bundle-a-incomplete' });
		process.exit(1);
	}

	// Bundle B — canaries (one per type) then the rest.
	const { canaryEntries, remainingTargets } = await touchSaveCanaries(cfg, instances.targets);
	const restEntries = await touchSaveInstances(cfg, remainingTargets);
	ledger.recordTouch([...canaryEntries, ...restEntries]);

	ledger.printReport();
	const artifactPath = writeResultArtifact({
		dryRun: false,
		propDefTargets: propDefs,
		instancePopulation: { countsByType: instances.countsByType, tierHistogram: instances.tierHistogram },
		...ledger.toJSON(),
		exitCode: ledger.hasFailures() ? 1 : 0,
		verificationCaveat:
			"Run under ENTU_API_KEY (PO/db-root), which always reads the private bucket regardless of prop-def sharing. 'set'/'touched' here means the write landed and rotated the property _id (proof a fresh aggregateEntity run happened), NOT an empirically-confirmed domain-bucket read by a non-owner reader. That last-mile confirmation needs a real non-omniscient browser session (Mihkel), same pattern as #20/#44."
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('T6.2 library-visibility ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
