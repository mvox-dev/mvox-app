// The event, series and season DELETE write layer, driven at the `fetchImpl` wire.
import { describe, expect, it, vi } from 'vitest';
import { isCascadePartial, isDeleteForbidden } from './deleteErrors';
import {
	countSeasonScope,
	countSeriesOccurrences,
	deleteEvent,
	deleteEventSeries,
	deleteSeason
} from './seasonManage';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');

type HeaderedCall = Call & { headers: string };

/** `${_type.string}:${_parent.reference}` — how a scoped child read is keyed in
 *  the stub below, i.e. exactly what the cascade asks the server for. */
function scopeKey(href: string): string {
	const params = new URL(href, 'https://stub.invalid/').searchParams;
	return `${params.get('_type.string')}:${params.get('_parent.reference')}`;
}

function entityIdOf(href: string): string {
	return href.slice(href.lastIndexOf('/entity/') + '/entity/'.length);
}

/** A row a scoped GET returns — a bare id, or an id with `_parent` refs (the
 *  season-wide event read carries `_parent` so a cascade can tell a series
 *  occurrence from a standalone event, exactly as `seriesRefOf` does). */
type StubRow = string | { _id: string; _parent?: Array<{ reference: string; entity_type?: string }> };

interface StubOpts {
	/** `${type}:${parentId}` → the child rows that scoped read returns. */
	children?: Record<string, StubRow[]>;
	/** `${type}:${parentId}` → a server `count` LARGER than the ids returned,
	 *  faking a result set the capped read could not carry. */
	counts?: Record<string, number>;
	/** `${type}:${parentId}` → non-200 status for that scoped read. */
	lookupStatus?: Record<string, number>;
	/** entity id → non-200 status for its DELETE. */
	deleteStatus?: Record<string, number>;
}

function stubFetch(opts: StubOpts = {}) {
	const calls: HeaderedCall[] = [];
	const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		const method = init?.method ?? 'GET';
		calls.push({ url: href, method, headers: JSON.stringify(init?.headers ?? {}) });

		if (method === 'GET') {
			const key = scopeKey(href);
			const status = opts.lookupStatus?.[key];
			if (status) return json({}, status);
			const rows = (opts.children?.[key] ?? []).map((row) =>
				typeof row === 'string' ? { _id: row } : row
			);
			return json({ count: opts.counts?.[key] ?? rows.length, entities: rows });
		}

		const status = opts.deleteStatus?.[entityIdOf(href)];
		if (status) return json({ error: 'refused' }, status);
		return json({ deleted: true });
	});
	return { impl, calls };
}

/** Just the DELETE targets, in order — the cascade's observable shape. */
function deleteTargets(calls: HeaderedCall[]): string[] {
	return calls.filter((c) => c.method === 'DELETE').map((c) => entityIdOf(c.url));
}

/** Just the scoped GETs, in order — which children the cascade looked for. */
function lookupKeys(calls: HeaderedCall[]): string[] {
	return calls.filter((c) => c.method === 'GET').map((c) => scopeKey(c.url));
}

