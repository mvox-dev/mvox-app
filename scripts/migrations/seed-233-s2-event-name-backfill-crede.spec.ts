// mvox-app#233 S2 / mvox-app#419 (RED, Tallis) — copy every crede event's
// `name` value into `event_name`. This backfill must be complete before S4
// turns `name` into a formula: a formula overwrites the stored value on
// every save and silently drops POSTs, so any name not copied first is gone.
//
// Crede ONLY, ONE script (the per-db `-crede-`/`-<other>-` twin-script
// pattern ended at S1 — estate ruling, Mihkel 2026-09-18, folded into the
// #233 body).
// networkGuard.setup.ts stands behind every spec: nothing here can reach a
// live db; the whole wire is a fake fetch and every request is asserted
// full-shape with toEqual (partial assertions hide bugs).
//
// Contract pinned here, for GREEN to satisfy:
//
// - The script module `./seed-233-s2-event-name-backfill-crede` is
//   side-effect-free on import (main() only under the isMainModule guard,
//   same as S1) and exports
//   `runSeed233S2(cfg, dryRun, fetchImpl, authorizedBy?)` returning
//   `{ counts, rerun, outcomes, ledgerPath }`. The 4th parameter is #417's
//   gate: `assertLiveRunAuthorized(dryRun, authorizedBy)` runs as the
//   FIRST statement — before the census GET — so a live run with no
//   recorded authorizer throws before ANY request leaves the script.
//   `authorizedBy` is passed through into the writeLedger call so the
//   envelope names the authorizer (#419 Done-when box 3).
//
// - The runner identity: `cfg.userId` — the user id the /auth exchange in
//   loadCredeCfg reports for the target db (script-runner.spec.ts pins that
//   loadCredeCfg now returns it; existing keys untouched). The rights
//   preflight below checks THIS id against each event's `_owner`/`_editor`
//   references.
//
// - CENSUS: one db-wide GET
//   `entity?_type.string=event&props=name,event_name,_owner,_editor&limit=10000`
//   — NO `_parent.reference=` scoping (S2 must cover every crede event,
//   whatever it hangs under). HARD-THROW when
//   `body.count !== body.entities.length`: a silently truncated census
//   would otherwise leave unmigrated events for
//   S4's formula to blank. The rights props ride along on this ONE query
//   (Entu returns them on a list — precedent:
//   probes/probe-356-crede-conductor-rights-2026-09-15.ts, which lists
//   crede events with exactly those props), so the rights preflight below
//   issues NO request of its own.
//
// - MULTI-VALUED SOURCE STOPS THE STEP (#419 review round 1): Entu string
//   props are implicitly multi-valued (POST appends). An event whose `name`
//   or `event_name` holds MORE THAN ONE value is collected as `multiValue`
//   (eventId + nameCount + eventNameCount) during classification, given NO
//   outcome, and a non-empty list stops the run before the rights check and
//   before any write — dry and live alike, no request beyond the census,
//   throws, ONE ledger with outcome 'aborted-multi-value'. Checked FIRST,
//   ahead of the three rules: copying value [0] and leaving [1] behind is
//   exactly the loss S4's formula then makes permanent, and the read-back
//   canary's exactly-one-value check covers only values THIS run wrote.
//   The list carries no value string, so the committed twin keeps it whole.
//
// - IDEMPOTENCE = THREE RULES (#233 body / #419), in this precedence:
//     1. `event_name` PRESENT (the property exists) → never POSTed to,
//        whatever it holds: Entu's POST appends, so a second value must
//        never be written, and presence is the only test that keeps it from
//        being. A non-empty value EQUAL to `name` (or `name` absent/empty)
//        → outcome 'already-migrated', NO write, run CONTINUES. A non-empty
//        value that DIFFERS from a non-empty `name` → `eventNameDiffers`
//        (id + name + stored value), see DIVERGENCE below. A BLANK value —
//        whitespace-only, empty, or a value document with no `string` at
//        all → `blankEventName` (id only), see BLANK below.
//     2. else `name` absent OR empty/whitespace → outcome 'no-name', id
//        recorded, NO write — NEVER write an empty value.
//     3. only then POST.
//
// - BLANK STOPS THE STEP (#419 review round 2): a present-but-blank
//   `event_name` is collected as `blankEventName` during classification,
//   given NO outcome, and a non-empty list stops the run right after the
//   multi-value stop and before divergence — dry and live alike, no request
//   beyond the census, throws, ONE ledger with outcome
//   'aborted-blank-event-name'. Nothing writes `event_name` today, so a
//   blank value is a surprise a human decides on; a write would append a
//   second value and the read-back canary would only catch it afterwards.
//   The list carries ids alone, so the committed twin keeps it whole.
//
// - DIVERGENCE STOPS THE STEP (#419 amended body, Gama comment 5742461628 +
//   the fourth Done-when box: 'a divergent value stops the step and is
//   reported, never skipped past'): when `eventNameDiffers` is non-empty
//   after classification, the run STOPS before any write — dry and live
//   alike — issues NO request beyond the census, throws (main() exits
//   non-zero), and writes ONE ledger with outcome 'aborted-divergence' and
//   the offending list. Nothing writes `event_name` today, so a divergent
//   event is a surprise a human decides on, not a state to skip past.
//
// - RIGHTS PREFLIGHT (same comment, point 2): before any write, for EVERY
//   event that would be written, check `cfg.userId` appears among the
//   `reference`s of the `_owner`/`_editor` lists the CENSUS returned
//   (references only — never `.string`, which bakes PII; and no per-event
//   GET — see CENSUS above). Events lacking it are collected as `noRights`
//   (id + name); non-empty → STOP before any write, throw (exit non-zero),
//   ledger outcome 'aborted-rights' with the list. This runs ON THE DRY RUN
//   TOO, so the dry-run report shows the missing grants before
//   authorization is sought. The list is complete before any POST — the
//   report names every missing grant, not the first.
//
// - ABORT ARTEFACTS (all four kinds): nothing was written, so the payload keys
//   the plan as `wouldMigrate`/`wouldMigrateIds` on dry AND live runs alike
//   (a count named for what happened cannot be misread — 'migrated' names
//   writes that never occurred), and `rerun` is FALSE: an aborted run has
//   migrated===0 and failed===0, and without the pin the crash artefact
//   would carry the exact flag the closing sweep reads as healthy. The
//   four abort lists (`multiValue`, `blankEventName`, `eventNameDiffers`,
//   `noRights`) plus `outcome` are the ONLY ledger additions besides the
//   drafted buckets. `eventNameDiffers`/`noRights` carry the name values
//   (nameValue/storedValue) for the operator — the instance ledger is
//   gitignored (sensitive:true) — while the committed allowlist admits only
//   `eventId` inside them, so no name value can reach git history.
//   `multiValue` carries counts and `blankEventName` ids alone, never a
//   value, so those two survive whole.
//
// - LIVE WRITE per migrated event: `POST entity/{id}` with
//   `[{ type: 'event_name', string: <name> }]` (event_name never has a prior
//   property at all on a migrated event — rule 1 skipped or aborted
//   otherwise — so Entu's POST-append is unambiguously a new value, not a
//   replace). Then the 3-check canary: (a) POST response
//   carries the new `event_name` property _id, (b) re-GET `entity/{id}?
//   props=event_name` reads back a value EQUAL to the source name,
//   (c) exactly ONE value. Any check failing → ledger records the event as
//   failed, then THROW — never a false 'migrated'.
//
// - DRY_RUN default prints the plan: zero POSTs (the census and the rights
//   preflight GETs are the only wire traffic), per-event outcome
//   'would-migrate' where a live run would write. The plan is keyed
//   SEPARATELY from a live run's writes — `counts.wouldMigrate` /
//   `wouldMigrateIds`, and NO `migrated` / `migratedIds` key at all.
//
// - RE-RUN posture: this script is re-run immediately before S4 as the
//   closing sweep. A re-run that writes ZERO and skips ALL is the HEALTHY
//   outcome and must read as one: result and ledger carry `rerun: true`
//   when migrated===0, failed===0 and total>0, plus the skipped counts.
//   The failed===0 term is load-bearing: the canary path writes the ledger
//   and THROWS, so an ABORTED run whose FIRST migration failed also has
//   migrated===0 — that crash artefact must NOT carry the flag the closing
//   sweep reads as 'healthy, nothing left to do'.
//
// - LEDGER through #402's committed-allowlist writer: sensitive:true routes
//   the instance file to gitignored crede-instance/; `committed.allow`
//   builds the tracked twin. Payload keyed by eventId/outcome/counts
//   ({ total, migrated|wouldMigrate, alreadyMigrated, noName, failed }) +
//   eventIds per outcome — NEVER a field keyed `name`
//   (DEFAULT_REDACT_FIELDS member; the committed allowlist throws on it).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json');

