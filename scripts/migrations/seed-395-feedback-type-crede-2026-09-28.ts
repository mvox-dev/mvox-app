// #395: provision the feedback type-def and its three prop-defs on mvox_crede; no instances.

// Every write's `_sharing` is set explicitly and read back. Run: node --import tsx --import
// ./scripts/migrations/lib/register-loader.mjs <this file>; DRY_RUN=false needs AUTHORIZED_BY.
import { pathToFileURL } from 'node:url';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import {
	resolveMetaTypeIds,
	resolveTypeIdByName,
	ensureEntityType,
	ensurePropDef,
	assertPropDefSharing,
	type LedgerStep
} from './lib/ensure-schema-type';
import { feedback, type PropertySpec } from './lib/mvox-schema-extensions';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

// The fields #395 provisioned; later ones (#611's metadata) were added on crede by hand.
const SEED_395_FIELDS = ['screenshot', 'doodle_layer', 'description'];
const FIELDS = feedback.properties.filter((p) => SEED_395_FIELDS.includes(p.name));

const TYPE_LABEL_EN = 'Feedback';
const TYPE_LABEL_ET = 'Tagasiside';
const TYPE_DESCRIPTION_EN =
	"A member's feedback on the app: a screenshot, ink drawn over it, and a description. Created by the member with their own key. mvox app extension — not part of the canonical v4E schema.";
const TYPE_DESCRIPTION_ET =
	'Liikme tagasiside rakenduse kohta: kuvatõmmis, sellele joonistatud märkused ja kirjeldus. Liige loob selle oma võtmega. Mvoxi rakenduse laiendus — ei kuulu v4E baasstruktuuri hulka.';

const PENDING_TYPE = '<feedback type-def id, assigned at create>';

function typeCreateBody(entityMetaTypeId: string): unknown[] {
	return [
		{ type: '_type', reference: entityMetaTypeId },
		{ type: 'name', string: feedback.name },
		{ type: 'label', language: 'en', string: TYPE_LABEL_EN },
		{ type: 'label', language: 'et', string: TYPE_LABEL_ET },
		{ type: 'description', language: 'en', string: TYPE_DESCRIPTION_EN },
		{ type: 'description', language: 'et', string: TYPE_DESCRIPTION_ET },
		{ type: '_inheritrights', boolean: feedback.inheritsRights },
		{ type: '_sharing', string: feedback.sharing }
	];
}

function propCreateBody(propertyMetaTypeId: string, parentId: string, prop: PropertySpec): unknown[] {
	const effectiveSharing = prop.sharing ?? feedback.sharing;
	const body: Array<Record<string, unknown>> = [
		{ type: '_type', reference: propertyMetaTypeId },
		{ type: '_parent', reference: parentId },
		{ type: 'name', string: prop.name },
		{ type: 'type', string: prop.type },
		{ type: '_sharing', string: effectiveSharing },
		{ type: 'description', language: 'en', string: prop.descriptionEn },
		{ type: 'description', language: 'et', string: prop.descriptionEt }
	];
	if (prop.required) body.push({ type: 'mandatory', boolean: true });
	if (prop.ordinal !== undefined) body.push({ type: 'ordinal', number: prop.ordinal });
	if (prop.table) body.push({ type: 'table', boolean: true });
	if (prop.search) body.push({ type: 'search', boolean: true });
	return body;
}

export interface PlannedWrite {
	target: string;
	body: unknown[];
}

export interface RunSeed395Result {
	memberTypeId: string;
	typeId: string | null;
	propDefIds: { screenshot: string | null; doodle_layer: string | null; description: string | null };
	plannedWrites: PlannedWrite[];
	ledger: LedgerStep[];
	ledgerPath: string;
}

