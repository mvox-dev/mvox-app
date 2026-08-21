import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createEvent, createEventSeries, createSeason } from './entityCreate';

// #132/T1 — the shared entity CREATE write layer for event management:
// `createSeason`, `createEventSeries`, `createEvent`.
//
// Contract under test (see entityCreate.ts module header):
//
//   - EXACTLY TWO fetches per create: the resolveTypeId GET (cached) + ONE
//     `POST entity` (COLLECTION endpoint, never entity/{id}).
//   - `_type` as a resolved REFERENCE (#10 pinned wire-shape), `_parent` =
//     `[orgId, ...extraParentIds]`, ONE prop PER id — zero lookup fetches, the
//     data layer never guesses an org/season. The ORG IS ITS OWN REQUIRED
//     FIELD (#132 review F4: v4E marks it `required, parentCard: '1'` on all
//     three types, and a flat id list made it forgettable), and on createEvent
//     THE SERIES PARENT IS ITS OWN FIELD TOO (`seriesId`, #132 review F2: it is
//     the parent whose presence decides whether a blank `name` is legal, and an
//     anonymous entry in a flat list is invisible to that check). A series
//     occurrence therefore carries BOTH its season parent (what listRehearsals
//     selects on, in `extraParentIds`) and its series parent (what the
//     inheritance merge follows, in `seriesId`).
//   - CRITICAL (#132, Mihkel 2026-08-13): NO `_sharing`, NO `_inheritrights`
//     anywhere in the create body — rights/visibility are TRUSTED to Entu's
//     `_inheritrights` chain from the organization. This is a DELIBERATE
//     deviation from createSection (which pins `_sharing: 'public'` as a
//     v4E per-type policy) — pinned here BOTH by the full-shape toEqual on
//     every body (#partial-assertions-hide-bugs) AND by explicit absence
//     probes, so a future "helpful" copy-paste of the old pattern fails loud.
//   - Field-typed wire values: start_date/end_date → { date }, start_datetime
//     → { datetime }, duration_minutes/capacity/interval_days → { number },
//     conductor → { reference } one entry per ref, everything else → { string }.
//   - EVERY v4E-required property is enforced BEFORE any fetch (#132 review
//     F1/F2/F3 — Entu `mandatory` is a soft UI hint that rejects nothing, so
//     this module is the only enforcement point): season name/start_date/
//     end_date; series name/event_type/interval_days/start_time/
//     duration_minutes/start_date/end_date; event start_datetime (+ event_type,
//     stricter than v4E because listRehearsals filters on the event's OWN
//     event_type.string; and event.name whenever no `seriesId` is given —
//     nothing to inherit from means a permanently nameless entity, #132 F2).
//   - Only genuinely INHERITABLE-or-optional props may be omitted: event.name
//     (v4E 'inherited from series.name if not set' — WITH a series parent),
//     event.location/description, the two series default_* fields, conductor,
//     capacity, duration_minutes. Those absent OR BLANK → prop OMITTED entirely
//     (an empty own-value on an event would shadow the series default in the
//     read-side `??` inheritance merge, and the T4/T5 forms hand us '' for every
//     untouched field). The same normalization on the NUMBER optionals: only a
//     FINITE number is sent, so 0 survives while undefined/null/NaN drop the
//     prop (a blank number input hands the form null or NaN, both typed
//     `number`, and JSON.stringify(NaN) is `null` on the wire — #132 F1).
//   - Resolves to the created entity's `_id`; 2xx WITHOUT `_id` throws (the
//     apparent-success trap); non-2xx POST throws with status surfaced;
//     resolveTypeId failure propagates with NO create POST issued.
//
// INTEGRATION NOTE — T1 is infra with NO page entry point yet: the agenda /
// season-management wiring that calls these functions lands in #132 T2/T4/T6
// (each with its own page.*.spec.ts route test, per house rule). What this
// spec DOES integrate is the real transport layer: the fetchImpl seam sits
// BELOW `entuFetch`/`entuUrl`, so the URL composition (base + db segment +
// endpoint) and the Authorization header asserted in the "transport
// integration" block exercise $lib/entu/request for real, not a mock of it.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

/**
 * Routes the two shapes any of the three creates may issue:
 *   type-resolution GET (`_type.string=entity&name.string=<type>`) → the
 *     type-def id for that name (from `typeIds`, default `type-<name>`),
 *   anything else → the entity-create POST → `createBody` at `createStatus`.
 */