// mvox-app#417 (carried from S1 review round 1, Bentham) — ONLY `writeLedger`
// is replaced; everything else in the module, `assertLiveRunAuthorized`
// above all, is the REAL export. The mutation lives inside the exported
// engine, so this spec is the only place the gate is exercised against
// running code — a full-module mock would both hide a missing gate call
// (TypeError instead of the gate's own throw) and let the spec pin a
// production-impossible shape (dryRun:false with authorizedBy:undefined,
// which the real writeLedger records as UNRECORDED_AUTHORIZATION).
vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import { runSeed233S2 as runSeed233S2Draft } from './seed-233-s2-event-name-backfill-crede';
import type { RunSeed233S2Result } from './seed-233-s2-event-name-backfill-crede';

/** The runner identity loadCredeCfg reports from the /auth exchange. */
type CredeRunnerCfg = EntuCfg & { userId: string };

// #419 (RED) — the draft engine takes 3 parameters; #417's gate adds
// `authorizedBy?: string` as the 4th. The cast pins the target signature
// while the draft still has 3 (RED fails test-by-test instead of failing
// the typecheck); GREEN makes this a plain named import with zero test
// edits.
const runSeed233S2 = runSeed233S2Draft as unknown as (
	cfg: CredeRunnerCfg,
	dryRun: boolean,
	fetchImpl?: typeof fetch,
	authorizedBy?: string
) => Promise<RunSeed233S2Result>;

const RUNNER_ID = 'runner-person-1';
const cfg: CredeRunnerCfg = { db: 'mvox_crede', token: 'jwt', userId: RUNNER_ID };
const BASE = 'https://api.entu-test.invalid/mvox_crede';

/** #417 canonical authorizer shape: name, channel, issue-comment URL — never an email. */
const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/419#issuecomment-5742461628';

const CENSUS_URL = `${BASE}/entity?_type.string=event&props=name,event_name,_owner,_editor&limit=10000`;

// The exact allowlist the committed twin is built from — ids, counts and
// outcomes only; no DEFAULT_REDACT_FIELDS member, no `string`, and NOT the
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
	// the multi-value and blank-event_name abort lists — ids and counts only,
	// never a value, so these two reach the committed twin intact
	'multiValue',
	'blankEventName',
	'nameCount',
	'eventNameCount'
] as const;

