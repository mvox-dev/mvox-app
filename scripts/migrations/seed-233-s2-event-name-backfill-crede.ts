// mvox-app#233 S2 — backfill every crede event's `name` value into
// `event_name`. The data-loss fence's FIRST half: this backfill must be
// complete before S4 turns `name` into a formula (a formula overwrites the
// stored value on every save and silently drops POSTs — run it first and
// every existing name is destroyed).
//
// Crede ONLY, ONE script (the `-crede-`/`-polyphony-` twin pattern ended at
// S1 — estate ruling, Mihkel 2026-09-18, folded into the #233 body).
//
// `runSeed233S2(cfg, dryRun, fetchImpl)` is the whole contract, pinned by
// `seed-233-s2-event-name-backfill-crede.spec.ts`: side-effect-free on
// import (no top-level network call — `main()` below only runs when this
// file is executed directly, guarded by the `isMainModule` check at the
// bottom, same pattern as S1).
//
// CENSUS: one db-wide GET, NO `_parent.reference=` scoping — S2 must cover
// every crede event, whatever it hangs under. Hard-throws when the reported
// `count` disagrees with the returned entity count (tidy-td2c's
// census-truncated guard): a silently truncated census would leave
// unmigrated events for S4's formula to blank.
//
// IDEMPOTENCE = THREE RULES (#233 body, 'The re-run that can undo the
// ordering'), in this precedence:
//   1. `event_name` already holds a non-empty value -> 'already-migrated',
//      NO write. This branch runs FIRST: the closing-sweep re-run happens
//      after S3 has been live for a while, so events created since carry
//      `event_name` and NO `name` at all — a naive copy would write an
//      empty `name` over a good `event_name`, and S4's formula would then
//      render them nameless.
//   2. else `name` absent OR empty/whitespace -> 'no-name', NO write —
//      NEVER write an empty value.
//   3. only then POST.
//
// LIVE WRITE per migrated event: `POST entity/{id}` with
// `[{ type: 'event_name', string: <name> }]`, then a 3-check read-back
// canary (tidy-td2c's touch-save shape): (a) the POST response carries the
// new `event_name` property _id, (b) re-GET reads back a value EQUAL to the
// source name, (c) exactly ONE value. Any check failing marks the event
// failed in the ledger, then throws — never a false 'migrated'.
//
// RE-RUN posture: this script is re-run immediately before S4 as the
// closing sweep. A re-run that writes ZERO and skips ALL is the HEALTHY
// outcome and reads as one: `rerun: true` when `migrated === 0`,
// `failed === 0` and `total > 0`. The `failed === 0` term is load-bearing,
// not defensive: the canary path pushes the event into `failedIds`, writes
// the ledger and THROWS, so an ABORTED run whose very first migration
// failed also has `migrated === 0` — without that term the crash artefact
// would carry the exact flag the closing sweep reads as 'healthy, nothing
// left to do'. `rerun: true` means 'wrote nothing AND nothing went wrong'.
//
// DRY-RUN counts are keyed SEPARATELY — `wouldMigrate`/`wouldMigrateIds`,
// never `migrated`/`migratedIds`. Each live step commits a tracked ledger
// twin, so a dry and a live artefact for the same step sit side by side in
// git; if both spelled the plan `migrated: 1`, only the sibling `dryRun`
// boolean would tell a reader that one of them never touched a thing. A
// count named for what happened cannot be misread.
//
// Ledger: every live step on the real-personal-data pilot commits a result
// ledger through #402's committed-allowlist writer — `sensitive: true`
// routes the instance file to gitignored crede-instance/, `committed.allow`
// builds the tracked twin. `name` is a DEFAULT_REDACT_FIELDS member, so the
// payload is keyed by eventId/outcome/counts — never a key named `name`,
// never a name value anywhere in the ledger call.
//
// Authorization: PO-Approved via the #233 estate ruling (Mihkel, 2026-09-18,
// via Gama comment 5728594975) for the definition and scope; team-lead's
// explicit "I authorize this run" gates DRY_RUN=false separately, per the
// standing two-step gate (crede is real PII — routine pre-authorization
// covers polyphony's synthetic data only).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s2-event-name-backfill-crede.ts        # DRY_RUN=true default
//   DRY_RUN=false node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s2-event-name-backfill-crede.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { readDryRun, loadCredeCfg } from './lib/script-runner';
import { writeLedger as writeLedgerShared } from './lib/ledger-writer';

type Outcome = 'would-migrate' | 'migrated' | 'already-migrated' | 'no-name';

interface CensusEvent {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
}

export interface RunSeed233S2Counts {
	total: number;
	/** LIVE runs only — events written and read-back-verified. Absent on a dry run. */
	migrated?: number;
	/** DRY runs only — events a live run would write. Absent on a live run. */
	wouldMigrate?: number;
	alreadyMigrated: number;
	noName: number;
	failed: number;
}

export interface RunSeed233S2Result {
	counts: RunSeed233S2Counts;
	rerun: boolean;
	outcomes: Array<{ eventId: string; outcome: Outcome }>;
	ledgerPath: string;
}

// The exact allowlist the committed twin is built from — ids, counts and
// outcomes only; no DEFAULT_REDACT_FIELDS member, no `string`.
const COMMITTED_ALLOW = [
	'dryRun',
	'rerun',
	'counts',
	'total',
	'migrated',
	'wouldMigrate',
	'alreadyMigrated',
	'noName',
	'failed',
	'migratedIds',
	'wouldMigrateIds',
	'alreadyMigratedIds',
	'noNameIds',
	'failedIds'
] as const;

