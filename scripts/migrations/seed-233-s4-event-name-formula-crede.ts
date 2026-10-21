// #233 S4: turns crede's event `name` into a formula of date + type + event_name, then touch-saves.
// A formula overwrites the stored name on every save, so any event with a name but no event_name
// copy stops the run before the POST.

// PO-Approved: #233 estate ruling (Mihkel 2026-09-18, Gama 5728594975); live needs #421's own go.
// Dry-run first: node --import tsx --import ./scripts/migrations/lib/register-loader.mjs <file>
// Live: DRY_RUN=false AUTHORIZED_BY='...'; RESUME_TOUCH_SAVES=true finishes a run cut after POST.

import { pathToFileURL } from 'node:url';
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';
import { resolveMetaTypeIds, resolveTypeIdByName } from './lib/ensure-schema-type';
import { event_name } from './lib/mvox-schema-extensions';
import { readDryRun, loadCredeCfg, readAuthorizedBy } from './lib/script-runner';
import { writeLedger as writeLedgerShared, assertLiveRunAuthorized } from './lib/ledger-writer';

// Mihkel set the live formula by hand on 2026-09-21 with a REGEX date; this constant stays as
// what the script wrote, and a re-run aborts on the existing formula.

// Full ISO timestamp in the formula, no platform-side way to shorten it
// (re-verify if Entu ships SUBSTRING).
export const FORMULA = "start_datetime event_type event_name ' — ' CONCAT_WS";

/** The dry ledger's plain statement that the overwrite cannot be previewed. */
const OVERWRITE_PREVIEW =
	'none — a formula has no non-destructive mode; the pairing preflight is the only guard before the overwrite';

/** The mismatch ledger's plain statement that the overwrite cannot be undone. */
const MISMATCH_NOTE = 'the formula overwrite cannot be undone — the mismatched events need manual review';

/** Fixed text: an upstream error message is not a value this script controls. */
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

// The committed twin's allowlist: ids, counts and outcomes only. 'authorizedBy' is absent:
// writeLedger adds it itself, and the liveRunAuthorization guard spec rejects it in `allow`.
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

	// Resume finishes a run that died after the formula POST: touch-saves and read-back only.
	// It may skip the pairing verdict: under a live formula, no new straggler can appear.
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
	// No non-empty formula source at all: CONCAT_WS would write these no `name` value.
	const emptyOperands: Array<{ eventId: string }> = [];
	const pairedIds: string[] = [];
	const namelessIds: string[] = [];
	// Per paired event the read-back needs only event_name; `name` never leaves the census loop.
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

		// All three formula sources empty: the formula computes nothing and the event loses `name`.
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
			// A straggler: the formula would destroy its name. This is the go/no-go, not a count.
			pairingStragglers.push({ eventId: event._id });
			continue;
		}
		namelessIds.push(event._id);
	}

	function baseCounts(): { total: number; paired: number; nameless: number } {
		return { total, paired: pairedIds.length, nameless: namelessIds.length };
	}

	// 2. Prop-def, rights, idempotence: read-only, and ahead of pairing, because once the formula
	// has landed every nameless event looks like a straggler; a re-run judged on the census
	// first would wrongly report names about to be destroyed.
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

	// Idempotence, after rights: a re-run after success reports and stops without writing.
	// Its counts are read under the live formula, so `nameless` reads 0.
	const existingFormula = propDefEntity.formula?.[0]?.string;
	if (resumeTouchSaves) {
		// A resume expects this exact formula in force; anything else is not the run it finishes.
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

	// 3. Multi-value stops the step ahead of pairing: a doubled value is not classifiable.
	if (multiValue.length > 0) {
		writeS4Ledger('aborted-multi-value', { counts: baseCounts(), multiValue });
		throw new Error(
			`runSeed233S4: ${multiValue.length} event(s) hold more than one name/event_name value -- not ` +
				`classifiable -- stopping before any write: ${multiValue.map((m) => m.eventId).join(', ')}`
		);
	}

	// 4. Pairing preflight, the go/no-go. The prop-def carries no formula here, so a non-empty
	// `name` is a real stored value.
	if (!resumeTouchSaves && pairingStragglers.length > 0) {
		writeS4Ledger('aborted-pairing', { counts: baseCounts(), pairingStragglers });
		throw new Error(
			`runSeed233S4: pairing preflight failed for ${pairingStragglers.length} event(s) -- a non-empty ` +
				`name with no event_name copy -- the formula would destroy it -- stopping before any write: ` +
				`${pairingStragglers.map((s) => s.eventId).join(', ')}`
		);
	}

	// 5. Empty-operand stop: all sources empty computes no `name`; caught before the POST.
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

	// 7. Live: one formula POST (no DELETE first), touch-saves, read-back. From the POST on, the
	// catch writes the ledger before rethrowing: a 5xx does not prove the write did not apply,
	// and the overwrite cannot be undone.
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

		// Touch-save every event: GET aggregate is the documented, read-only way to refresh
		// formula values, so no per-event write rights are needed.
		for (const event of censusBody.entities) {
			const aggregateRes = await entuFetch(cfg.db, `entity/${event._id}/aggregate`, cfg.token, {}, fetchImpl);
			if (!aggregateRes.ok) {
				throw new Error(`runSeed233S4: aggregate GET for ${event._id} failed: ${aggregateRes.status}`);
			}
			await aggregateRes.json();
			aggregated += 1;
			aggregatedIds.push(event._id);
		}

		// 8. Read-back: no event lost its name.
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

	// The verdict cannot fail on the wire, so it sits outside the try; one run writes one ledger.
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
	// Opt-in only, and only literally 'true'.
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
