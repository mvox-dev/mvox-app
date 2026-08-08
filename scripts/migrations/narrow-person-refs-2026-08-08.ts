// #44 (#37-P3.2) ENTRYPOINT — narrow the 18 person prop-defs from
// `_sharing:'domain'` to `'private'` (Bundle A), then touch-save all 132 person
// entities to re-trigger aggregation (Bundle B). Authorized on #37 by Gama
// (2026-08-08 06:56); this file enforces DRY_RUN=true by default. Do not flip
// it without team-lead's explicit "I authorize this run" AND Bentham's
// pre-execution review. The engine lives in
// `lib/narrow-person-refs-2026-08-08.ts` — read its header comment first.
//
// ─────────────────────────────────────────────────────────────────────────────
// SAFETY: DRY_RUN defaults TRUE. Bundle B is gated on Bundle A succeeding for
// ALL 18 prop-defs. Within Bundle B, the canary (person 69bcfd8e...8079,
// db-root/PO) runs ALONE first, followed by a hard, non-optional credential
// self-test (db-root's own API key must still authenticate a trivial read
// AFTER the canary's re-aggregation) — this run's own credential proving
// itself alive. A failure at either the canary or the self-test HALTS before
// any of the remaining 131 persons are touched.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/narrow-person-refs-2026-08-08.ts   # DRY_RUN=true default
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import {
	verifyPersonTypeSharing,
	verifyPropDefsCurrentlyDomain,
	enumeratePersons,
	countPropertyPresence,
	narrowPropDefs,
	touchSaveCanaryAndSelfTest,
	touchSavePersons,
	renderPlan,
	NarrowLedger,
	CANARY_PERSON_ID
} from './lib/narrow-person-refs-2026-08-08';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `narrow-person-refs-2026-08-08-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step-0 enumeration (READ-ONLY) — HALTs loudly on any drift from #41's data.
	const observedTypeSharing = await verifyPersonTypeSharing(cfg);
	const propDefsObserved = await verifyPropDefsCurrentlyDomain(cfg);
	const personEnumeration = await enumeratePersons(cfg);
	const propertyPresence = await countPropertyPresence(cfg);

	if (DRY_RUN) {
		const plan = renderPlan(observedTypeSharing, propDefsObserved, personEnumeration, propertyPresence);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated on #44 §8.6 authorization + Bentham review).');
		const artifactPath = writeResultArtifact({
			dryRun: true,
			personTypeSharingObserved: observedTypeSharing,
			propDefTargets: propDefsObserved,
			propertyPresenceCounts: propertyPresence,
			personPopulation: {
				total: personEnumeration.total,
				tierBreakdown: personEnumeration.tierBreakdown,
				missingSharingIds: personEnumeration.missingSharingIds
			},
			canaryPersonId: CANARY_PERSON_ID,
			credentialSelfTestPlanned: true,
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	const ledger = new NarrowLedger();

	// Bundle A — prop-def _sharing replace. Run for ALL 18 before touching Bundle B.
	const propDefEntries = await narrowPropDefs(cfg, propDefsObserved);
	ledger.recordPropDef(propDefEntries);

	if (ledger.propDefFailures().length > 0) {
		console.error(`Bundle A had ${ledger.propDefFailures().length} failure(s) — Bundle B (touch-save sweep) will NOT run.`);
		ledger.printReport();
		writeResultArtifact({ dryRun: false, ...ledger.toJSON(), exitCode: 1, halted: 'bundle-a-incomplete' });
		process.exit(1);
	}

	// Bundle B — canary + credential self-test, then the remaining 131.
	const canaryTarget = personEnumeration.targets.find((t) => t.personId === CANARY_PERSON_ID);
	if (!canaryTarget) {
		throw new Error(`canary person ${CANARY_PERSON_ID} not found in the enumerated 132 — refuse to proceed`);
	}
	const restTargets = personEnumeration.targets.filter((t) => t.personId !== CANARY_PERSON_ID);

	const canaryEntry = await touchSaveCanaryAndSelfTest(cfg, canaryTarget, loadCfg);
	const restEntries = await touchSavePersons(cfg, restTargets);
	ledger.recordTouch([canaryEntry, ...restEntries]);

	ledger.printReport();
	const artifactPath = writeResultArtifact({
		dryRun: false,
		personTypeSharingObserved: observedTypeSharing,
		propDefTargets: propDefsObserved,
		canaryPersonId: CANARY_PERSON_ID,
		credentialSelfTestPassed: true,
		personPopulation: {
			total: personEnumeration.total,
			tierBreakdown: personEnumeration.tierBreakdown,
			missingSharingIds: personEnumeration.missingSharingIds
		},
		...ledger.toJSON(),
		exitCode: ledger.hasFailures() ? 1 : 0,
		verificationCaveat:
			"Run under ENTU_API_KEY (PO/db-root), which always reads the private bucket regardless of prop-def sharing. 'narrowed'/'touched' here means the write landed and rotated the property _id (proof a fresh aggregateEntity run happened), NOT an empirically-confirmed absence from a non-owner domain reader's view. That last-mile confirmation needs a real non-omniscient browser session (Mihkel), same pattern as #20/#29."
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('#44 narrow-person-refs ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
