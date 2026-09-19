// mvox-app#233 S2 (RED, Tallis) — copy every crede event's `name` value into
// `event_name`. The data-loss fence's FIRST half: this backfill must be
// complete before S4 turns `name` into a formula (a formula overwrites the
// stored value on every save and silently drops POSTs — run it first and
// every existing name is destroyed).
//
// Crede ONLY, ONE script (the `-crede-`/`-polyphony-` twin pattern ended at
// S1 — estate ruling, Mihkel 2026-09-18, folded into the #233 body).
// networkGuard.setup.ts stands behind every spec: nothing here can reach a
// live db; the whole wire is a fake fetch and every request is asserted
// full-shape with toEqual (partial assertions hide bugs).
//
// Contract pinned here, for GREEN to satisfy:
//
// - The script module `./seed-233-s2-event-name-backfill-crede` is
//   side-effect-free on import (main() only under the isMainModule guard,
//   same as S1) and exports `runSeed233S2(cfg, dryRun, fetchImpl)` returning
//   `{ counts, rerun, outcomes, ledgerPath }`.
//
// - CENSUS: one db-wide GET
//   `entity?_type.string=event&props=name,event_name&limit=10000` — NO
//   `_parent.reference=` scoping (S2 must cover every crede event, whatever
//   it hangs under). HARD-THROW when `body.count !== body.entities.length`
//   (tidy-td2c's census-truncated guard): a silently truncated census would
//   leave unmigrated events for S4's formula to blank.
//
// - IDEMPOTENCE = THREE RULES (#233 body, 'The re-run that can undo the
//   ordering'), in this precedence:
//     1. `event_name` already holds a non-empty value → outcome
//        'already-migrated', NO write — whether or not it equals `name`.
//        This branch FIRST: the re-run right before S4 happens after S3 has
//        been live, so events created since carry `event_name` and NO `name`
//        at all — a naive copy would write an empty `name` over a good
//        `event_name`, and S4's formula would then render them nameless.
//     2. else `name` absent OR empty/whitespace → outcome 'no-name', id
//        recorded, NO write — NEVER write an empty value.
//     3. only then POST.
//
// - LIVE WRITE per migrated event: `POST entity/{id}` with
//   `[{ type: 'event_name', string: <name> }]` (event_name never has a prior
//   value on a migrated event — rule 1 skipped it otherwise — so Entu's
//   POST-append is unambiguously a new value, not a replace). Then the
//   3-check canary (tidy-td2c's touch-save shape): (a) POST response carries
//   the new `event_name` property _id, (b) re-GET `entity/{id}?
//   props=event_name` reads back a value EQUAL to the source name,
//   (c) exactly ONE value. Any check failing → ledger records the event as
//   failed, then THROW — never a false 'migrated'.
//
// - DRY_RUN default prints the plan: zero POSTs, per-event outcome
//   'would-migrate' where a live run would write. The plan is keyed
//   SEPARATELY from a live run's writes — `counts.wouldMigrate` /
//   `wouldMigrateIds`, and NO `migrated` / `migratedIds` key at all. Both
//   artefacts land tracked in git side by side; a dry ledger reading
//   `migrated: 1` for events it never touched would differ from the live
//   one by a single sibling boolean.
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
//   ({ total, migrated, alreadyMigrated, noName, failed }) + eventIds per
//   outcome — NEVER the name values, NEVER a field keyed `name`
//   (DEFAULT_REDACT_FIELDS member; the committed allowlist throws on it).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json');

vi.mock('./lib/ledger-writer', () => ({
	writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown])),
	DEFAULT_REDACT_FIELDS: ['email', 'forename', 'surname', 'phone', 'birthdate', 'name', 'id_code']
}));

import { runSeed233S2 } from './seed-233-s2-event-name-backfill-crede';

const cfg: EntuCfg = { db: 'mvox_crede', token: 'jwt' };
const BASE = 'https://api.entu-test.invalid/mvox_crede';

const CENSUS_URL = `${BASE}/entity?_type.string=event&props=name,event_name&limit=10000`;

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
	// post-S3 event: event_name set, NO name — the re-run trap; rule 1 must
	// catch it BEFORE the no-name rule ever sees the absent `name`
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

// ---------------------------------------------------------------------------
// Fake wire: census GET, per-event POST + read-back GET, routed by full URL.
// ---------------------------------------------------------------------------

