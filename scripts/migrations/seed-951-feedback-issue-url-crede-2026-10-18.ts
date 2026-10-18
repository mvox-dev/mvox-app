// #951: add the multi-value `issue_url` prop-def to the feedback type on mvox_crede; no instances.

// Run: node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <this file>;
// DRY_RUN=false needs AUTHORIZED_BY.
import { pathToFileURL } from 'node:url';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import {
	resolveMetaTypeIds,
	resolveTypeIdByName,
	ensurePropDef,
	assertPropDefSharing,
	type LedgerStep
} from './lib/ensure-schema-type';
import { feedback } from './lib/mvox-schema-extensions';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger, assertLiveRunAuthorized } from './lib/ledger-writer';

const PROP = feedback.properties.find((p) => p.name === 'issue_url');

export interface RunSeed951Result {
	typeId: string;
	propDefId: string | null;
	ledger: LedgerStep[];
	ledgerPath: string;
}

export async function runSeed951(
	cfg: EntuCfg,
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string
): Promise<RunSeed951Result> {
	assertLiveRunAuthorized(dryRun, authorizedBy);
	if (!PROP?.list) throw new Error('feedback.issue_url is missing or not multi-value in the schema of record');

	const ledger: LedgerStep[] = [];
	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);
	const typeId = await resolveTypeIdByName(cfg, entityMetaTypeId, feedback.name, fetchImpl);

	const propDefId = await ensurePropDef(cfg, propertyMetaTypeId, typeId, feedback.name, feedback.sharing, PROP, dryRun, ledger, fetchImpl);
	if (propDefId) {
		await assertPropDefSharing(cfg, propDefId, `${feedback.name}.${PROP.name}`, PROP.sharing ?? feedback.sharing, ledger, fetchImpl);
	}

	const ledgerPath = writeLedger({
		scriptName: 'seed-951-feedback-issue-url-crede',
		dryRun,
		db: cfg.db,
		sensitive: false,
		acknowledgedNonSensitive: true,
		authorizedBy,
		payload: { typeId, propDefId, instancesCreated: 0, ledger }
	});
	return { typeId, propDefId, ledger, ledgerPath };
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed951(cfg, DRY_RUN, fetch, readAuthorizedBy());
	console.log(`feedback type-def: ${result.typeId}`);
	console.log(`  feedback.issue_url: ${result.propDefId ?? '(would create — dry-run)'}`);
	console.log(`Ledger: ${result.ledgerPath}`);
	process.exit(result.ledger.some((e) => e.outcome === 'failed') ? 1 : 0);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('seed-951-feedback-issue-url-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