describe('deleteEvent — the event ENTITY, after its own children', () => {
	it('is exported from seasonManage', () => {
		expect(typeof deleteEvent).toBe('function');
	});

	it('an event with NO children: ONE DELETE …/sampledb/entity/{eventId} — no /property/ call', async () => {
		const { impl, calls } = stubFetch();
		await deleteEvent(cfg, 'ev-9', impl);

		expect(deleteTargets(calls)).toEqual(['ev-9']);
		expect(calls.at(-1)?.url).toContain('/sampledb/entity/ev-9');
		// The endpoint split, pinned: an event id is an ENTITY id — a /property/
		// DELETE here would 404 and leave the event standing.
		expect(calls.every((c) => !c.url.includes('/property/'))).toBe(true);
	});

	it('an event WITH children: every attendance and every program_item is DELETEd, and the event LAST', async () => {
		const { impl, calls } = stubFetch({
			children: { 'attendance:ev-9': ['att-1', 'att-2'], 'program_item:ev-9': ['pi-1'] }
		});
		await deleteEvent(cfg, 'ev-9', impl);

		expect(deleteTargets(calls)).toEqual(['att-1', 'att-2', 'pi-1', 'ev-9']);
	});

	it('sends the auth token on every call (nothing is anonymous)', async () => {
		const { impl, calls } = stubFetch({ children: { 'attendance:ev-9': ['att-1'] } });
		await deleteEvent(cfg, 'ev-9', impl);

		expect(calls.every((c) => c.headers.includes('jwt'))).toBe(true);
	});

	it('throws on a non-2xx DELETE with the status surfaced — a refused delete must never be silent', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'ev-9': 403 } });
		await expect(deleteEvent(cfg, 'ev-9', impl)).rejects.toThrow(/403/);
	});

	it('a 500 throws too — not just the auth-shaped refusals', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'ev-9': 500 } });
		await expect(deleteEvent(cfg, 'ev-9', impl)).rejects.toThrow(/500/);
	});

	// #197 review F3 — a 403 is the ONE refusal the panel's `_editor` rights gate
	// cannot predict (Entu's DELETE wants `_owner` on the target), so it is
	// TAGGED: the panel says "you don't have permission", not "try again".
	it('a 403 rejects with the tagged forbidden error; a 500 does NOT', async () => {
		const forbidden = await deleteEvent(
			cfg,
			'ev-9',
			stubFetch({ deleteStatus: { 'ev-9': 403 } }).impl
		).catch((e) => e);
		expect(isDeleteForbidden(forbidden)).toBe(true);

		const broken = await deleteEvent(
			cfg,
			'ev-9',
			stubFetch({ deleteStatus: { 'ev-9': 500 } }).impl
		).catch((e) => e);
		expect(isDeleteForbidden(broken)).toBe(false);
	});

	it('a failed CHILD delete aborts BEFORE the event delete — the event survives, tagged partial with how many went', async () => {
		const { impl, calls } = stubFetch({
			children: { 'attendance:ev-9': ['att-1', 'att-2'], 'program_item:ev-9': ['pi-1'] },
			deleteStatus: { 'att-2': 500 }
		});

		const failure = await deleteEvent(cfg, 'ev-9', impl).catch((e) => e);
		expect(isCascadePartial(failure, 'event')).toBe(true);
		expect(failure).toMatchObject({ deletedCount: 1, totalCount: 3 });
		// pi-1 is untouched and the EVENT is still there — the remainder keeps its
		// `_parent`, so a retry resumes instead of hunting orphans.
		expect(deleteTargets(calls)).toEqual(['att-1', 'att-2']);
	});

	it('a 403 on a CHILD reads as the same permission story as a 403 on the event', async () => {
		const forbidden = await deleteEvent(
			cfg,
			'ev-9',
			stubFetch({
				children: { 'program_item:ev-9': ['pi-1'] },
				deleteStatus: { 'pi-1': 403 }
			}).impl
		).catch((e) => e);
		expect(isDeleteForbidden(forbidden)).toBe(true);
	});

	it('a failed CHILD lookup throws with the status surfaced and deletes NOTHING', async () => {
		const { impl, calls } = stubFetch({
			children: { 'attendance:ev-9': ['att-1'] },
			lookupStatus: { 'program_item:ev-9': 500 }
		});
		await expect(deleteEvent(cfg, 'ev-9', impl)).rejects.toThrow(/500/);
		// The second lookup blew up AFTER the first returned rows — and still
		// nothing was destroyed: the whole work list is gathered before the first
		// DELETE.
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('an event with MORE children than the capped read returned is refused — nothing is deleted', async () => {
		const { impl, calls } = stubFetch({
			children: { 'attendance:ev-9': ['att-1', 'att-2'] },
			counts: { 'attendance:ev-9': 900 }
		});
		await expect(deleteEvent(cfg, 'ev-9', impl)).rejects.toThrow(/900/);
		expect(deleteTargets(calls)).toEqual([]);
	});
});

