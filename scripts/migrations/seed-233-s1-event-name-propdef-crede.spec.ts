// mvox-app#233 S1 (RED, Tallis) — `event_name` prop-def on the EXISTING
// canonical `event` type, crede ONLY.
//
// The estate ruling (Mihkel 2026-09-18, folded into the #233 body): steps run
// on crede and nothing else — the per-collective twin-script pattern ENDS
// here. ONE script per step. This spec pins that script's whole wire
// contract against a fake fetch (networkGuard.setup.ts stands behind every
// spec: nothing here can reach a live db).
//
// Contract pinned here, for GREEN to satisfy:
//
// - The script module `./seed-233-s1-event-name-propdef-crede` is
//   side-effect-free on import (no main() at module scope — importing it from
//   this spec must not attempt loadCredeCfg or any fetch; the network guard
//   turns such an attempt into a loud suite failure) and exports
//   `runSeed233S1(cfg, dryRun, fetchImpl)` returning
//   `{ typeId, propDefId, outcome, sharing, ordinal, ledgerPath }`.
//
// - SHARING + ORDINAL ARE NOT KNOWN from any committed artefact (no ledger
//   records the live crede event type's `name` prop-def posture, and the
//   historical v4E schema.ts has no ordinal field at all). So the script MUST
//   read the live `name` prop-def FIRST and derive: event_name's `_sharing`
//   MIRRORS event.name's, and its ordinal sits ADJACENT — pinned rule:
//   name's ordinal + 1. Nothing hardcoded, nothing omit-and-inherited
//   (the #265 inherit-from-parent trap).
//
// - The prop-def's identity (name, wire type, descriptions) is SOURCED from
//   the schema of record — `event_name: PropertyAdditionDef` in
//   lib/mvox-schema-extensions.ts, mirroring roster_show_real_names's shape
//   (`event` is canonical v4E with no MvoxEntityDef entry, so the id_code
//   inline-array pattern does not apply). The def leaves sharing/ordinal
//   UNSET and records the mirror rule in its notes; the script must not
//   inline any of it.
//
// - Every live step on the real-personal-data pilot commits a result ledger
//   through #402's committed-allowlist writer: `sensitive: true` routes the
//   instance file to gitignored crede-instance/, and `committed.allow` builds
//   the tracked twin by allowlist. Ledger keys never collide with
//   DEFAULT_REDACT_FIELDS — `name` is a member, so rows are keyed by
//   typeId/propDefId/outcome/sharing/ordinal/dryRun, never `name`.
//
// Wire fixture values are arbitrary ids; URLs are full-shape (the .env.test
// PUBLIC_ENTU_API_BASE host) and every request is asserted with toEqual —
// no objectContaining, no partial shapes (partial assertions hide bugs).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/seed-233-s1-fake.json');

// mvox-app#417 — this spec exercises the prop-def-ensure contract, not the
// authorization gate (that's ledger-writer.spec.ts + liveRunAuthorization.
// guard.spec.ts); assertLiveRunAuthorized is mocked to a no-op so these
// dryRun:false calls (none of which pass an authorizedBy) keep passing.
vi.mock('./lib/ledger-writer', () => ({
	writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown])),
	assertLiveRunAuthorized: () => {},
	DEFAULT_REDACT_FIELDS: ['email', 'forename', 'surname', 'phone', 'birthdate', 'name', 'id_code']
}));

import { runSeed233S1 } from './seed-233-s1-event-name-propdef-crede';
import { event_name } from './lib/mvox-schema-extensions';

const cfg: EntuCfg = { db: 'mvox_crede', token: 'jwt' };
const BASE = 'https://api.entu-test.invalid/mvox_crede';

// Fixture ids — meta types, the event type, its existing `name` prop-def.
const META_ENTITY = 'meta-entity-1';
const META_PROPERTY = 'meta-property-1';
const TYPE_EVENT = 'type-event-1';
const PD_NAME = 'pd-name-1';
const PD_EVENT_NAME_NEW = 'pd-event-name-new-1';
const PD_EVENT_NAME_EXISTING = 'pd-event-name-existing-1';

// The live posture the fake db reports for event.name — the ONLY source the
// script may derive event_name's sharing/ordinal from.
const LIVE_NAME_SHARING = 'domain';
const LIVE_NAME_ORDINAL = 40;
const DERIVED_ORDINAL = LIVE_NAME_ORDINAL + 1; // pinned adjacency rule

// ---------------------------------------------------------------------------
// Fake wire: routes each request the script may issue by full URL + method.
// ---------------------------------------------------------------------------

