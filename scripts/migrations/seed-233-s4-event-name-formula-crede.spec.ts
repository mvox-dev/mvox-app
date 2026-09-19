// mvox-app#233 S4 / mvox-app#421 (RED, Tallis) — crede's event `name`
// becomes the formula date + type + event_name, then every event is
// touch-saved so the formula recomputes. IRREVERSIBLE on crede: a formula
// overwrites the stored value on every save and has NO non-destructive
// mode, so the pairing preflight below is the only thing standing between
// a straggler and a destroyed name.
//
// networkGuard.setup.ts stands behind every spec: nothing here can reach a
// live db; the whole wire is a fake fetch and every request is asserted
// full-shape with toEqual (partial assertions hide bugs).
//
// Contract pinned here, for GREEN to satisfy:
//
// - The script module `./seed-233-s4-event-name-formula-crede` is
//   side-effect-free on import (main() only under the isMainModule guard,
//   same as S1/S2) and exports
//   `runSeed233S4(cfg, dryRun, fetchImpl, authorizedBy?)` plus the
//   constant `FORMULA`. #417's gate `assertLiveRunAuthorized(dryRun,
//   authorizedBy)` is the FIRST statement — before the census GET — so a
//   live run with no recorded authorizer throws before ANY request leaves
//   the script. CLI main() via readDryRun/loadCredeCfg/readAuthorizedBy,
//   DRY_RUN default true.
//
// - FORMULA (RPN, entu-www formula syntax):
//   `start_datetime event_type event_name ' — ' CONCAT_WS` — CONCAT_WS
//   drops absent operands, so the 36 nameless events render date — type
//   with no stray separator. The script source must carry the
//   full-timestamp note and its re-verify trigger VERBATIM (#421 Done-when
//   box 3): "Full ISO timestamp in the formula, no platform-side way to
//   shorten it (re-verify if Entu ships SUBSTRING)".
//
// - CENSUS (S2's query shape, formula-source props riding along): one
//   db-wide GET
//   `entity?_type.string=event&props=name,event_name,start_datetime,event_type&limit=10000`,
//   HARD-THROW when `body.count !== body.entities.length` — a silently
//   truncated census would leave events outside the pairing check for the
//   formula to blank.
//
// - PAIRING PREFLIGHT — the go/no-go, and it is a STOP, never a count to
//   proceed past (#421 body): any event with a non-empty `name` and an
//   empty/absent `event_name` is a straggler the formula would destroy.
//   Collected as `pairingStragglers` ({eventId} only), abort ledger with
//   outcome 'aborted-pairing', throw — dry and live alike, no request
//   beyond the census, zero POSTs, zero aggregate GETs.
//
// - MULTI-VALUE stops the step AHEAD of pairing (S2 precedent: a doubled
//   name is not classifiable at all): any event holding more than one
//   `name` or `event_name` value → `multiValue` (eventId + both counts),
//   outcome 'aborted-multi-value', throw before any write.
//
// - CLASSIFICATION for counts: `paired` = non-empty `event_name` (whatever
//   `name` holds — post-S3 events have no `name` at all); `nameless` =
//   neither non-empty. A total would be wrong (#421 body): paired is 10
//   today and moves as the app writes new events.
//
// - PROP-DEF + RIGHTS PREFLIGHT: resolve the event type's existing `name`
//   prop-def by S1's exact query shape —
//   `entity?_type.reference=<propertyMetaTypeId>&_parent.reference=<eventTypeId>&name.string=name&props=_owner,_editor,formula&limit=1`
//   (meta-type ids via resolveMetaTypeIds, event type id via
//   resolveTypeIdByName, same as S1). Abort 'aborted-rights' when
//   cfg.userId is absent from the prop-def's `_owner`/`_editor`
//   references (`.reference` ONLY — `.string` bakes the person's name).
//   Abort 'aborted-already-formula' when the prop-def already carries a
//   formula value — idempotence: a re-run after success reports and stops
//   without writing. Rights checked first.
//
// - DRY RUN (the default): zero POSTs, zero aggregate GETs — the census
//   and the prop-def resolution GETs are the whole wire. The ledger
//   carries the EXACT formula string, the counts (total/paired/nameless),
//   the prop-def id and the rights result, and says plainly that the
//   overwrite cannot be previewed (a formula has no non-destructive mode).
//
// - LIVE: exactly ONE POST — `entity/{namePropDefId}` with body
//   `[{type:'formula', string: FORMULA}]` (probe-233's proven wire shape,
//   NO DELETE first: `formula` behaved as a settable single value). Then
//   touch-save EVERY crede event via `GET entity/{id}/aggregate` — the
//   documented mechanic (api/best-practices: "fresh formula values after
//   external changes"); read-only, so no per-event write rights needed.
//   The formula POST strictly precedes every aggregate GET.
//
// - READ-BACK: one re-GET `entity?_type.string=event&props=name,event_name
//   &limit=10000` for the census set, asserting per event: exactly one
//   `name` value, non-empty; where `event_name` is present the name
//   CONTAINS the event_name string; where absent the name is still
//   non-empty (date — type). Mismatches → ledger outcome
//   'completed-with-mismatch' with `mismatchIds`, saying plainly the
//   overwrite cannot be undone, then THROW — never a silent partial.
//
// - LEDGER through #402's committed-allowlist writer: sensitive:true,
//   `committed.allow` keyed by ids/outcome/counts only — NEVER a field
//   named `name` (DEFAULT_REDACT_FIELDS) and NEVER 'authorizedBy' in
//   allow (the #417 fence rejects it; the writer owns the envelope key).
//   Counts: total, paired, nameless, aggregated, readBackOk,
//   readBackMismatch; ids: mismatchIds.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const LEDGER_PATH = 'scripts/migrations/seed-results/crede-instance/seed-233-s4-fake.json';
const writeLedgerMock = vi.fn(() => LEDGER_PATH);

