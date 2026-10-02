// Provisioning the feedback type and its prop-defs on crede.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const LEDGER_PATH = 'scripts/migrations/seed-results/seed-395-feedback-type-crede-fake.json';
const writeLedgerMock = vi.fn((..._args: unknown[]) => LEDGER_PATH);

vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...args)
	};
});

import { runSeed395 } from './seed-395-feedback-type-crede-2026-09-28';

const cfg = testCfg('mvox_crede');
const BASE = 'https://api.entu-test.invalid/mvox_crede';
const LIVE_AUTH = 'Mihkel, issue body, https://github.com/mvox-dev/mvox-app/issues/395';

const META_ENTITY = 'meta-entity-1';
const META_PROPERTY = 'meta-property-1';
const TYPE_MEMBER = 'type-member-1';
const TYPE_FEEDBACK_NEW = 'type-feedback-new-1';
const TYPE_FEEDBACK_EXISTING = 'type-feedback-existing-1';
const PENDING_TYPE = '<feedback type-def id, assigned at create>';

const FIELDS = ['screenshot', 'doodle_layer', 'description'] as const;
type Field = (typeof FIELDS)[number];
const PD_NEW: Record<Field, string> = {
	screenshot: 'pd-screenshot-new-1',
	doodle_layer: 'pd-doodle-new-1',
	description: 'pd-description-new-1'
};
const PD_EXISTING: Record<Field, string> = {
	screenshot: 'pd-screenshot-existing-1',
	doodle_layer: 'pd-doodle-existing-1',
	description: 'pd-description-existing-1'
};

function expectedTypeBody(): unknown[] {
	return [
		{ type: '_type', reference: META_ENTITY },
		{ type: 'name', string: 'feedback' },
		{ type: 'label', language: 'en', string: 'Feedback' },
		{ type: 'label', language: 'et', string: 'Tagasiside' },
		{
			type: 'description',
			language: 'en',
			string:
				"A member's feedback on the app: a screenshot, ink drawn over it, and a description. Created by the member with their own key. mvox app extension — not part of the canonical v4E schema."
		},
		{
			type: 'description',
			language: 'et',
			string:
				'Liikme tagasiside rakenduse kohta: kuvatõmmis, sellele joonistatud märkused ja kirjeldus. Liige loob selle oma võtmega. Mvoxi rakenduse laiendus — ei kuulu v4E baasstruktuuri hulka.'
		},
		{ type: '_inheritrights', boolean: true },
		{ type: '_sharing', string: 'domain' }
	];
}

const FIELD_SPEC: Record<Field, { type: string; en: string; et: string; ordinal: number }> = {
	screenshot: {
		type: 'file',
		en: 'Screenshot of the page the member is giving feedback on.',
		et: 'Kuvatõmmis lehest, mille kohta liige tagasisidet annab.',
		ordinal: 1
	},
	doodle_layer: {
		type: 'text',
		en: 'Ink drawn over the screenshot — stroke data as JSON (the #394 StrokeData format).',
		et: 'Kuvatõmmisele joonistatud märkused — joonte andmed JSON-vormingus (#394 StrokeData).',
		ordinal: 2
	},
	description: {
		type: 'text',
		en: "The member's feedback in their own words.",
		et: 'Liikme tagasiside tema enda sõnadega.',
		ordinal: 3
	}
};

function expectedPropBody(field: Field, parent: string): unknown[] {
	const f = FIELD_SPEC[field];
	return [
		{ type: '_type', reference: META_PROPERTY },
		{ type: '_parent', reference: parent },
		{ type: 'name', string: field },
		{ type: 'type', string: f.type },
		{ type: '_sharing', string: 'domain' },
		{ type: 'description', language: 'en', string: f.en },
		{ type: 'description', language: 'et', string: f.et },
		{ type: 'ordinal', number: f.ordinal }
	];
}