describe('deleteEventSeries — cascade: every occurrence, then the series ENTITY', () => {
	it('is exported from seasonManage', () => {
		expect(typeof deleteEventSeries).toBe('function');
	});

	it('an EMPTY series: ONE DELETE …/sampledb/entity/{seriesId} — no /property/ call', async () => {
		const { impl, calls } = stubFetch();
		await deleteEventSeries(cfg, 'series-1', impl);

		expect(deleteTargets(calls)).toEqual(['series-1']);
		expect(calls.at(-1)?.url).toContain('/sampledb/entity/series-1');
		// The endpoint split, pinned: a series id is an ENTITY id.
		expect(calls.every((c) => !c.url.includes('/property/'))).toBe(true);
	});

	it('a series WITH occurrences: every occurrence is DELETEd, and the series LAST', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] }
		});
		await deleteEventSeries(cfg, 'series-1', impl);

		expect(deleteTargets(calls)).toEqual(['occ-1', 'occ-2', 'occ-3', 'series-1']);
	});

	// #197 review 2nd pass F1 — the series path inherits the event path's child
	// cascade for free, which is the whole reason the occurrences go through
	// `deleteEvent` rather than a bare DELETE.
	it('each occurrence takes ITS OWN children with it, before itself', async () => {
		const { impl, calls } = stubFetch({
			children: {
				'event:series-1': ['occ-1', 'occ-2'],
				'attendance:occ-1': ['att-1'],
				'program_item:occ-2': ['pi-2']
			}
		});
		await deleteEventSeries(cfg, 'series-1', impl);

		expect(deleteTargets(calls)).toEqual(['att-1', 'occ-1', 'pi-2', 'occ-2', 'series-1']);
	});

	// #197 review 2nd pass F2 — the panel announces what was DESTROYED, so the
	// cascade has to hand back its own count rather than let the caller quote a
	// list read from some earlier moment.
	it('RESOLVES WITH the number of occurrences deleted', async () => {
		const { impl } = stubFetch({ children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] } });
		await expect(deleteEventSeries(cfg, 'series-1', impl)).resolves.toBe(3);

		const empty = stubFetch();
		await expect(deleteEventSeries(cfg, 'series-2', empty.impl)).resolves.toBe(0);
	});

	it('sends the auth token on every call (nothing is anonymous)', async () => {
		const { impl, calls } = stubFetch({ children: { 'event:series-1': ['occ-1'] } });
		await deleteEventSeries(cfg, 'series-1', impl);

		expect(calls.every((c) => c.headers.includes('jwt'))).toBe(true);
	});

	it('a failed OCCURRENCE delete aborts BEFORE the series delete — the series survives, tagged partial with how many went', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] },
			deleteStatus: { 'occ-2': 500 }
		});

		const failure = await deleteEventSeries(cfg, 'series-1', impl).catch((e) => e);
		expect(isCascadePartial(failure, 'series')).toBe(true);
		expect(failure).toMatchObject({ deletedCount: 1, totalCount: 3 });
		// occ-3 is untouched and the SERIES is still there — the remainder keeps
		// its `_parent`, so a retry resumes instead of hunting orphans.
		expect(deleteTargets(calls)).toEqual(['occ-1', 'occ-2']);
	});

	it('a 403 on an OCCURRENCE reads as the same permission story as a 403 on the series', async () => {
		const occForbidden = await deleteEventSeries(
			cfg,
			'series-1',
			stubFetch({
				children: { 'event:series-1': ['occ-1'] },
				deleteStatus: { 'occ-1': 403 }
			}).impl
		).catch((e) => e);
		expect(isDeleteForbidden(occForbidden)).toBe(true);

		const seriesForbidden = await deleteEventSeries(
			cfg,
			'series-1',
			stubFetch({ deleteStatus: { 'series-1': 403 } }).impl
		).catch((e) => e);
		expect(isDeleteForbidden(seriesForbidden)).toBe(true);
	});

	// The refusal now nests two deep (series → occurrence → the occurrence's own
	// program_item), which is why `isDeleteForbidden` walks the whole chain.
	it('a 403 on an occurrence’s CHILD is still a permission story, not a retry prompt', async () => {
		const forbidden = await deleteEventSeries(
			cfg,
			'series-1',
			stubFetch({
				children: { 'event:series-1': ['occ-1'], 'program_item:occ-1': ['pi-1'] },
				deleteStatus: { 'pi-1': 403 }
			}).impl
		).catch((e) => e);
		expect(isDeleteForbidden(forbidden)).toBe(true);
	});

	it('a failed occurrence LOOKUP throws with the status surfaced and deletes NOTHING', async () => {
		const { impl, calls } = stubFetch({ lookupStatus: { 'event:series-1': 500 } });
		await expect(deleteEventSeries(cfg, 'series-1', impl)).rejects.toThrow(/500/);
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('a series with MORE occurrences than the capped read returned is refused — nothing is deleted', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1', 'occ-2'] },
			counts: { 'event:series-1': 900 }
		});
		await expect(deleteEventSeries(cfg, 'series-1', impl)).rejects.toThrow(/900/);
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('a 403 on the series DELETE itself throws with the status surfaced', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'series-1': 403 } });
		await expect(deleteEventSeries(cfg, 'series-1', impl)).rejects.toThrow(/403/);
	});

	it('a 500 on the series DELETE throws too', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'series-1': 500 } });
		await expect(deleteEventSeries(cfg, 'series-1', impl)).rejects.toThrow(/500/);
	});
});

