// Crede's event name becomes the date + type + event_name formula.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const LEDGER_PATH = 'scripts/migrations/seed-results/crede-instance/seed-233-s4-fake.json';
const writeLedgerMock = vi.fn(() => LEDGER_PATH);

vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import { runSeed233S4, FORMULA as FORMULA_EXPORT } from './seed-233-s4-event-name-formula-crede';
import { json } from '$lib/testing/entuFetchKit';

type CredeRunnerCfg = EntuCfg & { userId: string };

const RUNNER_ID = 'runner-person-1';
const cfg: CredeRunnerCfg = { db: 'mvox_crede', token: 'jwt', userId: RUNNER_ID };
const BASE = 'https://api.entu-test.invalid/mvox_crede';

const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/421#issuecomment-PLACEHOLDER';

const FORMULA = "start_datetime event_type event_name ' — ' CONCAT_WS";

const CENSUS_URL = `${BASE}/entity?_type.string=event&props=name,event_name,start_datetime,event_type&limit=10000`;
const META_ENTITY_URL = `${BASE}/entity?_type.string=entity&name.string=entity&props=_id&limit=1`;
const META_PROPERTY_URL = `${BASE}/entity?_type.string=entity&name.string=property&props=_id&limit=1`;
const EVENT_TYPE_URL = `${BASE}/entity?_type.reference=meta-entity-1&name.string=event&props=_id&limit=1`;
const PROPDEF_URL = `${BASE}/entity?_type.reference=meta-property-1&_parent.reference=type-event-1&name.string=name&props=_owner,_editor,formula&limit=1`;
const READBACK_URL = `${BASE}/entity?_type.string=event&props=name,event_name&limit=10000`;

const NAME_PROPDEF_ID = 'pd-name-1';

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

const OVERWRITE_PREVIEW =
	'none — a formula has no non-destructive mode; the pairing preflight is the only guard before the overwrite';

const MISMATCH_NOTE =
	'the formula overwrite cannot be undone — the mismatched events need manual review';

const POST_WRITE_ERROR_NOTE =
	'the run failed at or after the formula POST — the formula may already be in force and the touch-saves are partial; aggregatedIds lists what was refreshed, and a RESUME_TOUCH_SAVES=true run finishes the rest';

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

const CREDE: CensusEvent[] = [
	...Array.from({ length: 10 }, (_, i) => pairedEvent(i + 1)),
	...Array.from({ length: 36 }, (_, i) => namelessEvent(i + 1))
];

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

const EMPTY_OPERANDS: CensusEvent[] = [
	pairedEvent(1),
	namelessEvent(1),
	{ _id: 'ev-empty-1' },
	{
		_id: 'ev-empty-2',
		start_datetime: [{ _id: 'p-empty-2-dt' }],
		event_type: [{ _id: 'p-empty-2-type', string: '   ' }]
	}
];

const SMALL: CensusEvent[] = [pairedEvent(1), namelessEvent(1), namelessEvent(2)];

const AFTER_SUCCESS: CensusEvent[] = SMALL.map((event) => {
	const eventName = event.event_name?.[0]?.string;
	const computed =
		eventName !== undefined && eventName.trim().length > 0
			? `${START} — ${TYPE} — ${eventName}`
			: `${START} — ${TYPE}`;
	return { ...event, name: [{ _id: `p-${event._id}-name-computed`, string: computed }] };
});

type LoggedRequest = { url: string; method: string; body: unknown };

function isNonEmpty(value: string | undefined): boolean {
	return value !== undefined && value.trim().length > 0;
}

function makeWire(
	events: CensusEvent[],
	overrides: {
		countOverride?: number;
		propDef?: { owners?: string[]; editors?: string[]; formula?: string };
		readbackNameOverride?: Record<string, string>;
		postFails?: boolean;
		aggregateFailsAt?: number;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const requests: LoggedRequest[] = [];
	let aggregateCalls = 0;

	const propDef = overrides.propDef ?? { owners: [RUNNER_ID] };
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

	function formulaValue(event: CensusEvent): string {
		const eventName = event.event_name?.[0]?.string;
		const base = `${START} — ${TYPE}`;
		return isNonEmpty(eventName) ? `${base} — ${eventName}` : base;
	}

	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
			if (overrides.postFails) return json({ error: 'upstream exploded' }, 500);
			return json({ properties: [{ _id: 'p-pd-formula-new', type: 'formula' }] });
		}

		const aggregateMatch = url.match(new RegExp(`^${BASE}/entity/(ev-[\\w-]+)/aggregate$`));
		if (method === 'GET' && aggregateMatch) {
			aggregateCalls += 1;
			if (overrides.aggregateFailsAt === aggregateCalls) {
				return json({ error: 'upstream exploded' }, 500);
			}
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

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
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
				counts: { total: 4, paired: 1, nameless: 1 },
				pairingStragglers: [{ eventId: 'ev-s1' }, { eventId: 'ev-s2' }]
			}
		});
	});

	it('DRY: the pairing abort fires on the dry run alike — throws, outcome aborted-pairing, reads only (census + prop-def resolution)', async () => {
		const { fetchImpl, requests } = makeWire(STRAGGLERS);

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/pairing/i);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

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
	it('DRY: multiValue non-empty → throws, outcome aborted-multi-value with both counts per event, reads only (census + prop-def resolution)', async () => {
		const { fetchImpl, requests } = makeWire(MULTI_VALUE);

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/more than one/i);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

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

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { outcome: string; multiValue: Array<{ eventId: string }> };
		};
		expect(call.payload.outcome).toBe('aborted-multi-value');
		expect(call.payload.multiValue).toEqual([{ eventId: 'ev-mv1', nameCount: 2, eventNameCount: 0 }]);
	});
});