function expectedPlan(parent: string, fields: readonly Field[] = FIELDS, withType = true) {
	return [
		...(withType ? [{ target: 'feedback', body: expectedTypeBody() }] : []),
		...fields.map((f) => ({ target: `feedback.${f}`, body: expectedPropBody(f, parent) }))
	];
}

type LoggedRequest = { url: string; method: string; body: unknown };

function makeWire(
	opts: {
		typeExists?: boolean;
		existingFields?: readonly Field[];
		memberTypeExists?: boolean;
		typeReadback?: string;
		propReadback?: string;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const {
		typeExists = false,
		existingFields = [],
		memberTypeExists = true,
		typeReadback = 'domain',
		propReadback = 'domain'
	} = opts;
	const requests: LoggedRequest[] = [];
	let createdType = false;
	const created = new Set<Field>();

	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
		requests.push({ url, method, body });

		const typeId = typeExists ? TYPE_FEEDBACK_EXISTING : createdType ? TYPE_FEEDBACK_NEW : null;

		if (method === 'GET') {
			if (url === `${BASE}/entity?_type.string=entity&name.string=entity&props=_id&limit=1`) {
				return json({ entities: [{ _id: META_ENTITY }] });
			}
			if (url === `${BASE}/entity?_type.string=entity&name.string=property&props=_id&limit=1`) {
				return json({ entities: [{ _id: META_PROPERTY }] });
			}
			if (url === `${BASE}/entity?_type.reference=${META_ENTITY}&name.string=member&props=_id&limit=1`) {
				return json({ entities: memberTypeExists ? [{ _id: TYPE_MEMBER }] : [] });
			}
			if (url === `${BASE}/entity?_type.reference=${META_ENTITY}&name.string=feedback&props=_id&limit=1`) {
				return json({ entities: typeExists ? [{ _id: TYPE_FEEDBACK_EXISTING }] : [] });
			}
			if (typeId && url === `${BASE}/entity/${typeId}?props=_sharing`) {
				return json({ entity: { _sharing: [{ string: typeReadback }] } });
			}
			for (const f of FIELDS) {
				if (
					typeId &&
					url ===
						`${BASE}/entity?_type.reference=${META_PROPERTY}&_parent.reference=${typeId}&name.string=${f}&props=_id&limit=1`
				) {
					return json({ entities: existingFields.includes(f) ? [{ _id: PD_EXISTING[f] }] : [] });
				}
				if (url === `${BASE}/entity/${PD_EXISTING[f]}?props=_sharing` || url === `${BASE}/entity/${PD_NEW[f]}?props=_sharing`) {
					return json({ entity: { _sharing: [{ string: propReadback }] } });
				}
			}
		}

		if (method === 'POST' && url === `${BASE}/entity`) {
			const nameProp = (body as Array<{ type: string; string?: string }>).find((p) => p.type === 'name');
			if (nameProp?.string === 'feedback') {
				createdType = true;
				return json({ _id: TYPE_FEEDBACK_NEW });
			}
			const f = nameProp?.string as Field;
			if (FIELDS.includes(f)) {
				created.add(f);
				return json({ _id: PD_NEW[f] });
			}
		}

		return json({ error: `unrouted request: ${method} ${url}` }, 500);
	}) as typeof fetch;

	return { fetchImpl, requests };
}

const get = (url: string): LoggedRequest => ({ url, method: 'GET', body: null });

function leadingGets(): LoggedRequest[] {
	return [
		get(`${BASE}/entity?_type.string=entity&name.string=entity&props=_id&limit=1`),
		get(`${BASE}/entity?_type.string=entity&name.string=property&props=_id&limit=1`),
		get(`${BASE}/entity?_type.reference=${META_ENTITY}&name.string=member&props=_id&limit=1`),
		get(`${BASE}/entity?_type.reference=${META_ENTITY}&name.string=feedback&props=_id&limit=1`)
	];
}

