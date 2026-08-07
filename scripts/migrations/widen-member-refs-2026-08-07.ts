// #20 follow-up migration ENTRYPOINT — close the roster rights-narrowing gap:
// widen `member.person` + `member.section` prop-defs to `_sharing:'domain'`
// (Bundle A) then touch-save every currently domain-tier member to re-trigger
// aggregation (Bundle B). §8.6 authorization required on #20 before any live
// run — this entrypoint enforces DRY_RUN=true by default; do not flip it
// without team-lead's explicit "I authorize this run" AND Bentham's
// pre-execution review (245-instance blast radius). The tested engine lives in
// `lib/widen-member-refs-2026-08-07.ts` — read its header comment first, it
// explains the mechanism + the read-back verification caveat.
//
// ─────────────────────────────────────────────────────────────────────────────
// SAFETY: DRY_RUN defaults TRUE. Bundle B is gated on Bundle A succeeding for
// BOTH prop-defs — a partial Bundle A must never let Bundle B run (touch-saving
// 245 members before the schema fix landed would waste writes and produce a
// misleading ledger — the touch-saves only DO anything once the prop-defs are
// actually domain-shared).
//
// Bentham note C (pre-execution review, non-blocking): a PARTIAL Bundle B
// failure has NO automatic re-run path. `verifyPropDefsAbsent` HALTs on any
// re-run once Bundle A has landed (it refuses to proceed if either prop-def
// already carries a _sharing value) — this script is not idempotent across a
// second invocation after Bundle A succeeds. If Bundle B fails partway
// through, do NOT blindly re-run; repair per the ledger's per-record failures
// (same posture as T4.10) — likely a targeted retry against just the failed
// memberIds, built as a follow-up if it's ever actually needed.
// ─────────────────────────────────────────────────────────────────────────────
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   pnpm run migrate:widen-member-refs:dry     # DRY_RUN=true  (safe; the operator's verify surface)
//   pnpm run migrate:widen-member-refs:live    # DRY_RUN=false (ONLY after #20 §8.6 authorization)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import {
	verifyMemberTypeSharing,
	verifyPropDefsAbsent,
	widenPropDefs,
	enumerateDomainMembers,
	touchSaveCanary,
	touchSaveDomainMembers,
	renderPlan,
	WidenLedger
} from './lib/widen-member-refs-2026-08-07';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `widen-member-refs-2026-08-07-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step-0 enumeration (READ-ONLY) + drift/precheck guards — HALTs loudly.
	await verifyMemberTypeSharing(cfg);
	await verifyPropDefsAbsent(cfg);
	const memberTargets = await enumerateDomainMembers(cfg);

	if (DRY_RUN) {
		const plan = renderPlan(memberTargets);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated on #20 §8.6 authorization).');
		const artifactPath = writeResultArtifact({
			dryRun: true,
			memberTypeSharingCheck: "PASSED — member TYPE entity's own _sharing confirmed live (Bentham YELLOW-A guard, verifyMemberTypeSharing)",
			propDefTargets: [
				{ id: '69c7ea4b8489bfcb0e819f05', name: 'person' },
				{ id: '69c7ea4c8489bfcb0e819f27', name: 'section' }
			],
			domainMemberCount: memberTargets.length,
			domainMemberIds: memberTargets.map((t) => t.memberId),
			writesIssued: 0,
			exitCode: 0
		});
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	const ledger = new WidenLedger();

	// Bundle A — prop-def _sharing writes. Run for BOTH targets before touching Bundle B.
	const propDefEntries = await widenPropDefs(cfg);
	ledger.recordPropDef(propDefEntries);

	if (ledger.propDefFailures().length > 0) {
		console.error(`Bundle A had ${ledger.propDefFailures().length} failure(s) — Bundle B (touch-save sweep) will NOT run.`);
		ledger.printReport();
		writeResultArtifact({ dryRun: false, ...ledger.toJSON(), exitCode: 1, halted: 'bundle-a-incomplete' });
		process.exit(1);
	}

	// Bundle B — touch-save sweep. Only reached if Bundle A succeeded for both prop-defs.
	// Canary first (Bentham note B): touch ONE member, hard-verify exactly one
	// _sharing value survives, before committing to the other 244. Throws (not a
	// ledger entry) on failure — the full sweep must never run on an unproven
	// mechanic.
	const [canaryTarget, ...restTargets] = memberTargets;
	const canaryEntry = await touchSaveCanary(cfg, canaryTarget);
	const restEntries = await touchSaveDomainMembers(cfg, restTargets);
	ledger.recordTouch([canaryEntry, ...restEntries]);

	ledger.printReport();
	const artifactPath = writeResultArtifact({
		dryRun: false,
		memberTypeSharingCheck: "PASSED — member TYPE entity's own _sharing confirmed live (Bentham YELLOW-A guard, verifyMemberTypeSharing)",
		canaryMemberId: canaryTarget.memberId,
		propDefTargets: [
			{ id: '69c7ea4b8489bfcb0e819f05', name: 'person' },
			{ id: '69c7ea4c8489bfcb0e819f27', name: 'section' }
		],
		domainMemberCount: memberTargets.length,
		...ledger.toJSON(),
		exitCode: ledger.hasFailures() ? 1 : 0,
		verificationCaveat:
			"Run under ENTU_API_KEY (PO/db-root), which always reads the private bucket regardless of prop-def sharing (cleanupEntity's first branch matches on _owner). 'touched'/'set' here means the write landed and rotated the property _id (proof of a fresh aggregateEntity run), NOT an empirically-confirmed domain-bucket read by a non-owner reader. That last-mile confirmation needs a real non-omniscient browser session (Mihkel), same pattern as #20/#29."
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('#20 widen-member-refs ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