describe('#421 — an event the formula would compute NOTHING for stops the step before the POST', () => {
	it('DRY: all three formula sources empty/absent → throws, outcome aborted-empty-operands with the ids, reads only', async () => {
		const { fetchImpl, requests } = makeWire(EMPTY_OPERANDS);

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/no non-empty start_datetime/i);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

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
				outcome: 'aborted-empty-operands',
				counts: { total: 4, paired: 1, nameless: 3 },
				emptyOperands: [{ eventId: 'ev-empty-1' }, { eventId: 'ev-empty-2' }]
			}
		});
	});

	it('LIVE: the same abort fires before the irreversible POST — zero POSTs, zero aggregate GETs', async () => {
		const { fetchImpl, requests } = makeWire(EMPTY_OPERANDS);

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/compute no name at all/i);

		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
		expect(requests.filter((r) => r.url.endsWith('/aggregate'))).toEqual([]);
		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: { outcome: string } };
		expect(call.payload.outcome).toBe('aborted-empty-operands');
	});

	it('pairing WINS when both are present — a straggler loses a stored name, the worse of the two verdicts', async () => {
		const BOTH: CensusEvent[] = [
			{ _id: 'ev-s1', name: [{ _id: 'p-s1-name', string: 'Kirjutati vahepeal' }] },
			{ _id: 'ev-empty-1' }
		];
		const { fetchImpl } = makeWire(BOTH);

		await expect(runSeed233S4(cfg, true, fetchImpl)).rejects.toThrow(/pairing/i);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: { outcome: string } };
		expect(call.payload.outcome).toBe('aborted-pairing');
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

	it('the re-run estate (the formula already computed a name onto every event) is diagnosed as aborted-already-formula, NOT as pairing stragglers', async () => {
		const { fetchImpl, requests } = makeWire(AFTER_SUCCESS, {
			propDef: { owners: [RUNNER_ID], formula: FORMULA }
		});

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/already.*formula/i);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

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
				counts: { total: 3, paired: 1, nameless: 0 },
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

		expect(requests).toEqual([
			censusGet,
			...propDefResolutionGets,
			formulaPost,
			...CREDE.map((e) => aggregateGet(e._id)),
			readbackGet
		]);

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

describe('#421 — a failure from the POST onwards is recorded, never only thrown', () => {
	it('the 20th aggregate GET fails mid-touch-save → ledger completed-with-error with aggregated: 19 and the ids, then rethrows', async () => {
		const { fetchImpl, requests } = makeWire(CREDE, { aggregateFailsAt: 20 });

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/aggregate GET for .* failed: 500/i);

		expect(requests.filter((r) => r.method === 'POST')).toEqual([formulaPost]);
		expect(requests.filter((r) => r.url.endsWith('/aggregate'))).toHaveLength(20);
		expect(requests.filter((r) => r.url === READBACK_URL)).toEqual([]);

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
				outcome: 'completed-with-error',
				formula: FORMULA,
				counts: { total: 46, paired: 10, nameless: 36, aggregated: 19 },
				namePropDefId: NAME_PROPDEF_ID,
				errorNote: POST_WRITE_ERROR_NOTE,
				aggregatedIds: CREDE.slice(0, 19).map((e) => e._id)
			}
		});
	});

	it('a 500 on the formula POST is ledgered too — a 5xx does not prove the write did not apply', async () => {
		const { fetchImpl, requests } = makeWire(CREDE, { postFails: true });

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/formula POST .* failed: 500/i);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets, formulaPost]);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { outcome: string; counts: Record<string, number>; aggregatedIds: string[]; errorNote: string };
		};
		expect(call.payload.outcome).toBe('completed-with-error');
		expect(call.payload.counts).toEqual({ total: 46, paired: 10, nameless: 36, aggregated: 0 });
		expect(call.payload.aggregatedIds).toEqual([]);
		expect(call.payload.errorNote).toBe(POST_WRITE_ERROR_NOTE);
	});

	it('the read-back GET failing is ledgered too — the overwrite already happened', async () => {
		const { fetchImpl } = makeWire(CREDE);
		const failing = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === READBACK_URL) {
				return Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
			}
			return fetchImpl(input, init);
		}) as typeof fetch;

		await expect(runSeed233S4(cfg, false, failing, LIVE_AUTH)).rejects.toThrow(/read-back GET failed: 500/i);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { outcome: string; counts: Record<string, number> };
		};
		expect(call.payload.outcome).toBe('completed-with-error');
		expect(call.payload.counts).toEqual({ total: 46, paired: 10, nameless: 36, aggregated: 46 });
	});
});

