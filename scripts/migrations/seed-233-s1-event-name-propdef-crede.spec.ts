// The event_name prop-def on crede's event type.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/seed-233-s1-fake.json');

vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import { runSeed233S1 } from './seed-233-s1-event-name-propdef-crede';
import { event_name } from './lib/mvox-schema-extensions';

const cfg = testCfg('mvox_crede');
const BASE = 'https://api.entu-test.invalid/mvox_crede';

const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/233#issuecomment-4171';

const META_ENTITY = 'meta-entity-1';
const META_PROPERTY = 'meta-property-1';
const TYPE_EVENT = 'type-event-1';
const PD_NAME = 'pd-name-1';
const PD_EVENT_NAME_NEW = 'pd-event-name-new-1';
const PD_EVENT_NAME_EXISTING = 'pd-event-name-existing-1';

const LIVE_NAME_SHARING = 'domain';
const LIVE_NAME_ORDINAL = 40;
const DERIVED_ORDINAL = LIVE_NAME_ORDINAL + 1; // pinned adjacency rule

type LoggedRequest = { url: string; method: string; body: unknown };

function makeWire(
	overrides: {
		eventNamePropDefExists?: boolean;
		readbackSharing?: string;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const { eventNamePropDefExists = false, readbackSharing = LIVE_NAME_SHARING } = overrides;
	const requests: LoggedRequest[] = [];

	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		requests.push({
			url,
			method,
			body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
		});

		if (method === 'GET') {
			if (url === `${BASE}/entity?_type.string=entity&name.string=entity&props=_id&limit=1`) {
				return json({ entities: [{ _id: META_ENTITY }] });
			}
			if (url === `${BASE}/entity?_type.string=entity&name.string=property&props=_id&limit=1`) {
				return json({ entities: [{ _id: META_PROPERTY }] });
			}
			if (url === `${BASE}/entity?_type.reference=${META_ENTITY}&name.string=event&props=_id&limit=1`) {
				return json({ entities: [{ _id: TYPE_EVENT }] });
			}
			if (
				url ===
				`${BASE}/entity?_type.reference=${META_PROPERTY}&_parent.reference=${TYPE_EVENT}&name.string=name&props=_sharing,ordinal&limit=1`
			) {
				return json({
					entities: [
						{
							_id: PD_NAME,
							_sharing: [{ string: LIVE_NAME_SHARING }],
							ordinal: [{ number: LIVE_NAME_ORDINAL }]
						}
					]
				});
			}
			if (
				url ===
				`${BASE}/entity?_type.reference=${META_PROPERTY}&_parent.reference=${TYPE_EVENT}&name.string=event_name&props=_id&limit=1`
			) {
				return json({
					entities: eventNamePropDefExists ? [{ _id: PD_EVENT_NAME_EXISTING }] : []
				});
			}
			if (url === `${BASE}/entity/${PD_EVENT_NAME_NEW}?props=_sharing`) {
				return json({ entity: { _sharing: [{ string: readbackSharing }] } });
			}
			if (url === `${BASE}/entity/${PD_EVENT_NAME_EXISTING}?props=_sharing`) {
				return json({ entity: { _sharing: [{ string: readbackSharing }] } });
			}
		}

		if (method === 'POST' && url === `${BASE}/entity`) {
			return json({ _id: PD_EVENT_NAME_NEW });
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

function expectedCreateBody(): unknown[] {
	return [
		{ type: '_type', reference: META_PROPERTY },
		{ type: '_parent', reference: TYPE_EVENT },
		{ type: 'name', string: 'event_name' },
		{ type: 'type', string: 'string' },
		{ type: '_sharing', string: LIVE_NAME_SHARING },
		{ type: 'description', language: 'en', string: event_name.property.descriptionEn },
		{ type: 'description', language: 'et', string: event_name.property.descriptionEt },
		{ type: 'ordinal', number: DERIVED_ORDINAL }
	];
}

function expectedLeadingGets(): LoggedRequest[] {
	return [
		{
			url: `${BASE}/entity?_type.string=entity&name.string=entity&props=_id&limit=1`,
			method: 'GET',
			body: null
		},
		{
			url: `${BASE}/entity?_type.string=entity&name.string=property&props=_id&limit=1`,
			method: 'GET',
			body: null
		},
		{
			url: `${BASE}/entity?_type.reference=${META_ENTITY}&name.string=event&props=_id&limit=1`,
			method: 'GET',
			body: null
		},
		{
			url: `${BASE}/entity?_type.reference=${META_PROPERTY}&_parent.reference=${TYPE_EVENT}&name.string=name&props=_sharing,ordinal&limit=1`,
			method: 'GET',
			body: null
		},
		{
			url: `${BASE}/entity?_type.reference=${META_PROPERTY}&_parent.reference=${TYPE_EVENT}&name.string=event_name&props=_id&limit=1`,
			method: 'GET',
			body: null
		}
	];
}

beforeEach(() => {
	writeLedgerMock.mockClear();
});

describe('#233 S1 — seed-233-s1-event-name-propdef-crede (dry-run)', () => {
	it('GETs meta types, the event type and its live `name` prop-def, reports the derived would-create posture — ZERO POSTs', async () => {
		const { fetchImpl, requests } = makeWire();

		const result = await runSeed233S1(cfg, true, fetchImpl);

		expect(requests).toEqual(expectedLeadingGets());

		expect(result).toEqual({
			typeId: TYPE_EVENT,
			propDefId: null,
			outcome: 'dry-run',
			sharing: LIVE_NAME_SHARING,
			ordinal: DERIVED_ORDINAL,
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s1-fake.json'
		});

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s1-event-name-propdef-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: undefined,
			committed: { allow: ['typeId', 'propDefId', 'outcome', 'sharing', 'ordinal', 'dryRun'] },
			payload: {
				typeId: TYPE_EVENT,
				propDefId: null,
				outcome: 'dry-run',
				sharing: LIVE_NAME_SHARING,
				ordinal: DERIVED_ORDINAL,
				dryRun: true
			}
		});
	});
});

describe('#233 S1 — live run', () => {
	it('POSTs the full prop-def create body (type ref, event_name, string, live-read sharing, adjacent ordinal), then read-back-asserts sharing', async () => {
		const { fetchImpl, requests } = makeWire();

		const result = await runSeed233S1(cfg, false, fetchImpl, LIVE_AUTH);

		expect(requests).toEqual([
			...expectedLeadingGets(),
			{ url: `${BASE}/entity`, method: 'POST', body: expectedCreateBody() },
			{ url: `${BASE}/entity/${PD_EVENT_NAME_NEW}?props=_sharing`, method: 'GET', body: null }
		]);

		expect(result).toEqual({
			typeId: TYPE_EVENT,
			propDefId: PD_EVENT_NAME_NEW,
			outcome: 'created',
			sharing: LIVE_NAME_SHARING,
			ordinal: DERIVED_ORDINAL,
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s1-fake.json'
		});
	});

	it('THROWS when the read-back _sharing mismatches the live-read intent (never records a false created)', async () => {
		const { fetchImpl } = makeWire({ readbackSharing: 'public' });

		await expect(runSeed233S1(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/READ-BACK MISMATCH/);
	});

	it('a live run with NO recorded authorizer is refused before anything is written — not one request, not one POST', async () => {
		const { fetchImpl, requests } = makeWire();

		await expect(runSeed233S1(cfg, false, fetchImpl)).rejects.toThrow(/authorizedBy|AUTHORIZED_BY/i);

		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
		expect(requests).toEqual([]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});

	it('a live run whose authorizer is the dry-run sentinel is refused the same way — "not required" never authorizes', async () => {
		const { fetchImpl, requests } = makeWire();

		await expect(
			runSeed233S1(cfg, false, fetchImpl, 'dry run — no authorization required')
		).rejects.toThrow(/sentinel|dry run/i);

		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
	});

	it('a DRY run needs no authorizer — the gate is a live-run gate only', async () => {
		const { fetchImpl, requests } = makeWire();

		await expect(runSeed233S1(cfg, true, fetchImpl)).resolves.toMatchObject({ outcome: 'dry-run' });
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);
	});
});

describe('#233 S1 — idempotence', () => {
	it('prop-def already present → outcome `found`, ZERO POSTs', async () => {
		const { fetchImpl, requests } = makeWire({ eventNamePropDefExists: true });

		const result = await runSeed233S1(cfg, false, fetchImpl, LIVE_AUTH);

		expect(requests).toEqual([
			...expectedLeadingGets(),
			{
				url: `${BASE}/entity/${PD_EVENT_NAME_EXISTING}?props=_sharing`,
				method: 'GET',
				body: null
			}
		]);
		expect(requests.filter((r) => r.method === 'POST')).toEqual([]);

		expect(result).toEqual({
			typeId: TYPE_EVENT,
			propDefId: PD_EVENT_NAME_EXISTING,
			outcome: 'found',
			sharing: LIVE_NAME_SHARING,
			ordinal: DERIVED_ORDINAL,
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s1-fake.json'
		});
	});
});

describe('#233 S1 — ledger through the #402 committed-allowlist writer', () => {
	it('live run writes ONE ledger: sensitive:true, committed allowlist, payload keyed by ids/outcome/posture — no key named `name`', async () => {
		const { fetchImpl } = makeWire();

		await runSeed233S1(cfg, false, fetchImpl, LIVE_AUTH);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s1-event-name-propdef-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: LIVE_AUTH,
			committed: { allow: ['typeId', 'propDefId', 'outcome', 'sharing', 'ordinal', 'dryRun'] },
			payload: {
				typeId: TYPE_EVENT,
				propDefId: PD_EVENT_NAME_NEW,
				outcome: 'created',
				sharing: LIVE_NAME_SHARING,
				ordinal: DERIVED_ORDINAL,
				dryRun: false
			}
		});

		const call = writeLedgerMock.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
		expect(collectKeys(call.payload).has('name')).toBe(false);
	});
});