// ---------------------------------------------------------------------------
// Fixtures — census entities in Entu's multi-value wire shape. The name
// STRINGS are what the ledger-hygiene walk hunts for; keep them distinctive.
// ---------------------------------------------------------------------------

type CensusEvent = {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
};

/** Mixed estate: one to migrate, two no-name shapes, two already-migrated. */
const MIX: CensusEvent[] = [
	// plain pre-S3 event — the one S2 exists for
	{ _id: 'ev-m1', name: [{ _id: 'p-m1-name', string: 'Kevadkontsert 2026' }] },
	// name absent entirely
	{ _id: 'ev-m2' },
	// name present but whitespace-only — still 'no-name', NEVER copied
	{ _id: 'ev-m3', name: [{ _id: 'p-m3-name', string: '   ' }] },
	// first run already copied it — value equal to name
	{
		_id: 'ev-m4',
		name: [{ _id: 'p-m4-name', string: 'Jõulukontsert' }],
		event_name: [{ _id: 'p-m4-en', string: 'Jõulukontsert' }]
	},
	// post-S3 event: event_name set, NO name — rule 1 must catch it BEFORE
	// the no-name rule ever sees the absent `name`
	{ _id: 'ev-m5', event_name: [{ _id: 'p-m5-en', string: 'Sügisproov' }] }
];

/** Rerun estate: half migrated on the first run, half still plain. */
const HALF: CensusEvent[] = [
	{ _id: 'ev-r1', name: [{ _id: 'p-r1-name', string: 'Esimene proov' }] },
	{
		_id: 'ev-r2',
		name: [{ _id: 'p-r2-name', string: 'Teine proov' }],
		event_name: [{ _id: 'p-r2-en', string: 'Teine proov' }]
	},
	{ _id: 'ev-r3', name: [{ _id: 'p-r3-name', string: 'Kolmas proov' }] },
	{
		_id: 'ev-r4',
		name: [{ _id: 'p-r4-name', string: 'Neljas proov' }],
		event_name: [{ _id: 'p-r4-en', string: 'Neljas proov' }]
	}
];

/** Post-S3-only estate — the closing-sweep healthy case: nothing to write. */
const POST_S3: CensusEvent[] = [
	{ _id: 'ev-p1', event_name: [{ _id: 'p-p1-en', string: 'Uus sündmus' }] },
	{ _id: 'ev-p2', event_name: [{ _id: 'p-p2-en', string: 'Veel üks uus' }] }
];

/** Empty-string name, no event_name — 'no-name', zero POSTs. */
const EMPTY_NAME: CensusEvent[] = [{ _id: 'ev-e1', name: [{ _id: 'p-e1-name', string: '' }] }];

/**
 * #419 amended body — one clean event, one equal (already-migrated), one
 * whose stored event_name DIFFERS from its name: the abort trigger. The
 * clean event proves the abort stops even the writes that would have been
 * fine — a partial backfill is the divergence case by a different road.
 */
const DIVERGENT: CensusEvent[] = [
	{ _id: 'ev-d1', name: [{ _id: 'p-d1-name', string: 'Puhas sündmus' }] },
	{
		_id: 'ev-d2',
		name: [{ _id: 'p-d2-name', string: 'Võrdne nimi' }],
		event_name: [{ _id: 'p-d2-en', string: 'Võrdne nimi' }]
	},
	{
		_id: 'ev-d3',
		name: [{ _id: 'p-d3-name', string: 'Õige nimi' }],
		event_name: [{ _id: 'p-d3-en', string: 'Keegi kirjutas muud' }]
	}
];

/** Two plain events — the rights-preflight estate. */
const TWO_PLAIN: CensusEvent[] = [
	{ _id: 'ev-g1', name: [{ _id: 'p-g1-name', string: 'Lauluproov' }] },
	{ _id: 'ev-g2', name: [{ _id: 'p-g2-name', string: 'Kontsert Tartus' }] }
];

/**
 * #419 review round 1 — one clean event, one holding TWO `name` values, one
 * holding TWO `event_name` values whose [0] equals `name` (the read-side
 * blind spot: it would otherwise classify as 'already-migrated' and the
 * stray duplicate would survive unreported). The clean event proves the
 * abort stops even the write that would have been fine.
 */
const MULTI_VALUE: CensusEvent[] = [
	{ _id: 'ev-v1', name: [{ _id: 'p-v1-name', string: 'Ainus nimi' }] },
	{
		_id: 'ev-v2',
		name: [
			{ _id: 'p-v2-name-a', string: 'Esimene nimi' },
			{ _id: 'p-v2-name-b', string: 'Teine nimi' }
		]
	},
	{
		_id: 'ev-v3',
		name: [{ _id: 'p-v3-name', string: 'Kolmas nimi' }],
		event_name: [
			{ _id: 'p-v3-en-a', string: 'Kolmas nimi' },
			{ _id: 'p-v3-en-b', string: 'Keegi lisas teise' }
		]
	}
];

/**
 * #419 review round 2 — the presence/emptiness gap. One clean event, one
 * holding a whitespace-only `event_name`, one holding an `event_name` value
 * document with no `string` at all. Both are PRESENT properties, so a POST
 * would append and leave the event holding two values; the test that decides
 * must be presence, not emptiness. The clean event proves the abort stops
 * even the write that would have been fine.
 */
const BLANK_EVENT_NAME: CensusEvent[] = [
	{ _id: 'ev-b1', name: [{ _id: 'p-b1-name', string: 'Puhas sündmus' }] },
	{
		_id: 'ev-b2',
		name: [{ _id: 'p-b2-name', string: 'Tühi sihtväli' }],
		event_name: [{ _id: 'p-b2-en', string: '   ' }]
	},
	{
		_id: 'ev-b3',
		name: [{ _id: 'p-b3-name', string: 'Väärtuseta sihtväli' }],
		event_name: [{ _id: 'p-b3-en' }]
	},
	// empty-string event_name and no `name` — nothing would be written here
	// either way, but the blank value is still one nobody wrote, so it is
	// reported rather than filed as 'no-name'
	{ _id: 'ev-b4', event_name: [{ _id: 'p-b4-en', string: '' }] }
];

