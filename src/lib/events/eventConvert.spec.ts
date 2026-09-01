// #196 RED — standalone event → series conversion: `convertEventToSeries`
// ($lib/events/eventConvert), the data layer behind "I created a standalone
// 'proov' and now want it to repeat" (Joosep, Crede pilot 2026-08-31).
//
// Pinned contract (GREEN must implement — see also the eventConvert.ts stub
// header):
//
//   INPUT — { eventId, dbEntityId, seasonId, intervalDays, startTime,
//   startDate, endDate, durationMinutes }. NO `name` field, ever: the series
//   takes the EVENT'S stored name (the whole point of "convert", and the
//   reason the conversion path is exempt from createEvent's standalone-name
//   validation — it never calls createEvent at all). Type-level pin below.
//
//   CHOREOGRAPHY — four steps, exactly this order, fail-loud at every one:
//
//     1. read-event    GET entity/{eventId}?props=name,event_type
//                      The event's own name (string AND value `_id`s — the ids
//                      feed step 4) and event_type. An event whose name OR
//                      event_type is absent/blank REFUSES here, before any
//                      write: v4E marks BOTH `required: true` on event_series,
//                      and #196 review F1 — the typeless case used to create the
//                      (invalid) series first and only then discover it could
//                      write no occurrences, stranding a converted event with no
//                      in-app way back. The refusal carries a `reason`
//                      ('missing-name' / 'missing-event-type') so the caller can
//                      say WHICH, a transient HTTP 500 at the same step being a
//                      materially different thing.
//     2. create-series COMPOSED on `createEventSeries` ($lib/entity/entityCreate),
//                      the app's ONE event_series create path — never a local
//                      copy of it (#196 review F1). On the wire that is still
//                      ONE resolveTypeId GET (cached per db:typeName) + ONE POST
//                      to the COLLECTION `entity` endpoint. Body: `_type` as a
//                      REFERENCE (#10), `_parent` = [dbEntityId, seasonId] one
//                      prop per id, name + event_type from the EVENT,
//                      interval_days/start_time/start_date/end_date/
//                      duration_minutes from the input. NO `_sharing`, NO
//                      inherit-rights flag (the #132 design decision).
//     3. link-event    POST entity/{eventId} with EXACTLY ONE prop:
//                      { type: '_parent', reference: <new series id> }.
//                      The event's existing db + season `_parent` values are
//                      NEVER deleted: `listEvents` selects on
//                      `_parent.reference=<seasonId>` with NO ancestor
//                      expansion (pinned in entityCreate.ts's multi-parent
//                      contract), so removing the season parent would vanish
//                      the converted event from the very agenda the user is
//                      looking at. The ordered call-log assertion below is
//                      what pins the absence of any such DELETE.
//     4. delete-name   DELETE property/{id} for EACH old name value — strictly
//                      AFTER the link POST landed (POST before DELETE, the
//                      eventFieldEdit ordering), so a failure part-way leaves
//                      a NAMED standalone event, never a nameless orphan. With
//                      the own value gone the displayed name falls back to the
//                      series name through the read-side inheritance merge
//                      (listEvents / loadEventDetail), so renaming the series
//                      propagates — the integration block drives that merge
//                      through the REAL listEvents producer.
//
//   FAILURE — every step failure throws EventConvertError whose `step` names
//   the failed step, whose MESSAGE contains that step name verbatim (loud, and
//   greppable in an error surface), and whose `seriesId` carries the created
//   series' id for every failure AFTER create-series succeeded. No rollback
//   (Entu has no transactions) — the error is what tells the operator where
//   the run stopped. No silent success, no partial resolve.
//
//   VALIDATION — user-input hygiene BEFORE any fetch (entityCreate's pattern:
//   Entu `mandatory` rejects nothing, so this module is the enforcement
//   point): blank eventId/dbEntityId/seasonId, intervalDays < 1, non-finite
//   durationMinutes, blank startTime, and an inverted date range all reject
//   with the field named and ZERO fetches issued. #196 review F2 — those
//   refusals are EventConvertError('validate', …) too: a plain Error has no
//   `.step`, and a caller duck-typing the step off the rejection then named
//   'read-event' — a step that had not run — for an empty form field.
//
// INTEGRATION — the final block wires a stateful in-memory Entu fake (create /
// append / delete / query, same wire shapes the live API serves) and drives
// the REAL producers end to end: convertEventToSeries writes, then
// entuSeasons.listEvents and seasonManage.listEventsForSeason /
// listEventSeriesForSeason READ the converted world back. No hand-set state —
// what the agenda shows is exactly what the conversion wrote.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, listEvents, type EntuCfg } from '$lib/seasons/entuSeasons';
import { listEventSeriesForSeason, listEventsForSeason } from '$lib/seasons/seasonManage';
import { createEvent } from '$lib/entity/entityCreate';
import {
	convertEventToSeries,
	EventConvertError,
	type ConvertEventToSeriesInput
} from './eventConvert';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };
const BASE = 'https://api.entu-test.invalid/testdb';

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
	resetTypeIdCache();
});