// #417 (S1/S2 precedent) — ONLY `writeLedger` is replaced; everything else
// in the module, `assertLiveRunAuthorized` above all, is the REAL export,
// so the gate is exercised against running code.
vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import { runSeed233S4, FORMULA as FORMULA_EXPORT } from './seed-233-s4-event-name-formula-crede';

/** The runner identity loadCredeCfg reports from the /auth exchange. */
type CredeRunnerCfg = EntuCfg & { userId: string };

const RUNNER_ID = 'runner-person-1';
const cfg: CredeRunnerCfg = { db: 'mvox_crede', token: 'jwt', userId: RUNNER_ID };
const BASE = 'https://api.entu-test.invalid/mvox_crede';

/** #417 canonical authorizer shape: name, channel, issue-comment URL — never an email. */
const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/421#issuecomment-PLACEHOLDER';

/** The exact RPN formula string the ONE live POST carries — #421's whole point. */
const FORMULA = "start_datetime event_type event_name ' — ' CONCAT_WS";

const CENSUS_URL = `${BASE}/entity?_type.string=event&props=name,event_name,start_datetime,event_type&limit=10000`;
const META_ENTITY_URL = `${BASE}/entity?_type.string=entity&name.string=entity&props=_id&limit=1`;
const META_PROPERTY_URL = `${BASE}/entity?_type.string=entity&name.string=property&props=_id&limit=1`;
const EVENT_TYPE_URL = `${BASE}/entity?_type.reference=meta-entity-1&name.string=event&props=_id&limit=1`;
const PROPDEF_URL = `${BASE}/entity?_type.reference=meta-property-1&_parent.reference=type-event-1&name.string=name&props=_owner,_editor,formula&limit=1`;
const READBACK_URL = `${BASE}/entity?_type.string=event&props=name,event_name&limit=10000`;

const NAME_PROPDEF_ID = 'pd-name-1';

// The exact allowlist the committed twin is built from — ids, counts,
// outcomes and the formula string only; no DEFAULT_REDACT_FIELDS member,
// no `string`, and no 'authorizedBy' (writeLedger injects it into the
// committed envelope itself; the fence rejects an allow entry for it).
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

