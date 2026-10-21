// #233 S2: copies every crede event's `name` into `event_name` before S4 makes `name` a formula.
// A formula overwrites the stored value on every save, so a name not copied first is gone.
// PO-Approved: #233 estate ruling (Mihkel 2026-09-18, via Gama comment 5728594975), crede only.

// Dry-run first: node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <file>
// Live: DRY_RUN=false AUTHORIZED_BY='...', only after a verified dry run and authorization.

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

type Outcome = 'would-migrate' | 'migrated' | 'already-migrated' | 'no-name';

interface CensusEvent {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
	// Rights references ride on the census; `.string` here is a person's name and never leaves.
	_owner?: Array<{ reference?: string }>;
	_editor?: Array<{ reference?: string }>;
}

export interface RunSeed233S2Counts {
	total: number;
	/** Live runs only: events written and verified. Absent on a dry or aborted run. */
	migrated?: number;
	/** Dry runs and aborted runs (nothing written). Absent when `migrated` is present. */
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

// The committed twin's allowlist: ids, counts and outcomes only, no redact field or `string`.
// 'authorizedBy' is absent: writeLedger adds it itself, and the liveRunAuthorization guard
// spec rejects an allow entry for it.
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
	// Abort lists: ids and counts only, never a value.
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
	// The plan on a dry or aborted run; on a live run the written ones land in `migratedIds`.
	const toWriteIds: string[] = [];
	const nameById = new Map<string, string>();
	const alreadyMigratedIds: string[] = [];
	const noNameIds: string[] = [];
	const failedIds: string[] = [];
	const migratedIds: string[] = [];
	const eventNameDiffers: Array<{ eventId: string; nameValue: string; storedValue: string }> = [];
	const blankEventName: Array<{ eventId: string }> = [];
	const multiValue: Array<{ eventId: string; nameCount: number; eventNameCount: number }> = [];
	// Off the census, so the rights preflight needs no GET per event.
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
				// A blank value is for a human to decide: writing would append a second value.
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

	// #419 rights preflight: the whole list is built before any write, dry run included.
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