// Minimal VALID input — every field present. `name` is deliberately NOT here
// (and not accepted — see the type-level pin).
const validInput: ConvertEventToSeriesInput = {
	eventId: 'ev-9',
	dbEntityId: 'org-1',
	seasonId: 'season-1',
	intervalDays: 7,
	startTime: '19:00',
	startDate: '2026-09-07',
	endDate: '2027-05-31',
	durationMinutes: 90
};

/** What the read-event GET answers by default: a named, typed standalone event. */
function defaultEventEntity(): unknown {
	return {
		entity: {
			_id: 'ev-9',
			name: [{ _id: 'nv-1', string: 'Proov' }],
			event_type: [{ _id: 'etv-1', string: 'rehearsal' }]
		}
	};
}

/**
 * Routes the five wire shapes the conversion may issue, each step's response
 * overridable so one step at a time can be made to fail.
 */
function makeConvertWire(
	overrides: {
		eventEntity?: unknown;
		readStatus?: number;
		createStatus?: number;
		createBody?: unknown;
		linkStatus?: number;
		deleteStatus?: number;
	} = {}
) {
	const {
		eventEntity = defaultEventEntity(),
		readStatus = 200,
		createStatus = 200,
		createBody = { _id: 'series-new-1' },
		linkStatus = 200,
		deleteStatus = 200
	} = overrides;
	return vi.fn().mockImplementation((rawUrl: string, init?: RequestInit) => {
		const u = String(rawUrl);
		const method = init?.method ?? 'GET';
		if (method === 'GET' && u.includes('_type.string=entity')) {
			const name = /name\.string=([^&]+)/.exec(u)?.[1] ?? '';
			return json({ entities: [{ _id: `type-${name}` }] });
		}
		if (method === 'GET' && u.includes('/entity/ev-9')) return json(eventEntity, readStatus);
		if (method === 'POST' && u.endsWith('/entity')) return json(createBody, createStatus);
		if (method === 'POST' && u.includes('/entity/ev-9')) return json({ _id: 'ev-9' }, linkStatus);
		if (method === 'DELETE' && u.includes('/property/')) return json({ deleted: true }, deleteStatus);
		throw new Error(`makeConvertWire: unexpected call ${method} ${u}`);
	});
}

/** Every call as '<METHOD> <url>', in order — the choreography pin. */
function callLog(fetchImpl: ReturnType<typeof makeConvertWire>): string[] {
	return (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).map(
		([url, init]) => `${init?.method ?? 'GET'} ${url}`
	);
}

type WireProp = {
	type: string;
	reference?: string;
	string?: string;
	number?: number;
	date?: string;
	datetime?: string;
};

function bodyOfCall(fetchImpl: ReturnType<typeof makeConvertWire>, index: number): WireProp[] {
	const [, init] = (fetchImpl.mock.calls as Array<[string, RequestInit]>)[index];
	return JSON.parse(String(init.body)) as WireProp[];
}

/** Order-independent full-shape compare (two `_parent` entries share a type). */
const byCanon = (a: WireProp, b: WireProp) =>
	a.type.localeCompare(b.type) || JSON.stringify(a).localeCompare(JSON.stringify(b));

