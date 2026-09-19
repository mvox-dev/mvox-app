// mvox-app#233 S1 — `event_name` prop-def on the EXISTING canonical `event`
// type, crede ONLY. The estate ruling (Mihkel 2026-09-18, folded into the
// #233 body) ends the per-collective twin-script pattern that every earlier
// schema change used (seed-246, seed-256, seed-265, seed-282): ONE script
// per step, crede only — no other collective receives this or any further
// schema change.
//
// SHARING + ORDINAL ARE NOT KNOWN from any committed artefact — this script
// reads the live `event.name` prop-def FIRST and DERIVES event_name's
// posture from it: `_sharing` MIRRORS event.name's, `ordinal` sits ADJACENT
// (name's ordinal + 1). Nothing hardcoded, nothing omit-and-inherited (the
// #265 inherit-from-parent trap) — the prop-def's identity (name, wire type,
// descriptions) is sourced from the schema of record, `event_name` in
// `lib/mvox-schema-extensions.ts`, not inlined here.
//
// `runSeed233S1(cfg, dryRun, fetchImpl)` is the whole contract, pinned by
// `seed-233-s1-event-name-propdef-crede.spec.ts`: side-effect-free on import
// (no top-level network call — `main()` below only runs when this file is
// executed directly, guarded by the `isMainModule` check at the bottom, same
// pattern as scripts/roadmap/render.ts), so importing it from a test never
// attempts `loadCredeCfg` or a live fetch — the network guard would fail the
// suite loudly if it did.
//
// EMPTY STRUCTURE ONLY. mvox_crede is a real-life pilot holding real
// people's personal data — this script adds one prop-def to the schema; it
// creates zero instance data (S2, a separate script, does the backfill).
//
// Ledger: every live step on the real-personal-data pilot commits a result
// ledger through #402's committed-allowlist writer — `sensitive: true`
// routes the instance file to gitignored crede-instance/, `committed.allow`
// builds the tracked twin by allowlist. `name` is a DEFAULT_REDACT_FIELDS
// member, so the payload is keyed by typeId/propDefId/outcome/sharing/
// ordinal/dryRun — never a key named `name`.
//
// Authorization: PO-Approved via the #233 estate ruling (Mihkel, 2026-09-18,
// via Gama comment 5728594975) for the definition and scope; team-lead's
// explicit "I authorize this run" gates DRY_RUN=false separately, per the
// standing two-step gate (crede is real PII — routine pre-authorization
// covers synthetic-db work only).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s1-event-name-propdef-crede.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s1-event-name-propdef-crede.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
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

	// Live posture of the EXISTING `name` prop-def — the ONLY source
	// event_name's sharing/ordinal may be derived from (never hardcoded,
	// never omitted — the #265 inherit-from-parent trap).
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