/** The dry ledger's plain statement that the overwrite cannot be previewed. */
const OVERWRITE_PREVIEW =
	'none — a formula has no non-destructive mode; the pairing preflight is the only guard before the overwrite';

/** The mismatch ledger's plain statement that the overwrite cannot be undone. */
const MISMATCH_NOTE =
	'the formula overwrite cannot be undone — the mismatched events need manual review';

// ---------------------------------------------------------------------------
// Fixtures — census entities in Entu's multi-value wire shape. The name
// STRINGS are what the ledger-hygiene walk hunts for; keep them distinctive.
// ---------------------------------------------------------------------------

type CensusEvent = {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
	start_datetime?: Array<{ _id: string; datetime?: string }>;
	event_type?: Array<{ _id: string; string?: string }>;
};

const START = '2026-10-03T18:00:00.000Z';
const TYPE = 'kontsert';

function pairedEvent(i: number): CensusEvent {
	const value = `Sündmus number ${i}`;
	return {
		_id: `ev-paired-${i}`,
		name: [{ _id: `p-paired-${i}-name`, string: value }],
		event_name: [{ _id: `p-paired-${i}-en`, string: value }],
		start_datetime: [{ _id: `p-paired-${i}-dt`, datetime: START }],
		event_type: [{ _id: `p-paired-${i}-type`, string: TYPE }]
	};
}

function namelessEvent(i: number): CensusEvent {
	return {
		_id: `ev-nameless-${i}`,
		start_datetime: [{ _id: `p-nameless-${i}-dt`, datetime: START }],
		event_type: [{ _id: `p-nameless-${i}-type`, string: TYPE }]
	};
}

/** Mirrors crede's live estate after S2: 10 paired + 36 nameless = 46. */
const CREDE: CensusEvent[] = [
	...Array.from({ length: 10 }, (_, i) => pairedEvent(i + 1)),
	...Array.from({ length: 36 }, (_, i) => namelessEvent(i + 1))
];

/**
 * The go/no-go trigger: two stragglers the formula would destroy — one with
 * no event_name property at all, one with a PRESENT but blank value (empty
 * beats presence here: an empty event_name pairs with nothing). The clean
 * paired and nameless events prove the abort stops the whole step.
 */
const STRAGGLERS: CensusEvent[] = [
	pairedEvent(1),
	namelessEvent(1),
	{ _id: 'ev-s1', name: [{ _id: 'p-s1-name', string: 'Kirjutati vahepeal' }] },
	{
		_id: 'ev-s2',
		name: [{ _id: 'p-s2-name', string: 'Tühjaks jäänud paar' }],
		event_name: [{ _id: 'p-s2-en', string: '   ' }]
	}
];

/** Doubled values — not classifiable, checked ahead of pairing. */
const MULTI_VALUE: CensusEvent[] = [
	pairedEvent(1),
	{
		_id: 'ev-mv1',
		name: [
			{ _id: 'p-mv1-name-a', string: 'Esimene nimi' },
			{ _id: 'p-mv1-name-b', string: 'Teine nimi' }
		]
	},
	{
		_id: 'ev-mv2',
		name: [{ _id: 'p-mv2-name', string: 'Kolmas nimi' }],
		event_name: [
			{ _id: 'p-mv2-en-a', string: 'Kolmas nimi' },
			{ _id: 'p-mv2-en-b', string: 'Keegi lisas teise' }
		]
	}
];

/** Small clean estate for the preflight-abort cases. */
const SMALL: CensusEvent[] = [pairedEvent(1), namelessEvent(1), namelessEvent(2)];

// ---------------------------------------------------------------------------
// Fake wire: census GET, meta-type + prop-def resolution GETs, the ONE
// formula POST, per-event aggregate GETs, the read-back GET — routed by
// full URL, every request logged.
// ---------------------------------------------------------------------------

type LoggedRequest = { url: string; method: string; body: unknown };

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function isNonEmpty(value: string | undefined): boolean {
	return value !== undefined && value.trim().length > 0;
}