/** Await the rejection and hand it back for shape assertions. */
async function failureOf(promise: Promise<unknown>): Promise<EventConvertError> {
	return promise.then(
		() => {
			throw new Error('resolved — expected the conversion to reject');
		},
		(e: unknown) => e as EventConvertError
	);
}

// ---------------------------------------------------------------------------
// happy path — the full four-step choreography
// ---------------------------------------------------------------------------

describe('convertEventToSeries — happy path choreography', () => {
	it('issues EXACTLY read → type-resolution → series create → link POST → name DELETE, in that order, and NOTHING else — no `_parent` value of the event is ever deleted', async () => {
		const fetchImpl = makeConvertWire();
		await convertEventToSeries(cfg, validInput, fetchImpl);

		expect(callLog(fetchImpl)).toEqual([
			`GET ${BASE}/entity/ev-9?props=name,event_type`,
			`GET ${BASE}/entity?_type.string=entity&name.string=event_series&props=_id&limit=1`,
			`POST ${BASE}/entity`,
			`POST ${BASE}/entity/ev-9`,
			`DELETE ${BASE}/property/nv-1`
		]);
	});

	it('the series create body carries the EVENT’S name and event_type, `_type` as a REFERENCE, `_parent` = [dbEntityId, seasonId], the recurrence fields — and NO `_sharing`, NO inherit-rights flag', async () => {
		const fetchImpl = makeConvertWire();
		await convertEventToSeries(cfg, validInput, fetchImpl);

		const body = bodyOfCall(fetchImpl, 2);
		expect([...body].sort(byCanon)).toEqual(
			[
				{ type: '_type', reference: 'type-event_series' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'season-1' },
				{ type: 'name', string: 'Proov' },
				{ type: 'event_type', string: 'rehearsal' },
				{ type: 'interval_days', number: 7 },
				{ type: 'start_time', string: '19:00' },
				{ type: 'start_date', date: '2026-09-07' },
				{ type: 'end_date', date: '2027-05-31' },
				{ type: 'duration_minutes', number: 90 }
			].sort(byCanon)
		);
	});

	it('the link POST carries EXACTLY ONE prop — the new series as a `_parent` reference (the event’s db + season parents stay untouched)', async () => {
		const fetchImpl = makeConvertWire();
		await convertEventToSeries(cfg, validInput, fetchImpl);

		expect(bodyOfCall(fetchImpl, 3)).toEqual([{ type: '_parent', reference: 'series-new-1' }]);
	});

	it('resolves to the new series id AND the event’s own event_type — full result shape', async () => {
		const fetchImpl = makeConvertWire();
		const result = await convertEventToSeries(cfg, validInput, fetchImpl);
		// #196 review F1 — `eventType` rides back because the caller needs it to
		// write the series' FURTHER occurrences (each `createEvent` carries its own
		// event_type; no reader inherits it from the series), and this function has
		// already read it.
		expect(result).toEqual({ seriesId: 'series-new-1', eventType: 'rehearsal' });
	});

	it('an event carrying TWO name values (Entu strings are implicitly multi-valued) gets BOTH deleted — each by its own value id, all after the link POST', async () => {
		const fetchImpl = makeConvertWire({
			eventEntity: {
				entity: {
					_id: 'ev-9',
					name: [
						{ _id: 'nv-1', string: 'Proov' },
						{ _id: 'nv-2', string: 'Proov (vana)' }
					],
					event_type: [{ _id: 'etv-1', string: 'rehearsal' }]
				}
			}
		});
		await convertEventToSeries(cfg, validInput, fetchImpl);

		const log = callLog(fetchImpl);
		expect(log.slice(3)).toEqual([
			`POST ${BASE}/entity/ev-9`,
			`DELETE ${BASE}/property/nv-1`,
			`DELETE ${BASE}/property/nv-2`
		]);
	});
});

// ---------------------------------------------------------------------------
// input validation — before ANY fetch
// ---------------------------------------------------------------------------