type LoggedRequest = { url: string; method: string; body: unknown };

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function makeWire(
	overrides: {
		/** event_name prop-def already present live (idempotence case). */
		eventNamePropDefExists?: boolean;
		/** What the post-create read-back reports for _sharing. */
		readbackSharing?: string;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const { eventNamePropDefExists = false, readbackSharing = LIVE_NAME_SHARING } = overrides;
	const requests: LoggedRequest[] = [];

	const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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

// The full CREATE body the live run must POST — every value either a resolved
// id, the LIVE-READ posture, or sourced from the schema-of-record def. Full
// shape: no `mandatory` (not required), no `table`/`search`, and `plural`
// stays absent (defaults false on the platform).
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

// The GET sequence every scenario starts with: meta types, event type, then
// the live `name` prop-def read (sharing/ordinal source), then ensurePropDef's
// idempotence check for `event_name`.
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

		// Full request sequence, full shape: the five GETs and nothing else.
		expect(requests).toEqual(expectedLeadingGets());

		// The would-create report carries the sharing/ordinal READ LIVE — not
		// hardcoded, not omitted: mirror event.name's sharing, ordinal adjacent.
		expect(result).toEqual({
			typeId: TYPE_EVENT,
			propDefId: null,
			outcome: 'dry-run',
			sharing: LIVE_NAME_SHARING,
			ordinal: DERIVED_ORDINAL,
			ledgerPath: 'scripts/migrations/seed-results/crede-instance/seed-233-s1-fake.json'
		});

		// A dry run still writes its ledger (dryRun: true, nothing mutated).
		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s1-event-name-propdef-crede',
			dryRun: true,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: undefined,
			committed: { allow: ['typeId', 'propDefId', 'outcome', 'sharing', 'ordinal', 'dryRun', 'authorizedBy'] },
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

		const result = await runSeed233S1(cfg, false, fetchImpl);

		expect(requests).toEqual([
			...expectedLeadingGets(),
			{ url: `${BASE}/entity`, method: 'POST', body: expectedCreateBody() },
			// assertPropDefSharing's read-back — a create landing is not proof it
			// landed AS WRITTEN (#265 inherit-from-parent trap).
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

		await expect(runSeed233S1(cfg, false, fetchImpl)).rejects.toThrow(/READ-BACK MISMATCH/);
	});
});

describe('#233 S1 — idempotence', () => {
	it('prop-def already present → outcome `found`, ZERO POSTs', async () => {
		const { fetchImpl, requests } = makeWire({ eventNamePropDefExists: true });

		const result = await runSeed233S1(cfg, false, fetchImpl);

		expect(requests).toEqual([
			...expectedLeadingGets(),
			// Read-back still runs on the found prop-def — its live sharing must
			// still match the mirror rule; no POST anywhere.
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

		await runSeed233S1(cfg, false, fetchImpl);

		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		// Pinned full shape — #402's landed API: sensitive:true routes the
		// instance file to gitignored crede-instance/; `committed.allow` builds
		// the tracked twin by allowlist, and naming any DEFAULT_REDACT_FIELDS
		// member in it would throw inside the real writer.
		expect(writeLedgerMock).toHaveBeenCalledWith({
			scriptName: 'seed-233-s1-event-name-propdef-crede',
			dryRun: false,
			db: 'mvox_crede',
			sensitive: true,
			authorizedBy: undefined,
			committed: { allow: ['typeId', 'propDefId', 'outcome', 'sharing', 'ordinal', 'dryRun', 'authorizedBy'] },
			payload: {
				typeId: TYPE_EVENT,
				propDefId: PD_EVENT_NAME_NEW,
				outcome: 'created',
				sharing: LIVE_NAME_SHARING,
				ordinal: DERIVED_ORDINAL,
				dryRun: false
			}
		});

		// Hygiene walk: `name` is a DEFAULT_REDACT_FIELDS member — a payload key
		// literally named `name` renders [REDACTED] in the instance file and is
		// refused by the committed allowlist. No key anywhere may carry it.
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

		// Sharing and ordinal are NOT known from any committed artefact — the
		// def leaves them unset and records the rule; the script derives them
		// live at S1 (mirror event.name, ordinal adjacent).
		expect(event_name.property.sharing).toBeUndefined();
		expect(event_name.property.ordinal).toBeUndefined();
		expect(event_name.notes.some((n) => n.includes('mirrors event.name'))).toBe(true);
	});

	it('what the script creates IS the schema-file def — name, wire type and descriptions come from the import, not an inline copy', async () => {
		const { fetchImpl, requests } = makeWire();

		await runSeed233S1(cfg, false, fetchImpl);

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
