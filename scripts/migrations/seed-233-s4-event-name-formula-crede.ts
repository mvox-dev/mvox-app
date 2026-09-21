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
// 5. EMPTY-OPERAND STOP — an event whose three formula sources are ALL
//    empty/absent computes to nothing at all: CONCAT_WS with no input
//    writes no value (entu-www src/api/formulas/index.md, "Empty Input
//    Behaviour": "no value (property not written)"), so that event would
//    come out of the formula with no `name` whatsoever. The census already
//    carries both formula sources, so this is checkable BEFORE the
//    irreversible POST — without it the read-back is the first to notice,
//    which is a mismatch throw over events that in fact lost nothing.
//
// 6. DRY RUN (the default) — zero POSTs, zero aggregate GETs. The ledger
//    carries the exact formula string, the counts, the prop-def id, the
//    rights result, and says plainly that the overwrite cannot be
//    previewed (a formula has no non-destructive mode).
//
// 7. LIVE — exactly ONE POST, `entity/{namePropDefId}` with body
//    `[{type:'formula', string: FORMULA}]`
//    (probe-233-formula-name-overwrite-2026-09-03.ts's proven wire shape —
//    no DELETE first: `formula` behaved as a settable single value). Then
//    touch-save EVERY crede event via `GET entity/{id}/aggregate` — the
//    documented mechanic (api/best-practices: "fresh formula values after
//    external changes"); read-only, so no per-event write rights are
//    needed, unlike S2's write path. The formula POST strictly precedes
//    every aggregate GET. EVERY failure from the POST onwards writes a
//    ledger (`completed-with-error`, with the ids touch-saved so far)
//    BEFORE it rethrows: a 5xx does not prove the write did not apply, so
//    past this line a bare throw would leave a live formula and a
//    half-refreshed estate recorded nowhere but a console line.
//
//    RESUME (`resumeTouchSaves`, CLI `RESUME_TOUCH_SAVES=true`) is the way
//    back from exactly that state: it requires the prop-def to already
//    carry this FORMULA, issues NO POST, and runs the touch-saves and the
//    read-back alone. It skips the pairing verdict because under a live
//    formula the census cannot be read straight (a computed `name` beside
//    no `event_name` wears the straggler shape) — safe only because the
//    formula is already in force: `name` is no longer a storable property,
//    so no new straggler can have appeared since the POST.
//
// 8. READ-BACK — one re-GET of `props=name,event_name` for the census set,
//    asserting per event: exactly one `name` value, non-empty; where
//    `event_name` was non-empty the new `name` CONTAINS it; where absent,
//    the new `name` is still non-empty (date — type). Any mismatch ->
//    ledger outcome `completed-with-mismatch` with `mismatchIds`, then
//    THROW — the overwrite cannot be undone, so a silent partial is worse
//    than a loud one.
//
// 9. LEDGER through #402's committed-allowlist writer: `sensitive: true`,
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
//   DRY_RUN=false RESUME_TOUCH_SAVES=true AUTHORIZED_BY='...' node --import tsx \
//     --import ./scripts/migrations/lib/register-loader.mjs \
//     ./scripts/migrations/seed-233-s4-event-name-formula-crede.ts        # ONLY to finish a run that died after the formula POST

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
// Full ISO timestamp in the formula, no platform-side way to shorten it at the time of the
// 2026-09-20 live run. Entu documented REGEX on 2026-09-21 (entu/www bc86660); Mihkel then set
// the live formula by hand to
//   start_datetime '^(\d{4}-\d{2}-\d{2}).*$' '$1' REGEX event_type event_name ' -- ' CONCAT_WS
// (#421 comment, 2026-09-21). The constant below is what this script wrote and stays as history;
// a re-run aborts on the existing formula.
export const FORMULA = "start_datetime event_type event_name ' — ' CONCAT_WS";

/** The dry ledger's plain statement that the overwrite cannot be previewed. */
const OVERWRITE_PREVIEW =
	'none — a formula has no non-destructive mode; the pairing preflight is the only guard before the overwrite';