function makeWire(
	events: CensusEvent[],
	overrides: {
		/** Census `count` reported by the db; defaults to events.length. */
		countOverride?: number;
		/**
		 * The `name` prop-def's rights references and formula posture.
		 * Default: runner in _owner, no formula value yet.
		 */
		propDef?: { owners?: string[]; editors?: string[]; formula?: string };
		/** Read-back `name` value per event id, overriding the computed one. */
		readbackNameOverride?: Record<string, string>;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const requests: LoggedRequest[] = [];

	const propDef = overrides.propDef ?? { owners: [RUNNER_ID] };
	// `reference` is the id the rights preflight must check; `string` is the
	// baked person NAME (PII), present precisely so a check reading .string
	// instead of .reference could not pass.
	const refs = (ids: string[] | undefined, tier: string) =>
		ids?.length
			? ids.map((id, i) => ({ _id: `r-pd-${tier}-${i}`, reference: id, string: `Isik ${id}` }))
			: undefined;
	const propDefEntity = {
		_id: NAME_PROPDEF_ID,
		_owner: refs(propDef.owners, 'owner'),
		_editor: refs(propDef.editors, 'editor'),
		...(propDef.formula !== undefined
			? { formula: [{ _id: 'p-pd-formula-old', string: propDef.formula }] }
			: {})
	};

	/** What the formula computes for one event once it has landed. */
	function formulaValue(event: CensusEvent): string {
		const eventName = event.event_name?.[0]?.string;
		const base = `${START} — ${TYPE}`;
		return isNonEmpty(eventName) ? `${base} — ${eventName}` : base;
	}

	const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
		requests.push({ url, method, body: parsedBody });

		if (method === 'GET' && url === CENSUS_URL) {
			return json({ count: overrides.countOverride ?? events.length, entities: events });
		}
		if (method === 'GET' && url === META_ENTITY_URL) {
			return json({ entities: [{ _id: 'meta-entity-1' }] });
		}
		if (method === 'GET' && url === META_PROPERTY_URL) {
			return json({ entities: [{ _id: 'meta-property-1' }] });
		}
		if (method === 'GET' && url === EVENT_TYPE_URL) {
			return json({ entities: [{ _id: 'type-event-1' }] });
		}
		if (method === 'GET' && url === PROPDEF_URL) {
			return json({ entities: [propDefEntity] });
		}

		if (method === 'POST' && url === `${BASE}/entity/${NAME_PROPDEF_ID}`) {
			return json({ properties: [{ _id: 'p-pd-formula-new', type: 'formula' }] });
		}

		const aggregateMatch = url.match(new RegExp(`^${BASE}/entity/(ev-[\\w-]+)/aggregate$`));
		if (method === 'GET' && aggregateMatch) {
			return json({ _id: aggregateMatch[1] });
		}

		if (method === 'GET' && url === READBACK_URL) {
			const entities = events.map((event) => {
				const value = overrides.readbackNameOverride?.[event._id] ?? formulaValue(event);
				return {
					_id: event._id,
					name: [{ _id: `p-${event._id}-name-computed`, string: value }],
					...(event.event_name ? { event_name: event.event_name } : {})
				};
			});
			return json({ count: entities.length, entities });
		}

		return json({ error: `unrouted request: ${method} ${url}` }, 500);
	}) as typeof fetch;

	return { fetchImpl, requests };
}

/** Collect every object key anywhere in a parsed tree (ledger hygiene walk). */
function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
	if (Array.isArray(value)) {
		for (const v of value) collectKeys(v, into);
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			into.add(k);
			collectKeys(v, into);
		}
	}
	return into;
}

const censusGet: LoggedRequest = { url: CENSUS_URL, method: 'GET', body: null };

/** The prop-def resolution chain — meta types, event type, `name` prop-def. */
const propDefResolutionGets: LoggedRequest[] = [
	{ url: META_ENTITY_URL, method: 'GET', body: null },
	{ url: META_PROPERTY_URL, method: 'GET', body: null },
	{ url: EVENT_TYPE_URL, method: 'GET', body: null },
	{ url: PROPDEF_URL, method: 'GET', body: null }
];

const formulaPost: LoggedRequest = {
	url: `${BASE}/entity/${NAME_PROPDEF_ID}`,
	method: 'POST',
	body: [{ type: 'formula', string: FORMULA }]
};