// ---------------------------------------------------------------------------
// Fake wire: census GET (carrying the rights references), per-event POST +
// read-back GET, routed by full URL.
// ---------------------------------------------------------------------------

type LoggedRequest = { url: string; method: string; body: unknown };

/** Rights the fake db reports for one event's _owner/_editor references. */
type EventRights = { owner?: string[]; editor?: string[] };

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function makeWire(
	events: CensusEvent[],
	overrides: {
		/** Census `count` reported by the db; defaults to events.length. */
		countOverride?: number;
		/** POST response loses the event_name property (canary a fails). */
		postResponseWithoutPropId?: boolean;
		/** Read-back reports THIS string instead of the written one. */
		readbackValueOverride?: string;
		/** Read-back reports TWO values (canary c fails). */
		readbackDoubled?: boolean;
		/**
		 * Per-event _owner/_editor references the census reports and the
		 * rights preflight reads. Default: every event carries the runner in
		 * _owner.
		 */
		rightsByEvent?: Record<string, EventRights>;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const requests: LoggedRequest[] = [];
	// what a well-behaved db would hold after each POST this wire accepts
	const written = new Map<string, string>();

	// The census carries the rights references — one query, no per-event GET.
	// `reference` is the id the preflight must check; `string` is the baked
	// person NAME (PII), present here precisely so a check that read .string
	// instead of .reference could not pass.
	const censusEntities = events.map((event) => {
		const rights = overrides.rightsByEvent?.[event._id] ?? { owner: [RUNNER_ID] };
		const refs = (ids: string[] | undefined, tier: string) =>
			ids?.length
				? ids.map((id, i) => ({ _id: `r-${event._id}-${tier}-${i}`, reference: id, string: `Isik ${id}` }))
				: undefined;
		return { ...event, _owner: refs(rights.owner, 'owner'), _editor: refs(rights.editor, 'editor') };
	});

	const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
		requests.push({ url, method, body: parsedBody });

		if (method === 'GET' && url === CENSUS_URL) {
			return json({ count: overrides.countOverride ?? events.length, entities: censusEntities });
		}

		const postMatch = url.match(new RegExp(`^${BASE}/entity/(ev-[\\w-]+)$`));
		if (method === 'POST' && postMatch) {
			const eventId = postMatch[1];
			const wanted = (parsedBody as Array<{ type: string; string: string }>)?.[0]?.string;
			written.set(eventId, wanted);
			if (overrides.postResponseWithoutPropId) {
				return json({ properties: [] });
			}
			return json({ properties: [{ _id: `p-${eventId}-en-new`, type: 'event_name' }] });
		}

		const readbackMatch = url.match(new RegExp(`^${BASE}/entity/(ev-[\\w-]+)\\?props=event_name$`));
		if (method === 'GET' && readbackMatch) {
			const eventId = readbackMatch[1];
			const value = overrides.readbackValueOverride ?? written.get(eventId) ?? '';
			const one = { _id: `p-${eventId}-en-new`, string: value };
			return json({
				entity: {
					_id: eventId,
					event_name: overrides.readbackDoubled ? [one, { _id: `p-${eventId}-en-dup`, string: value }] : [one]
				}
			});
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

function migrationPair(eventId: string, nameValue: string): LoggedRequest[] {
	return [
		{
			url: `${BASE}/entity/${eventId}`,
			method: 'POST',
			body: [{ type: 'event_name', string: nameValue }]
		},
		{ url: `${BASE}/entity/${eventId}?props=event_name`, method: 'GET', body: null }
	];
}

beforeEach(() => {
	writeLedgerMock.mockClear();
});

// ---------------------------------------------------------------------------

describe('#419 — the #417 live-run gate', () => {
	it('a LIVE run with no authorizer throws BEFORE any fetch — the gate is the first statement, ahead of the census', async () => {
		const { fetchImpl, requests } = makeWire(MIX);

		await expect(runSeed233S2(cfg, false, fetchImpl)).rejects.toThrow(/authorizedBy|AUTHORIZED_BY/i);

		// Nothing left the script: no census, no rights GET, no POST, and no
		// ledger — the run never started.
		expect(requests).toEqual([]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('#233 S2 — census', () => {
	it('THROWS when count !== entities.length (truncated census would leave events for the formula to blank) — nothing after the census, zero POSTs', async () => {
		const { fetchImpl, requests } = makeWire(MIX, { countOverride: 7 });

		await expect(runSeed233S2(cfg, true, fetchImpl)).rejects.toThrow(/census truncated/i);

		// The census is the FIRST and ONLY request — db-wide, no _parent
		// scoping, and the run stops dead on the mismatch.
		expect(requests).toEqual([censusGet]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('#233 S2 — dry-run (the default)', () => {
	it('ZERO POSTs; the plan lists every event with its outcome under the three-rule precedence, off the census alone', async () => {
		const { fetchImpl, requests } = makeWire(MIX);

		const result = await runSeed233S2(cfg, true, fetchImpl);

		// The dry run's WHOLE wire traffic is the census — the rights
		// references it already carries are what the preflight reads, so a
		// dry run costs exactly one round-trip and never a POST.
		expect(requests).toEqual([censusGet]);

		expect(result).toEqual({
			// the plan is `wouldMigrate`, never `migrated` — nothing was written
			counts: { total: 5, wouldMigrate: 1, alreadyMigrated: 2, noName: 2, failed: 0 },
			rerun: false,
			outcomes: [
				{ eventId: 'ev-m1', outcome: 'would-migrate' },
				{ eventId: 'ev-m2', outcome: 'no-name' },
				{ eventId: 'ev-m3', outcome: 'no-name' },
				{ eventId: 'ev-m4', outcome: 'already-migrated' },
				// post-S3 shape: event_name set, name ABSENT — rule 1 catches it
				// before the no-name rule can misread the absent name
				{ eventId: 'ev-m5', outcome: 'already-migrated' }
			],
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json'
		});

		// A dry run still writes its ledger — the plan is the artefact.
		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			// #417: a dry run passes no authorizer and needs none — the writer
			// records the NO_AUTHORIZATION_DRY_RUN sentinel itself.
			authorizedBy: undefined,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: true,
				rerun: false,
				counts: { total: 5, wouldMigrate: 1, alreadyMigrated: 2, noName: 2, failed: 0 },
				wouldMigrateIds: ['ev-m1'],
				alreadyMigratedIds: ['ev-m4', 'ev-m5'],
				noNameIds: ['ev-m2', 'ev-m3'],
				failedIds: []
			}
		});
	});

	it('the committed dry artefact can never be misread as a live one: NO `migrated`/`migratedIds` key anywhere in it', async () => {
		const { fetchImpl } = makeWire(MIX);

		const result = await runSeed233S2(cfg, true, fetchImpl);

		// Both twins land tracked in seed-results/. If the plan were spelled
		// `migrated: 1`, a dry and a live artefact for the SAME step would
		// differ by one sibling boolean while their counts read identically.
		expect(Object.keys(result.counts)).not.toContain('migrated');

		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { counts: Record<string, number> };
		};
		expect(Object.keys(call.payload.counts)).not.toContain('migrated');
		expect(collectKeys(call).has('migratedIds')).toBe(false);
	});
});

describe('#233 S2 — live run', () => {
	it('POSTs exactly [{type: event_name, string: <name>}] per plain event after the rights preflight, read-back-verifies, skips already-migrated, records no-name', async () => {
		const { fetchImpl, requests } = makeWire(MIX);

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		// Full request sequence: census, then the migration pair for the ONE
		// plain event — nothing for the two no-name and two already-migrated,
		// and no rights GET at all (the census carried the references).
		expect(requests).toEqual([censusGet, ...migrationPair('ev-m1', 'Kevadkontsert 2026')]);

		expect(result).toEqual({
			counts: { total: 5, migrated: 1, alreadyMigrated: 2, noName: 2, failed: 0 },
			rerun: false,
			outcomes: [
				{ eventId: 'ev-m1', outcome: 'migrated' },
				{ eventId: 'ev-m2', outcome: 'no-name' },
				{ eventId: 'ev-m3', outcome: 'no-name' },
				{ eventId: 'ev-m4', outcome: 'already-migrated' },
				{ eventId: 'ev-m5', outcome: 'already-migrated' }
			],
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json'
		});
	});

	it('THROWS when the POST response carries no event_name property _id (canary a) — ledger marks the event failed first', async () => {
		const { fetchImpl } = makeWire(MIX, { postResponseWithoutPropId: true });

		await expect(runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/event_name/);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { counts: Record<string, number>; failedIds: string[]; migratedIds: string[]; rerun: boolean };
		};
		expect(call.payload.failedIds).toEqual(['ev-m1']);
		expect(call.payload.counts.failed).toBe(1);
		expect(call.payload.counts.migrated).toBe(0);
		expect(call.payload.migratedIds).toEqual([]);

		// The ABORT artefact must NOT read as the healthy closing sweep. This
		// run wrote zero because it CRASHED on the first event, not because
		// there was nothing left to do — `rerun: true` alongside `failed: 1`
		// would hand the pre-S4 gate the opposite of what happened.
		expect(call.payload.rerun).toBe(false);
	});

	it('THROWS when the read-back value differs from the source name (canary b) — never a false migrated', async () => {
		const { fetchImpl } = makeWire(MIX, { readbackValueOverride: 'Vale väärtus' });

		await expect(runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/READ-BACK/i);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: { failedIds: string[] } };
		expect(call.payload.failedIds).toEqual(['ev-m1']);
	});

	it('THROWS when the read-back holds MORE than one value (canary c: count===1)', async () => {
		const { fetchImpl } = makeWire(MIX, { readbackDoubled: true });

		await expect(runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/READ-BACK/i);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: { failedIds: string[] } };
		expect(call.payload.failedIds).toEqual(['ev-m1']);
	});
});

describe('#419 — a multi-valued name/event_name stops the step, never copied in part', () => {
	it('LIVE: multiValue non-empty → NO request beyond the census, throws, ONE ledger with outcome aborted-multi-value and both counts per event', async () => {
		const { fetchImpl, requests } = makeWire(MULTI_VALUE);

		await expect(runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/more than one/i);

		// Even the clean event ev-v1 is not written: copying value [0] and
		// leaving [1] for S4's formula to blank is the loss this script
		// exists to prevent, so a human decides before any write.
		expect(requests).toEqual([censusGet]);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				// aborted, not healthy — same reason as the divergence abort
				rerun: false,
				outcome: 'aborted-multi-value',
				// nothing was written, so the plan keys stay `would*`; the two
				// multi-valued events get NO outcome and appear in no bucket
				counts: { total: 3, wouldMigrate: 1, alreadyMigrated: 0, noName: 0, failed: 0 },
				wouldMigrateIds: ['ev-v1'],
				alreadyMigratedIds: [],
				noNameIds: [],
				failedIds: [],
				multiValue: [
					{ eventId: 'ev-v2', nameCount: 2, eventNameCount: 0 },
					// the READ side: event_name[0] equals name, so without this
					// stop it would read 'already-migrated' and the stray
					// duplicate would survive unreported
					{ eventId: 'ev-v3', nameCount: 1, eventNameCount: 2 }
				]
			}
		});
	});

	it('DRY: the multi-value abort fires on the dry run alike — throws, outcome aborted-multi-value, zero requests beyond the census', async () => {
		const { fetchImpl, requests } = makeWire(MULTI_VALUE);

		await expect(runSeed233S2(cfg, true, fetchImpl)).rejects.toThrow(/more than one/i);

		expect(requests).toEqual([censusGet]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: undefined,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: true,
				rerun: false,
				outcome: 'aborted-multi-value',
				counts: { total: 3, wouldMigrate: 1, alreadyMigrated: 0, noName: 0, failed: 0 },
				wouldMigrateIds: ['ev-v1'],
				alreadyMigratedIds: [],
				noNameIds: [],
				failedIds: [],
				multiValue: [
					{ eventId: 'ev-v2', nameCount: 2, eventNameCount: 0 },
					{ eventId: 'ev-v3', nameCount: 1, eventNameCount: 2 }
				]
			}
		});
	});

	it('the multi-value abort is checked AHEAD of divergence — a doubled name is not classifiable at all', async () => {
		// ev-x1 would abort as divergence if it were ever classified; ev-x2
		// holds two `name` values. The multi-value stop must win, because
		// asking whether value [0] equals the stored event_name is the wrong
		// question about an event with two names.
		const BOTH: CensusEvent[] = [
			{
				_id: 'ev-x1',
				name: [{ _id: 'p-x1-name', string: 'Õige nimi' }],
				event_name: [{ _id: 'p-x1-en', string: 'Keegi kirjutas muud' }]
			},
			{
				_id: 'ev-x2',
				name: [
					{ _id: 'p-x2-a', string: 'Esimene nimi' },
					{ _id: 'p-x2-b', string: 'Teine nimi' }
				]
			}
		];

		const { fetchImpl, requests } = makeWire(BOTH);

		await expect(runSeed233S2(cfg, true, fetchImpl)).rejects.toThrow(/more than one/i);

		expect(requests).toEqual([censusGet]);

		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { outcome: string; multiValue: Array<{ eventId: string }> };
		};
		expect(call.payload.outcome).toBe('aborted-multi-value');
		expect(call.payload.multiValue).toEqual([{ eventId: 'ev-x2', nameCount: 2, eventNameCount: 0 }]);
	});

	it('exactly ONE value on each prop is the normal case — no abort, the run proceeds', async () => {
		const { fetchImpl, requests } = makeWire(TWO_PLAIN);

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		expect(requests).toEqual([
			censusGet,
			...migrationPair('ev-g1', 'Lauluproov'),
			...migrationPair('ev-g2', 'Kontsert Tartus')
		]);
		expect(result.counts).toEqual({ total: 2, migrated: 2, alreadyMigrated: 0, noName: 0, failed: 0 });
	});
});

