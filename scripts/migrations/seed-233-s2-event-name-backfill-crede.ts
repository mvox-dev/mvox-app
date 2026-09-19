// mvox-app#233 S2 / mvox-app#419 — backfill every crede event's `name`
// value into `event_name`. The data-loss fence's FIRST half: this backfill
// must be complete before S4 turns `name` into a formula (a formula
// overwrites the stored value on every save and silently drops POSTs — run
// it first and every existing name is destroyed).
//
// Crede ONLY, ONE script (the per-db `-crede-`/`-<other>-` twin-script
// pattern ended at S1 — estate ruling, Mihkel 2026-09-18, folded into the
// #233 body).
//
// `runSeed233S2(cfg, dryRun, fetchImpl, authorizedBy?)` is the whole
// contract, pinned by `seed-233-s2-event-name-backfill-crede.spec.ts`:
// side-effect-free on import (no top-level network call — `main()` below
// only runs when this file is executed directly, guarded by the
// `isMainModule` check at the bottom, same pattern as S1).
//
// `cfg.userId` (mvox-app#419) is the runner identity the /auth exchange in
// `loadCredeCfg` reports for the target db — the rights preflight below
// checks it against each event's `_owner`/`_editor` references.
//
// CENSUS: one db-wide GET, NO `_parent.reference=` scoping — S2 must cover
// every crede event, whatever it hangs under. Hard-throws when the reported
// `count` disagrees with the returned entity count (tidy-td2c's
// census-truncated guard): a silently truncated census would leave
// unmigrated events for S4's formula to blank. The census asks for
// `_owner,_editor` alongside `name,event_name` — Entu returns rights props
// on a list query (precedent: probes/probe-356-crede-conductor-rights-
// 2026-09-15.ts, which lists crede events with exactly those props) — so
// the rights preflight below costs ZERO extra round-trips instead of one
// GET per would-write event. Visibility is identical either way: an event
// the runner holds no rights on comes back without `_owner`/`_editor`,
// which is the signal the check already relies on.
//
// MULTI-VALUED SOURCE STOPS THE STEP (#419 review round 1): Entu string
// props are implicitly multi-valued (POST appends), so `name` and
// `event_name` can each hold more than one value. This script copies ONE;
// S4 then turns `name` into a formula and overwrites what is stored, so a
// second `name` value nobody copied is destroyed — precisely the loss this
// script is the fence against. A second `event_name` value is the same
// surprise read from the other side (the exactly-one-value read-back
// canary covers only values THIS run wrote). So: an event whose `name` or
// `event_name` holds more than one value is collected during
// classification as `multiValue` (id + both counts), given no outcome, and
// a non-empty list stops the run before the rights check and before any
// write — dry and live alike — with ledger outcome 'aborted-multi-value'.
// Same shape and the same reason as the divergence stop: a surprise a
// human decides on, not a state to skip past.
//
// IDEMPOTENCE = THREE RULES (#233 body / #419 amended body), in this
// precedence:
//   1. `event_name` already holds a non-empty value -> a PRESENCE check
//      (Entu's POST appends — a second value must never be written). Equal
//      to `name` (or `name` absent/empty) -> 'already-migrated', NO write,
//      run continues. DIFFERS from a non-empty `name` -> collected as
//      `eventNameDiffers` (id + name + stored value) — see DIVERGENCE
//      below, never written, never skipped past.
//   2. else `name` absent OR empty/whitespace -> 'no-name', NO write —
//      NEVER write an empty value.
//   3. only then POST.
//
// DIVERGENCE STOPS THE STEP (#419 amended body, Gama comment 5742461628):
// when `eventNameDiffers` is non-empty after classification, the run stops
// before any write — dry and live alike — issues no request beyond the
// census, throws, and writes ONE ledger with outcome 'aborted-divergence'
// and the offending list. Nothing writes `event_name` today, so a divergent
// event is a surprise a human decides on, not a state to skip past.
// Multi-value is checked FIRST, before divergence: an event holding two
// `name` values cannot be classified at all, so it never reaches the
// equal/differs comparison.
//
// RIGHTS PREFLIGHT (#419 amended body): before any write, for every event
// that would be written, check `cfg.userId` appears among the `_owner`/
// `_editor` references the census already returned (references only —
// never `.string`, which bakes PII). Events lacking it are collected as
// `noRights` (id + name); non-empty -> stop before any write, throw, ledger
// outcome 'aborted-rights' with the list. Runs on the dry run too, so the
// dry-run report shows missing grants before authorization is sought. The
// whole list is complete before any POST — the report names every missing
// grant, not the first.
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
// An `aborted-divergence`/`aborted-rights` run is never `rerun: true`
// either, for the same reason.
//
// DRY-RUN counts are keyed SEPARATELY — `wouldMigrate`/`wouldMigrateIds`,
// never `migrated`/`migratedIds`. An aborted run (divergence or rights)
// keys the same way on a LIVE run too — nothing was written, so `migrated`
// would name writes that never occurred. Each live step commits a tracked
// ledger twin, so a dry and a live artefact for the same step sit side by
// side in git; if both spelled the plan `migrated: 1`, only the sibling
// `dryRun` boolean would tell a reader that one of them never touched a
// thing. A count named for what happened cannot be misread.
//
// Ledger: every live step on the real-personal-data pilot commits a result
// ledger through #402's committed-allowlist writer — `sensitive: true`
// routes the instance file to gitignored crede-instance/, `committed.allow`
// builds the tracked twin. `name` is a DEFAULT_REDACT_FIELDS member, so the
// payload is keyed by eventId/outcome/counts — never a key named `name`.
// The two value-carrying abort lists (`eventNameDiffers`, `noRights`) carry
// the name values for the operator in the gitignored instance file only —
// the committed allowlist admits `eventId` alone inside them. `multiValue`
// carries no value at all, only ids and counts, so it survives whole.
//
// Authorization: PO-Approved via the #233 estate ruling (Mihkel, 2026-09-18,
// via Gama comment 5728594975) for the definition and scope; mvox-app#417's
// `assertLiveRunAuthorized` gates DRY_RUN=false on a recorded `AUTHORIZED_BY`
// separately, per the standing two-step gate (crede is real PII — routine
// pre-authorization covers synthetic-db data only).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s2-event-name-backfill-crede.ts        # DRY_RUN=true default
//   DRY_RUN=false AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s2-event-name-backfill-crede.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