function aggregateGet(eventId: string): LoggedRequest {
	return { url: `${BASE}/entity/${eventId}/aggregate`, method: 'GET', body: null };
}

const readbackGet: LoggedRequest = { url: READBACK_URL, method: 'GET', body: null };

beforeEach(() => {
	writeLedgerMock.mockClear();
});

// ---------------------------------------------------------------------------

describe('#421 — the exported FORMULA constant and its standing comment', () => {
	it("FORMULA is exactly `start_datetime event_type event_name ' — ' CONCAT_WS` (RPN; CONCAT_WS drops absent operands)", () => {
		expect(FORMULA_EXPORT).toBe(FORMULA);
	});

	it('the script source carries the full-timestamp note and its re-verify trigger VERBATIM (#421 Done-when box 3)', () => {
		const src = readFileSync(join(import.meta.dirname, 'seed-233-s4-event-name-formula-crede.ts'), 'utf-8');
		expect(src).toContain(
			'Full ISO timestamp in the formula, no platform-side way to shorten it (re-verify if Entu ships SUBSTRING)'
		);
	});
});

describe('#421 — the #417 live-run gate', () => {
	it('a LIVE run with no authorizer throws BEFORE any fetch — the gate is the first statement, ahead of the census', async () => {
		const { fetchImpl, requests } = makeWire(CREDE);

		await expect(runSeed233S4(cfg, false, fetchImpl)).rejects.toThrow(/authorizedBy|AUTHORIZED_BY/i);

		expect(requests).toEqual([]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('#421 — census', () => {
	it('THROWS when count !== entities.length (a truncated census would leave events outside the pairing check) — nothing after the census', async () => {
		const { fetchImpl, requests } = makeWire(CREDE, { countOverride: 99 });

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/census truncated/i);

		expect(requests).toEqual([censusGet]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('#421 — pairing preflight: the go/no-go, a STOP, never a count to proceed past', () => {
	it('LIVE: a straggler (non-empty name, empty/absent event_name) → abort ledger aborted-pairing with the ids, throws, zero POSTs, zero aggregate GETs', async () => {
		const { fetchImpl, requests } = makeWire(STRAGGLERS);

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/pairing/i);

		// The dry run cannot preview the overwrite, so this preflight is the
		// only thing standing between a straggler and a destroyed name: the
		// census is the ONLY request — not even the prop-def is resolved.
		expect(requests).toEqual([censusGet]);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
		expect(requests.filter((r) => r.url.endsWith('/aggregate'))).toEqual([]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				outcome: 'aborted-pairing',
				// stragglers sit in neither bucket — they are the reason there
				// is no bucket to put them in
				counts: { total: 4, paired: 1, nameless: 1 },
				// ids only — the straggler's name value never reaches a ledger
				pairingStragglers: [{ eventId: 'ev-s1' }, { eventId: 'ev-s2' }]
			}
		});
	});

	it('DRY: the pairing abort fires on the dry run alike — throws, outcome aborted-pairing, census is the only request', async () => {
		const { fetchImpl, requests } = makeWire(STRAGGLERS);

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/pairing/i);

		expect(requests).toEqual([censusGet]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			dryRun: boolean;
			payload: { outcome: string; pairingStragglers: Array<{ eventId: string }> };
		};
		expect(call.dryRun).toBe(true);
		expect(call.payload.outcome).toBe('aborted-pairing');
		expect(call.payload.pairingStragglers).toEqual([{ eventId: 'ev-s1' }, { eventId: 'ev-s2' }]);
	});
});

describe('#421 — a multi-valued name/event_name stops the step ahead of pairing', () => {
	it('DRY: multiValue non-empty → throws, outcome aborted-multi-value with both counts per event, census is the only request', async () => {
		const { fetchImpl, requests } = makeWire(MULTI_VALUE);

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/more than one/i);

		expect(requests).toEqual([censusGet]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: undefined,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: true,
				outcome: 'aborted-multi-value',
				// the doubled events are not classifiable and sit in no bucket
				counts: { total: 3, paired: 1, nameless: 0 },
				multiValue: [
					{ eventId: 'ev-mv1', nameCount: 2, eventNameCount: 0 },
					{ eventId: 'ev-mv2', nameCount: 1, eventNameCount: 2 }
				]
			}
		});
	});

	it('the multi-value abort WINS over pairing when both are present — a doubled name is not classifiable at all', async () => {
		const BOTH: CensusEvent[] = [
			{ _id: 'ev-s1', name: [{ _id: 'p-s1-name', string: 'Kirjutati vahepeal' }] },
			{
				_id: 'ev-mv1',
				name: [
					{ _id: 'p-mv1-name-a', string: 'Esimene nimi' },
					{ _id: 'p-mv1-name-b', string: 'Teine nimi' }
				]
			}
		];
		const { fetchImpl, requests } = makeWire(BOTH);

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/more than one/i);

		expect(requests).toEqual([censusGet]);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { outcome: string; multiValue: Array<{ eventId: string }> };
		};
		expect(call.payload.outcome).toBe('aborted-multi-value');
		expect(call.payload.multiValue).toEqual([{ eventId: 'ev-mv1', nameCount: 2, eventNameCount: 0 }]);
	});
});