describe('convertEventToSeries — input validation (zero fetches on refusal)', () => {
	const cases: Array<[string, Partial<ConvertEventToSeriesInput>, RegExp]> = [
		['blank eventId', { eventId: '  ' }, /eventId/],
		['blank dbEntityId', { dbEntityId: '' }, /dbEntityId/],
		['blank seasonId', { seasonId: '' }, /seasonId/],
		['intervalDays below 1', { intervalDays: 0 }, /intervalDays/],
		['non-finite durationMinutes', { durationMinutes: Number.NaN }, /durationMinutes/],
		['blank startTime', { startTime: '' }, /startTime/],
		['endDate before startDate', { startDate: '2027-05-31', endDate: '2026-09-07' }, /endDate/]
	];

	it.each(cases)('%s → rejects naming the field, and NO fetch is issued', async (_label, patch, matcher) => {
		const fetchImpl = makeConvertWire();
		await expect(convertEventToSeries(cfg, { ...validInput, ...patch }, fetchImpl)).rejects.toThrow(
			matcher
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each(cases)(
		'%s → the refusal is an EventConvertError naming step "validate", never a bare Error a caller must guess a step for',
		async (_label, patch) => {
			// #196 review F2 — the fail-loud contract covers the validation stage
			// too. A plain Error has no `.step`, so a caller duck-typing the step
			// (the page does exactly that across its mocked module boundary) fell
			// back to naming 'read-event' for a blank form field: a step that never
			// ran, retried identically, with no clue which box was empty.
			const fetchImpl = makeConvertWire();
			const failure = await failureOf(
				convertEventToSeries(cfg, { ...validInput, ...patch }, fetchImpl)
			);
			expect(failure).toBeInstanceOf(EventConvertError);
			expect(failure.step).toBe('validate');
			expect(failure.message).toContain('validate');
			// Nothing was created, so there is no series id to carry.
			expect(failure.seriesId).toBeUndefined();
		}
	);

	it('type-level pin: the conversion input does NOT accept a `name` — the series name comes from the EVENT, which is why the conversion path is exempt from standalone-name validation', () => {
		// @ts-expect-error — ConvertEventToSeriesInput must never grow a `name`
		// field: a caller-supplied name would freeze a copy instead of converting
		// the event's own, and would re-open the createEvent name-validation
		// question the conversion design deliberately sidesteps.
		const rejected: ConvertEventToSeriesInput = { ...validInput, name: 'frozen copy' };
		expect(rejected).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// partial failure — loud, step-named, nothing silent (#196 test 3)
// ---------------------------------------------------------------------------

describe('convertEventToSeries — partial failure surfaces loudly and NAMES the failed step', () => {
	it('read-event GET non-2xx → EventConvertError step "read-event" (named in the message); NO write was issued', async () => {
		const fetchImpl = makeConvertWire({ readStatus: 500 });
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure).toBeInstanceOf(EventConvertError);
		expect(failure.step).toBe('read-event');
		expect(failure.message).toContain('read-event');
		expect(failure.seriesId).toBeUndefined();
		expect(callLog(fetchImpl)).toEqual([`GET ${BASE}/entity/ev-9?props=name,event_type`]);
	});

	it('a NAMELESS event refuses in read-event — a series with no name violates v4E — and NO write was issued', async () => {
		const fetchImpl = makeConvertWire({
			eventEntity: { entity: { _id: 'ev-9', event_type: [{ _id: 'etv-1', string: 'rehearsal' }] } }
		});
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure).toBeInstanceOf(EventConvertError);
		expect(failure.step).toBe('read-event');
		expect(failure.message).toMatch(/name/);
		expect(failure.reason).toBe('missing-name');
		expect(callLog(fetchImpl)).toEqual([`GET ${BASE}/entity/ev-9?props=name,event_type`]);
	});

	it('a TYPELESS event refuses in read-event too — BEFORE any write, so nothing is stranded (#196 review F1)', async () => {
		// The old behaviour created the series WITHOUT event_type (v4E marks it
		// `required: true`, and Entu's `mandatory` rejects nothing), linked the
		// event, deleted the event's own name — and only THEN discovered the
		// occurrence loop could not run, with the event out of the standalone list
		// and no in-app way back. Nothing past the GET may go on the wire.
		const fetchImpl = makeConvertWire({
			eventEntity: { entity: { _id: 'ev-9', name: [{ _id: 'nv-1', string: 'Proov' }] } }
		});
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure).toBeInstanceOf(EventConvertError);
		expect(failure.step).toBe('read-event');
		expect(failure.message).toMatch(/event_type/);
		expect(failure.reason).toBe('missing-event-type');
		expect(failure.seriesId).toBeUndefined();
		expect(callLog(fetchImpl)).toEqual([`GET ${BASE}/entity/ev-9?props=name,event_type`]);
	});

	it('a BLANK-STRING event_type is refused exactly like an absent one — never sent as `string: ""`', async () => {
		const fetchImpl = makeConvertWire({
			eventEntity: {
				entity: {
					_id: 'ev-9',
					name: [{ _id: 'nv-1', string: 'Proov' }],
					event_type: [{ _id: 'etv-1', string: '   ' }]
				}
			}
		});
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure.reason).toBe('missing-event-type');
		expect(callLog(fetchImpl)).toEqual([`GET ${BASE}/entity/ev-9?props=name,event_type`]);
	});

	it('series create POST non-2xx → step "create-series"; no link POST, no name DELETE, no seriesId on the error', async () => {
		const fetchImpl = makeConvertWire({ createStatus: 500 });
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure).toBeInstanceOf(EventConvertError);
		expect(failure.step).toBe('create-series');
		expect(failure.message).toContain('create-series');
		expect(failure.seriesId).toBeUndefined();
		const log = callLog(fetchImpl);
		expect(log.filter((c) => c.startsWith('POST'))).toEqual([`POST ${BASE}/entity`]);
		expect(log.filter((c) => c.startsWith('DELETE'))).toEqual([]);
	});

	it('series create 2xx WITHOUT _id (the apparent-success trap) → step "create-series", never a silent success', async () => {
		const fetchImpl = makeConvertWire({ createBody: {} });
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure).toBeInstanceOf(EventConvertError);
		expect(failure.step).toBe('create-series');
		expect(callLog(fetchImpl).filter((c) => c.startsWith('DELETE'))).toEqual([]);
	});

	it('link POST non-2xx → step "link-event" carrying the orphaned series id; the name DELETE is NOT issued (the event stays named and standalone)', async () => {
		const fetchImpl = makeConvertWire({ linkStatus: 500 });
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure).toBeInstanceOf(EventConvertError);
		expect(failure.step).toBe('link-event');
		expect(failure.message).toContain('link-event');
		expect(failure.seriesId).toBe('series-new-1');
		expect(callLog(fetchImpl).filter((c) => c.startsWith('DELETE'))).toEqual([]);
	});

	it('name DELETE non-2xx → step "delete-name" carrying the series id; the link ALREADY landed (the event is converted, its own name merely lingers and shadows the series name)', async () => {
		const fetchImpl = makeConvertWire({ deleteStatus: 500 });
		const failure = await failureOf(convertEventToSeries(cfg, validInput, fetchImpl));

		expect(failure).toBeInstanceOf(EventConvertError);
		expect(failure.step).toBe('delete-name');
		expect(failure.message).toContain('delete-name');
		expect(failure.seriesId).toBe('series-new-1');
		expect(callLog(fetchImpl)).toContain(`POST ${BASE}/entity/ev-9`);
	});
});

