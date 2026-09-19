// mvox-app#233 S4 / mvox-app#421 — crede's event `name` becomes a formula of
// date + type + event_name, then every event is touch-saved so the formula
// recomputes. This is the LAST step of the #233 ordering fence carried by
// event_name's own def (mvox-schema-extensions.ts): S1 (#418, the
// event_name prop-def) -> S2 (#419, backfill every name into event_name) ->
// S3 (#420, move every app read/write off `name`) -> S4 (this script, only
// now PATCH `name` into a formula). A formula overwrites the stored value
// on every save and has NO non-destructive mode — that is why S2/S3 must be
// fully live first, and why the pairing preflight below is a hard STOP, not
// a count to proceed past: it is the only thing standing between a
// straggler (an event holding a `name` no `event_name` copy exists for) and
// a destroyed name. No further app-code change lands with this script —
// #420 already absorbed S4's consequence (eventDetail.ts reads
// `event_name`, never `name`).
//
// Contract — `runSeed233S4(cfg, dryRun, fetchImpl, authorizedBy?)`, pinned
// by seed-233-s4-event-name-formula-crede.spec.ts. Side-effect-free on
// import; #417's `assertLiveRunAuthorized` is the first statement, before
// the census GET. Flow:
//
// 1. CENSUS — S2's query shape, with the three formula-source props riding
//    along: one db-wide GET
//    `entity?_type.string=event&props=name,event_name,start_datetime,event_type&limit=10000`,
//    hard-throw when the reported `count` disagrees with the entity count
//    (a truncated census would leave events outside the pairing check for
//    the formula to blank).
//
// 2. PROP-DEF + RIGHTS + IDEMPOTENCE PREFLIGHT — resolve the event type's
//    existing `name` prop-def by S1's exact query shape (meta-type ids +
//    event type id via the same lib/ensure-schema-type helpers S1 uses),
//    then a plain GET for `_owner`/`_editor`/`formula`. Rights first:
//    abort when `cfg.userId` is absent from the prop-def's own
//    `_owner`/`_editor` references (`.reference` only — `.string` bakes
//    the person's name). Then idempotence: abort when the prop-def already
//    carries a formula value — a re-run after success reports and stops
//    without writing. All four are read-only GETs, and they run BEFORE the
//    census verdicts below for one reason: once the formula has landed,
//    every nameless event carries a computed `name` with no `event_name`
//    beside it — the straggler shape exactly — so a re-run judged on the
//    census first would abort 'aborted-pairing' and announce 36 names
//    about to be destroyed, when the step in fact already succeeded and
//    only the touch-saves remain.
//
// 3. MULTI-VALUE stops the step ahead of pairing (S2 precedent: a doubled
//    value is not classifiable at all): any event holding more than one
//    `name` or `event_name` value aborts the whole run.
//
// 4. PAIRING PREFLIGHT — the go/no-go (#421 body): any event with a
//    non-empty `name` and an empty/absent `event_name` is a straggler the
//    formula would destroy. Found even one -> abort ledger, throw, zero
//    POSTs, zero aggregate GETs. Classification for counts: `paired` =
//    non-empty `event_name` (whatever `name` holds); `nameless` = neither
//    non-empty. A total would be wrong (#421 body) — it moves as the app
//    writes new events.
//
// 5. DRY RUN (the default) — zero POSTs, zero aggregate GETs. The ledger
//    carries the exact formula string, the counts, the prop-def id, the
//    rights result, and says plainly that the overwrite cannot be
//    previewed (a formula has no non-destructive mode).
//
// 6. LIVE — exactly ONE POST, `entity/{namePropDefId}` with body
//    `[{type:'formula', string: FORMULA}]`
//    (probe-233-formula-name-overwrite-2026-09-03.ts's proven wire shape —
//    no DELETE first: `formula` behaved as a settable single value). Then
//    touch-save EVERY crede event via `GET entity/{id}/aggregate` — the
//    documented mechanic (api/best-practices: "fresh formula values after
//    external changes"); read-only, so no per-event write rights are
//    needed, unlike S2's write path. The formula POST strictly precedes
//    every aggregate GET.
//
// 7. READ-BACK — one re-GET of `props=name,event_name` for the census set,
//    asserting per event: exactly one `name` value, non-empty; where
//    `event_name` was non-empty the new `name` CONTAINS it; where absent,
//    the new `name` is still non-empty (date — type). Any mismatch ->
//    ledger outcome `completed-with-mismatch` with `mismatchIds`, then
//    THROW — the overwrite cannot be undone, so a silent partial is worse
//    than a loud one.
//
// 8. LEDGER through #402's committed-allowlist writer: `sensitive: true`,
//    `committed.allow` keyed by ids/outcome/counts only — never a field
//    named `name` (DEFAULT_REDACT_FIELDS) and never `authorizedBy` in
//    `allow` (the writer owns that envelope key; the #417 fence rejects an
//    allow entry for it).
//
// Authorization: PO-Approved via the #233 estate ruling (Mihkel,
// 2026-09-18, Gama comment 5728594975) for definition and scope; #417's
// gate requires a recorded AUTHORIZED_BY for DRY_RUN=false separately, and
// this run needs its OWN #421-specific authorization (S2's re-run
// immediately before this preflight, and Mihkel's live-run go-ahead, are
// both separate, manual steps — never part of this script).
//
// Run (standalone node, outside Vite — needs the $env shim via loader.mjs):
//   cd ~/workspace-app
//   set -a; . ~/.config/mvox/credentials.env; set +a
//   node --import tsx --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s4-event-name-formula-crede.ts        # DRY_RUN=true default
//   DRY_RUN=false AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s4-event-name-formula-crede.ts        # ONLY after dry-run verified + authorization

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { resolveMetaTypeIds, resolveTypeIdByName } from './lib/ensure-schema-type';
import { event_name } from './lib/mvox-schema-extensions';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

