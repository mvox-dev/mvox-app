import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listSeasons, listRehearsals, resolveTypeId, resetTypeIdCache, type EntuCfg } from './entuSeasons';

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const ORG_ID = 'org-1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

/** The database entity lookup response (#161 — collective = database). */
function databaseBody(dbEntityId: string | null) {
	return dbEntityId ? { entities: [{ _id: dbEntityId }], count: 1 } : { entities: [], count: 0 };
}

/** Routed mock: database-entity lookup (`resolveDatabaseEntityId`), then the
 *  collective-scoped seasons list. */
function mockSeasonsFetch(opts: {
	member?: unknown;
	memberStatus?: number;
	seasons?: unknown;
	seasonsStatus?: number;
}) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json(opts.member ?? { entities: [], count: 0 }, opts.memberStatus ?? 200));
		}
		return Promise.resolve(json(opts.seasons ?? { entities: [] }, opts.seasonsStatus ?? 200));
	}) as unknown as typeof fetch;
}

// A rehearsal event as Entu returns it, parented to org + season + series with
// denormalized entity_type on each parent.
function eventRaw(over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: 'e1',
		name: [{ string: 'Mon rehearsal' }],
		start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }],
		_parent: [
			{ reference: 'org1', entity_type: 'organization' },
			{ reference: 'season1', entity_type: 'season' },
			{ reference: 'series1', entity_type: 'event_series' }
		],
		...over
	};
}

// #144 review — re-fans the de-fan: `listSeasons` now scopes to the
// DATABASE entity (#161, resolved via `resolveDatabaseEntityId`, same as
// `resolveAdmin`/`resolveMyLibraryId`) instead of reading every `season` row
// in the db. The routed mock stands in for the two calls: the database-entity
// lookup, then the collective-scoped seasons list.
describe('listSeasons (scoped via resolveDatabaseEntityId, #161)', () => {
	it('queries seasons WITH a _parent.reference filter, scoped to the database entity', async () => {
		const fetchImpl = mockSeasonsFetch({ member: databaseBody(ORG_ID), seasons: { entities: [] } });
		await listSeasons(cfg, fetchImpl);

		const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
			String(c[0])
		);
		const seasonsUrl = urls.find((u) => u.includes('_type.string=season'));
		expect(seasonsUrl).toBeDefined();
		expect(seasonsUrl).toContain('https://api.entu-test.invalid/polyphony/entity?');
		expect(seasonsUrl).toContain(`_parent.reference=${ORG_ID}`);
	});

	it('maps + sorts seasons by start date', async () => {
		const fetchImpl = mockSeasonsFetch({
			member: databaseBody(ORG_ID),
			seasons: {
				entities: [
					{ _id: 'b', name: [{ string: 'B' }], start_date: [{ date: '2026-09-01' }], end_date: [{ date: '2027-05-31' }] },
					{ _id: 'a', name: [{ string: 'A' }], start_date: [{ date: '2025-09-01' }], end_date: [{ date: '2026-05-31' }] }
				]
			}
		});
		const seasons = await listSeasons(cfg, fetchImpl);
		expect(seasons.map((s) => s.id)).toEqual(['a', 'b']);
		expect(seasons[0]).toEqual({
			id: 'a',
			name: 'A',
			startDate: '2025-09-01',
			endDate: '2026-05-31',
			conductors: [],
			owners: [],
			editors: []
		});
	});

	// #91 review F1 — repertoire management gates on `_editor` on the SEASON.
	// Asking for it in THIS query is what removes the per-entity rights probe.
	it('asks for _owner,_editor and surfaces the refs the caller can see', async () => {
		const fetchImpl = mockSeasonsFetch({
			member: databaseBody(ORG_ID),
			seasons: {
				entities: [
					{
						_id: 'a',
						name: [{ string: 'A' }],
						start_date: [{ date: '2025-09-01' }],
						_owner: [{ reference: 'p-owner' }],
						_editor: [{ reference: 'p-editor' }, {}]
					}
				]
			}
		});
		const seasons = await listSeasons(cfg, fetchImpl);
		const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
			String(c[0])
		);
		expect(urls.some((u) => u.includes('_owner,_editor'))).toBe(true);
		expect(seasons[0].owners).toEqual(['p-owner']);
		// A ref-less entry is dropped, never surfaced as an undefined person id.
		expect(seasons[0].editors).toEqual(['p-editor']);
	});

	it('rights props ABSENT (non-granted caller — private bucket) → empty arrays, no throw', async () => {
		const fetchImpl = mockSeasonsFetch({
			member: databaseBody(ORG_ID),
			seasons: { entities: [{ _id: 'a', name: [{ string: 'A' }] }] }
		});
		const seasons = await listSeasons(cfg, fetchImpl);
		expect(seasons[0].owners).toEqual([]);
		expect(seasons[0].editors).toEqual([]);
	});

	it('throws on a non-2xx response from the seasons query', async () => {
		const fetchImpl = mockSeasonsFetch({ member: databaseBody(ORG_ID), seasonsStatus: 500 });
		await expect(listSeasons(cfg, fetchImpl)).rejects.toThrow(/listSeasons failed: 500/);
	});

	it('returns [] without querying seasons when no database entity is visible', async () => {
		const fetchImpl = mockSeasonsFetch({ member: { entities: [], count: 0 } });
		const seasons = await listSeasons(cfg, fetchImpl);
		expect(seasons).toEqual([]);
		const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
			String(c[0])
		);
		expect(urls.some((u) => u.includes('_type.string=season'))).toBe(false);
	});
});