describe('#233 S1 — schema of record sources the script', () => {
	it('event_name is a PropertyAdditionDef on `event`: string type, sharing/ordinal deferred to the live read, commissioned by mvox-app#233', () => {
		expect(runSeed233S1).toBeTypeOf('function');

		expect(event_name.onType).toBe('event');
		expect(event_name.property.name).toBe('event_name');
		expect(event_name.property.type).toBe('string');
		expect(event_name.commissionedBy).toBe('mvox-app#233');

		expect(event_name.property.sharing).toBeUndefined();
		expect(event_name.property.ordinal).toBeUndefined();
		expect(event_name.notes.some((n) => n.includes('mirrors event.name'))).toBe(true);
	});

	it('what the script creates IS the schema-file def — name, wire type and descriptions come from the import, not an inline copy', async () => {
		const { fetchImpl, requests } = makeWire();

		await runSeed233S1(cfg, false, fetchImpl, LIVE_AUTH);

		const post = requests.find((r) => r.method === 'POST');
		if (!post) throw new Error('no CREATE POST issued');
		const body = post.body as Array<Record<string, unknown>>;

		expect(body.find((p) => p.type === 'name')).toEqual({
			type: 'name',
			string: event_name.property.name
		});
		expect(body.find((p) => p.type === 'type')).toEqual({
			type: 'type',
			string: event_name.property.type
		});
		expect(body.filter((p) => p.type === 'description')).toEqual([
			{ type: 'description', language: 'en', string: event_name.property.descriptionEn },
			{ type: 'description', language: 'et', string: event_name.property.descriptionEt }
		]);
	});
});

// (*MVOX:Tallis*)