function makeFetchMock(
	opts: {
		typeIds?: Record<string, string>;
		typeEntitiesEmpty?: boolean;
		createBody?: unknown;
		createStatus?: number;
	} = {}
) {
	const { typeIds = {}, typeEntitiesEmpty = false, createBody, createStatus = 200 } = opts;
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=entity')) {
			if (typeEntitiesEmpty) return Promise.resolve(json({ entities: [] }));
			const name = /name\.string=([^&]+)/.exec(u)?.[1] ?? '';
			return Promise.resolve(json({ entities: [{ _id: typeIds[name] ?? `type-${name}` }] }));
		}
		return Promise.resolve(json(createBody ?? { _id: 'new-1' }, createStatus));
	});
}

type WireProp = {
	type: string;
	reference?: string;
	string?: string;
	number?: number;
	date?: string;
	datetime?: string;
};

/** The one call that is not type-resolution: the create POST. */
function createCall(fetchImpl: ReturnType<typeof makeFetchMock>): [string, RequestInit] {
	const calls = fetchImpl.mock.calls as Array<[string, RequestInit]>;
	const found = calls.filter(([url]) => !String(url).includes('_type.string=entity'));
	expect(found, 'exactly one entity-create call').toHaveLength(1);
	return found[0];
}

function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>): WireProp[] {
	const [, init] = createCall(fetchImpl);
	return JSON.parse(String(init.body)) as WireProp[];
}

const byType = (a: WireProp, b: WireProp) =>
	a.type.localeCompare(b.type) || JSON.stringify(a).localeCompare(JSON.stringify(b));

/** The type-resolution GETs issued (URL strings). */
function typeResolutionCalls(fetchImpl: ReturnType<typeof makeFetchMock>): string[] {
	return (fetchImpl.mock.calls as Array<[string]>)
		.map(([url]) => String(url))
		.filter((u) => u.includes('_type.string=entity'));
}

// Minimal VALID inputs — every v4E-required field present, nothing optional.
// Reused by the shared cross-create blocks so a new required field breaks them
// once, here, instead of silently weakening a dozen assertions.
const minimalSeason = {
	name: 'S',
	orgId: 'org-1',
	startDate: '2026-09-01',
	endDate: '2027-05-31'
};
const minimalSeries = {
	name: 'S',
	orgId: 'org-1',
	extraParentIds: ['season-1'],
	eventType: 'rehearsal',
	intervalDays: 7,
	startTime: '19:00',
	durationMinutes: 90,
	startDate: '2026-09-07',
	endDate: '2027-05-31'
};
const minimalEvent = {
	name: 'E',
	orgId: 'org-1',
	extraParentIds: ['season-1'],
	eventType: 'concert',
	startDatetime: '2026-09-07T16:00:00.000Z'
};

// ---------------------------------------------------------------------------
// createSeason
// ---------------------------------------------------------------------------