// The exact RPN formula string the ONE live POST carries — #421's whole
// point. `CONCAT_WS` drops absent operands, so the 36 nameless events
// render `date — type` with no stray separator (entu-www formula syntax:
// the last stack value is the separator, the rest are joined with it).
//
// Full ISO timestamp in the formula, no platform-side way to shorten it (re-verify if Entu ships SUBSTRING).
export const FORMULA = "start_datetime event_type event_name ' — ' CONCAT_WS";

/** The dry ledger's plain statement that the overwrite cannot be previewed. */
const OVERWRITE_PREVIEW =
	'none — a formula has no non-destructive mode; the pairing preflight is the only guard before the overwrite';

/** The mismatch ledger's plain statement that the overwrite cannot be undone. */
const MISMATCH_NOTE = 'the formula overwrite cannot be undone — the mismatched events need manual review';

interface CensusEvent {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
	start_datetime?: Array<{ _id: string; datetime?: string }>;
	event_type?: Array<{ _id: string; string?: string }>;
}

interface ReadbackEvent {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
}

export type RunSeed233S4Outcome =
	| 'aborted-pairing'
	| 'aborted-multi-value'
	| 'aborted-rights'
	| 'aborted-already-formula'
	| 'dry-run'
	| 'completed'
	| 'completed-with-mismatch';

export interface RunSeed233S4Result {
	outcome: RunSeed233S4Outcome;
	formula: string;
	counts: Record<string, number>;
	namePropDefId: string;
	mismatchIds?: string[];
	ledgerPath: string;
}

// The exact allowlist the committed twin is built from — ids, counts and
// outcomes only; no DEFAULT_REDACT_FIELDS member, no `string`, and no
// `authorizedBy` (writeLedger injects it into the committed envelope
// itself; the fence, lib/liveRunAuthorization.guard.spec.ts, rejects an
// allow entry for it).
const COMMITTED_ALLOW = [
	'dryRun',
	'outcome',
	'formula',
	'counts',
	'total',
	'paired',
	'nameless',
	'aggregated',
	'readBackOk',
	'readBackMismatch',
	'namePropDefId',
	'rightsOk',
	'existingFormula',
	'overwritePreview',
	'mismatchIds',
	'mismatchNote',
	'pairingStragglers',
	'multiValue',
	'eventId',
	'nameCount',
	'eventNameCount'
] as const;