describe('#421 — resume: finishing a run that died after the formula POST', () => {
	it('the formula already in force → NO POST, touch-saves + read-back only, outcome completed with resumed: true', async () => {
		const { fetchImpl, requests } = makeWire(AFTER_SUCCESS, {
			propDef: { owners: [RUNNER_ID], formula: FORMULA }
		});

		const result = await runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH, { resumeTouchSaves: true });

		expect(requests).toEqual([
			censusGet,
			...propDefResolutionGets,
			...AFTER_SUCCESS.map((e) => aggregateGet(e._id)),
			readbackGet
		]);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

		expect(result).toEqual({
			outcome: 'completed',
			formula: FORMULA,
			counts: { total: 3, paired: 1, nameless: 0, aggregated: 3, readBackOk: 3, readBackMismatch: 0 },
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
				counts: { total: 3, paired: 1, nameless: 0, aggregated: 3, readBackOk: 3, readBackMismatch: 0 },
				namePropDefId: NAME_PROPDEF_ID,
				mismatchIds: [],
				resumed: true
			}
		});
	});

	it('resume asked for with NO formula in force → aborted-resume-precondition, zero POSTs, zero aggregate GETs', async () => {
		const { fetchImpl, requests } = makeWire(SMALL);

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH, { resumeTouchSaves: true })).rejects.toThrow(
			/no post-POST run to finish/i
		);

		expect(requests).toEqual([censusGet, ...propDefResolutionGets]);

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
				outcome: 'aborted-resume-precondition',
				counts: { total: 3, paired: 1, nameless: 2 },
				namePropDefId: NAME_PROPDEF_ID,
				rightsOk: true,
				resumed: true
			}
		});
	});

	it("resume with someone ELSE's formula in force stops the same way — the estate is not this run's", async () => {
		const { fetchImpl, requests } = makeWire(SMALL, {
			propDef: { owners: [RUNNER_ID], formula: "event_name ' ' CONCAT_WS" }
		});

		await expect(runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH, { resumeTouchSaves: true })).rejects.toThrow(
			/no post-POST run to finish/i
		);

		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
		const call = writeLedgerMock.mock.calls[0]?.[0] as {
			payload: { outcome: string; existingFormula: string };
		};
		expect(call.payload.outcome).toBe('aborted-resume-precondition');
		expect(call.payload.existingFormula).toBe("event_name ' ' CONCAT_WS");
	});

	it('a resume run still needs an authorizer — the #417 gate is untouched by the flag', async () => {
		const { fetchImpl, requests } = makeWire(AFTER_SUCCESS, {
			propDef: { owners: [RUNNER_ID], formula: FORMULA }
		});

		await expect(runSeed233S4(cfg, false, fetchImpl, undefined, { resumeTouchSaves: true })).rejects.toThrow(
			/authorizedBy|AUTHORIZED_BY/i
		);

		expect(requests).toEqual([]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});
});

describe('#421 — ledger hygiene through the #402 committed-allowlist writer', () => {
	it("NO key `name` anywhere in the ledger call, no event-name value string rides along, and the authorizer travels on the envelope — never in allow", async () => {
		const { fetchImpl } = makeWire(CREDE);

		await runSeed233S4(cfg, false, fetchImpl, LIVE_AUTH);

		const call = writeLedgerMock.mock.calls[0]?.[0] as Record<string, unknown>;

		expect(collectKeys(call).has('name')).toBe(false);

		const serialized = JSON.stringify(call);
		for (const nameValue of ['Sündmus number 1', 'Sündmus number 7', 'Sündmus number 10']) {
			expect(serialized).not.toContain(nameValue);
		}

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