describe('createSeason — wire shape', () => {
	it('resolves the `season` type (ONE resolution GET carrying name.string=season) and POSTs `_type` as that REFERENCE — never a string', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { season: 'season-type-9' } });
		await createSeason(
			cfg,
			{
				name: 'Hooaeg 2026/27',
				startDate: '2026-09-01',
				endDate: '2027-05-31',
				orgId: 'org-1'
			},
			fetchImpl
		);

		const resolutions = typeResolutionCalls(fetchImpl);
		expect(resolutions).toHaveLength(1);
		expect(resolutions[0]).toContain('name.string=season');

		const typeProp = createCallBody(fetchImpl).find((p) => p.type === '_type');
		expect(typeProp).toEqual({ type: '_type', reference: 'season-type-9' });
	});

	it('POST body FULL SHAPE without conductors: _type ref + _parent=orgId + name string + start_date/end_date as { date } — and NOTHING else (no _sharing, no _inheritrights, no conductor)', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { season: 'season-type-9' } });
		await createSeason(
			cfg,
			{
				name: 'Hooaeg 2026/27',
				startDate: '2026-09-01',
				endDate: '2027-05-31',
				orgId: 'org-1'
			},
			fetchImpl
		);

		// FULL SET check (toEqual on the sorted list, not arrayContaining) — a body
		// smuggling an extra prop (_sharing above all) must fail HERE, not ship
		// silently (#partial-assertions-hide-bugs).
		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'season-type-9' },
				{ type: '_parent', reference: 'org-1' },
				{ type: 'name', string: 'Hooaeg 2026/27' },
				{ type: 'start_date', date: '2026-09-01' },
				{ type: 'end_date', date: '2027-05-31' }
			].sort(byType)
		);
	});

	it('conductorRefs → one `{ type: conductor, reference }` prop PER ref, in order — full-shape checked', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { season: 'season-type-9' } });
		await createSeason(
			cfg,
			{
				name: 'Hooaeg 2026/27',
				startDate: '2026-09-01',
				endDate: '2027-05-31',
				orgId: 'org-1',
				conductorRefs: ['person-7', 'person-8']
			},
			fetchImpl
		);

		const body = createCallBody(fetchImpl);
		expect(body.filter((p) => p.type === 'conductor')).toEqual([
			{ type: 'conductor', reference: 'person-7' },
			{ type: 'conductor', reference: 'person-8' }
		]);
		expect([...body].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'season-type-9' },
				{ type: '_parent', reference: 'org-1' },
				{ type: 'name', string: 'Hooaeg 2026/27' },
				{ type: 'start_date', date: '2026-09-01' },
				{ type: 'end_date', date: '2027-05-31' },
				{ type: 'conductor', reference: 'person-7' },
				{ type: 'conductor', reference: 'person-8' }
			].sort(byType)
		);
	});

	it('the create is a POST to the COLLECTION endpoint `entity` — never entity/{id} (that appends onto an EXISTING entity) — and issues EXACTLY two fetches (resolution + create), zero org lookups', async () => {
		const fetchImpl = makeFetchMock();
		await createSeason(cfg, { ...minimalSeason }, fetchImpl);
		const [url, init] = createCall(fetchImpl);
		expect(init.method).toBe('POST');
		expect(String(url)).toContain('/testdb/entity');
		// No id path segment after `entity` (query-string is allowed, a path is not).
		expect(String(url)).not.toMatch(/\/entity\/[^?]/);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('resolves to the NEW entity `_id` from the create response', async () => {
		const fetchImpl = makeFetchMock({ createBody: { _id: 'season-created-3' } });
		await expect(createSeason(cfg, { ...minimalSeason }, fetchImpl)).resolves.toBe(
			'season-created-3'
		);
	});
});

// ---------------------------------------------------------------------------
// createEventSeries
// ---------------------------------------------------------------------------

describe('createEventSeries — wire shape', () => {
	const full = {
		name: 'Mon rehearsals',
		orgId: 'org-1',
		extraParentIds: ['season-1'],
		eventType: 'rehearsal',
		intervalDays: 7,
		startTime: '19:00',
		startDate: '2026-09-07',
		endDate: '2027-05-31',
		durationMinutes: 90,
		defaultLocation: 'Choir hall',
		defaultDescription: 'Weekly'
	};

	it('resolves the `event_series` type and POSTs `_type` as that reference + one `_parent` per id — the ORG FIRST (v4E parentCard 1) then the SEASON, both verbatim', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event_series: 'series-type-5' } });
		await createEventSeries(cfg, full, fetchImpl);

		const resolutions = typeResolutionCalls(fetchImpl);
		expect(resolutions).toHaveLength(1);
		expect(resolutions[0]).toContain('name.string=event_series');

		const body = createCallBody(fetchImpl);
		expect(body.find((p) => p.type === '_type')).toEqual({
			type: '_type',
			reference: 'series-type-5'
		});
		expect(body.filter((p) => p.type === '_parent')).toEqual([
			{ type: '_parent', reference: 'org-1' },
			{ type: '_parent', reference: 'season-1' }
		]);
	});

	it('POST body FULL SHAPE with all optionals — every v4E event_series property on its OWN wire name: event_type/start_time strings, interval_days/duration_minutes numbers, start_date/end_date { date }, default_location + default_description (NOT `description` — no reader ever reads that)', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event_series: 'series-type-5' } });
		await createEventSeries(cfg, full, fetchImpl);

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'series-type-5' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'season-1' },
				{ type: 'name', string: 'Mon rehearsals' },
				{ type: 'event_type', string: 'rehearsal' },
				{ type: 'interval_days', number: 7 },
				{ type: 'start_time', string: '19:00' },
				{ type: 'start_date', date: '2026-09-07' },
				{ type: 'end_date', date: '2027-05-31' },
				{ type: 'duration_minutes', number: 90 },
				{ type: 'default_location', string: 'Choir hall' },
				{ type: 'default_description', string: 'Weekly' }
			].sort(byType)
		);
	});

	it('the series description rides on `default_description` — the name eventDetail actually fetches and merges; a `description` prop is NEVER sent (it would be write-only, invisible to every reader and never inherited by child events)', async () => {
		const fetchImpl = makeFetchMock();
		await createEventSeries(cfg, { ...minimalSeries, defaultDescription: 'Weekly' }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body.filter((p) => p.type === 'description')).toEqual([]);
		expect(body.filter((p) => p.type === 'default_description')).toEqual([
			{ type: 'default_description', string: 'Weekly' }
		]);
	});

	it('the two INHERITABLE defaults absent → those props are OMITTED, but every v4E-REQUIRED property is still sent (a series missing interval_days/start_date/end_date is structurally un-generatable by T2; one missing event_type/duration_minutes defeats the point of a defaults template)', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event_series: 'series-type-5' } });
		await createEventSeries(cfg, { ...minimalSeries, name: 'Mon rehearsals' }, fetchImpl);

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'series-type-5' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'season-1' },
				{ type: 'name', string: 'Mon rehearsals' },
				{ type: 'event_type', string: 'rehearsal' },
				{ type: 'interval_days', number: 7 },
				{ type: 'start_time', string: '19:00' },
				{ type: 'start_date', date: '2026-09-07' },
				{ type: 'end_date', date: '2027-05-31' },
				{ type: 'duration_minutes', number: 90 }
			].sort(byType)
		);
	});

	it('BLANK default_location / default_description ("" / whitespace) are omitted exactly like absent ones — the T4/T5 forms bind untouched inputs to $state("")', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event_series: 'series-type-5' } });
		await createEventSeries(
			cfg,
			{
				...minimalSeries,
				name: 'Mon rehearsals',
				defaultLocation: '',
				defaultDescription: '   '
			},
			fetchImpl
		);

		const body = createCallBody(fetchImpl);
		expect(body.filter((p) => p.type === 'default_location')).toEqual([]);
		expect(body.filter((p) => p.type === 'default_description')).toEqual([]);
	});

	it('resolves to the NEW entity `_id` from the create response', async () => {
		const fetchImpl = makeFetchMock({ createBody: { _id: 'series-created-2' } });
		await expect(createEventSeries(cfg, { ...minimalSeries }, fetchImpl)).resolves.toBe(
			'series-created-2'
		);
	});
});

