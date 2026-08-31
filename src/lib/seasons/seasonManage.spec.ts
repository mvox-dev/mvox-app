// #132/T3 RED — the season-management DATA layer's wire contract, tested at the
// `fetchImpl` seam (same harness family as entuSeasons.spec.ts). The module
// under test does not exist yet; this spec IS its contract:
//
//   src/lib/seasons/seasonManage.ts
//     listEventSeriesForSeason(cfg, seasonId, fetchImpl) → SeriesListItem[]
//         { id, name, eventCount } — the season's event_series children, with
//         each series' event count. NO N+1 (review checklist #2): counts come
//         from ONE season-wide event read grouped client-side by the events'
//         denormalized `_parent[].entity_type === 'event_series'` ref — never
//         one count query per series. TWO fetches total, however many series.
//     listEventsForSeason(cfg, seasonId, fetchImpl) → StandaloneEvent[]
//         { id, name, startDatetime } — events parented DIRECTLY to the season
//         and NOT to any event_series (multi-parent: series events carry both,
//         so "standalone" = no event_series ref in `_parent`). ALL event types
//         (a standalone event is typically a concert — no rehearsal filter).
//     updateSeasonField(cfg, seasonId, field, value, fetchImpl)
//         field ∈ 'name' | 'start_date' | 'end_date'. Replace semantics per the
//         pinned Entu wire contract (POST APPENDS to implicitly multi-valued
//         props), in eventFieldEdit.ts's exact choreography and order:
//           1. GET entity/{seasonId}?props={field} — the PRE-EXISTING value ids
//           2. POST entity/{seasonId} with exactly ONE new value
//           3. DELETE /property/{id} for EVERY id from step 1
//         POST BEFORE DELETE (#91 F5 house rule): a failed POST leaves the old
//         value untouched; a failed DELETE leaves a recoverable duplicate.
//         Field-typed wire values: name → {type,string}; start_date/end_date →
//         {type,date} (seasons carry calendar DATES — `date`, not `datetime`).
//     addSeasonConductor(cfg, seasonId, personRef, fetchImpl)
//         `conductor` is multi-valued BY DESIGN, so adding IS a plain append:
//         ONE POST [{type:'conductor', reference}], no GET, no DELETE.
//     removeSeasonConductor(cfg, seasonId, personRef, fetchImpl)
//         GET entity/{seasonId}?props=conductor → DELETE /property/{id} of the
//         value(s) whose `reference` matches personRef — and ONLY those (the
//         other conductors' values must survive). Absent ref → no-op resolve.
//
// Non-2xx anywhere throws (fail loud, no silent success) — the panel is what
// turns that into an inline error.
import { describe, expect, it, vi } from 'vitest';
import {
	listEventSeriesForSeason,
	listEventsForSeason,
	updateSeasonField,
	addSeasonConductor,
	removeSeasonConductor,
	getSeriesDefaults
} from './seasonManage';
import type { EntuCfg } from './entuSeasons';

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

type Call = { url: string; method: string; body: unknown };

/** fetchImpl that routes by URL/method and records every call in order. */
function recordingFetch(route: (url: string, method: string) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return route(u, method);
	});
	return { impl: impl as unknown as typeof fetch, calls, mock: impl };
}

// ── listEventSeriesForSeason ────────────────────────────────────────────────────

/** The season's series, as Entu returns them. */
const seriesEntities = [
	{ _id: 's1', name: [{ string: 'Monday rehearsals' }] },
	{ _id: 's2', name: [{ string: 'Sectionals' }] },
	{ _id: 's3', name: [{ string: 'Empty series' }] }
];

/** The season's events: two in s1, one in s2, none in s3, one standalone.
 *  Every event is MULTI-PARENT (season + optionally its series), exactly as
 *  listEvents already observes on the live db. */
const countableEvents = [
	{
		_id: 'e1',
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 's1', entity_type: 'event_series' }
		]
	},
	{
		_id: 'e2',
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 's1', entity_type: 'event_series' }
		]
	},
	{
		_id: 'e3',
		_parent: [
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 's2', entity_type: 'event_series' }
		]
	},
	// Standalone — must count toward NO series.
	{ _id: 'e4', _parent: [{ reference: 'season1', entity_type: 'season' }] }
];