describe('#421 — prop-def + rights preflight on the `name` prop-def', () => {
	it('LIVE: runner absent from the prop-def _owner/_editor references → aborted-rights, NO POST — .reference only, never .string', async () => {
		const { fetchImpl, requests } = makeWire(SMALL, {
			propDef: { owners: ['keegi-teine-1'], editors: ['keegi-teine-2'] }
		});

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/rights/i);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				outcome: 'aborted-rights',
				counts: { total: 3, paired: 1, nameless: 2 },
				namePropDefId: NAME_PROPDEF_ID,
				rightsOk: false
			}
		});
	});

	it('LIVE: the prop-def already carries a formula value → aborted-already-formula, NO POST — a re-run after success reports and stops', async () => {
		const { fetchImpl, requests } = makeWire(SMALL, {
			propDef: { owners: [RUNNER_ID], formula: FORMULA }
		});

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/already.*formula/i);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				outcome: 'aborted-already-formula',
				counts: { total: 3, paired: 1, nameless: 2 },
				namePropDefId: NAME_PROPDEF_ID,
				rightsOk: true,
				existingFormula: FORMULA
			}
		});
	});
});

describe('#421 — dry run (the default): report everything, write nothing', () => {
	it('zero POSTs, zero aggregate GETs; the ledger carries the exact formula string, the counts, the prop-def id, the rights result and the no-preview statement', async () => {
		const { fetchImpl, requests } = makeWire(CREDE);

		const result = await runSeed233S4(cfg, true, fetchImpl);

		// The whole dry wire: census + the prop-def resolution chain. The
		// overwrite itself cannot be previewed — a formula has no
		// non-destructive mode — so there is nothing more a dry run may do.
		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

		expect(result).toEqual({
			outcome: 'dry-run',
			formula: FORMULA,
			counts: { total: 46, paired: 10, nameless: 36 },
			namePropDefId: NAME_PROPDEF_ID,
			ledgerPath: LEDGER_PATH
		});

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			// a dry run passes no authorizer and needs none — the writer
			// records the NO_AUTHORIZATION_DRY_RUN sentinel itself
			authorizedBy: undefined,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: true,
				outcome: 'dry-run',
				formula: FORMULA,
				counts: { total: 46, paired: 10, nameless: 36 },
				namePropDefId: NAME_PROPDEF_ID,
				rightsOk: true,
				overwritePreview: OVERWRITE_PREVIEW
			}
		});
	});
});