describe('#419 — a PRESENT but blank event_name stops the step, never written over', () => {
	it('LIVE: a whitespace-only, a string-less and an empty-string event_name → NO request beyond the census, throws, ONE ledger with outcome aborted-blank-event-name', async () => {
		const { fetchImpl, requests } = makeWire(BLANK_EVENT_NAME);

		await expect(runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/blank event_name/i);

		// The POST appends, so writing over a present-but-blank value leaves
		// the event holding TWO event_name values — and the read-back canary
		// would only notice AFTER the write. Presence decides, not emptiness.
		expect(requests).toEqual([censusGet]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				rerun: false,
				outcome: 'aborted-blank-event-name',
				// the three blank events get NO outcome and appear in no bucket
				// — ev-b4 included, blank beats 'no-name'
				counts: { total: 4, wouldMigrate: 1, alreadyMigrated: 0, noName: 0, failed: 0 },
				wouldMigrateIds: ['ev-b1'],
				alreadyMigratedIds: [],
				noNameIds: [],
				failedIds: [],
				// ids only — a blank value carries nothing to redact, so this
				// list reaches the committed twin whole
				blankEventName: [{ eventId: 'ev-b2' }, { eventId: 'ev-b3' }, { eventId: 'ev-b4' }]
			}
		});
	});

	it('DRY: the blank abort fires on the dry run alike — throws, outcome aborted-blank-event-name, zero requests beyond the census', async () => {
		const { fetchImpl, requests } = makeWire(BLANK_EVENT_NAME);

		await expect(runSeed233S2(cfg, true, fetchImpl)).rejects.toThrow(/blank event_name/i);

		expect(requests).toEqual([censusGet]);

		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			dryRun: boolean;
			payload: { outcome: string; rerun: boolean; blankEventName: Array<{ eventId: string }> };
		};
		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(call.dryRun).toBe(true);
		expect(call.payload.outcome).toBe('aborted-blank-event-name');
		expect(call.payload.rerun).toBe(false);
		expect(call.payload.blankEventName).toEqual([
			{ eventId: 'ev-b2' },
			{ eventId: 'ev-b3' },
			{ eventId: 'ev-b4' }
		]);
	});
});