const propExistsGet = (typeId: string, f: Field) =>
	get(`${BASE}/entity?_type.reference=${META_PROPERTY}&_parent.reference=${typeId}&name.string=${f}&props=_id&limit=1`);
const readbackGet = (id: string) => get(`${BASE}/entity/${id}?props=_sharing`);

beforeEach(() => {
	writeLedgerMock.mockClear();
});

describe('#395 S1 — dry run on a db without the type', () => {
	it('plans exactly the type-def and its three prop-defs, with full payloads — ZERO POSTs', async () => {
		const { fetchImpl, requests } = makeWire();

		const result = await runSeed395(cfg, true, fetchImpl);

		expect(requests).toEqual(leadingGets());
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);

		expect(result).toEqual({
			memberTypeId: TYPE_MEMBER,
			typeId: null,
			propDefIds: { screenshot: null, doodle_layer: null, description: null },
			plannedWrites: expectedPlan(PENDING_TYPE),
			ledger: [
				{ action: 'ensure-type', target: 'feedback', outcome: 'dry-run', after: { sharing: 'domain', inheritsRights: true } },
				{ action: 'ensure-propdef', target: 'feedback.screenshot', outcome: 'dry-run', after: { type: 'file', sharing: 'domain', mandatory: false } },
				{ action: 'ensure-propdef', target: 'feedback.doodle_layer', outcome: 'dry-run', after: { type: 'text', sharing: 'domain', mandatory: false } },
				{ action: 'ensure-propdef', target: 'feedback.description', outcome: 'dry-run', after: { type: 'text', sharing: 'domain', mandatory: false } }
			],
			ledgerPath: LEDGER_PATH
		});
	});

	it('plans no member record and no feedback instance — every planned write is a type-def or a prop-def under it', async () => {
		const { fetchImpl } = makeWire();

		const { plannedWrites } = await runSeed395(cfg, true, fetchImpl);

		const typeRefs = plannedWrites.map(
			(w: { body: Array<{ type: string; reference?: string }> }) => w.body.find((p) => p.type === '_type')?.reference
		);
		expect(typeRefs).toEqual([META_ENTITY, META_PROPERTY, META_PROPERTY, META_PROPERTY]);
		expect(typeRefs).not.toContain(TYPE_MEMBER);
		expect(typeRefs).not.toContain(TYPE_FEEDBACK_NEW);
	});

	it('writes one ledger: schema posture (sensitive:false, acknowledged), zero instances, no `name` key', async () => {
		const { fetchImpl } = makeWire();

		const result = await runSeed395(cfg, true, fetchImpl);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-395-feedback-type-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: false,
			acknowledgedNonSensitive: true,
			authorizedBy: undefined,
			payload: {
				memberTypeId: TYPE_MEMBER,
				typeId: null,
				propDefIds: { screenshot: null, doodle_layer: null, description: null },
				plannedWrites: expectedPlan(PENDING_TYPE),
				instancesCreated: 0,
				ledger: result.ledger
			}
		});
	});

	it('fails loud when the parent `member` type does not exist — nothing planned, nothing written', async () => {
		const { fetchImpl, requests } = makeWire({ memberTypeExists: false });

		await expect(runSeed395(cfg, true, fetchImpl)).rejects.toThrow(/member/);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
	});
});