// ---------------------------------------------------------------------------
// createEvent
// ---------------------------------------------------------------------------

describe('createEvent — wire shape', () => {
	it('resolves the `event` type; minimal body is EXACTLY _type ref + _parent refs + name string + event_type string + start_datetime { datetime }', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event: 'event-type-3' } });
		await createEvent(
			cfg,
			{
				name: 'Spring concert',
				orgId: 'org-1',
				extraParentIds: ['season-1'],
				eventType: 'concert',
				startDatetime: '2027-04-11T17:00:00.000Z'
			},
			fetchImpl
		);

		const resolutions = typeResolutionCalls(fetchImpl);
		expect(resolutions).toHaveLength(1);
		expect(resolutions[0]).toContain('name.string=event');

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'event-type-3' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'season-1' },
				{ type: 'name', string: 'Spring concert' },
				{ type: 'event_type', string: 'concert' },
				{ type: 'start_datetime', datetime: '2027-04-11T17:00:00.000Z' }
			].sort(byType)
		);
	});

	it('POST body FULL SHAPE with every optional: start_datetime { datetime } + duration_minutes { number } + location/description { string } + conductor { reference } per ref + capacity { number }', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event: 'event-type-3' } });
		await createEvent(
			cfg,
			{
				name: 'Mon rehearsal',
				orgId: 'org-1',
				seriesId: 'series-1',
				extraParentIds: ['season-1'],
				eventType: 'rehearsal',
				startDatetime: '2026-09-07T16:00:00.000Z',
				durationMinutes: 120,
				location: 'Choir hall',
				description: 'Bring scores',
				conductorRefs: ['person-7', 'person-8'],
				capacity: 40
			},
			fetchImpl
		);

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'event-type-3' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'season-1' },
				{ type: '_parent', reference: 'series-1' },
				{ type: 'name', string: 'Mon rehearsal' },
				{ type: 'event_type', string: 'rehearsal' },
				{ type: 'start_datetime', datetime: '2026-09-07T16:00:00.000Z' },
				{ type: 'duration_minutes', number: 120 },
				{ type: 'location', string: 'Choir hall' },
				{ type: 'description', string: 'Bring scores' },
				{ type: 'conductor', reference: 'person-7' },
				{ type: 'conductor', reference: 'person-8' },
				{ type: 'capacity', number: 40 }
			].sort(byType)
		);
	});

	it('a SERIES occurrence carries ALL THREE parents — one `_parent` prop per id: ORG first (v4E parentCard 1), then the named `seriesId` (what the read-side inheritance merge follows), then the caller`s extras verbatim including the SEASON (what listRehearsals selects on, `_parent.reference=<seasonId>` with no ancestor expansion). Still exactly two fetches — no parent-kind sniffing.', async () => {
		const fetchImpl = makeFetchMock();
		await createEvent(
			cfg,
			{
				name: 'Mon rehearsal',
				orgId: 'org-1',
				seriesId: 'series-42',
				extraParentIds: ['season-1'],
				eventType: 'rehearsal',
				startDatetime: '2026-09-07T16:00:00.000Z'
			},
			fetchImpl
		);
		expect(createCallBody(fetchImpl).filter((p) => p.type === '_parent')).toEqual([
			{ type: '_parent', reference: 'org-1' },
			{ type: '_parent', reference: 'series-42' },
			{ type: '_parent', reference: 'season-1' }
		]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('a series id repeated in extraParentIds is sent ONCE — the named seriesId wins its position and the duplicate is dropped (Entu would otherwise store two identical `_parent` values)', async () => {
		const fetchImpl = makeFetchMock();
		await createEvent(
			cfg,
			{
				...minimalEvent,
				seriesId: 'series-42',
				extraParentIds: ['season-1', 'series-42']
			},
			fetchImpl
		);
		expect(createCallBody(fetchImpl).filter((p) => p.type === '_parent')).toEqual([
			{ type: '_parent', reference: 'org-1' },
			{ type: '_parent', reference: 'series-42' },
			{ type: '_parent', reference: 'season-1' }
		]);
	});

	it('WITH a seriesId, name is INHERITABLE (v4E: "inherited from series.name if not set") — omitted or blank → NO name prop, so a generated occurrence tracks its series name instead of freezing a copy that a later series rename cannot reach', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event: 'event-type-3' } });
		await createEvent(
			cfg,
			{
				orgId: 'org-1',
				seriesId: 'series-42',
				extraParentIds: ['season-1'],
				eventType: 'rehearsal',
				startDatetime: '2026-09-07T16:00:00.000Z'
			},
			fetchImpl
		);
		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'event-type-3' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'season-1' },
				{ type: '_parent', reference: 'series-42' },
				{ type: 'event_type', string: 'rehearsal' },
				{ type: 'start_datetime', datetime: '2026-09-07T16:00:00.000Z' }
			].sort(byType)
		);

		const blank = makeFetchMock({ typeIds: { event: 'event-type-3' } });
		await createEvent(cfg, { ...minimalEvent, seriesId: 'series-42', name: '   ' }, blank);
		expect(createCallBody(blank).filter((p) => p.type === 'name')).toEqual([]);
	});

	it('BLANK INHERITABLE strings are omitted, NOT sent as "" — an own empty location/description would win the read-side `??` merge and SHADOW the series default (entuSeasons.ts / eventDetail.ts)', async () => {
		const fetchImpl = makeFetchMock({ typeIds: { event: 'event-type-3' } });
		await createEvent(
			cfg,
			{
				name: 'Mon rehearsal',
				orgId: 'org-1',
				seriesId: 'series-42',
				eventType: 'rehearsal',
				startDatetime: '2026-09-07T16:00:00.000Z',
				location: '',
				description: '   '
			},
			fetchImpl
		);

		expect([...createCallBody(fetchImpl)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'event-type-3' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'series-42' },
				{ type: 'name', string: 'Mon rehearsal' },
				{ type: 'event_type', string: 'rehearsal' },
				{ type: 'start_datetime', datetime: '2026-09-07T16:00:00.000Z' }
			].sort(byType)
		);
	});

	it('NON-FINITE optional numbers are OMITTED, never sent as `{"number":null}` — a blank `<input type="number">` hands the form `null` and `Number("")` is `NaN`, both of which type-check as `number`, and JSON.stringify turns NaN into null on the wire (#132 review F1)', async () => {
		const nan = makeFetchMock({ typeIds: { event: 'event-type-3' } });
		await createEvent(
			cfg,
			{ ...minimalEvent, capacity: Number.NaN, durationMinutes: Number.NaN },
			nan
		);
		const nanBody = createCallBody(nan);
		expect(nanBody.filter((p) => p.type === 'capacity')).toEqual([]);
		expect(nanBody.filter((p) => p.type === 'duration_minutes')).toEqual([]);
		// The wire text itself must not contain a null-valued number prop.
		expect(String(createCall(nan)[1].body)).not.toContain('"number":null');

		const nulls = makeFetchMock({ typeIds: { event: 'event-type-3' } });
		await createEvent(
			cfg,
			{
				...minimalEvent,
				capacity: null as unknown as number,
				durationMinutes: null as unknown as number
			},
			nulls
		);
		expect([...createCallBody(nulls)].sort(byType)).toEqual(
			[
				{ type: '_type', reference: 'event-type-3' },
				{ type: '_parent', reference: 'org-1' },
				{ type: '_parent', reference: 'season-1' },
				{ type: 'name', string: 'E' },
				{ type: 'event_type', string: 'concert' },
				{ type: 'start_datetime', datetime: '2026-09-07T16:00:00.000Z' }
			].sort(byType)
		);
	});

	it('a literal 0 IS still sent for the optional numbers — only non-finite values drop the prop', async () => {
		const fetchImpl = makeFetchMock();
		await createEvent(cfg, { ...minimalEvent, capacity: 0, durationMinutes: 0 }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body.filter((p) => p.type === 'capacity')).toEqual([{ type: 'capacity', number: 0 }]);
		expect(body.filter((p) => p.type === 'duration_minutes')).toEqual([
			{ type: 'duration_minutes', number: 0 }
		]);
	});

	it('resolves to the NEW entity `_id` from the create response', async () => {
		const fetchImpl = makeFetchMock({ createBody: { _id: 'event-created-5' } });
		await expect(createEvent(cfg, { ...minimalEvent }, fetchImpl)).resolves.toBe('event-created-5');
	});
});