type LoggedRequest = { url: string; method: string; body: unknown };

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
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const requests: LoggedRequest[] = [];
	// what a well-behaved db would hold after each POST this wire accepts
	const written = new Map<string, string>();

	const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
		requests.push({ url, method, body: parsedBody });

		if (method === 'GET' && url === CENSUS_URL) {
			return json({ count: overrides.countOverride ?? events.length, entities: events });
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
	it('ZERO POSTs; the plan lists every event with its outcome under the three-rule precedence', async () => {
		const { fetchImpl, requests } = makeWire(MIX);

		const result = await runSeed233S2(cfg, true, fetchImpl);

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
	it('POSTs exactly [{type: event_name, string: <name>}] per plain event, read-back-verifies, skips already-migrated, records no-name', async () => {
		const { fetchImpl, requests } = makeWire(MIX);

		const result = await runSeed233S2(cfg, false, fetchImpl);

		// Full request sequence: census, then ONE migration pair for the ONE
		// plain event — nothing for the two no-name and two already-migrated.
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

		await expect(runSeed233S2(cfg, false, fetchImpl)).rejects.toThrow(/event_name/);

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

		await expect(runSeed233S2(cfg, false, fetchImpl)).rejects.toThrow(/READ-BACK/i);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: { failedIds: string[] } };
		expect(call.payload.failedIds).toEqual(['ev-m1']);
	});

	it('THROWS when the read-back holds MORE than one value (canary c: count===1)', async () => {
		const { fetchImpl } = makeWire(MIX, { readbackDoubled: true });

		await expect(runSeed233S2(cfg, false, fetchImpl)).rejects.toThrow(/READ-BACK/i);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: { failedIds: string[] } };
		expect(call.payload.failedIds).toEqual(['ev-m1']);
	});
});

describe('#233 S2 — rerun (the closing sweep before S4)', () => {
	it('half the estate already migrated → only the other half POSTed, each with its own read-back', async () => {
		const { fetchImpl, requests } = makeWire(HALF);

		const result = await runSeed233S2(cfg, false, fetchImpl);

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

		const result = await runSeed233S2(cfg, false, fetchImpl);

		// A naive copy here would write an empty `name` over a good
		// `event_name` — the exact loss the re-run rule exists to prevent.
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

		const result = await runSeed233S2(cfg, false, fetchImpl);

		expect(requests).toEqual([censusGet]);
		expect(result.counts).toEqual({ total: 1, migrated: 0, alreadyMigrated: 0, noName: 1, failed: 0 });
		expect(result.outcomes).toEqual([{ eventId: 'ev-e1', outcome: 'no-name' }]);
		expect(result.rerun).toBe(true);
	});
});

describe('#233 S2 — ledger through the #402 committed-allowlist writer', () => {
	it('live run writes ONE ledger: sensitive:true, allowlist of ids/counts/outcomes, full payload pinned', async () => {
		const { fetchImpl } = makeWire(MIX);

		await runSeed233S2(cfg, false, fetchImpl);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s2-event-name-backfill-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
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

		await runSeed233S2(cfg, false, fetchImpl);

		const call = writeLedgerMock.mock.calls[0]?.[0] as Record<string, unknown>;

		// `name` is a DEFAULT_REDACT_FIELDS member — a payload key named
		// `name` renders [REDACTED] in the instance file and is refused by the
		// committed allowlist. No key anywhere in the call may carry it.
		expect(collectKeys(call).has('name')).toBe(false);

		// And no NAME VALUE rides along under any other key either — the
		// ledger carries ids, counts and outcomes, never the copied strings.
		const serialized = JSON.stringify(call);
		for (const nameValue of ['Kevadkontsert 2026', 'Jõulukontsert', 'Sügisproov']) {
			expect(serialized).not.toContain(nameValue);
		}
	});

	it('the committed allowlist itself names no DEFAULT_REDACT_FIELDS member and not `string` (the real writer throws on those)', () => {
		const denied = ['email', 'forename', 'surname', 'phone', 'birthdate', 'name', 'id_code', 'string'];
		for (const field of COMMITTED_ALLOW) {
			expect(denied).not.toContain(field.toLowerCase());
		}
	});
});

// (*MVOX:Tallis*)