describe('#419 — a divergent event_name stops the step, never skipped past', () => {
	it('LIVE: eventNameDiffers non-empty → NO request beyond the census (no rights GET, no POST), throws, ONE ledger with outcome aborted-divergence and the offending list', async () => {
		const { fetchImpl, requests } = makeWire(DIVERGENT);

		await expect(runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/diverg/i);

		// The run stops at the first gate after classification: even the
		// clean event ev-d1 is not written — a human decides before the
		// write, not after.
		expect(requests).toEqual([censusGet]);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				// aborted, not healthy: migrated===0 && failed===0 would
				// otherwise read as the closing sweep's 'nothing left to do'
				rerun: false,
				outcome: 'aborted-divergence',
				// nothing was written — the plan keys stay `would*` on a live
				// abort too; `migrated` names writes that never occurred
				counts: { total: 3, wouldMigrate: 1, alreadyMigrated: 1, noName: 0, failed: 0 },
				wouldMigrateIds: ['ev-d1'],
				alreadyMigratedIds: ['ev-d2'],
				noNameIds: [],
				failedIds: [],
				// id + name + stored value — the operator's decision material.
				// The values live in the gitignored instance file only: the
				// committed allowlist admits `eventId` alone inside this list.
				eventNameDiffers: [{ eventId: 'ev-d3', nameValue: 'Õige nimi', storedValue: 'Keegi kirjutas muud' }]
			}
		});
	});

	it('DRY: the divergence abort fires on the dry run alike — throws, outcome aborted-divergence, zero requests beyond the census', async () => {
		const { fetchImpl, requests } = makeWire(DIVERGENT);

		await expect(runSeed233S2(cfg, true, fetchImpl)).rejects.toThrow(/diverg/i);

		expect(requests).toEqual([censusGet]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: undefined,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: true,
				rerun: false,
				outcome: 'aborted-divergence',
				counts: { total: 3, wouldMigrate: 1, alreadyMigrated: 1, noName: 0, failed: 0 },
				wouldMigrateIds: ['ev-d1'],
				alreadyMigratedIds: ['ev-d2'],
				noNameIds: [],
				failedIds: [],
				eventNameDiffers: [{ eventId: 'ev-d3', nameValue: 'Õige nimi', storedValue: 'Keegi kirjutas muud' }]
			}
		});
	});

	it('an event_name EQUAL to name is already-migrated, not divergence — the run continues and writes the clean event', async () => {
		// ev-d1 plain, ev-d2 equal — DIVERGENT minus its abort trigger
		const EQUAL: CensusEvent[] = [
			{ _id: 'ev-d1', name: [{ _id: 'p-d1-name', string: 'Puhas sündmus' }] },
			{
				_id: 'ev-d2',
				name: [{ _id: 'p-d2-name', string: 'Võrdne nimi' }],
				event_name: [{ _id: 'p-d2-en', string: 'Võrdne nimi' }]
			}
		];

		const { fetchImpl, requests } = makeWire(EQUAL);

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		expect(requests).toEqual([censusGet, ...migrationPair('ev-d1', 'Puhas sündmus')]);
		expect(result.counts).toEqual({ total: 2, migrated: 1, alreadyMigrated: 1, noName: 0, failed: 0 });
		expect(result.outcomes).toEqual([
			{ eventId: 'ev-d1', outcome: 'migrated' },
			{ eventId: 'ev-d2', outcome: 'already-migrated' }
		]);
	});
});