type Outcome = 'would-migrate' | 'migrated' | 'already-migrated' | 'no-name';

interface CensusEvent {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
	// Rights references ride along on the census (see CENSUS above) — the
	// preflight reads `reference` only; `.string` on these is the person's
	// baked NAME and never leaves this module.
	_owner?: Array<{ reference?: string }>;
	_editor?: Array<{ reference?: string }>;
}

export interface RunSeed233S2Counts {
	total: number;
	/** LIVE runs only — events written and read-back-verified. Absent on a dry run or an aborted run. */
	migrated?: number;
	/** DRY runs, and any aborted run (nothing was written). Absent when `migrated` is present. */
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
// outcomes only; no DEFAULT_REDACT_FIELDS member, no `string`, and not the
// abort lists' value keys (nameValue/storedValue stay in the gitignored
// instance file — `eventId` is the only key that survives inside them).
// 'authorizedBy' is deliberately absent: writeLedger injects it into the
// committed envelope itself, and the fence
// (lib/liveRunAuthorization.guard.spec.ts) rejects an allow entry for it.
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
	'failedIds',
	'outcome',
	'eventId',
	'eventNameDiffers',
	'noRights',
	// multi-value abort list: ids and counts only, no value ever — it is the
	// one abort list that survives into the committed twin intact.
	'multiValue',
	'nameCount',
	'eventNameCount'
] as const;

function isNonEmpty(value: string | undefined): value is string {
	return value !== undefined && value.trim().length > 0;
}