// #197 review 2nd pass F2 — the number the irreversible confirm shows must come
// from the server, not from the panel list's client-side tally of a season-wide
// capped read.
describe('countSeriesOccurrences — the live figure behind the confirm', () => {
	it('is exported from seasonManage', () => {
		expect(typeof countSeriesOccurrences).toBe('function');
	});

	it('reports the SERVER’s count, even when it exceeds the rows the read carried', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1'] },
			counts: { 'event:series-1': 900 }
		});

		await expect(countSeriesOccurrences(cfg, 'series-1', impl)).resolves.toBe(900);
		// A COUNT, not a page of rows: one scoped read, nothing written.
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toContain('_type.string=event');
		expect(calls[0].url).toContain('_parent.reference=series-1');
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('an empty series counts 0, and the token rides along', async () => {
		const { impl, calls } = stubFetch();
		await expect(countSeriesOccurrences(cfg, 'series-2', impl)).resolves.toBe(0);
		expect(calls[0].headers).toContain('jwt');
	});

	it('a non-2xx read throws with the status surfaced (fail loud)', async () => {
		const { impl } = stubFetch({ lookupStatus: { 'event:series-1': 500 } });
		await expect(countSeriesOccurrences(cfg, 'series-1', impl)).rejects.toThrow(/500/);
	});
});

const SEASON_PARENT = { reference: 'season-1', entity_type: 'season' };
function inSeries(id: string, seriesId: string) {
	return { _id: id, _parent: [SEASON_PARENT, { reference: seriesId, entity_type: 'event_series' }] };
}
function standalone(id: string) {
	return { _id: id, _parent: [SEASON_PARENT] };
}

/** The canonical #217 season: 2 series (2 + 1 occurrences), 1 standalone event,
 *  2 repertoire items → ruled denominator 2 + 4 + 2 = 8. */
function seasonChildren(): NonNullable<StubOpts['children']> {
	return {
		'event_series:season-1': ['series-1', 'series-2'],
		'event:season-1': [
			inSeries('occ-1', 'series-1'),
			inSeries('occ-2', 'series-1'),
			inSeries('occ-3', 'series-2'),
			standalone('ev-9')
		],
		'repertoire_item:season-1': ['rep-1', 'rep-2'],
		'event:series-1': ['occ-1', 'occ-2'],
		'event:series-2': ['occ-3']
	};
}

