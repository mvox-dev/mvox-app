// #68 (epic #37) Phase 2 ENTRYPOINT — add-only db-root `_owner` backfill onto
// the 72 entities Phase 1 flagged. DRY_RUN=true by default. Per the issue's
// own chain: dry-run → review verdict → team-lead's explicit "I authorize
// this run" → live. Do NOT flip DRY_RUN=false until that authorization
// lands separately — dry-run-clean and a review GREEN are not substitutes
// (standing gate, see teams/mvox-dev/memory/perotin.md "Authorization gate").
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/db-root-owner-backfill-2026-08-09.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                    # ONLY after team-lead's explicit authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { entuFetch } from '$lib/entu/request';
import { loadCfg } from './lib/creds';
import {
	loadFlaggedBaseline,
	verifyPopulation,
	backfillCanaries,
	backfillOwner,
	readSharing,
	renderPlan,
	BackfillLedger,
	DB_ROOT_PERSON_ID
} from './lib/db-root-owner-backfill-2026-08-09';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

// The person-5ddc specimen (Mihkel's real-OAuth identity) is the known
// previously-403 case (#44's narrow-person-refs run, 1/132 failure) — the
// natural post-run proof that db-root can now write a rightType property it
// could not before. Touch-save only (re-assert the SAME `_sharing` value) —
// zero risk to the bucket, proves write access without changing anything.
const POST_RUN_PROOF_SPECIMEN_ID = '6a2fc05e4cd971291c5d5ddc';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `db-root-owner-backfill-2026-08-09-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	const baseline = loadFlaggedBaseline();
	const check = await verifyPopulation(cfg, baseline);

	if (DRY_RUN) {
		const plan = renderPlan(check);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute ONLY after team-lead\'s explicit "I authorize this run".');
		const artifactPath = writeResultArtifact({
			dryRun: true,
			populationCheck: check,
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	if (check.missing.length > 0) {
		console.error(`ABORT: ${check.missing.length} target(s) from the Phase 1 baseline no longer exist — refuse to proceed without explicit direction: ${JSON.stringify(check.missing)}`);
		writeResultArtifact({ dryRun: false, halted: 'missing-targets-since-phase-1', missing: check.missing, exitCode: 1 });
		process.exit(1);
	}

	// Pre-capture _sharing on the constraint specimen BEFORE any write, so the
	// post-run comparison is against a value read in THIS run, not assumed.
	const sharingBefore = await readSharing(cfg, POST_RUN_PROOF_SPECIMEN_ID);

	const ledger = new BackfillLedger();
	const { canaryEntries, remainingTargets } = await backfillCanaries(cfg, check.stillFlagged, check.preOwnerCounts);
	const restEntries = await backfillOwner(cfg, remainingTargets, check.preOwnerCounts);
	ledger.record([...canaryEntries, ...restEntries]);
	ledger.printReport();

	const sharingAfter = await readSharing(cfg, POST_RUN_PROOF_SPECIMEN_ID);
	const sharingUnchanged = sharingBefore.string === sharingAfter.string && sharingBefore.valueId === sharingAfter.valueId;
	if (!sharingUnchanged) {
		console.error(`WARNING: _sharing on constraint specimen ${POST_RUN_PROOF_SPECIMEN_ID} changed — before=${JSON.stringify(sharingBefore)} after=${JSON.stringify(sharingAfter)}. Ownership writes were expected NOT to touch _sharing.`);
	}

	// Post-run access-proof (acceptance criterion): touch-save the specimen's
	// _sharing (re-assert the SAME value, same _id) — proves db-root can now
	// WRITE a rightType property on this entity, not just read it (before the
	// backfill, this exact write shape 403'd — #44's narrow-person-refs run).
	// Skips cleanly if the specimen carries no explicit _sharing value to touch.
	let postRunWriteProof: { attempted: boolean; succeeded: boolean; message?: string } = { attempted: false, succeeded: false };
	if (sharingAfter.valueId && sharingAfter.string) {
		try {
			const touchRes = await entuFetch(
				cfg.db,
				`entity/${POST_RUN_PROOF_SPECIMEN_ID}`,
				cfg.token,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ _id: sharingAfter.valueId, type: '_sharing', string: sharingAfter.string }]) }
			);
			if (!touchRes.ok) {
				postRunWriteProof = { attempted: true, succeeded: false, message: `touch-save POST failed: ${touchRes.status}` };
			} else {
				const verify = await readSharing(cfg, POST_RUN_PROOF_SPECIMEN_ID);
				postRunWriteProof =
					verify.string === sharingAfter.string
						? { attempted: true, succeeded: true }
						: { attempted: true, succeeded: false, message: `post-touch read-back shows _sharing=${JSON.stringify(verify.string)}, expected ${JSON.stringify(sharingAfter.string)}` };
			}
		} catch (err) {
			postRunWriteProof = { attempted: true, succeeded: false, message: err instanceof Error ? err.message : String(err) };
		}
	} else {
		postRunWriteProof = { attempted: false, succeeded: false, message: 'specimen carries no explicit _sharing value — no write-proof shape available; read access alone is not proof (db-root always reads private bucket)' };
	}

	const artifactPath = writeResultArtifact({
		dryRun: false,
		populationCheck: check,
		...ledger.toJSON(),
		constraintCheck: { specimen: POST_RUN_PROOF_SPECIMEN_ID, sharingBefore, sharingAfter, sharingUnchanged },
		postRunWriteProof,
		exitCode: ledger.hasFailures() ? 1 : 0,
		verificationCaveat:
			"Run under ENTU_API_KEY (db-root), which always reads the private bucket regardless of tier. 'added' here means the write landed and the read-back confirms db-root present in _owner with exactly +1 count (add-only) — existing owners/editors were never touched or removed."
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('#68 Phase 2 db-root-owner-backfill ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