describe('#395 S1 — live run', () => {
	it('refuses without a recorded authorizer before any request', async () => {
		const { fetchImpl, requests } = makeWire();

		await expect(runSeed395(cfg, false, fetchImpl)).rejects.toThrow(/authorizedBy|AUTHORIZED_BY/i);
		expect(requests).toEqual([]);
		expect(writeLedgerMock).not.toHaveBeenCalled();
	});

	it('refuses the dry-run sentinel as an authorizer', async () => {
		const { fetchImpl, requests } = makeWire();

		await expect(runSeed395(cfg, false, fetchImpl, 'dry run — no authorization required')).rejects.toThrow(
			/sentinel|dry run/i
		);
		expect(requests).toEqual([]);
	});

	it('POSTs exactly the planned four bodies, each followed by a `_sharing` read-back', async () => {
		const { fetchImpl, requests } = makeWire();

		const result = await runSeed395(cfg, false, fetchImpl, LIVE_AUTH);

		const post = (body: unknown): LoggedRequest => ({ url: `${BASE}/entity`, method: 'POST', body });
		expect(requests).toEqual([
			...leadingGets(),
			post(expectedTypeBody()),
			readbackGet(TYPE_FEEDBACK_NEW),
			...FIELDS.flatMap((f) => [
				propExistsGet(TYPE_FEEDBACK_NEW, f),
				post(expectedPropBody(f, TYPE_FEEDBACK_NEW)),
				readbackGet(PD_NEW[f])
			])
		]);

		expect(result).toEqual({
			memberTypeId: TYPE_MEMBER,
			typeId: TYPE_FEEDBACK_NEW,
			propDefIds: { ...PD_NEW },
			plannedWrites: expectedPlan(TYPE_FEEDBACK_NEW),
			ledger: expect.any(Array),
			ledgerPath: LEDGER_PATH
		});
		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-395-feedback-type-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: false,
			acknowledgedNonSensitive: true,
			authorizedBy: LIVE_AUTH,
			payload: {
				memberTypeId: TYPE_MEMBER,
				typeId: TYPE_FEEDBACK_NEW,
				propDefIds: { ...PD_NEW },
				plannedWrites: expectedPlan(TYPE_FEEDBACK_NEW),
				instancesCreated: 0,
				ledger: result.ledger
			}
		});
	});

	it('THROWS when the type-def read-back _sharing is not domain', async () => {
		const { fetchImpl } = makeWire({ typeReadback: 'private' });
		await expect(runSeed395(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/READ-BACK MISMATCH/);
	});

	it('THROWS when a prop-def read-back _sharing is not domain', async () => {
		const { fetchImpl } = makeWire({ propReadback: 'public' });
		await expect(runSeed395(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/READ-BACK MISMATCH/);
	});
});

describe('#395 S1 — idempotence', () => {
	const allFoundRequests = (): LoggedRequest[] => [
		...leadingGets(),
		readbackGet(TYPE_FEEDBACK_EXISTING),
		...FIELDS.flatMap((f) => [propExistsGet(TYPE_FEEDBACK_EXISTING, f), readbackGet(PD_EXISTING[f])])
	];

	for (const dryRun of [true, false]) {
		it(`already provisioned (${dryRun ? 'dry' : 'live'} run) → plans nothing, ZERO POSTs, read-backs still asserted`, async () => {
			const { fetchImpl, requests } = makeWire({ typeExists: true, existingFields: FIELDS });

			const result = await runSeed395(cfg, dryRun, fetchImpl, dryRun ? undefined : LIVE_AUTH);

			expect(requests).toEqual(allFoundRequests());
			expect(result).toEqual({
				memberTypeId: TYPE_MEMBER,
				typeId: TYPE_FEEDBACK_EXISTING,
				propDefIds: { ...PD_EXISTING },
				plannedWrites: [],
				ledger: expect.any(Array),
				ledgerPath: LEDGER_PATH
			});
		});
	}

	it('type present, one field missing (dry run) → plans only that prop-def, parented to the real type id', async () => {
		const { fetchImpl, requests } = makeWire({ typeExists: true, existingFields: ['screenshot', 'description'] });

		const result = await runSeed395(cfg, true, fetchImpl);

		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
		expect(result.plannedWrites).toEqual(expectedPlan(TYPE_FEEDBACK_EXISTING, ['doodle_layer'], false));
		expect(result.propDefIds).toEqual({
			screenshot: PD_EXISTING.screenshot,
			doodle_layer: null,
			description: PD_EXISTING.description
		});
	});
});

// (*MVOX:Tallis*)