describe('countSeasonScope — the live scope the season-delete confirm quotes (#217)', () => {
	it('is exported from seasonManage', () => {
		expect(typeof countSeasonScope).toBe('function');
	});

	it('reads the three scoped lists and reports { series, events, repertoireItems } — events counts ALL season events (occurrences AND standalone); a read deletes NOTHING', async () => {
		const { impl, calls } = stubFetch({ children: seasonChildren() });

		await expect(countSeasonScope(cfg, 'season-1', impl)).resolves.toEqual({
			series: 2,
			events: 4,
			repertoireItems: 2
		});

		const keys = lookupKeys(calls);
		expect(keys).toContain('event_series:season-1');
		expect(keys).toContain('event:season-1');
		expect(keys).toContain('repertoire_item:season-1');
		expect(deleteTargets(calls)).toEqual([]);
		expect(calls.every((c) => c.headers.includes('jwt'))).toBe(true);
	});

	it('an empty season counts zeros', async () => {
		const { impl } = stubFetch();
		await expect(countSeasonScope(cfg, 'season-1', impl)).resolves.toEqual({
			series: 0,
			events: 0,
			repertoireItems: 0
		});
	});

	it('a scope larger than the capped read carried is REFUSED (the existing over-limit refusal) — a confirm must not promise a number the read never saw', async () => {
		const { impl } = stubFetch({
			children: seasonChildren(),
			counts: { 'repertoire_item:season-1': 900 }
		});
		await expect(countSeasonScope(cfg, 'season-1', impl)).rejects.toThrow(/900/);
	});

	it('a non-2xx read throws with the status surfaced (fail loud)', async () => {
		const { impl } = stubFetch({ lookupStatus: { 'event:season-1': 500 } });
		await expect(countSeasonScope(cfg, 'season-1', impl)).rejects.toThrow(/500/);
	});
});

describe('deleteEventSeries — the #216 progress option, without breaking a single positional caller', () => {
	it('reports 1..N over the ruled denominator (occurrences + the series itself): each occurrence ticks as "event", the series entity as the final "series" tick', async () => {
		const { impl } = stubFetch({ children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] } });
		const onProgress = vi.fn();

		await deleteEventSeries(cfg, 'series-1', impl, { onProgress });

		expect(onProgress.mock.calls).toEqual([
			[1, 4, 'event'],
			[2, 4, 'event'],
			[3, 4, 'event'],
			[4, 4, 'series']
		]);
	});

	it('an occurrence’s OWN children (attendance / program_item) are deleted but never tick — they are outside the ruled denominator', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1'], 'attendance:occ-1': ['att-1', 'att-2'] }
		});
		const onProgress = vi.fn();

		await deleteEventSeries(cfg, 'series-1', impl, { onProgress });

		// The children DID go (before their event, the #197 ordering)…
		expect(deleteTargets(calls)).toEqual(['att-1', 'att-2', 'occ-1', 'series-1']);
		// …but the counter promised 2 entities (1 occurrence + the series) and
		// counted exactly those.
		expect(onProgress.mock.calls).toEqual([
			[1, 2, 'event'],
			[2, 2, 'series']
		]);
	});

	it('a cascade that stops part-way stops TICKING too — the counter never claims an entity that did not go', async () => {
		const { impl } = stubFetch({
			children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] },
			deleteStatus: { 'occ-2': 500 }
		});
		const onProgress = vi.fn();

		await expect(
			deleteEventSeries(cfg, 'series-1', impl, { onProgress })
		).rejects.toMatchObject({ deletedCount: 1 });
		expect(onProgress.mock.calls).toEqual([[1, 4, 'event']]);
	});

	it('the options argument is OPTIONAL and trailing — the existing 3-arg positional call shape still resolves with the occurrence count', async () => {
		const { impl } = stubFetch({ children: { 'event:series-1': ['occ-1', 'occ-2'] } });
		await expect(deleteEventSeries(cfg, 'series-1', impl)).resolves.toBe(2);
	});
});