describe('#421 — live run: ONE formula POST, then touch-save EVERY event, then read-back', () => {
	it('happy path over the crede estate (10 paired + 36 nameless): exactly one POST, 46 aggregate GETs, one read-back GET — outcome completed', async () => {
		const { fetchImpl, requests } = makeWire(CREDE);

		const result = await runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH);

		// Full request order: census → prop-def resolution → the ONE formula
		// POST (no DELETE first — probe-233's proven wire shape) → one
		// aggregate GET per event in census order → the read-back GET.
		expect(requests).toEqual([
			censusGet,
			...propDefResolutionGets,
			formulaPost,
			...CREDE.map((e) => aggregateGet(e._id)),
			readbackGet
		]);

		// The formula POST strictly precedes every aggregate GET — an
		// aggregate before the formula lands would bake the OLD value fresh.
		const postIndex = requests.findIndex((r) => r.method === 'POST');
		const firstAggregate = requests.findIndex((r) => r.url.endsWith('/aggregate'));
		expect(postIndex).toBeGreaterThan(-1);
		expect(firstAggregate).toBeGreaterThan(postIndex);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([formulaPost]);
		expect(requests.filter((r) => r.method === 'DELETE')).toEqual([]);

		expect(result).toEqual({
			outcome: 'completed',
			formula: FORMULA,
			counts: { total: 46, paired: 10, nameless: 36, aggregated: 46, readBackOk: 46, readBackMismatch: 0 },
			namePropDefId: NAME_PROPDEF_ID,
			mismatchIds: [],
			ledgerPath: LEDGER_PATH
		});

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				outcome: 'completed',
				formula: FORMULA,
				counts: { total: 46, paired: 10, nameless: 36, aggregated: 46, readBackOk: 46, readBackMismatch: 0 },
				namePropDefId: NAME_PROPDEF_ID,
				mismatchIds: []
			}
		});
	});

	it('read-back mismatch (a paired event whose recomputed name lost its event_name) → ledger completed-with-mismatch with mismatchIds, then THROWS', async () => {
		// ev-paired-1's read-back renders date — type only: its event_name no
		// longer appears in the name the formula computed. That cannot be
		// undone — the old stored value is gone — so the ledger says so.
		const { fetchImpl } = makeWire(CREDE, {
			readbackNameOverride: { 'ev-paired-1': `${START} — ${TYPE}` }
		});

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/mismatch/i);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s4-event-name-formula-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				outcome: 'completed-with-mismatch',
				formula: FORMULA,
				counts: { total: 46, paired: 10, nameless: 36, aggregated: 46, readBackOk: 45, readBackMismatch: 1 },
				namePropDefId: NAME_PROPDEF_ID,
				mismatchIds: ['ev-paired-1'],
				mismatchNote: MISMATCH_NOTE
			}
		});
	});
});

describe('#421 — ledger hygiene through the #402 committed-allowlist writer', () => {
	it("NO key `name` anywhere in the ledger call, no event-name value string rides along, and the authorizer travels on the envelope — never in allow", async () => {
		const { fetchImpl } = makeWire(CREDE);

		await runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH);

		const call = writeLedgerMock.mock.calls[0]?.[0] as Record<string, unknown>;

		// `name` is a DEFAULT_REDACT_FIELDS member — no key anywhere in the
		// call may carry it (namePropDefId is a different key, not `name`).
		expect(collectKeys(call).has('name')).toBe(false);

		// No event-name VALUE rides along under any other key either.
		const serialized = JSON.stringify(call);
		for (const nameValue of ['Sündmus number 1', 'Sündmus number 7', 'Sündmus number 10']) {
			expect(serialized).not.toContain(nameValue);
		}

		// #417: writeLedger injects authorizedBy into the committed envelope
		// itself — the engine passes it as the envelope option, and the allow
		// array never names it (the fence rejects an entry for it).
		expect(call.authorizedBy).toBe(LIVE_AUTH);
		const allow = (call.committed as { allow: string[] }).allow;
		expect(allow).not.toContain('authorizedBy');
	});

	it("the committed allowlist itself names no DEFAULT_REDACT_FIELDS member, not `string`, and not `authorizedBy`", () => {
		const denied = [
			'email',
			'forename',
			'surname',
			'phone',
			'birthdate',
			'name',
			'id_code',
			'string',
			'authorizedby'
		];
		for (const field of COMMITTED_ALLOW) {
			expect(denied).not.toContain(field.toLowerCase());
		}
	});
});

// (*MVOX:Tallis*)