export async function runSeed395(
	cfg: EntuCfg,
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string
): Promise<RunSeed395Result> {
	assertLiveRunAuthorized(dryRun, authorizedBy);

	const ledger: LedgerStep[] = [];
	const plannedWrites: PlannedWrite[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);

	const memberTypeId = await resolveTypeIdByName(cfg, entityMetaTypeId, feedback.parents[0].entity, fetchImpl);

	const typeId = await ensureEntityType(
		cfg,
		entityMetaTypeId,
		{
			name: feedback.name,
			sharing: feedback.sharing,
			inheritsRights: feedback.inheritsRights,
			labelEn: TYPE_LABEL_EN,
			labelEt: TYPE_LABEL_ET,
			descriptionEn: TYPE_DESCRIPTION_EN,
			descriptionEt: TYPE_DESCRIPTION_ET
		},
		dryRun,
		ledger,
		fetchImpl
	);

	const typeOutcome = ledger.find((e) => e.action === 'ensure-type' && e.target === feedback.name)?.outcome;
	if (typeOutcome !== 'found') {
		plannedWrites.push({ target: feedback.name, body: typeCreateBody(entityMetaTypeId) });
	}

	if (typeId !== null) {
		await assertPropDefSharing(cfg, typeId, feedback.name, feedback.sharing, ledger, fetchImpl);
	}

	const propDefIds: { screenshot: string | null; doodle_layer: string | null; description: string | null } = {
		screenshot: null,
		doodle_layer: null,
		description: null
	};

	for (const prop of FIELDS) {
		const label = `${feedback.name}.${prop.name}`;
		const effectiveSharing = prop.sharing ?? feedback.sharing;

		if (typeId === null) {
			plannedWrites.push({ target: label, body: propCreateBody(propertyMetaTypeId, PENDING_TYPE, prop) });
			ledger.push({
				action: 'ensure-propdef',
				target: label,
				outcome: 'dry-run',
				after: { type: prop.type, sharing: effectiveSharing, mandatory: prop.required ?? false }
			});
			continue;
		}

		const propId = await ensurePropDef(cfg, propertyMetaTypeId, typeId, feedback.name, feedback.sharing, prop, dryRun, ledger, fetchImpl);
		const propOutcome = ledger.find((e) => e.action === 'ensure-propdef' && e.target === label)?.outcome;
		if (propOutcome !== 'found') {
			plannedWrites.push({ target: label, body: propCreateBody(propertyMetaTypeId, typeId, prop) });
		}
		(propDefIds as Record<string, string | null>)[prop.name] = propId;

		if (propId) {
			await assertPropDefSharing(cfg, propId, label, effectiveSharing, ledger, fetchImpl);
		}
	}

	const payload = {
		memberTypeId,
		typeId,
		propDefIds,
		plannedWrites,
		instancesCreated: 0,
		ledger
	};

	const ledgerPath = writeLedgerShared({
		scriptName: 'seed-395-feedback-type-crede',
		dryRun,
		db: cfg.db,
		sensitive: false,
		acknowledgedNonSensitive: true,
		authorizedBy,
		payload
	});

	return { memberTypeId, typeId, propDefIds, plannedWrites, ledger, ledgerPath };
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const AUTHORIZED_BY = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed395(cfg, DRY_RUN, fetch, AUTHORIZED_BY);

	console.log(`member type-def: ${result.memberTypeId}`);
	console.log(`feedback type-def: ${result.typeId ?? '(would create — dry-run)'}`);
	for (const prop of FIELDS) {
		const id = result.propDefIds[prop.name as 'screenshot' | 'doodle_layer' | 'description'];
		console.log(`  feedback.${prop.name}: ${id ?? '(would create — dry-run)'}`);
	}
	console.log(`\n${result.plannedWrites.length} planned write(s), ${result.ledger.length} ledger step(s)`);
	console.log(`Ledger: ${result.ledgerPath}`);

	const failures = result.ledger.filter((e) => e.outcome === 'failed');
	process.exit(failures.length > 0 ? 1 : 0);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('seed-395-feedback-type-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