function isNonEmpty(value: string | undefined): value is string {
	return value !== undefined && value.trim().length > 0;
}

export async function runSeed233S4(
	cfg: EntuCfg & { userId: string },
	dryRun: boolean,
	fetchImpl: typeof fetch = fetch,
	authorizedBy?: string
): Promise<RunSeed233S4Result> {
	// mvox-app#417 — before the census GET, before any request leaves the script.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	function writeS4Ledger(outcome: RunSeed233S4Outcome, extra: Record<string, unknown>): string {
		return writeLedgerShared({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun,
			db: cfg.db,
			sensitive: true,
			authorizedBy,
			committed: { allow: COMMITTED_ALLOW },
			payload: { dryRun, outcome, ...extra }
		});
	}

	// 1. CENSUS — S2's shape, with the formula-source props riding along.
	const censusRes = await entuFetch(
		cfg.db,
		'entity?_type.string=event&props=name,event_name,start_datetime,event_type&limit=10000',
		cfg.token,
		{},
		fetchImpl
	);
	if (!censusRes.ok) {
		throw new Error(`runSeed233S4: census GET failed: ${censusRes.status}`);
	}
	const censusBody = (await censusRes.json()) as { count: number; entities: CensusEvent[] };
	if (censusBody.count !== censusBody.entities.length) {
		throw new Error(
			`runSeed233S4: census truncated -- count=${censusBody.count} entities=${censusBody.entities.length}. Raise limit.`
		);
	}

	const total = censusBody.entities.length;
	const multiValue: Array<{ eventId: string; nameCount: number; eventNameCount: number }> = [];
	const pairingStragglers: Array<{ eventId: string }> = [];
	const pairedIds: string[] = [];
	const namelessIds: string[] = [];
	// The one value the read-back needs per paired event — never the `name`
	// value itself, which never leaves the census loop.
	const eventNameById = new Map<string, string>();

	for (const event of censusBody.entities) {
		const nameCount = event.name?.length ?? 0;
		const eventNameCount = event.event_name?.length ?? 0;
		if (nameCount > 1 || eventNameCount > 1) {
			// Not classifiable at all — checked ahead of pairing.
			multiValue.push({ eventId: event._id, nameCount, eventNameCount });
			continue;
		}

		const nameValue = event.name?.[0]?.string;
		const eventNameValue = event.event_name?.[0]?.string;

		if (isNonEmpty(eventNameValue)) {
			pairedIds.push(event._id);
			eventNameById.set(event._id, eventNameValue);
			continue;
		}
		if (isNonEmpty(nameValue)) {
			// A straggler: a name with no event_name copy — the formula would
			// destroy it. This is the go/no-go, not a count to proceed past.
			pairingStragglers.push({ eventId: event._id });
			continue;
		}
		namelessIds.push(event._id);
	}

	function baseCounts(): { total: number; paired: number; nameless: number } {
		return { total, paired: pairedIds.length, nameless: namelessIds.length };
	}

	// 2. PROP-DEF + RIGHTS + IDEMPOTENCE PREFLIGHT — S1's exact resolution
	// shape, and it runs AHEAD of the multi-value/pairing blocks: all four
	// checks here are read-only GETs, and until the script knows whether the
	// formula already landed it cannot read the census straight. After a
	// successful run every nameless event carries a formula-computed `name`
	// and still has no `event_name`, which is exactly the straggler shape —
	// so a re-run classified first would abort 'aborted-pairing' and report
	// names about to be destroyed when in truth the step already succeeded.
	const { entityMetaTypeId, propertyMetaTypeId } = await resolveMetaTypeIds(cfg, fetchImpl);
	const typeId = await resolveTypeIdByName(cfg, entityMetaTypeId, event_name.onType, fetchImpl);

	const propDefRes = await entuFetch(
		cfg.db,
		`entity?_type.reference=${propertyMetaTypeId}&_parent.reference=${typeId}&name.string=name&props=_owner,_editor,formula&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!propDefRes.ok) {
		throw new Error(`runSeed233S4: 'name' prop-def GET failed: ${propDefRes.status}`);
	}
	const propDefBody = (await propDefRes.json()) as {
		entities?: Array<{
			_id: string;
			_owner?: Array<{ reference?: string }>;
			_editor?: Array<{ reference?: string }>;
			formula?: Array<{ string?: string }>;
		}>;
	};
	const propDefEntity = propDefBody.entities?.[0];
	if (!propDefEntity?._id) {
		throw new Error(`runSeed233S4: 'name' prop-def not found on the '${event_name.onType}' type`);
	}
	const namePropDefId = propDefEntity._id;

	// `.reference` only — `.string` on these bakes the person's name.
	const ownerRefs = (propDefEntity._owner ?? []).map((r) => r.reference);
	const editorRefs = (propDefEntity._editor ?? []).map((r) => r.reference);
	const rightsOk = ownerRefs.includes(cfg.userId) || editorRefs.includes(cfg.userId);

	if (!rightsOk) {
		writeS4Ledger('aborted-rights', { counts: baseCounts(), namePropDefId, rightsOk: false });
		throw new Error(
			`runSeed233S4: rights preflight failed on the '${event_name.onType}' type's 'name' prop-def -- the ` +
				`runner is absent from _owner/_editor -- stopping before any write`
		);
	}

	// Idempotence, checked only once rights are confirmed: a re-run after
	// success reports and stops without writing. The counts riding along are
	// the census read under a formula already in force — `nameless` reads 0
	// there, since those events now hold a computed `name`; the outcome, not
	// the split, is what this ledger is for.
	const existingFormula = propDefEntity.formula?.[0]?.string;
	if (existingFormula !== undefined) {
		writeS4Ledger('aborted-already-formula', {
			counts: baseCounts(),
			namePropDefId,
			rightsOk: true,
			existingFormula
		});
		throw new Error(
			`runSeed233S4: the 'name' prop-def already carries a formula -- this looks like a re-run after ` +
				`success -- stopping without writing`
		);
	}

	// 3. MULTI-VALUE stops the step ahead of pairing (S2 precedent: a doubled
	// value is not classifiable at all).
	if (multiValue.length > 0) {
		writeS4Ledger('aborted-multi-value', { counts: baseCounts(), multiValue });
		throw new Error(
			`runSeed233S4: ${multiValue.length} event(s) hold more than one name/event_name value -- not ` +
				`classifiable -- stopping before any write: ${multiValue.map((m) => m.eventId).join(', ')}`
		);
	}

	// 4. PAIRING PREFLIGHT — the go/no-go. Reached only once the prop-def is
	// known to carry no formula, so a non-empty `name` here is a real stored
	// value, never one the formula computed.
	if (pairingStragglers.length > 0) {
		writeS4Ledger('aborted-pairing', { counts: baseCounts(), pairingStragglers });
		throw new Error(
			`runSeed233S4: pairing preflight failed for ${pairingStragglers.length} event(s) -- a non-empty ` +
				`name with no event_name copy -- the formula would destroy it -- stopping before any write: ` +
				`${pairingStragglers.map((s) => s.eventId).join(', ')}`
		);
	}

	if (dryRun) {
		const ledgerPath = writeS4Ledger('dry-run', {
			formula: FORMULA,
			counts: baseCounts(),
			namePropDefId,
			rightsOk: true,
			overwritePreview: OVERWRITE_PREVIEW
		});
		return {
			outcome: 'dry-run',
			formula: FORMULA,
			counts: baseCounts(),
			namePropDefId,
			ledgerPath
		};
	}

	// 5. LIVE — the ONE formula POST, no DELETE first
	// (probe-233-formula-name-overwrite-2026-09-03.ts's proven wire shape).
	const formulaPostRes = await entuFetch(
		cfg.db,
		`entity/${namePropDefId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ type: 'formula', string: FORMULA }])
		},
		fetchImpl
	);
	if (!formulaPostRes.ok) {
		throw new Error(`runSeed233S4: formula POST to entity/${namePropDefId} failed: ${formulaPostRes.status}`);
	}

	// Touch-save EVERY event, in census order — the documented, read-only
	// mechanic (api/best-practices: "fresh formula values after external
	// changes"). No per-event write rights are needed.
	let aggregated = 0;
	for (const event of censusBody.entities) {
		const aggregateRes = await entuFetch(cfg.db, `entity/${event._id}/aggregate`, cfg.token, {}, fetchImpl);
		if (!aggregateRes.ok) {
			throw new Error(`runSeed233S4: aggregate GET for ${event._id} failed: ${aggregateRes.status}`);
		}
		await aggregateRes.json();
		aggregated += 1;
	}

	// 6. READ-BACK — proves Done-when box 2 ("no event lost its name").
	const readbackRes = await entuFetch(
		cfg.db,
		'entity?_type.string=event&props=name,event_name&limit=10000',
		cfg.token,
		{},
		fetchImpl
	);
	if (!readbackRes.ok) {
		throw new Error(`runSeed233S4: read-back GET failed: ${readbackRes.status}`);
	}
	const readbackBody = (await readbackRes.json()) as { count: number; entities: ReadbackEvent[] };
	const readbackById = new Map(readbackBody.entities.map((e) => [e._id, e]));

	let readBackOk = 0;
	const mismatchIds: string[] = [];
	for (const event of censusBody.entities) {
		const readback = readbackById.get(event._id);
		const nameValues = readback?.name ?? [];
		const nameValue = nameValues[0]?.string;
		const requiredEventName = eventNameById.get(event._id);
		const ok =
			nameValues.length === 1 &&
			isNonEmpty(nameValue) &&
			(requiredEventName === undefined || nameValue.includes(requiredEventName));
		if (ok) {
			readBackOk += 1;
		} else {
			mismatchIds.push(event._id);
		}
	}

	const liveCounts = { ...baseCounts(), aggregated, readBackOk, readBackMismatch: mismatchIds.length };

	if (mismatchIds.length > 0) {
		writeS4Ledger('completed-with-mismatch', {
			formula: FORMULA,
			counts: liveCounts,
			namePropDefId,
			mismatchIds,
			mismatchNote: MISMATCH_NOTE
		});
		throw new Error(
			`runSeed233S4: read-back mismatch for ${mismatchIds.length} event(s) -- the overwrite cannot be ` +
				`undone -- manual review needed: ${mismatchIds.join(', ')}`
		);
	}

	const ledgerPath = writeS4Ledger('completed', {
		formula: FORMULA,
		counts: liveCounts,
		namePropDefId,
		mismatchIds: []
	});

	return {
		outcome: 'completed',
		formula: FORMULA,
		counts: liveCounts,
		namePropDefId,
		mismatchIds: [],
		ledgerPath
	};
}

async function main(): Promise<void> {
	const DRY_RUN = readDryRun();
	const AUTHORIZED_BY = readAuthorizedBy();
	const cfg = await loadCredeCfg();
	console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} — db=${cfg.db}\n`);

	const result = await runSeed233S4(cfg, DRY_RUN, fetch, AUTHORIZED_BY);

	console.log(`outcome=${result.outcome} formula='${result.formula}' counts=${JSON.stringify(result.counts)}`);
	console.log(`Ledger: ${result.ledgerPath}`);
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
	main().catch((err) => {
		console.error(
			'seed-233-s4-event-name-formula-crede ABORTED:',
			err instanceof Error ? err.message : String(err)
		);
		process.exit(1);
	});
}

// (*MVOX:Perotin*)