describe('deleteSeason — serial cascade, children before parent, ONE counter over the whole scope (#217)', () => {
	it('is exported from seasonManage', () => {
		expect(typeof deleteSeason).toBe('function');
	});

	it('deletes every series (occurrences first), then every STANDALONE event, then every repertoire_item, then the season — the exact DELETE sequence, all on the ENTITY endpoint', async () => {
		const { impl, calls } = stubFetch({ children: seasonChildren() });

		await deleteSeason(cfg, 'season-1', impl);

		expect(deleteTargets(calls)).toEqual([
			'occ-1',
			'occ-2',
			'series-1',
			'occ-3',
			'series-2',
			'ev-9',
			'rep-1',
			'rep-2',
			'season-1'
		]);
		// The endpoint split, pinned: season / series / event / repertoire_item
		// ids are ENTITY ids — a /property/ DELETE here would 404 and pollute.
		expect(calls.every((c) => !c.url.includes('/property/'))).toBe(true);
		expect(calls.at(-1)?.url).toContain('/sampledb/entity/season-1');
		expect(calls.every((c) => c.headers.includes('jwt'))).toBe(true);
	});

	it('ticks 1..8 over the up-front denominator (2 series + 4 events + 2 repertoire items) with the kind of each entity — the season entity itself never ticks', async () => {
		const { impl } = stubFetch({ children: seasonChildren() });
		const onProgress = vi.fn();

		await deleteSeason(cfg, 'season-1', impl, { onProgress });

		expect(onProgress.mock.calls).toEqual([
			[1, 8, 'event'],
			[2, 8, 'event'],
			[3, 8, 'series'],
			[4, 8, 'event'],
			[5, 8, 'series'],
			[6, 8, 'event'],
			[7, 8, 'repertoire'],
			[8, 8, 'repertoire']
		]);
	});

	it('resolves with what it actually deleted: { series, events, repertoireItems }', async () => {
		const { impl } = stubFetch({ children: seasonChildren() });
		await expect(deleteSeason(cfg, 'season-1', impl)).resolves.toEqual({
			series: 2,
			events: 4,
			repertoireItems: 2
		});
	});

	it('an occurrence’s attendance rows go with it but neither tick nor count in the denominator', async () => {
		const { impl, calls } = stubFetch({
			children: {
				'event_series:season-1': ['series-1'],
				'event:season-1': [inSeries('occ-1', 'series-1')],
				'event:series-1': ['occ-1'],
				'attendance:occ-1': ['att-1']
			}
		});
		const onProgress = vi.fn();

		await deleteSeason(cfg, 'season-1', impl, { onProgress });

		expect(deleteTargets(calls)).toEqual(['att-1', 'occ-1', 'series-1', 'season-1']);
		expect(onProgress.mock.calls).toEqual([
			[1, 2, 'event'],
			[2, 2, 'series']
		]);
	});

	it('an EMPTY season is one lonely season DELETE — no ticks, zero counts', async () => {
		const { impl, calls } = stubFetch();
		const onProgress = vi.fn();

		await expect(deleteSeason(cfg, 'season-1', impl, { onProgress })).resolves.toEqual({
			series: 0,
			events: 0,
			repertoireItems: 0
		});
		expect(deleteTargets(calls)).toEqual(['season-1']);
		expect(onProgress).not.toHaveBeenCalled();
	});

	it('a failed STANDALONE-event delete aborts BEFORE the repertoire items and the season — tagged season-partial with how many of the denominator went', async () => {
		const { impl, calls } = stubFetch({
			children: {
				'event_series:season-1': ['series-1'],
				'event:season-1': [inSeries('occ-1', 'series-1'), standalone('ev-1'), standalone('ev-2')],
				'event:series-1': ['occ-1'],
				'repertoire_item:season-1': ['rep-1']
			},
			deleteStatus: { 'ev-2': 500 }
		});

		const failure = await deleteSeason(cfg, 'season-1', impl).catch((e) => e);
		expect(typeof isCascadePartial).toBe('function');
		expect(isCascadePartial(failure, 'season')).toBe(true);
		expect(failure).toMatchObject({
			code: 'season-cascade-partial',
			scope: 'season',
			id: 'season-1',
			deletedCount: 3, // occ-1 + series-1 + ev-1 of the promised 5
			totalCount: 5
		});
		// rep-1 untouched, season still standing — the remainder keeps its
		// `_parent`, so a retry resumes instead of hunting orphans.
		expect(deleteTargets(calls)).toEqual(['occ-1', 'series-1', 'ev-1', 'ev-2']);
	});

	it('a SERIES cascade failing inside the season cascade keeps its own story in the failure chain', async () => {
		const { impl, calls } = stubFetch({
			children: seasonChildren(),
			deleteStatus: { 'occ-2': 500 }
		});

		const failure = await deleteSeason(cfg, 'season-1', impl).catch((e) => e);
		expect(isCascadePartial(failure, 'season')).toBe(true);
		expect(failure).toMatchObject({ deletedCount: 1, totalCount: 8 });
		expect(isCascadePartial((failure as { failure?: unknown }).failure, 'series')).toBe(true);
		// series-2, ev-9, the repertoire and the season are all still standing.
		expect(deleteTargets(calls)).toEqual(['occ-1', 'occ-2']);
	});

	it('a failed SERIES-ENTITY delete still credits the occurrences that already went — the count never contradicts the counter', async () => {
		const { impl, calls } = stubFetch({
			children: seasonChildren(),
			deleteStatus: { 'series-1': 500 }
		});
		const onProgress = vi.fn();

		const failure = await deleteSeason(cfg, 'season-1', impl, { onProgress }).catch((e) => e);
		expect(isCascadePartial(failure, 'season')).toBe(true);
		// occ-1 + occ-2 really are gone — exactly the two ticks that were emitted.
		expect(failure).toMatchObject({ deletedCount: 2, totalCount: 8 });
		expect(onProgress.mock.calls).toEqual([
			[1, 8, 'event'],
			[2, 8, 'event']
		]);
		expect(deleteTargets(calls)).toEqual(['occ-1', 'occ-2', 'series-1']);
	});

	it('a 403 anywhere in the cascade reads as the SAME permission story, however deep it sits', async () => {
		const onRepertoire = await deleteSeason(
			cfg,
			'season-1',
			stubFetch({ children: seasonChildren(), deleteStatus: { 'rep-1': 403 } }).impl
		).catch((e) => e);
		expect(isDeleteForbidden(onRepertoire)).toBe(true);

		// season → series → occurrence → the occurrence's own child: four links.
		const deep = await deleteSeason(
			cfg,
			'season-1',
			stubFetch({
				children: { ...seasonChildren(), 'program_item:occ-1': ['pi-1'] },
				deleteStatus: { 'pi-1': 403 }
			}).impl
		).catch((e) => e);
		expect(isDeleteForbidden(deep)).toBe(true);

		const onSeason = await deleteSeason(
			cfg,
			'season-1',
			stubFetch({ deleteStatus: { 'season-1': 403 } }).impl
		).catch((e) => e);
		expect(isDeleteForbidden(onSeason)).toBe(true);
	});

	it('a scope larger than the capped read carried is REFUSED up front — NOTHING is deleted', async () => {
		const { impl, calls } = stubFetch({
			children: seasonChildren(),
			counts: { 'event:season-1': 900 }
		});
		await expect(deleteSeason(cfg, 'season-1', impl)).rejects.toThrow(/900/);
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('a failed scope lookup throws with the status surfaced and deletes NOTHING', async () => {
		const { impl, calls } = stubFetch({
			children: seasonChildren(),
			lookupStatus: { 'repertoire_item:season-1': 500 }
		});
		await expect(deleteSeason(cfg, 'season-1', impl)).rejects.toThrow(/500/);
		expect(deleteTargets(calls)).toEqual([]);
	});
});

describe('isCascadePartial(reason, "season") — the duck-typed discriminator crosses mock boundaries (#217)', () => {
	it('recognises the tagged code on a PLAIN object (a page spec’s mocked write layer rejects with exactly that) and nothing else', () => {
		expect(typeof isCascadePartial).toBe('function');
		expect(isCascadePartial({ code: 'season-cascade-partial' }, 'season')).toBe(true);
		expect(isCascadePartial({ code: 'series-cascade-partial' }, 'season')).toBe(false);
		expect(isCascadePartial(new Error('boom'), 'season')).toBe(false);
		expect(isCascadePartial(null, 'season')).toBe(false);
	});
});