function isNonEmpty(value: string | undefined): value is string {
	return value !== undefined && value.trim().length > 0;
}

export async function runSeed233S2(
	cfg: EntuCfg,
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch
): Promise<RunSeed233S2Result> {
	const censusRes = await entuFetch(
		cfg.db,
		'entity?_type.string=event&props=name,event_name&limit=10000',
		cfg.token,
		{},
		fetchImpl
	);
	if (!censusRes.ok) {
		throw new Error(`runSeed233S2: census GET failed: ${censusRes.status}`);
	}
	const censusBody = (await censusRes.json()) as { count: number; entities: CensusEvent[] };
	if (censusBody.count !== censusBody.entities.length) {
		throw new Error(
			`runSeed233S2: census truncated -- count=${censusBody.count} entities=${censusBody.entities.length}. Raise limit.`
		);
	}

	const total = censusBody.entities.length;
	const outcomes: Array<{ eventId: string; outcome: Outcome }> = [];
	// Events this run WROTE (live) or WOULD write (dry) — one accumulator,
	// spelled out under the run-appropriate key at ledger/result time.
	const migrateIds: string[] = [];
	const alreadyMigratedIds: string[] = [];
	const noNameIds: string[] = [];
	const failedIds: string[] = [];

	function buildCounts(): RunSeed233S2Counts {
		return {
			total,
			...(dryRun ? { wouldMigrate: migrateIds.length } : { migrated: migrateIds.length }),
			alreadyMigrated: alreadyMigratedIds.length,
			noName: noNameIds.length,
			failed: failedIds.length
		};
	}

	/** The healthy closing-sweep zero: wrote nothing AND nothing went wrong. */
	function isRerun(): boolean {
		return migrateIds.length === 0 && failedIds.length === 0 && total > 0;
	}

	function buildPayload(): Record<string, unknown> {
		return {
			dryRun,
			rerun: isRerun(),
			counts: buildCounts(),
			...(dryRun ? { wouldMigrateIds: migrateIds } : { migratedIds: migrateIds }),
			alreadyMigratedIds,
			noNameIds,
			failedIds
		};
	}

	function writeLedgerNow(): string {
		return writeLedgerShared({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			committed: { allow: COMMITTED_ALLOW },
			payload: buildPayload()
		});
	}

	for (const event of censusBody.entities) {
		const eventNameValue = event.event_name?.[0]?.string;
		if (isNonEmpty(eventNameValue)) {
			outcomes.push({ eventId: event._id, outcome: 'already-migrated' });
			alreadyMigratedIds.push(event._id);
			continue;
		}

		const nameValue = event.name?.[0]?.string;
		if (!isNonEmpty(nameValue)) {
			outcomes.push({ eventId: event._id, outcome: 'no-name' });
			noNameIds.push(event._id);
			continue;
		}

		if (dryRun) {
			outcomes.push({ eventId: event._id, outcome: 'would-migrate' });
			migrateIds.push(event._id);
			continue;
		}

		try {
			const postRes = await entuFetch(
				cfg.db,
				`entity/${event._id}`,
				cfg.token,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify([{ type: 'event_name', string: nameValue }])
				},
				fetchImpl
			);
			if (!postRes.ok) {
				throw new Error(`runSeed233S2: POST entity/${event._id} failed: ${postRes.status}`);
			}
			const postBody = (await postRes.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newProp = (postBody.properties ?? []).find((p) => p.type === 'event_name');
			if (!newProp?._id) {
				throw new Error(
					`runSeed233S2: POST response for ${event._id} carries no event_name property _id (canary a)`
				);
			}

			const readRes = await entuFetch(cfg.db, `entity/${event._id}?props=event_name`, cfg.token, {}, fetchImpl);
			if (!readRes.ok) {
				throw new Error(`runSeed233S2: read-back GET for ${event._id} failed: ${readRes.status}`);
			}
			const readBody = (await readRes.json()) as {
				entity?: { event_name?: Array<{ _id: string; string?: string }> };
			};
			const readValues = readBody.entity?.event_name ?? [];
			if (readValues.length !== 1) {
				throw new Error(
					`runSeed233S2: READ-BACK for ${event._id} holds ${readValues.length} event_name value(s) (expected exactly 1, canary c)`
				);
			}
			if (readValues[0]?.string !== nameValue) {
				throw new Error(
					`runSeed233S2: READ-BACK mismatch for ${event._id}: expected '${nameValue}', got '${readValues[0]?.string}' (canary b)`
				);
			}

			outcomes.push({ eventId: event._id, outcome: 'migrated' });
			migrateIds.push(event._id);
		} catch (err) {
			failedIds.push(event._id);
			writeLedgerNow();
			throw err;
		}
	}

	const ledgerPath = writeLedgerNow();

	return { counts: buildCounts(), rerun: isRerun(), outcomes, ledgerPath };
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed233S2(cfg, DRY_RUN);

	const migrateLine = DRY_RUN
		? `wouldMigrate=${result.counts.wouldMigrate}`
		: `migrated=${result.counts.migrated}`;
	console.log(
		`events: total=${result.counts.total} ${migrateLine} ` +
			`alreadyMigrated=${result.counts.alreadyMigrated} noName=${result.counts.noName} ` +
			`failed=${result.counts.failed} rerun=${result.rerun}`
	);
	console.log(`Ledger: ${result.ledgerPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error('seed-233-s2-event-name-backfill-crede ABORTED:', err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
