// T3.1 (#17) migration ENTRYPOINT — provision the 128 synthetic singers: domain
// `profile` entities (Bundle 1) + `member` tier conversion private→domain (Bundle
// 2). §8.6 authorization recorded on #17 (Owner: Pérotin, live, authorized). The
// tested engine lives in `lib/t3-1-singer-provision.ts`; this file wires
// credentials + the DRY_RUN switch + bundle sequencing.
//
// ─────────────────────────────────────────────────────────────────────────────
// SAFETY: DRY_RUN defaults TRUE. Bundle 2 is gated on Bundle 1 succeeding for
// EVERY target — a partial Bundle 1 must never let Bundle 2 run (see
// t3-1-singer-provision.ts's header comment for why).
// ─────────────────────────────────────────────────────────────────────────────
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   pnpm run migrate:t3-1:dry     # DRY_RUN=true  (safe; the operator's verify surface)
//   pnpm run migrate:t3-1:live    # DRY_RUN=false (ONLY after the #17 §8.6 authorization)

import { loadCfg } from './lib/creds';
import {
	enumerateSingerTargets,
	provisionDomainProfiles,
	convertMemberTiers,
	renderPlan,
	ProvisionLedger
} from './lib/t3-1-singer-provision';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

async function main(): Promise<void> {
	const cfg = await loadCfg();

	// Step-0 enumeration (READ-ONLY) + drift/precheck guards — HALTs loudly.
	const targets = await enumerateSingerTargets(cfg);

	if (DRY_RUN) {
		console.log(renderPlan(targets));
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute (gated).');
		process.exit(0);
	}

	const ledger = new ProvisionLedger();

	// Bundle 1 — profile creates. Run for ALL targets before touching Bundle 2.
	const profileEntries = await provisionDomainProfiles(cfg, targets);
	ledger.recordProfile(profileEntries);

	if (ledger.profileFailures().length > 0) {
		console.error(`Bundle 1 had ${ledger.profileFailures().length} failure(s) — Bundle 2 (tier conversion) will NOT run.`);
		ledger.printReport();
		process.exit(1);
	}

	// Bundle 2 — tier conversion. Only reached if Bundle 1 succeeded for every target.
	const tierEntries = await convertMemberTiers(cfg, targets);
	ledger.recordTier(tierEntries);

	ledger.printReport();
	process.exit(ledger.hasFailures() ? 1 : 0);
}

main().catch((err) => {
	console.error('T3.1 singer provisioning ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