describe('#419 — rights preflight: every would-be-written event needs the runner in _owner/_editor', () => {
	it('LIVE: an event without the runner identity → NO POST at all (not even for the granted event), throws, ledger outcome aborted-rights with the list', async () => {
		const { fetchImpl, requests } = makeWire(TWO_PLAIN, {
			rightsByEvent: {
				'ev-g1': { editor: [RUNNER_ID] },
				'ev-g2': { owner: ['keegi-teine-1'], editor: ['keegi-teine-2'] }
			}
		});

		await expect(runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/rights/i);

		// The check is complete over EVERY would-write event before the stop —
		// the report names every missing grant, not just the first — and no
		// POST is ever issued. The census is the only request either way.
		expect(requests).toEqual([censusGet]);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				rerun: false,
				outcome: 'aborted-rights',
				counts: { total: 2, wouldMigrate: 2, alreadyMigrated: 0, noName: 0, failed: 0 },
				wouldMigrateIds: ['ev-g1', 'ev-g2'],
				alreadyMigratedIds: [],
				noNameIds: [],
				failedIds: [],
				noRights: [{ eventId: 'ev-g2', nameValue: 'Kontsert Tartus' }]
			}
		});
	});

	it('DRY: the preflight runs on the dry run too — the report shows the missing grants BEFORE authorization is sought', async () => {
		const { fetchImpl, requests } = makeWire(TWO_PLAIN, {
			rightsByEvent: {
				'ev-g1': { owner: [RUNNER_ID] },
				'ev-g2': { owner: ['keegi-teine-1'] }
			}
		});

		await expect(runSeed233S2(cfg, true, fetchImpl)).rejects.toThrow(/rights/i);

		expect(requests).toEqual([censusGet]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { outcome: string; noRights: Array<{ eventId: string }>; rerun: boolean };
		};
		expect(call.payload.outcome).toBe('aborted-rights');
		expect(call.payload.noRights).toEqual([{ eventId: 'ev-g2', nameValue: 'Kontsert Tartus' }]);
		expect(call.payload.rerun).toBe(false);
	});

	it('all would-be-written events carry the runner (owner OR editor reference) → the whole check first, then the writes proceed', async () => {
		const { fetchImpl, requests } = makeWire(TWO_PLAIN, {
			rightsByEvent: {
				'ev-g1': { owner: [RUNNER_ID] },
				// runner as _editor alongside a foreign _owner — editor suffices
				'ev-g2': { owner: ['keegi-teine-1'], editor: [RUNNER_ID] }
			}
		});

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		// The noRights list is complete before the first write can be allowed
		// to happen — and it costs no request: the references came in on the
		// census, so the POST pairs follow it directly.
		expect(requests).toEqual([
			censusGet,
			...migrationPair('ev-g1', 'Lauluproov'),
			...migrationPair('ev-g2', 'Kontsert Tartus')
		]);

		expect(result.counts).toEqual({ total: 2, migrated: 2, alreadyMigrated: 0, noName: 0, failed: 0 });
	});
});

