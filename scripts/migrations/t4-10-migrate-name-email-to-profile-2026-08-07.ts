// T4.10 migration ENTRYPOINT (issue mvox-dev/mvox-app#30, epic #21) — thin.
//
// Moves the `name`/`email` VALUES off the 3 REAL persons into `profile` entities
// (create-before-delete, per-record read-back, fail-loud). The tested engine lives in
// `lib/t4-10-plan.ts`; this file only wires credentials + the DRY_RUN switch.
//
// ─────────────────────────────────────────────────────────────────────────────
// SAFETY: DRY_RUN defaults TRUE. This workflow BUILDS the script; it does NOT run it
// against live polyphony. Live execution (either mode) is a SEPARATE gated step —
// team-lead per-run verify recorded on #30 + Perotin runs it. An agent may run
// DRY_RUN only against a mock/local fetch, never live.
// ─────────────────────────────────────────────────────────────────────────────
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   pnpm run migrate:t4-10:dry     # DRY_RUN=true  (safe; the operator's verify surface)
//   pnpm run migrate:t4-10:live    # DRY_RUN=false (ONLY after the #30 per-run gate)

import { loadCfg } from './lib/creds';
import {
	MigrationLedger,
	buildPlan,
	enumerateTargets,
	migrateOneGroup,
	renderPlan
} from './lib/t4-10-plan';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step-0 enumeration (READ-ONLY) + drift/one-page guards — HALTs loudly on drift.
	const targets = await enumerateTargets(cfg);
	const groups = buildPlan(targets);

	if (DRY_RUN) {
		console.log(renderPlan(groups));
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated).');
		process.exit(0);
	}

	// Execute: per-record move engine → fail-loud per-record ledger. Never an
	// aggregate "done" that masks a per-record failure.
	const ledger = new MigrationLedger();
	for (const group of groups) {
		const entries = await migrateOneGroup(cfg, group);
		for (const entry of entries) ledger.record(entry);
	}
	ledger.printReport();
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('T4.10 migration ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