/** The mismatch ledger's plain statement that the overwrite cannot be undone. */
const MISMATCH_NOTE = 'the formula overwrite cannot be undone — the mismatched events need manual review';

/**
 * The post-write failure ledger's plain statement. Fixed text, no error
 * message folded in: the ledger's committed twin is built from the payload,
 * and an upstream message is not a value this script controls.
 */
const POST_WRITE_ERROR_NOTE =
	'the run failed at or after the formula POST — the formula may already be in force and the touch-saves are partial; aggregatedIds lists what was refreshed, and a RESUME_TOUCH_SAVES=true run finishes the rest';

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
	| 'aborted-empty-operands'
	| 'aborted-rights'
	| 'aborted-already-formula'
	| 'aborted-resume-precondition'
	| 'dry-run'
	| 'completed'
	| 'completed-with-mismatch'
	| 'completed-with-error';

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
	'aggregatedIds',
	'errorNote',
	'resumed',
	'pairingStragglers',
	'emptyOperands',
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
	authorizedBy?: string,
	options: { resumeTouchSaves?: boolean } = {}
): Promise<RunSeed233S4Result> {
	// mvox-app#417 — before the census GET, before any request leaves the script.
	assertLiveRunAuthorized(dryRun, authorizedBy);

	// The recovery path for a run that died after the formula POST: no POST,
	// touch-saves and read-back only. See the header's RESUME paragraph for
	// why it is allowed to skip the pairing verdict.
	const resumeTouchSaves = options.resumeTouchSaves === true;

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
	// Events with no non-empty formula source at all: CONCAT_WS would write
	// them no `name` value whatsoever.
	const emptyOperands: Array<{ eventId: string }> = [];
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

		// Judged for every classifiable event, before the paired/nameless
		// split: all three formula sources empty means the formula computes
		// nothing and the event ends up with no `name` at all.
		if (
			!isNonEmpty(event.start_datetime?.[0]?.datetime) &&
			!isNonEmpty(event.event_type?.[0]?.string) &&
			!isNonEmpty(eventNameValue)
		) {
			emptyOperands.push({ eventId: event._id });
		}

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
	if (resumeTouchSaves) {
		// A resume run is the mirror image: it EXPECTS this exact formula to
		// be in force already. Anything else (no formula at all, or someone
		// else's) means the estate is not the one this run is finishing.
		if (existingFormula !== FORMULA) {
			writeS4Ledger('aborted-resume-precondition', {
				counts: baseCounts(),
				namePropDefId,
				rightsOk: true,
				resumed: true,
				...(existingFormula !== undefined ? { existingFormula } : {})
			});
			throw new Error(
				`runSeed233S4: resume asked for, but the 'name' prop-def does not carry this script's formula -- ` +
					`there is no post-POST run to finish -- stopping without writing`
			);
		}
	} else if (existingFormula !== undefined) {
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
	if (!resumeTouchSaves && pairingStragglers.length > 0) {
		writeS4Ledger('aborted-pairing', { counts: baseCounts(), pairingStragglers });
		throw new Error(
			`runSeed233S4: pairing preflight failed for ${pairingStragglers.length} event(s) -- a non-empty ` +
				`name with no event_name copy -- the formula would destroy it -- stopping before any write: ` +
				`${pairingStragglers.map((s) => s.eventId).join(', ')}`
		);
	}

	// 5. EMPTY-OPERAND STOP — all three formula sources empty computes to no
	// value at all (entu-www src/api/formulas/index.md, "Empty Input
	// Behaviour"), so the formula would leave the event with no `name`.
	// Caught here, before the POST, not by the read-back after it.
	if (emptyOperands.length > 0) {
		writeS4Ledger('aborted-empty-operands', { counts: baseCounts(), emptyOperands });
		throw new Error(
			`runSeed233S4: ${emptyOperands.length} event(s) have no non-empty start_datetime, event_type or ` +
				`event_name -- the formula would compute no name at all for them -- stopping before any write: ` +
				`${emptyOperands.map((e) => e.eventId).join(', ')}`
		);
	}

	if (dryRun) {
		const ledgerPath = writeS4Ledger('dry-run', {
			formula: FORMULA,
			counts: baseCounts(),
			namePropDefId,
			rightsOk: true,
			overwritePreview: OVERWRITE_PREVIEW,
			...(resumeTouchSaves ? { resumed: true } : {})
		});
		return {
			outcome: 'dry-run',
			formula: FORMULA,
			counts: baseCounts(),
			namePropDefId,
			ledgerPath
		};
	}

	// 7. LIVE — the ONE formula POST, no DELETE first
	// (probe-233-formula-name-overwrite-2026-09-03.ts's proven wire shape),
	// then the touch-saves and the read-back GET.
	//
	// Everything from the POST onwards runs inside one try/catch, and the
	// catch writes the ledger BEFORE it rethrows: from here on a failure is
	// never proof that nothing happened. A 5xx on the POST does not say the
	// write did not apply, and a failure mid-touch-save leaves the formula
	// live over a part-refreshed estate. The same stance the mismatch branch
	// below states outright — the overwrite cannot be undone, so a silent
	// partial is worse than a loud one — and Done-when box 4 wants the run's
	// ledger committed either way.
	let aggregated = 0;
	const aggregatedIds: string[] = [];
	let readbackBody: { count: number; entities: ReadbackEvent[] };
	try {
		if (!resumeTouchSaves) {
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
				throw new Error(
					`runSeed233S4: formula POST to entity/${namePropDefId} failed: ${formulaPostRes.status}`
				);
			}
		}

		// Touch-save EVERY event, in census order — the documented, read-only
		// mechanic (api/best-practices: "fresh formula values after external
		// changes"). No per-event write rights are needed.
		for (const event of censusBody.entities) {
			const aggregateRes = await entuFetch(cfg.db, `entity/${event._id}/aggregate`, cfg.token, {}, fetchImpl);
			if (!aggregateRes.ok) {
				throw new Error(`runSeed233S4: aggregate GET for ${event._id} failed: ${aggregateRes.status}`);
			}
			await aggregateRes.json();
			aggregated += 1;
			aggregatedIds.push(event._id);
		}

		// 8. READ-BACK — proves Done-when box 2 ("no event lost its name").
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
		readbackBody = (await readbackRes.json()) as { count: number; entities: ReadbackEvent[] };
	} catch (err) {
		writeS4Ledger('completed-with-error', {
			formula: FORMULA,
			counts: { ...baseCounts(), aggregated },
			namePropDefId,
			errorNote: POST_WRITE_ERROR_NOTE,
			aggregatedIds,
			...(resumeTouchSaves ? { resumed: true } : {})
		});
		throw err;
	}

	// The read-back verdict itself cannot fail on the wire, so it sits
	// outside the try: its own ledger (completed-with-mismatch) is the
	// record of this path, and one run writes exactly one ledger.
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
			mismatchNote: MISMATCH_NOTE,
			...(resumeTouchSaves ? { resumed: true } : {})
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
		mismatchIds: [],
		...(resumeTouchSaves ? { resumed: true } : {})
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
	// Opt-in only, and only literally 'true' — the recovery path for a run
	// that died after the formula POST.
	const RESUME_TOUCH_SAVES = process.env.RESUME_TOUCH_SAVES?.trim().toLowerCase() === 'true';
	const cfg = await loadCredeCfg();
	console.log(
		`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'}${RESUME_TOUCH_SAVES ? ' (RESUME: touch-saves only, no formula POST)' : ''} — db=${cfg.db}\n`
	);

	const result = await runSeed233S4(cfg, DRY_RUN, fetch, AUTHORIZED_BY, {
		resumeTouchSaves: RESUME_TOUCH_SAVES
	});

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
