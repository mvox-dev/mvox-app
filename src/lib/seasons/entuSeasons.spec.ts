import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listSeasons, listRehearsals, resolveTypeId, resetTypeIdCache, type EntuCfg } from './entuSeasons';

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
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

describe('listSeasons (de-fanned — no org scoping)', () => {
	it('queries seasons WITHOUT a _parent.reference org filter', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listSeasons(cfg, fetchImpl);

		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('https://api.entu.app/polyphony/entity?');
		expect(url).toContain('_type.string=season');
		expect(url).not.toContain('_parent.reference'); // de-fanned: read the whole collective
	});

	it('maps + sorts seasons by start date', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'b', name: [{ string: 'B' }], start_date: [{ date: '2026-09-01' }], end_date: [{ date: '2027-05-31' }] },
					{ _id: 'a', name: [{ string: 'A' }], start_date: [{ date: '2025-09-01' }], end_date: [{ date: '2026-05-31' }] }
				]
			})
		);
		const seasons = await listSeasons(cfg, fetchImpl);
		expect(seasons.map((s) => s.id)).toEqual(['a', 'b']);
		expect(seasons[0]).toEqual({ id: 'a', name: 'A', startDate: '2025-09-01', endDate: '2026-05-31', conductors: [] });
	});

	it('throws on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listSeasons(cfg, fetchImpl)).rejects.toThrow(/listSeasons failed: 500/);
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
				conductors: []
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