// ---------------------------------------------------------------------------
// Input hygiene — rejected BEFORE any fetch (createSection's pattern)
// ---------------------------------------------------------------------------

describe('input hygiene — a missing/blank v4E-REQUIRED field throws before ANY fetch is issued', () => {
	/** Every case: run the create, expect the message, expect ZERO fetches. */
	async function expectRejectedWithoutFetch(
		run: (f: typeof fetch) => Promise<string>,
		message: RegExp
	) {
		const fetchImpl = makeFetchMock();
		await expect(run(fetchImpl as unknown as typeof fetch)).rejects.toThrow(message);
		expect(fetchImpl).not.toHaveBeenCalled();
	}

	it('createSeason: a blank/whitespace name throws (a nameless season renders as an empty header)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createSeason(cfg, { ...minimalSeason, name: '   ' }, f),
			/name must not be empty/
		);
	});

	it('createSeason: a blank start_date / end_date throws — both are v4E-required, listSeasons maps a blank to "" and sorts that season to the FRONT, and the header renders dateless (#132 review F2)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createSeason(cfg, { ...minimalSeason, startDate: '' }, f),
			/startDate must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createSeason(cfg, { ...minimalSeason, endDate: '   ' }, f),
			/endDate must not be empty/
		);
	});

	it('createSeason: an end_date BEFORE the start_date throws (a season nothing falls inside)', async () => {
		await expectRejectedWithoutFetch(
			(f) =>
				createSeason(cfg, { ...minimalSeason, startDate: '2027-05-31', endDate: '2026-09-01' }, f),
			/endDate must not be before startDate/
		);
	});

	it('createEventSeries: a blank name throws (a series has no name to inherit)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, name: '' }, f),
			/name must not be empty/
		);
	});

	it('createEventSeries: EVERY v4E-required series field is enforced — event_type, interval_days, start_time, duration_minutes, start_date, end_date (#132 review F3: a partial series is un-generatable by T2 and inherits nothing to its events)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, eventType: '  ' }, f),
			/eventType must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, startTime: '' }, f),
			/startTime must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, startDate: '' }, f),
			/startDate must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, endDate: '' }, f),
			/endDate must not be empty/
		);
		// number inputs bound to $state('') arrive as undefined / NaN, never as ''
		await expectRejectedWithoutFetch(
			(f) =>
				createEventSeries(
					cfg,
					{ ...minimalSeries, intervalDays: undefined as unknown as number },
					f
				),
			/intervalDays must be a number/
		);
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, durationMinutes: Number.NaN }, f),
			/durationMinutes must be a number/
		);
	});

	it('createEventSeries: a non-positive interval_days throws — the T2 occurrence generator would never terminate', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, intervalDays: 0 }, f),
			/intervalDays must be at least 1/
		);
	});

	it('createEventSeries: an end_date BEFORE the start_date throws (the generator would emit zero occurrences)', async () => {
		await expectRejectedWithoutFetch(
			(f) =>
				createEventSeries(
					cfg,
					{ ...minimalSeries, startDate: '2027-05-31', endDate: '2026-09-07' },
					f
				),
			/endDate must not be before startDate/
		);
	});

	it('createEvent: a blank eventType throws — listRehearsals filters on the event`s OWN event_type.string, so it can never be inherited', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEvent(cfg, { ...minimalEvent, eventType: '  ' }, f),
			/eventType must not be empty/
		);
	});

	it('createEvent: a blank start_datetime throws — v4E-required and inherited by NO reader (listRehearsals/eventDetail read the event`s own value with `?? ""`), so a dropped blank would silently create a dateless event that renders as a blank-time row and sorts to the TOP of the season (#132 review F1)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEvent(cfg, { ...minimalEvent, startDatetime: '' }, f),
			/startDatetime must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEvent(cfg, { ...minimalEvent, startDatetime: '   ' }, f),
			/startDatetime must not be empty/
		);
	});

	it('createEvent: a STANDALONE event (no seriesId) with a blank/absent name throws — v4E calls event.name inheritable, but with no series parent there is nothing to inherit from, and the create would otherwise succeed and leave a permanently nameless entity: listRehearsals maps it to "" (blank agenda row, detail link with no accessible name) and loadEventDetail renders a blank header (#132 review F2)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createEvent(cfg, { ...minimalEvent, name: undefined }, f),
			/name must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEvent(cfg, { ...minimalEvent, name: '   ' }, f),
			/name must not be empty/
		);
		// A BLANK seriesId is no series at all — same rejection, not a loophole.
		await expectRejectedWithoutFetch(
			(f) => createEvent(cfg, { ...minimalEvent, name: '', seriesId: '  ' }, f),
			/name must not be empty/
		);
	});

	it('createEvent: a series id passed ONLY inside extraParentIds does NOT license a blank name — the module never sniffs a parent`s kind (that would cost a lookup fetch the contract forbids), so the series parent must ride in its own `seriesId` field', async () => {
		await expectRejectedWithoutFetch(
			(f) =>
				createEvent(
					cfg,
					{ ...minimalEvent, name: '', extraParentIds: ['season-1', 'series-42'] },
					f
				),
			/name must not be empty/
		);
	});

	it('all three: a blank/missing orgId throws — v4E marks the organization parent required with parentCard "1" on season, event_series AND event, and a season-or-series-only parent list breaks org-scoped reads (#132 review F4)', async () => {
		await expectRejectedWithoutFetch(
			(f) => createSeason(cfg, { ...minimalSeason, orgId: '' }, f),
			/orgId must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEventSeries(cfg, { ...minimalSeries, orgId: '   ' }, f),
			/orgId must not be empty/
		);
		await expectRejectedWithoutFetch(
			(f) => createEvent(cfg, { ...minimalEvent, orgId: undefined as unknown as string }, f),
			/orgId must not be empty/
		);
	});

	it('a trimmable name is stored TRIMMED, not verbatim', async () => {
		const fetchImpl = makeFetchMock();
		await createSeason(cfg, { ...minimalSeason, name: '  Hooaeg 2026/27  ' }, fetchImpl);
		expect(createCallBody(fetchImpl).find((p) => p.type === 'name')).toEqual({
			type: 'name',
			string: 'Hooaeg 2026/27'
		});
	});

	it('blank entries in extraParentIds are dropped and the org is never sent twice, even if the caller repeats it', async () => {
		const fetchImpl = makeFetchMock();
		await createEvent(
			cfg,
			{ ...minimalEvent, extraParentIds: ['', '  ', 'org-1', 'season-1'] },
			fetchImpl
		);
		expect(createCallBody(fetchImpl).filter((p) => p.type === '_parent')).toEqual([
			{ type: '_parent', reference: 'org-1' },
			{ type: '_parent', reference: 'season-1' }
		]);
	});
});

