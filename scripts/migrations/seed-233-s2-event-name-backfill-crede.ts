// mvox-app#233 S2 / mvox-app#419 — copy every crede event's `name` value
// into `event_name`. Crede only, one script. Must finish before S4 turns
// `name` into a formula: a formula overwrites the stored value on every
// save, so any name not copied first is gone.
//
// Contract — `runSeed233S2(cfg, dryRun, fetchImpl, authorizedBy?)`, pinned
// by seed-233-s2-event-name-backfill-crede.spec.ts, which carries the
// rationale (review history on #419). Side-effect-free on import; #417's
// `assertLiveRunAuthorized` is the first statement. One db-wide census GET
// (`_type.string=event&props=name,event_name,_owner,_editor`), no `_parent`
// scoping, hard-throw when the reported `count` disagrees with the entity
// count. Classification then stops the whole run — dry and live alike, no
// request beyond the census, one ledger, throw — on any of four surprises:
// more than one `name` or `event_name` value (`multiValue`), a present but
// blank `event_name` (`blankEventName`), an `event_name` differing from a
// non-empty `name` (`eventNameDiffers`), and a would-be-written event whose
// `_owner`/`_editor` lack `cfg.userId` (`noRights`; the references ride on
// the census, so the check costs no round-trip — references only, `.string`
// bakes the person's name). Otherwise: an event_name PRESENT at all is
// never written to — POST appends, so presence, not emptiness, is the test
// — and counts as 'already-migrated'; `name` absent or blank -> 'no-name',
// an empty value is never written; else POST
// `[{ type: 'event_name', string: <name> }]` and verify three things: the
// POST response carries the new property _id, a re-GET reads back the
// source value, and exactly one value is stored. Any check failing records
// the event as failed in the ledger, then throws — never a false 'migrated'.
//
// Re-run rules. This script is re-run immediately before S4 as the closing
// sweep, so a run that writes zero and skips all must read as healthy:
// `rerun: true` only when `migrated === 0`, `failed === 0` and `total > 0`
// — the `failed === 0` term keeps a crashed run (which also wrote nothing)
// from carrying the healthy flag, and an aborted run never carries it
// either. A dry run and any aborted run key the plan `wouldMigrate` /
// `wouldMigrateIds`, never `migrated`, so no artefact names writes that
// never happened. Every step commits a ledger through #402's writer with
// `sensitive: true`: the instance file is gitignored, the committed twin is
// built from COMMITTED_ALLOW — `name` is a redact field, and the abort
// lists' value keys (nameValue/storedValue) stay out of it.
//
// Authorization: PO-Approved via the #233 estate ruling (Mihkel,
// 2026-09-18, Gama comment 5728594975) for definition and scope; #417's
// gate requires a recorded AUTHORIZED_BY for DRY_RUN=false separately.
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
	// Rights references ride along on the census — the preflight reads
	// `reference` only; `.string` on these is the person's baked name and
	// never leaves this module.
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
	// multi-value and blank-event_name abort lists: ids and counts only, no
	// value ever — the two lists that survive into the committed twin intact.
	'multiValue',
	'blankEventName',
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
	const blankEventName: Array<{ eventId: string }> = [];
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

		// PRESENCE, not emptiness, decides whether to write: Entu's POST
		// appends, so an event that already holds an `event_name` property
		// must never be POSTed to, whatever that property's value is.
		if (eventNameCount === 1) {
			if (!isNonEmpty(eventNameValue)) {
				// A blank value (whitespace-only, or a value document with no
				// `string` at all). Nothing writes `event_name` today, so it is
				// a surprise a human decides on — writing would append a second
				// value and leave the event holding two.
				blankEventName.push({ eventId: event._id });
				continue;
			}
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

	if (blankEventName.length > 0) {
		writeAbortLedger({ outcome: 'aborted-blank-event-name', blankEventName });
		throw new Error(
			`runSeed233S2: ${blankEventName.length} event(s) already hold a blank event_name value -- writing would ` +
				`append a second one -- stopping before any write: ${blankEventName.map((b) => b.eventId).join(', ')}`
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