export async function runSeed233S2(
	cfg: EntuCfg & { userId: string },
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string
): Promise<RunSeed233S2Result> {
	// mvox-app#417 — before the census GET, before any request leaves the script.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	const censusRes = await entuFetch(
		cfg.db,
		'entity?_type.string=event&props=name,event_name,_owner,_editor&limit=10000',
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
	// Events classified as needing a write. On a dry run, or an aborted run,
	// this IS the plan (`wouldMigrateIds`). On a completed live run, the
	// events actually written land in `migratedIds` instead — a subset when
	// a canary failure stopped the loop partway through.
	const toWriteIds: string[] = [];
	const nameById = new Map<string, string>();
	const alreadyMigratedIds: string[] = [];
	const noNameIds: string[] = [];
	const failedIds: string[] = [];
	const migratedIds: string[] = [];
	const eventNameDiffers: Array<{ eventId: string; nameValue: string; storedValue: string }> = [];
	const multiValue: Array<{ eventId: string; nameCount: number; eventNameCount: number }> = [];
	// Rights references, straight off the census — the preflight below reads
	// these instead of issuing a GET per would-write event.
	const eventById = new Map<string, CensusEvent>();

	for (const event of censusBody.entities) {
		eventById.set(event._id, event);

		const nameCount = event.name?.length ?? 0;
		const eventNameCount = event.event_name?.length ?? 0;
		if (nameCount > 1 || eventNameCount > 1) {
			// Only value [0] would be read below — the rest would be copied by
			// nobody and blanked by S4's formula. Not classifiable: stop.
			multiValue.push({ eventId: event._id, nameCount, eventNameCount });
			continue;
		}

		const eventNameValue = event.event_name?.[0]?.string;
		const nameValue = event.name?.[0]?.string;

		if (isNonEmpty(eventNameValue)) {
			if (isNonEmpty(nameValue) && nameValue !== eventNameValue) {
				eventNameDiffers.push({ eventId: event._id, nameValue, storedValue: eventNameValue });
				continue;
			}
			outcomes.push({ eventId: event._id, outcome: 'already-migrated' });
			alreadyMigratedIds.push(event._id);
			continue;
		}

		if (!isNonEmpty(nameValue)) {
			outcomes.push({ eventId: event._id, outcome: 'no-name' });
			noNameIds.push(event._id);
			continue;
		}

		outcomes.push({ eventId: event._id, outcome: 'would-migrate' });
		toWriteIds.push(event._id);
		nameById.set(event._id, nameValue);
	}

	function buildCounts(aborted: boolean): RunSeed233S2Counts {
		return {
			total,
			...(dryRun || aborted ? { wouldMigrate: toWriteIds.length } : { migrated: migratedIds.length }),
			alreadyMigrated: alreadyMigratedIds.length,
			noName: noNameIds.length,
			failed: failedIds.length
		};
	}

	function buildIdsField(aborted: boolean): Record<string, string[]> {
		return dryRun || aborted ? { wouldMigrateIds: toWriteIds } : { migratedIds };
	}

	function writeAbortLedger(extra: Record<string, unknown>): string {
		return writeLedgerShared({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun,
				rerun: false,
				counts: buildCounts(true),
				...buildIdsField(true),
				alreadyMigratedIds,
				noNameIds,
				failedIds,
				...extra
			}
		});
	}

	if (multiValue.length > 0) {
		writeAbortLedger({ outcome: 'aborted-multi-value', multiValue });
		throw new Error(
			`runSeed233S2: ${multiValue.length} event(s) hold more than one name/event_name value -- only one ` +
				`would be copied and S4's formula would blank the rest -- stopping before any write: ` +
				`${multiValue.map((m) => m.eventId).join(', ')}`
		);
	}

	if (eventNameDiffers.length > 0) {
		writeAbortLedger({ outcome: 'aborted-divergence', eventNameDiffers });
		throw new Error(
			`runSeed233S2: ${eventNameDiffers.length} event(s) hold an event_name that diverges from name -- ` +
				`stopping before any write: ${eventNameDiffers.map((d) => d.eventId).join(', ')}`
		);
	}

	// mvox-app#419 rights preflight — the whole list is built before any
	// write is allowed to happen, on the dry run too. The references come off
	// the census (zero extra round-trips); an event the runner holds no
	// rights on returns without `_owner`/`_editor` either way.
	const noRights: Array<{ eventId: string; nameValue: string }> = [];
	for (const eventId of toWriteIds) {
		const event = eventById.get(eventId) as CensusEvent;
		const ownerRefs = (event._owner ?? []).map((r) => r.reference);
		const editorRefs = (event._editor ?? []).map((r) => r.reference);
		if (!ownerRefs.includes(cfg.userId) && !editorRefs.includes(cfg.userId)) {
			noRights.push({ eventId, nameValue: nameById.get(eventId) as string });
		}
	}

	if (noRights.length > 0) {
		writeAbortLedger({ outcome: 'aborted-rights', noRights });
		throw new Error(
			`runSeed233S2: rights preflight failed for ${noRights.length} event(s) -- the runner is absent from ` +
				`_owner/_editor -- stopping before any write: ${noRights.map((n) => n.eventId).join(', ')}`
		);
	}

	function isRerun(): boolean {
		const writeCount = dryRun ? toWriteIds.length : migratedIds.length;
		return writeCount === 0 && failedIds.length === 0 && total > 0;
	}

	function writeFinalLedger(): string {
		return writeLedgerShared({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: {
				dryRun,
				rerun: isRerun(),
				counts: buildCounts(false),
				...buildIdsField(false),
				alreadyMigratedIds,
				noNameIds,
				failedIds
			}
		});
	}

	if (dryRun) {
		const ledgerPath = writeFinalLedger();
		return { counts: buildCounts(false), rerun: isRerun(), outcomes, ledgerPath };
	}

	for (const eventId of toWriteIds) {
		const nameValue = nameById.get(eventId) as string;
		try {
			const postRes = await entuFetch(
				cfg.db,
				`entity/${eventId}`,
				cfg.token,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify([{ type: 'event_name', string: nameValue }])
				},
				fetchImpl
			);
			if (!postRes.ok) {
				throw new Error(`runSeed233S2: POST entity/${eventId} failed: ${postRes.status}`);
			}
			const postBody = (await postRes.json()) as { properties?: Array<{ _id: string; type: string }> };
			const newProp = (postBody.properties ?? []).find((p) => p.type === 'event_name');
			if (!newProp?._id) {
				throw new Error(
					`runSeed233S2: POST response for ${eventId} carries no event_name property _id (canary a)`
				);
			}

			const readRes = await entuFetch(cfg.db, `entity/${eventId}?props=event_name`, cfg.token, {}, fetchImpl);
			if (!readRes.ok) {
				throw new Error(`runSeed233S2: read-back GET for ${eventId} failed: ${readRes.status}`);
			}
			const readBody = (await readRes.json()) as {
				entity?: { event_name?: Array<{ _id: string; string?: string }> };
			};
			const readValues = readBody.entity?.event_name ?? [];
			if (readValues.length !== 1) {
				throw new Error(
					`runSeed233S2: READ-BACK for ${eventId} holds ${readValues.length} event_name value(s) (expected exactly 1, canary c)`
				);
			}
			if (readValues[0]?.string !== nameValue) {
				throw new Error(
					`runSeed233S2: READ-BACK mismatch for ${eventId}: expected '${nameValue}', got '${readValues[0]?.string}' (canary b)`
				);
			}

			const idx = outcomes.findIndex((o) => o.eventId === eventId);
			if (idx !== -1) outcomes[idx] = { eventId, outcome: 'migrated' };
			migratedIds.push(eventId);
		} catch (err) {
			failedIds.push(eventId);
			writeFinalLedger();
			throw err;
		}
	}

	const ledgerPath = writeFinalLedger();
	return { counts: buildCounts(false), rerun: isRerun(), outcomes, ledgerPath };
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const AUTHORIZED_BY = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed233S2(cfg, DRY_RUN, fetch, AUTHORIZED_BY);

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