// ---------------------------------------------------------------------------
// The #132 critical design decision, probed explicitly across all three
// ---------------------------------------------------------------------------

// Already enforced by every full-shape toEqual above; these direct absence
// probes exist so the DECISION has a named, greppable pin — a regression that
// copy-pastes createSection's `_sharing: 'public'` (or "hardens" the create
// with `_inheritrights`) fails a test whose title says exactly why.
describe('#132 critical: NO _sharing and NO _inheritrights on ANY create — rights are trusted to Entu `_inheritrights` propagation from the organization', () => {
	const runs: Array<[string, (fetchImpl: typeof fetch) => Promise<string>]> = [
		[
			'createSeason',
			(f) => createSeason(cfg, { ...minimalSeason, conductorRefs: ['person-7'] }, f)
		],
		[
			'createEventSeries',
			(f) =>
				createEventSeries(
					cfg,
					{ ...minimalSeries, defaultLocation: 'Hall', defaultDescription: 'D' },
					f
				)
		],
		[
			'createEvent',
			(f) =>
				createEvent(
					cfg,
					{
						...minimalEvent,
						seriesId: 'series-1',
						extraParentIds: ['season-1'],
						durationMinutes: 120,
						location: 'Hall',
						description: 'D',
						conductorRefs: ['person-7'],
						capacity: 40
					},
					f
				)
		]
	];

	it.each(runs)(
		'%s sends NEITHER _sharing NOR _inheritrights, even with every optional present',
		async (_name, run) => {
			const fetchImpl = makeFetchMock();
			await run(fetchImpl as unknown as typeof fetch);
			const body = createCallBody(fetchImpl);
			expect(body.filter((p) => p.type === '_sharing')).toEqual([]);
			expect(body.filter((p) => p.type === '_inheritrights')).toEqual([]);
			// And only the two prop KINDS a create may carry beyond domain props
			// (`_parent` may repeat — one entry per parent id):
			const systemProps = new Set(body.filter((p) => p.type.startsWith('_')).map((p) => p.type));
			expect([...systemProps].sort()).toEqual(['_parent', '_type']);
		}
	);
});