describe('listRehearsals (de-fanned series id + verbatim inheritance merge)', () => {
	it('identifies the series parent by entity_type and returns AgendaItems', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1')) return json({ entity: { _id: 'series1' } });
			return json({
				entities: [
					eventRaw({ duration_minutes: [{ number: 90 }], location: [{ string: 'Hall A' }] })
				]
			});
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items).toEqual([
			{
				id: 'e1',
				name: 'Mon rehearsal',
				startDatetime: '2026-09-01T16:00:00.000Z',
				durationMinutes: 90,
				location: 'Hall A',
				conductors: [],
				owners: [],
				editors: []
			}
		]);
	});

	it('merges absent duration + location from the parent series (read-time inheritance)', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1'))
				return json({
					entity: {
						_id: 'series1',
						duration_minutes: [{ number: 120 }],
						default_location: [{ string: 'Church Hall' }]
					}
				});
			// event has NO duration_minutes, NO location → both inherited
			return json({ entities: [eventRaw()] });
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items[0]).toMatchObject({ durationMinutes: 120, location: 'Church Hall' });
	});

	// #101 review fix (F2) — `loadEventDetail` (the detail page) already inherited
	// `name` from the parent series while `listRehearsals` (the agenda) did not.
	// The asymmetry rendered a BLANK agenda row — and, once #101 made the row a
	// link, an anchor with no accessible name — that opened a detail page showing
	// a populated name.
	it('merges an absent name from the parent series, same as duration + location', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1'))
				return json({ entity: { _id: 'series1', name: [{ string: 'Tuesday Series' }] } });
			// event has NO name of its own → inherited from the series
			return json({ entities: [eventRaw({ name: [] })] });
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items[0].name).toBe('Tuesday Series');
		// …and the series GET must actually ASK for the name (props list).
		const seriesCall = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/entity/series1'))!;
		expect(String(seriesCall[0])).toContain('name');
	});

	it('the event own name still wins over the series name', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1'))
				return json({ entity: { _id: 'series1', name: [{ string: 'Tuesday Series' }] } });
			return json({ entities: [eventRaw()] }); // eventRaw carries 'Mon rehearsal'
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items[0].name).toBe('Mon rehearsal');
	});

	it('no name on the event AND none on the series → "" (never undefined)', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1')) return json({ entity: { _id: 'series1' } });
			return json({ entities: [eventRaw({ name: [] })] });
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items[0].name).toBe('');
	});

	it('event value overrides the series default', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1'))
				return json({
					entity: { _id: 'series1', duration_minutes: [{ number: 120 }], default_location: [{ string: 'Church Hall' }] }
				});
			return json({ entities: [eventRaw({ duration_minutes: [{ number: 60 }], location: [{ string: 'Room 2' }] })] });
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items[0]).toMatchObject({ durationMinutes: 60, location: 'Room 2' });
	});

	it('fetches each unique series ONCE (no N+1) and sorts by start datetime', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1'))
				return json({ entity: { _id: 'series1', duration_minutes: [{ number: 45 }] } });
			return json({
				entities: [
					eventRaw({ _id: 'late', start_datetime: [{ datetime: '2026-09-08T16:00:00.000Z' }] }),
					eventRaw({ _id: 'early', start_datetime: [{ datetime: '2026-09-01T16:00:00.000Z' }] })
				]
			});
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items.map((i) => i.id)).toEqual(['early', 'late']); // sorted ascending
		const seriesCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/entity/series1'));
		expect(seriesCalls).toHaveLength(1); // both events share series1 → one lookup
	});

	it('falls back to 0/"" when the series lookup fails and the event has no values', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1')) return json({}, 500); // series lookup fails
			return json({ entities: [eventRaw()] });
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items[0]).toMatchObject({ durationMinutes: 0, location: '' });
	});

	it('returns [] with no series fetch when there are no events', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		const items = await listRehearsals(cfg, 'season1', fetchImpl);
		expect(items).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(1); // only the events query, no series lookups
	});

	it('throws on a non-2xx events response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(listRehearsals(cfg, 'season1', fetchImpl)).rejects.toThrow(/listRehearsals failed: 403/);
	});

	// #91 review F1 — the programme controls gate on `_editor` on the EVENT.
	// Riding on this query is what replaced one rights GET per agenda event.
	it('asks for _owner,_editor and carries the visible refs onto each AgendaItem', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1')) return json({ entity: { _id: 'series1' } });
			return json({
				entities: [eventRaw({ _owner: [{ reference: 'p1' }], _editor: [{ reference: 'p2' }] })]
			});
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('_owner,_editor');
		expect(items[0]).toMatchObject({ owners: ['p1'], editors: ['p2'] });
	});

	it('rights are NOT inherited from the parent series the way duration/location are', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes('/entity/series1'))
				return json({ entity: { _id: 'series1', _editor: [{ reference: 'series-editor' }] } });
			return json({ entities: [eventRaw()] });
		});
		const items = await listRehearsals(cfg, 'season1', fetchImpl as unknown as typeof fetch);
		expect(items[0]).toMatchObject({ owners: [], editors: [] });
	});
});

