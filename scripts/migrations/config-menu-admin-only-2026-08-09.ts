// #70 (#37) ENTRYPOINT — restrict the 3 domain-shared Configuration menu
// entries (Entities, Menu, Plugins) to admin-only, matching Billing's
// existing shape. DRY_RUN=true by default. §8.6 chain: dry-run → review →
// team-lead's explicit "I authorize this run" → live.
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   export PUBLIC_ENTU_API_BASE="${ENTU_API_URL%/}/"
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/config-menu-admin-only-2026-08-09.ts       # DRY_RUN=true default
//   DRY_RUN=false node --import tsx ... same-file                    # ONLY after team-lead's explicit authorization

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCfg } from './lib/creds';
import { verifyAll, privatizeMenuEntries, renderPlan } from './lib/config-menu-admin-only-2026-08-09';

const DRY_RUN = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';

function writeResultArtifact(payload: Record<string, unknown>): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dir = join('scripts', 'migrations', 'seed-results');
	const filename = `config-menu-admin-only-2026-08-09-${DRY_RUN ? 'dry' : 'live'}-${timestamp}.json`;
	const filePath = join(dir, filename);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function main(): Promise<void> {
	const cfg = await loadCfg();
	const v = await verifyAll(cfg);

	if (DRY_RUN) {
		const plan = renderPlan(v);
		console.log(plan);
		console.log('DRY_RUN=true — no writes issued. Set DRY_RUN=false to execute ONLY after team-lead\'s explicit "I authorize this run".');
		const artifactPath = writeResultArtifact({ dryRun: true, verified: v, writesIssued: 0, exitCode: 0 });
		console.log(`Dry-run artifact: ${artifactPath}`);
		process.exit(0);
	}

	const entries = await privatizeMenuEntries(cfg, v.targets);
	const failures = entries.filter((e) => e.status !== 'privatized');
	console.log(`\n── Menu privatize: ${entries.length} attempted`);
	for (const e of failures) console.error(`FAILED ${e.name} (${e.menuId}) — ${e.message}`);
	console.log(`${entries.length - failures.length}/${entries.length} privatized cleanly.`);
	if (failures.length > 0) {
		console.error(`#70 INCOMPLETE — ${failures.length} failure(s) need operator repair.`);
	}

	const artifactPath = writeResultArtifact({
		dryRun: false,
		referenceCheck: v.referenceCheck,
		entries,
		failureCount: failures.length,
		exitCode: failures.length > 0 ? 1 : 0,
		verificationCaveat:
			'Run under ENTU_API_KEY (db-root). Member-seat visibility was NOT empirically observed — no working member-seat credential exists locally (per #44/#47). Acceptance item 3 stages that confirmation for the next Mihkel sitting.'
	});
	console.log(`Result artifact: ${artifactPath}`);
	process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('#70 config-menu-admin-only ABORTED:', err instanceof Error ? err.message : String(err));
	process.exit(1);
});