// ---------------------------------------------------------------------------
// createEvent validation is UNTOUCHED (#196 test 4 — regression guard)
// ---------------------------------------------------------------------------

describe('createEvent standalone-name validation stays intact beside the conversion path', () => {
	it('a standalone create (no seriesId) with a blank name STILL rejects before any fetch — #196 must not weaken #132 review F2', async () => {
		const fetchImpl = vi.fn();
		await expect(
			createEvent(
				cfg,
				{
					name: '   ',
					dbEntityId: 'org-1',
					extraParentIds: ['season-1'],
					eventType: 'concert',
					startDatetime: '2026-09-07T16:00:00.000Z'
				},
				fetchImpl as unknown as typeof fetch
			)
		).rejects.toThrow(/name/);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// integration — the REAL read producers see the converted world (#196 tests 2+6)
// ---------------------------------------------------------------------------

type FakeProp = {
	_id: string;
	string?: string;
	number?: number;
	reference?: string;
	date?: string;
	datetime?: string;
};
type FakeSeed = Omit<FakeProp, '_id'>;
type FakeEntity = { id: string; type: string; props: Record<string, FakeProp[]> };

/**
 * A stateful in-memory Entu: create (collection POST, `_type` resolved via the
 * referenced type-def entity — the real wire contract), property append
 * (entity/{id} POST), property-value DELETE, entity GET, and filtered listing
 * with the denormalized `_parent[].entity_type` the real API serves. Just
 * enough wire for the conversion to WRITE through and the agenda/panel
 * producers to READ back — no hand-set app state anywhere.
 */
class FakeEntu {
	private entities = new Map<string, FakeEntity>();
	private seq = 0;

	seed(id: string, type: string, props: Record<string, FakeSeed[]>): void {
		this.entities.set(id, { id, type, props: this.materialize(props) });
	}

	/** Test-harness mutation of STORED data (e.g. renaming the series) — the
	 *  producers still do all their own reading. */
	setProp(id: string, prop: string, values: FakeSeed[]): void {
		const entity = this.entities.get(id);
		if (!entity) throw new Error(`FakeEntu.setProp: no entity ${id}`);
		entity.props[prop] = this.materialize({ [prop]: values })[prop];
	}

	private materialize(props: Record<string, FakeSeed[]>): Record<string, FakeProp[]> {
		const out: Record<string, FakeProp[]> = {};
		for (const [key, values] of Object.entries(props)) {
			out[key] = values.map((v) => ({ _id: `val-${++this.seq}`, ...v }));
		}
		return out;
	}

	private serialize(entity: FakeEntity): Record<string, unknown> {
		const out: Record<string, unknown> = { _id: entity.id };
		for (const [key, values] of Object.entries(entity.props)) {
			out[key] = values.map((v) =>
				key === '_parent'
					? { ...v, entity_type: this.entities.get(v.reference ?? '')?.type }
					: { ...v }
			);
		}
		return out;
	}

	fetch = ((rawUrl: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(String(rawUrl));
		const method = init?.method ?? 'GET';
		const [, endpoint, targetId] = url.pathname.split('/').filter(Boolean);

		if (endpoint === 'property' && method === 'DELETE' && targetId) {
			for (const entity of this.entities.values()) {
				for (const [key, values] of Object.entries(entity.props)) {
					if (values.some((v) => v._id === targetId)) {
						entity.props[key] = values.filter((v) => v._id !== targetId);
						return json({ deleted: true });
					}
				}
			}
			return json({ error: 'not found' }, 404);
		}

		if (endpoint === 'entity' && targetId) {
			const entity = this.entities.get(targetId);
			if (!entity) return json({ error: 'not found' }, 404);
			if (method === 'GET') return json({ entity: this.serialize(entity) });
			if (method === 'POST') {
				const props = JSON.parse(String(init?.body)) as Array<{ type: string } & FakeSeed>;
				for (const { type, ...value } of props) {
					entity.props[type] = [
						...(entity.props[type] ?? []),
						...this.materialize({ [type]: [value] })[type]
					];
				}
				return json({ _id: targetId });
			}
		}

		if (endpoint === 'entity' && !targetId) {
			if (method === 'POST') {
				const props = JSON.parse(String(init?.body)) as Array<{ type: string } & FakeSeed>;
				const typeRef = props.find((p) => p.type === '_type')?.reference ?? '';
				const typeName = this.entities.get(typeRef)?.props.name?.[0]?.string;
				if (!typeName) return json({ error: 'unknown _type reference' }, 400);
				const id = `created-${++this.seq}`;
				const grouped: Record<string, FakeSeed[]> = {};
				for (const { type, ...value } of props) {
					if (type === '_type') continue;
					(grouped[type] ??= []).push(value);
				}
				this.entities.set(id, { id, type: typeName, props: this.materialize(grouped) });
				return json({ _id: id });
			}
			// filtered listing
			const params = url.searchParams;
			const typeName = params.get('_type.string');
			const parentRef = params.get('_parent.reference');
			const nameString = params.get('name.string');
			const matches = [...this.entities.values()].filter(
				(e) =>
					(!typeName || e.type === typeName) &&
					(!parentRef || (e.props._parent ?? []).some((p) => p.reference === parentRef)) &&
					(!nameString || (e.props.name ?? []).some((p) => p.string === nameString))
			);
			return json({ count: matches.length, entities: matches.map((e) => this.serialize(e)) });
		}

		return json({ error: `FakeEntu: unhandled ${method} ${url.pathname}` }, 500);
	}) as typeof fetch;
}

function seededWire(): FakeEntu {
	const wire = new FakeEntu();
	// type definitions — what resolveTypeId queries and create POSTs reference
	wire.seed('type-event', 'entity', { name: [{ string: 'event' }] });
	wire.seed('type-event_series', 'entity', { name: [{ string: 'event_series' }] });
	// the collective tree: database entity → season → one standalone event
	wire.seed('org-1', 'database', { name: [{ string: 'Polyphony test' }] });
	wire.seed('season-1', 'season', {
		name: [{ string: 'Kevad 2027' }],
		_parent: [{ reference: 'org-1' }]
	});
	wire.seed('ev-9', 'event', {
		name: [{ string: 'Proov' }],
		event_type: [{ string: 'rehearsal' }],
		start_datetime: [{ datetime: '2027-04-20T18:00:00.000Z' }],
		duration_minutes: [{ number: 75 }],
		location: [{ string: 'Saal' }],
		_parent: [{ reference: 'org-1' }, { reference: 'season-1' }]
	});
	return wire;
}

const icfg: EntuCfg = { db: 'polytest', token: 'jwt' };

const conversionInput: ConvertEventToSeriesInput = {
	eventId: 'ev-9',
	dbEntityId: 'org-1',
	seasonId: 'season-1',
	intervalDays: 7,
	startTime: '21:00',
	startDate: '2027-04-20',
	endDate: '2027-06-30',
	durationMinutes: 90
};

describe('integration — conversion writes, the REAL agenda/panel producers read it back', () => {
	it('the converted event appears on the agenda UNDER the series: listEvents still finds it via its season parent, name/duration/location merged (own values win, series fills the name gap)', async () => {
		const wire = seededWire();

		// sanity: BEFORE conversion the panel classifies ev-9 as standalone
		expect(await listEventsForSeason(icfg, 'season-1', wire.fetch)).toEqual([
			{ id: 'ev-9', name: 'Proov', startDatetime: '2027-04-20T18:00:00.000Z' }
		]);

		const { seriesId } = await convertEventToSeries(icfg, conversionInput, wire.fetch);
		expect(seriesId).toMatch(/\S/);

		// the FULL agenda row: found via the season parent, name inherited from
		// the series (own name value deleted), own duration/location intact
		expect(await listEvents(icfg, 'season-1', wire.fetch)).toEqual([
			{
				id: 'ev-9',
				name: 'Proov',
				startDatetime: '2027-04-20T18:00:00.000Z',
				durationMinutes: 75,
				location: 'Saal',
				eventType: 'rehearsal',
				conductors: [],
				owners: [],
				editors: []
			}
		]);
	});

	it('the event’s OWN name value is really GONE — renaming the series propagates to the agenda row (app-layer merge, not a frozen copy)', async () => {
		const wire = seededWire();
		const { seriesId } = await convertEventToSeries(icfg, conversionInput, wire.fetch);

		wire.setProp(seriesId, 'name', [{ string: 'Esmaspäeva proovid' }]);

		const [row] = await listEvents(icfg, 'season-1', wire.fetch);
		expect(row.name).toBe('Esmaspäeva proovid');
	});

	it('the panel reclassifies: ev-9 is no longer a standalone event, and the new series lists under the season with the event’s name and eventCount 1', async () => {
		const wire = seededWire();
		const { seriesId } = await convertEventToSeries(icfg, conversionInput, wire.fetch);

		expect(await listEventsForSeason(icfg, 'season-1', wire.fetch)).toEqual([]);
		expect(await listEventSeriesForSeason(icfg, 'season-1', wire.fetch)).toEqual([
			{ id: seriesId, name: 'Proov', eventCount: 1 }
		]);
	});
});

// (*MVOX:Tallis* — #196 RED: event → series conversion data-layer contract)