function seriesRoute(url: string): Response {
	if (url.includes('_type.string=event_series')) return json({ entities: seriesEntities });
	return json({ entities: countableEvents });
}

describe('listEventSeriesForSeason — series with event counts, no N+1', () => {
	it('reads the season-scoped series list and returns { id, name, eventCount } for every series — a series with ZERO events is present with 0, not dropped', async () => {
		const { impl } = recordingFetch(seriesRoute);
		const result = await listEventSeriesForSeason(cfg, 'season1', impl);

		const byId = [...result].sort((a, b) => a.id.localeCompare(b.id));
		// FULL shape (partial assertions hide bugs — house rule).
		expect(byId).toEqual([
			{ id: 's1', name: 'Monday rehearsals', eventCount: 2 },
			{ id: 's2', name: 'Sectionals', eventCount: 1 },
			{ id: 's3', name: 'Empty series', eventCount: 0 }
		]);
	});

	it('scopes the series read to the season: _type.string=event_series + _parent.reference={seasonId}, asking for name', async () => {
		const { impl, calls } = recordingFetch(seriesRoute);
		await listEventSeriesForSeason(cfg, 'season1', impl);

		const seriesCall = calls.find((c) => c.url.includes('_type.string=event_series'));
		expect(seriesCall).toBeDefined();
		expect(seriesCall!.url).toContain('https://api.entu-test.invalid/polyphony/entity?');
		expect(seriesCall!.url).toContain('_parent.reference=season1');
		expect(seriesCall!.url).toContain('name');
	});

	it('NO N+1: exactly TWO fetches however many series — one series list + one season-wide event read grouped client-side (never a per-series count query)', async () => {
		const { impl, mock, calls } = recordingFetch(seriesRoute);
		await listEventSeriesForSeason(cfg, 'season1', impl);

		expect(mock).toHaveBeenCalledTimes(2);
		// The count source is ONE event read scoped to the SEASON, carrying the
		// `_parent` refs the grouping needs — not scoped to any single series.
		const eventCall = calls.find(
			(c) => c.url.includes('_type.string=event') && !c.url.includes('event_series')
		);
		expect(eventCall).toBeDefined();
		expect(eventCall!.url).toContain('_parent.reference=season1');
		expect(eventCall!.url).toContain('_parent');
	});

	it('a season with NO series resolves [] without firing the event read for nothing… or fires it — either way, never throws and never a per-series call', async () => {
		const { impl, mock } = recordingFetch((url) =>
			url.includes('_type.string=event_series') ? json({ entities: [] }) : json({ entities: [] })
		);
		const result = await listEventSeriesForSeason(cfg, 'season1', impl);
		expect(result).toEqual([]);
		expect(mock.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it('throws on a non-2xx series read', async () => {
		const { impl } = recordingFetch(() => json({}, 500));
		await expect(listEventSeriesForSeason(cfg, 'season1', impl)).rejects.toThrow(/500/);
	});
});

// ── listEventsForSeason ─────────────────────────────────────────────────────────

describe('listEventsForSeason — standalone events only (no event_series parent)', () => {
	const seasonEvents = [
		{
			_id: 'e-series',
			name: [{ string: 'Weekly rehearsal' }],
			start_datetime: [{ datetime: '2026-09-07T16:00:00.000Z' }],
			_parent: [
				{ reference: 'season1', entity_type: 'season' },
				{ reference: 's1', entity_type: 'event_series' }
			]
		},
		{
			_id: 'e-solo',
			name: [{ string: 'Spring concert' }],
			start_datetime: [{ datetime: '2027-04-18T18:00:00.000Z' }],
			_parent: [{ reference: 'season1', entity_type: 'season' }]
		}
	];

	it('returns ONLY events without an event_series parent, in full { id, name, startDatetime } shape', async () => {
		const { impl } = recordingFetch(() => json({ entities: seasonEvents }));
		const result = await listEventsForSeason(cfg, 'season1', impl);

		expect(result).toEqual([
			{ id: 'e-solo', name: 'Spring concert', startDatetime: '2027-04-18T18:00:00.000Z' }
		]);
	});

	it('reads ALL event types under the season (a standalone event is typically a concert): _type.string=event scoped by _parent.reference, and NO event_type filter', async () => {
		const { impl, calls } = recordingFetch(() => json({ entities: seasonEvents }));
		await listEventsForSeason(cfg, 'season1', impl);

		const url = calls[0].url;
		expect(url).toContain('_type.string=event');
		expect(url).toContain('_parent.reference=season1');
		expect(url).not.toContain('event_type.string');
	});

	it('throws on a non-2xx response', async () => {
		const { impl } = recordingFetch(() => json({}, 403));
		await expect(listEventsForSeason(cfg, 'season1', impl)).rejects.toThrow(/403/);
	});
});

// ── updateSeasonField — the replace choreography ────────────────────────────────

describe('updateSeasonField — GET old → POST new → DELETE old, in that order', () => {
	function editRoute(existing: Array<{ _id: string }>) {
		return (url: string, method: string): Response => {
			if (method === 'GET') return json({ entity: { _id: 'season1', name: existing } });
			return json({});
		};
	}

	it('name: GETs the pre-existing value ids FIRST, POSTs exactly ONE {type:"name", string} value, then DELETEs EVERY old id (not just the first)', async () => {
		const { impl, calls } = recordingFetch(
			editRoute([{ _id: 'old-1' }, { _id: 'old-2' }])
		);
		await updateSeasonField(cfg, 'season1', 'name', 'Autumn splendour', impl);

		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'DELETE', 'DELETE']);
		expect(calls[0].url).toContain('/entity/season1');
		expect(calls[0].url).toContain('props=name');
		expect(calls[1].url).toContain('/entity/season1');
		expect(calls[1].body).toEqual([{ type: 'name', string: 'Autumn splendour' }]);
		expect(calls[2].url).toContain('/property/old-1');
		expect(calls[3].url).toContain('/property/old-2');
	});

	it('start_date goes over the wire as {type:"start_date", date} — a season carries calendar DATES, never datetime', async () => {
		const { impl, calls } = recordingFetch((_url, method) =>
			method === 'GET' ? json({ entity: { start_date: [{ _id: 'sd-1' }] } }) : json({})
		);
		await updateSeasonField(cfg, 'season1', 'start_date', '2026-10-01', impl);

		const post = calls.find((c) => c.method === 'POST');
		expect(post).toBeDefined();
		expect(post!.body).toEqual([{ type: 'start_date', date: '2026-10-01' }]);
	});

	it('end_date likewise: {type:"end_date", date}', async () => {
		const { impl, calls } = recordingFetch((_url, method) =>
			method === 'GET' ? json({ entity: { end_date: [{ _id: 'ed-1' }] } }) : json({})
		);
		await updateSeasonField(cfg, 'season1', 'end_date', '2027-06-30', impl);

		const post = calls.find((c) => c.method === 'POST');
		expect(post!.body).toEqual([{ type: 'end_date', date: '2027-06-30' }]);
	});

	it('a FAILED POST throws and issues NO delete — the old value survives server-side (the whole point of POST-before-DELETE)', async () => {
		const { impl, calls } = recordingFetch((_url, method) => {
			if (method === 'GET') return json({ entity: { name: [{ _id: 'old-1' }] } });
			if (method === 'POST') return json({}, 500);
			return json({});
		});
		await expect(updateSeasonField(cfg, 'season1', 'name', 'X', impl)).rejects.toThrow(/500/);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('a FAILED lookup GET throws BEFORE anything is written', async () => {
		const { impl, calls } = recordingFetch(() => json({}, 502));
		await expect(updateSeasonField(cfg, 'season1', 'name', 'X', impl)).rejects.toThrow(/502/);
		expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('no pre-existing value (field never set): POST fires, zero deletes, resolves clean', async () => {
		const { impl, calls } = recordingFetch((_url, method) =>
			method === 'GET' ? json({ entity: {} }) : json({})
		);
		await updateSeasonField(cfg, 'season1', 'name', 'First name ever', impl);
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
	});
});

// ── conductors — append to add, targeted delete to remove ───────────────────────

describe('addSeasonConductor — a multi-valued prop ADD is a plain append', () => {
	it('ONE POST [{type:"conductor", reference}] — no GET, no DELETE (the other conductors stay)', async () => {
		const { impl, calls, mock } = recordingFetch(() => json({}));
		await addSeasonConductor(cfg, 'season1', 'p-ada', impl);

		expect(mock).toHaveBeenCalledTimes(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toContain('/entity/season1');
		expect(calls[0].body).toEqual([{ type: 'conductor', reference: 'p-ada' }]);
	});

	it('throws on a non-2xx response', async () => {
		const { impl } = recordingFetch(() => json({}, 500));
		await expect(addSeasonConductor(cfg, 'season1', 'p-ada', impl)).rejects.toThrow(/500/);
	});
});

describe('removeSeasonConductor — delete ONLY the matching value', () => {
	const conductorValues = [
		{ _id: 'c-1', reference: 'p-grace' },
		{ _id: 'c-2', reference: 'p-ada' }
	];

	it('GETs the conductor values, DELETEs the one whose reference matches — the OTHER conductor survives untouched', async () => {
		const { impl, calls } = recordingFetch((_url, method) =>
			method === 'GET' ? json({ entity: { conductor: conductorValues } }) : json({})
		);
		await removeSeasonConductor(cfg, 'season1', 'p-ada', impl);

		expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
		expect(calls[0].url).toContain('/entity/season1');
		expect(calls[0].url).toContain('props=conductor');
		expect(calls[1].url).toContain('/property/c-2');
	});

	it('a ref that is not among the conductors: resolves as a no-op, zero deletes (idempotent — a double-tap must not 404 or delete a stranger)', async () => {
		const { impl, calls } = recordingFetch((_url, method) =>
			method === 'GET' ? json({ entity: { conductor: conductorValues } }) : json({})
		);
		await removeSeasonConductor(cfg, 'season1', 'p-nobody', impl);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
	});

	it('throws on a failed lookup — never guesses which property id to delete', async () => {
		const { impl } = recordingFetch(() => json({}, 500));
		await expect(removeSeasonConductor(cfg, 'season1', 'p-ada', impl)).rejects.toThrow(/500/);
	});
});

// ── getSeriesDefaults — the event-creation inheritance preview's source ─────────

describe('getSeriesDefaults — ONE read, every field the read side inherits', () => {
	it('reads all FOUR inheritable props in a single fetch and maps them', async () => {
		const { impl, calls } = recordingFetch(() =>
			json({
				entity: {
					name: [{ string: 'Monday rehearsals' }],
					default_location: [{ string: 'Main hall' }],
					duration_minutes: [{ number: 90 }],
					default_description: [{ string: 'Bring the black folder' }]
				}
			})
		);
		const defaults = await getSeriesDefaults(cfg, 'series1', impl);

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toContain('/entity/series1');
		// `default_description` included (#132/T4 review 2nd-pass F4): the read
		// side inherits it (eventDetail's `event.description ?? series
		// .default_description`), so the write-time preview must be able to show
		// it — otherwise a blank description looks like it inherits nothing.
		expect(calls[0].url).toContain(
			'props=name,default_location,duration_minutes,default_description'
		);
		expect(defaults).toEqual({
			name: 'Monday rehearsals',
			durationMinutes: 90,
			defaultLocation: 'Main hall',
			defaultDescription: 'Bring the black folder'
		});
	});

	it('a series carrying none of the optionals: blanks and a null duration, never undefined', async () => {
		const { impl } = recordingFetch(() => json({ entity: { name: [{ string: 'Ad-hoc' }] } }));
		expect(await getSeriesDefaults(cfg, 'series2', impl)).toEqual({
			name: 'Ad-hoc',
			durationMinutes: null,
			defaultLocation: '',
			defaultDescription: ''
		});
	});

	it('throws on a non-2xx — fail loud, never a preview of invented defaults', async () => {
		const { impl } = recordingFetch(() => json({}, 403));
		await expect(getSeriesDefaults(cfg, 'series1', impl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis* — #132/T3 RED: seasonManage data layer — series counts without N+1,
// standalone-event filter, replace choreography on season fields, conductor add/remove)