describe('#233 S2 — rerun (the closing sweep before S4)', () => {
	it('half the estate already migrated → only the other half POSTed, each with its own read-back', async () => {
		const { fetchImpl, requests } = makeWire(HALF);

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		expect(requests).toEqual([
			censusGet,
			...migrationPair('ev-r1', 'Esimene proov'),
			...migrationPair('ev-r3', 'Kolmas proov')
		]);

		expect(result).toEqual({
			counts: { total: 4, migrated: 2, alreadyMigrated: 2, noName: 0, failed: 0 },
			rerun: false,
			outcomes: [
				{ eventId: 'ev-r1', outcome: 'migrated' },
				{ eventId: 'ev-r2', outcome: 'already-migrated' },
				{ eventId: 'ev-r3', outcome: 'migrated' },
				{ eventId: 'ev-r4', outcome: 'already-migrated' }
			],
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json'
		});
	});

	it('post-S3 estate (event_name set, name ABSENT) → ZERO POSTs, all already-migrated, rerun:true — the healthy zero reads as one', async () => {
		const { fetchImpl, requests } = makeWire(POST_S3);

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		// A naive copy here would write an empty `name` over a good
		// `event_name` — the exact loss the re-run rule exists to prevent.
		// Nothing would be written, so the rights preflight has nothing to
		// check either: the census stays the only request.
		expect(requests).toEqual([censusGet]);

		expect(result).toEqual({
			counts: { total: 2, migrated: 0, alreadyMigrated: 2, noName: 0, failed: 0 },
			rerun: true,
			outcomes: [
				{ eventId: 'ev-p1', outcome: 'already-migrated' },
				{ eventId: 'ev-p2', outcome: 'already-migrated' }
			],
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json'
		});

		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: { rerun: boolean } };
		expect(call.payload.rerun).toBe(true);
	});

	it('name present but EMPTY string, event_name absent → no-name, ZERO POSTs — an empty value is never written', async () => {
		const { fetchImpl, requests } = makeWire(EMPTY_NAME);

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		expect(requests).toEqual([censusGet]);
		expect(result.counts).toEqual({ total: 1, migrated: 0, alreadyMigrated: 0, noName: 1, failed: 0 });
		expect(result.outcomes).toEqual([{ eventId: 'ev-e1', outcome: 'no-name' }]);
		expect(result.rerun).toBe(true);
	});
});

describe('#233 S2 — ledger through the #402 committed-allowlist writer', () => {
	it('live run writes ONE ledger: sensitive:true, allowlist of ids/counts/outcomes, the authorizer threaded through, full payload pinned', async () => {
		const { fetchImpl } = makeWire(MIX);

		await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			// #417 Done-when box 3: the ledger names the authorizer — the
			// engine passes it through; the real writeLedger writes it into
			// BOTH the instance and committed envelope.
			authorizedBy: LIVE_AUTH,
			committed: { allow: [...COMMITTED_ALLOW] },
			payload: {
				dryRun: false,
				rerun: false,
				counts: { total: 5, migrated: 1, alreadyMigrated: 2, noName: 2, failed: 0 },
				migratedIds: ['ev-m1'],
				alreadyMigratedIds: ['ev-m4', 'ev-m5'],
				noNameIds: ['ev-m2', 'ev-m3'],
				failedIds: []
			}
		});
	});

	it('NO key `name` anywhere in the ledger call, and NO event-name value string appears — rows are keyed by eventId/outcome/counts', async () => {
		const { fetchImpl } = makeWire(MIX);

		await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

		const call = writeLedgerMock.mock.calls[0]?.[0] as Record<string, unknown>;

		// `name` is a DEFAULT_REDACT_FIELDS member — a payload key named
		// `name` renders [REDACTED] in the instance file and is refused by the
		// committed allowlist. No key anywhere in the call may carry it.
		expect(collectKeys(call).has('name')).toBe(false);

		// And no NAME VALUE rides along under any other key either — on a
		// completed run the ledger carries ids, counts and outcomes, never
		// the copied strings. (The abort payloads above are the deliberate
		// exception: their lists carry the decision material into the
		// gitignored instance file, and the allowlist keeps it out of git.)
		const serialized = JSON.stringify(call);
		for (const nameValue of ['Kevadkontsert 2026', 'Jõulukontsert', 'Sügisproov']) {
			expect(serialized).not.toContain(nameValue);
		}
	});

	it('the committed allowlist itself names no DEFAULT_REDACT_FIELDS member, not `string`, not the abort lists\' value keys, and not `authorizedBy`', () => {
		const denied = [
			'email',
			'forename',
			'surname',
			'phone',
			'birthdate',
			'name',
			'id_code',
			'string',
			// the abort lists' value keys — operator material for the
			// gitignored instance file, never the tracked twin
			'namevalue',
			'storedvalue',
			// the envelope owns it; an allow entry only admits an impostor
			// payload key (and the #417 fence rejects it)
			'authorizedby'
		];
		for (const field of COMMITTED_ALLOW) {
			expect(denied).not.toContain(field.toLowerCase());
		}
	});
});

// (*MVOX:Tallis*)
