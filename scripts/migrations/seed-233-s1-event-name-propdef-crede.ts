// #233 S1: adds the `event_name` prop-def to crede's `event` type; schema only, no instance data.
// Its sharing mirrors the live `event.name` prop-def and its ordinal sits right after it.
// PO-Approved: #233 estate ruling (Mihkel 2026-09-18, via Gama comment 5728594975), crede only.

// Dry-run first: node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <file>
// Live: DRY_RUN=false, only on team-lead's "I authorize this run" (crede holds real PII).

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import {
	resolveMetaTypeIds,
	resolveTypeIdByName,
	ensurePropDef,
	assertPropDefSharing,
	type LedgerStep
} from './lib/ensure-schema-type';
import { event_name, type PropertySpec, type Sharing } from './lib/mvox-schema-extensions';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

export interface RunSeed233S1Result {
	typeId: string;
	propDefId: string | null;
	outcome: 'dry-run' | 'found' | 'created';
	sharing: Sharing;
	ordinal: number;
	ledgerPath: string;
}

export async function runSeed233S1(
	cfg: EntuCfg,
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string
): Promise<RunSeed233S1Result> {
	// mvox-app#417 — before the first mutating call (ensurePropDef below).
	assertLiveRunAuthorized(dryRun, authorizedBy);

	const ledger: LedgerStep[] = [];

	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);
	const typeId = await resolveTypeIdByName(cfg, entityMetaTypeId, event_name.onType, fetchImpl);

	// The only source for event_name's sharing/ordinal: never hardcoded, never omitted,
	// since an omitted one inherits from the parent.
	const nameRes = await entuFetch(
		cfg.db,
		`entity?_type.reference=${propertyMetaTypeId}&_parent.reference=${typeId}&name.string=name&props=_sharing,ordinal&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!nameRes.ok) {
		throw new Error(`runSeed233S1: live '${event_name.onType}.name' prop-def GET failed: ${nameRes.status}`);
	}
	const nameBody = (await nameRes.json()) as {
		entities?: Array<{ _sharing?: Array<{ string?: string }>; ordinal?: Array<{ number?: number }> }>;
	};
	const liveNameSharing = nameBody.entities?.[0]?._sharing?.[0]?.string as Sharing | undefined;
	const liveNameOrdinal = nameBody.entities?.[0]?.ordinal?.[0]?.number;
	if (!liveNameSharing) {
		throw new Error(
			`runSeed233S1: live '${event_name.onType}.name' prop-def has no readable _sharing — cannot derive event_name's posture`
		);
	}
	if (liveNameOrdinal === undefined) {
		throw new Error(
			`runSeed233S1: live '${event_name.onType}.name' prop-def has no readable ordinal — cannot derive event_name's posture`
		);
	}

	const derivedOrdinal = liveNameOrdinal + 1; // pinned adjacency rule

	const prop: PropertySpec = { ...event_name.property, ordinal: derivedOrdinal };
	const label = `${event_name.onType}.${prop.name}`;

	const propId = await ensurePropDef(
		cfg,
		propertyMetaTypeId,
		typeId,
		event_name.onType,
		liveNameSharing,
		prop,
		dryRun,
		ledger,
		fetchImpl
	);

	const outcome = (ledger.find((e) => e.action === 'ensure-propdef' && e.target === label)?.outcome ??
		'dry-run') as 'dry-run' | 'found' | 'created';

	// Read-back still runs on an already-found prop-def, not just a freshly
	// created one — its live sharing must still match the mirror rule.
	if (propId) {
		await assertPropDefSharing(cfg, propId, label, liveNameSharing, ledger, fetchImpl);
	}

	const payload = {
		typeId,
		propDefId: propId,
		outcome,
		sharing: liveNameSharing,
		ordinal: derivedOrdinal,
		dryRun
	};

	const ledgerPath = writeLedgerShared({
		scriptName: 'seed-233-s1-event-name-propdef-crede',
		dryRun,
		db: cfg.db,
		sensitive: true,
		authorizedBy,
		committed: { allow: ['typeId', 'propDefId', 'outcome', 'sharing', 'ordinal', 'dryRun'] },
		payload
	});

	return { typeId, propDefId: propId, outcome, sharing: liveNameSharing, ordinal: derivedOrdinal, ledgerPath };
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const AUTHORIZED_BY = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed233S1(cfg, DRY_RUN, fetch, AUTHORIZED_BY);

	console.log(
		`event.event_name prop-def: ${result.propDefId ?? '(would create — dry-run)'} ` +
			`outcome=${result.outcome} sharing=${result.sharing} ordinal=${result.ordinal}`
	);
	console.log(`Ledger: ${result.ledgerPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('seed-233-s1-event-name-propdef-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