// resolveTypeId — new shared infra for #10 (rsvp create needs `_type` as a
// resolved `reference`, not `_type.string`). Ported from the mvox_v4e_web
// original: same query shape, same per-db cache.
describe('resolveTypeId', () => {
	beforeEach(() => {
		resetTypeIdCache();
	});

	it('queries _type.string=entity&name.string=<typeName>', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'rsvp-type-id' }] }));
		const id = await resolveTypeId(cfg, 'rsvp', fetchImpl);
		expect(id).toBe('rsvp-type-id');
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=entity');
		expect(url).toContain('name.string=rsvp');
	});

	it('caches per db+typeName — a second call for the same pair does not refetch', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'rsvp-type-id' }] }));
		await resolveTypeId(cfg, 'rsvp', fetchImpl);
		await resolveTypeId(cfg, 'rsvp', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a different db triggers a new fetch even for the same typeName', async () => {
		// Fresh Response per call — a Response body is single-read, and real fetch
		// mints a new one each time. mockResolvedValue would hand back one already-
		// consumed body on the second (cache-miss) call.
		const fetchImpl = vi
			.fn()
			.mockImplementation(() => Promise.resolve(json({ entities: [{ _id: 'rsvp-type-id' }] })));
		await resolveTypeId({ db: 'db-a', token: 'jwt' }, 'rsvp', fetchImpl);
		await resolveTypeId({ db: 'db-b', token: 'jwt' }, 'rsvp', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('throws when the type definition is not found', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await expect(resolveTypeId(cfg, 'nonexistent', fetchImpl)).rejects.toThrow(
			/type definition not found.*nonexistent/
		);
	});

	it('throws on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(resolveTypeId(cfg, 'rsvp', fetchImpl)).rejects.toThrow(/resolveTypeId failed: 500/);
	});
});

// (*MVOX:Josquin* — #101 TE.1 review fix F2: series name inheritance)
