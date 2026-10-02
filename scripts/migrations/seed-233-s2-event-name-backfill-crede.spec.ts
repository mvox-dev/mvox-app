// Copy every crede event's name into event_name before the formula lands.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json');

vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import { runSeed233S2 as runSeed233S2Draft } from './seed-233-s2-event-name-backfill-crede';
import type { RunSeed233S2Result } from './seed-233-s2-event-name-backfill-crede';
import { json } from '$lib/testing/entuFetchKit';

type CredeRunnerCfg = EntuCfg & { userId: string };

const runSeed233S2 = runSeed233S2Draft as unknown as (
	cfg: CredeRunnerCfg,
	dryRun: boolean,
	fetchImpl?: typeof fetch,
	authorizedBy?: string
) => Promise<RunSeed233S2Result>;

const RUNNER_ID = 'runner-person-1';
const cfg: CredeRunnerCfg = { db: 'mvox_crede', token: 'jwt', userId: RUNNER_ID };
const BASE = 'https://api.entu-test.invalid/mvox_crede';

const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/419#issuecomment-5742461628';

const CENSUS_URL = `${BASE}/entity?_type.string=event&props=name,event_name,_owner,_editor&limit=10000`;

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
	'multiValue',
	'blankEventName',
	'nameCount',
	'eventNameCount'
] as const;

type CensusEvent = {
	_id: string;
	name?: Array<{ _id: string; string?: string }>;
	event_name?: Array<{ _id: string; string?: string }>;
};

const MIX: CensusEvent[] = [
	{ _id: 'ev-m1', name: [{ _id: 'p-m1-name', string: 'Kevadkontsert 2026' }] },
	{ _id: 'ev-m2' },
	{ _id: 'ev-m3', name: [{ _id: 'p-m3-name', string: '   ' }] },
	{
		_id: 'ev-m4',
		name: [{ _id: 'p-m4-name', string: 'Jõulukontsert' }],
		event_name: [{ _id: 'p-m4-en', string: 'Jõulukontsert' }]
	},
	{ _id: 'ev-m5', event_name: [{ _id: 'p-m5-en', string: 'Sügisproov' }] }
];

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

const POST_S3: CensusEvent[] = [
	{ _id: 'ev-p1', event_name: [{ _id: 'p-p1-en', string: 'Uus sündmus' }] },
	{ _id: 'ev-p2', event_name: [{ _id: 'p-p2-en', string: 'Veel üks uus' }] }
];

const EMPTY_NAME: CensusEvent[] = [{ _id: 'ev-e1', name: [{ _id: 'p-e1-name', string: '' }] }];

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

const TWO_PLAIN: CensusEvent[] = [
	{ _id: 'ev-g1', name: [{ _id: 'p-g1-name', string: 'Lauluproov' }] },
	{ _id: 'ev-g2', name: [{ _id: 'p-g2-name', string: 'Kontsert Tartus' }] }
];

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
	{ _id: 'ev-b4', event_name: [{ _id: 'p-b4-en', string: '' }] }
];

type LoggedRequest = { url: string; method: string; body: unknown };

type EventRights = { owner?: string[]; editor?: string[] };

function makeWire(
	events: CensusEvent[],
	overrides: {
		countOverride?: number;
		postResponseWithoutPropId?: boolean;
		readbackValueOverride?: string;
		readbackDoubled?: boolean;
		rightsByEvent?: Record<string, EventRights>;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const requests: LoggedRequest[] = [];
	const written = new Map<string, string>();

	const censusEntities = events.map((event) => {
		const rights = overrides.rightsByEvent?.[event._id] ?? { owner: [RUNNER_ID] };
		const refs = (ids: string[] | undefined, tier: string) =>
			ids?.length
				? ids.map((id, i) => ({ _id: `r-${event._id}-${tier}-${i}`, reference: id, string: `Isik ${id}` }))
				: undefined;
		return { ...event, _owner: refs(rights.owner, 'owner'), _editor: refs(rights.editor, 'editor') };
	});

	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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

describe('#419 — the #417 live-run gate', () => {
	it('a LIVE run with no authorizer throws BEFORE any fetch — the gate is the first statement, ahead of the census', async () => {
		const { fetchImpl, requests } = makeWire(MIX);

		await expect(runSeed233S2(cfg, false, fetchImpl)).rejects.toThrow(/authorizedBy|AUTHORIZED_BY/i);

		expect(requests).toEqual([]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('#233 S2 — census', () => {
	it('THROWS when count !== entities.length (truncated census would leave events for the formula to blank) — nothing after the census, zero POSTs', async () => {
		const { fetchImpl, requests } = makeWire(MIX, { countOverride: 7 });

		await expect(runSeed233S2(cfg, true, fetchImpl)).rejects.toThrow(/census truncated/i);

		expect(requests).toEqual([censusGet]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('#233 S2 — dry-run (the default)', () => {
	it('ZERO POSTs; the plan lists every event with its outcome under the three-rule precedence, off the census alone', async () => {
		const { fetchImpl, requests } = makeWire(MIX);

		const result = await runSeed233S2(cfg, true, fetchImpl);

		expect(requests).toEqual([censusGet]);

		expect(result).toEqual({
			counts: { total: 5, wouldMigrate: 1, alreadyMigrated: 2, noName: 2, failed: 0 },
			rerun: false,
			outcomes: [
				{ eventId: 'ev-m1', outcome: 'would-migrate' },
				{ eventId: 'ev-m2', outcome: 'no-name' },
				{ eventId: 'ev-m3', outcome: 'no-name' },
				{ eventId: 'ev-m4', outcome: 'already-migrated' },
				{ eventId: 'ev-m5', outcome: 'already-migrated' }
			],
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s2-fake.json'
		});

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
				counts: { total: 4, wouldMigrate: 1, alreadyMigrated: 0, noName: 0, failed: 0 },
				wouldMigrateIds: ['ev-b1'],
				alreadyMigratedIds: [],
				noNameIds: [],
				failedIds: [],
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
				'ev-g2': { owner: ['keegi-teine-1'], editor: [RUNNER_ID] }
			}
		});

		const result = await runSeed233S2(cfg, false, fetchImpl, LIVE_AUTH);

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

		expect(collectKeys(call).has('name')).toBe(false);

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
			'namevalue',
			'storedvalue',
			'authorizedby'
		];
		for (const field of COMMITTED_ALLOW) {
			expect(denied).not.toContain(field.toLowerCase());
		}
	});
});

// (*MVOX:Tallis*)
