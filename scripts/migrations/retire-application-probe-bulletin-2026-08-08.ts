// #45 (#37-P3.3) ENTRYPOINT — retire apply-to-join (D2) + delete _probe_bulletin
// (D5). Authorized on #37 by Gama (upfront conditional, 2026-08-08 07:05); each
// of the 4 mutation steps below is its OWN §8.6 authorization per the issue.
// This file enforces DRY_RUN=true by default AND refuses to execute more than
// one STEP per live invocation. The engine lives in
// `lib/retire-application-probe-bulletin-2026-08-08.ts` — read its header
// comment first.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/retire-application-probe-bulletin-2026-08-08.ts        # DRY_RUN=true default, renders ALL 4 step plans
//   DRY_RUN=false STEP=1 node --import tsx ... same-file                          # executes ONLY step 1, after its own authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import {
	verifyAllTargets,
	verifyStep3Only,
	step1PrivatizeMenu,
	step2DeleteSpecimen,
	step3RetireApplicationType,
	step4DeleteProbeBulletin,
	renderPlan
} from './lib/retire-application-probe-bulletin-2026-08-08';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const STEP = process.env.STEP ? Number(process.env.STEP) : null;

function writeResultArtifact(payload: Record<string, unknown>, suffix: string): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `retire-application-probe-bulletin-2026-08-08-${suffix}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	if (DRY_RUN) {
		// Full-plan render still needs all 4 targets' live state.
		const verified = await verifyAllTargets(cfg);
		const plan = renderPlan(verified);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false AND STEP=1|2|3|4 to execute exactly one step (gated on its own #45 §8.6 authorization + Bentham review).');
		const artifactPath = writeResultArtifact({ dryRun: true, verifiedTargets: verified, writesIssued: 0, exitCode: 0 }, 'dry');
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	if (STEP !== 1 && STEP !== 2 && STEP !== 3 && STEP !== 4) {
		throw new Error(`DRY_RUN=false requires STEP set to exactly 1, 2, 3, or 4 (got ${JSON.stringify(process.env.STEP)}) — each step is its own §8.6 authorization, refuse to run an unspecified or combined step`);
	}

	let entries: Array<{ id: string; label: string; status: string; message?: string }>;
	if (STEP === 1) {
		const verified = await verifyAllTargets(cfg);
		if (!verified.menuEntry.sharingValueId) {
			throw new Error('STEP 1: menu entry already has no _sharing value — already privatized, or state drifted; refuse to proceed, re-verify manually');
		}
		entries = [await step1PrivatizeMenu(cfg, verified.menuEntry.sharingValueId)];
	} else if (STEP === 2) {
		entries = [await step2DeleteSpecimen(cfg)];
	} else if (STEP === 3) {
		// Targeted verification only — steps 1/2/4 have already landed live by
		// this point (specimen deleted, menu privatized, _probe_bulletin gone),
		// so the full verifyAllTargets 4-target check would fail on entities
		// that are gone BY DESIGN. step3RetireApplicationType does its own live
		// zero-instance recount internally regardless (see lib header note).
		await verifyStep3Only(cfg);
		entries = await step3RetireApplicationType(cfg);
	} else {
		entries = await step4DeleteProbeBulletin(cfg);
	}

	const failures = entries.filter((e) => e.status === 'failed');
	console.log(`\n── STEP ${STEP}: ${entries.length} attempted`);
	for (const e of entries) {
		const line = `${e.status.toUpperCase()} ${e.label} (${e.id})${e.message ? ` — ${e.message}` : ''}`;
		if (e.status === 'deleted') console.log(line);
		else console.error(line);
	}
	if (failures.length > 0) {
		console.error(`\nSTEP ${STEP} INCOMPLETE — ${failures.length} failure(s) need operator repair. Non-zero exit: do not claim success.`);
	}

	const artifactPath = writeResultArtifact(
		{ dryRun: false, step: STEP, entries, failureCount: failures.length, exitCode: failures.length > 0 ? 1 : 0 },
		`step${STEP}-live`
	);
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#45 retire-application-probe-bulletin ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