// ---------------------------------------------------------------------------
// Failure surfacing — shared error contract across all three
// ---------------------------------------------------------------------------

describe('failure surfacing (all three creates)', () => {
	const runs: Array<[string, string, (fetchImpl: typeof fetch) => Promise<string>]> = [
		['createSeason', 'season', (f) => createSeason(cfg, { ...minimalSeason }, f)],
		['createEventSeries', 'event_series', (f) => createEventSeries(cfg, { ...minimalSeries }, f)],
		['createEvent', 'event', (f) => createEvent(cfg, { ...minimalEvent }, f)]
	];

	it.each(runs)(
		'%s: resolveTypeId finding NO type definition (%s) propagates the failure and NO create POST is issued',
		async (_name, typeName, run) => {
			const fetchImpl = makeFetchMock({ typeEntitiesEmpty: true });
			await expect(run(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
				new RegExp(`${typeName}|not found`)
			);
			const posts = (fetchImpl.mock.calls as Array<[string, RequestInit | undefined]>).filter(
				([, init]) => init?.method === 'POST'
			);
			expect(posts).toEqual([]);
		}
	);

	it.each(runs)(
		'%s: a non-2xx create POST throws with the STATUS surfaced, never resolves silently',
		async (_name, _type, run) => {
			const fetchImpl = makeFetchMock({ createStatus: 403 });
			await expect(run(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/403/);
		}
	);

	it.each(runs)(
		'%s: a 2xx create response WITHOUT `_id` throws (the apparent-success trap) — a silent non-create must not resolve',
		async (_name, _type, run) => {
			const fetchImpl = makeFetchMock({ createBody: {} });
			await expect(run(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/_id/);
		}
	);
});

// ---------------------------------------------------------------------------
// Transport integration — the fetchImpl seam sits BELOW the real
// entuFetch/entuUrl, so these pin the actual request layer (see header note)
// ---------------------------------------------------------------------------

describe('transport integration — real entuFetch/entuUrl underneath the seam', () => {
	it('the create POST goes through entuUrl (base + db segment) and entuFetch attaches the Bearer token + JSON content type', async () => {
		const fetchImpl = makeFetchMock();
		await createSeason(cfg, { ...minimalSeason }, fetchImpl);
		const [url, init] = createCall(fetchImpl);
		expect(String(url)).toBe('https://api.entu-test.invalid/testdb/entity');
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer jwt');
		expect(headers['Content-Type']).toBe('application/json');
	});

	it('resolveTypeId results are CACHED per db:typeName — two creates of the same type issue ONE resolution GET total', async () => {
		const fetchImpl = makeFetchMock();
		await createEvent(cfg, { ...minimalEvent, name: 'E1' }, fetchImpl);
		await createEvent(cfg, { ...minimalEvent, name: 'E2' }, fetchImpl);
		expect(typeResolutionCalls(fetchImpl)).toHaveLength(1);
		// 1 resolution + 2 creates:
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});
});

// (*MVOX:Tallis* — #132/T1 RED)
// (*MVOX:Palestrina* — review-fix pass, #132/T1)
