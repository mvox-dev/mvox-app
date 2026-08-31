// #197 RED — the event / event-series DELETE write layer, at the `fetchImpl`
// seam (same harness family as seasonManage.spec.ts; same endpoint-split
// discipline as sectionActions.delete.spec.ts).
//
// WHY (#197, Joosep / Crede pilot 2026-08-31): there is no way to delete an
// event or an event series from the app UI — test data and mistakes accumulate
// until an admin cleans up via the Entu API. Section delete already exists
// (sectionActions.deleteSection); events and series get the same treatment.
//
// Contract under test (GREEN must implement, in src/lib/seasons/seasonManage.ts
// — the ONE seam the season-manage panel reads/writes seasons through):
//
//   deleteEvent(cfg, eventId, fetchImpl?)             → Promise<void>
//   deleteEventSeries(cfg, seriesId, fetchImpl?)      → Promise<number>
//   countSeriesOccurrences(cfg, seriesId, fetchImpl?) → Promise<number>
//
//   - `deleteEvent` CASCADES to the event's own children (#197 review 2nd pass
//     F1 — the one-DELETE contract ORPHANED them): one scoped read per child
//     type (`attendance`, `program_item` — the two types read elsewhere as
//     `_parent.reference={eventId}`), one `DELETE entity/{id}` per child, then
//     the event's own DELETE. Everything on the ENTITY endpoint (an event /
//     attendance / program_item id is an ENTITY id; `/property/{id}` is for
//     property-VALUE ids only, and a /property DELETE here would 404 and leave
//     the entity standing).
//   - `deleteEventSeries` CASCADES (widened by the #197 review, F1 — the
//     original one-DELETE contract ORPHANED the occurrences): one scoped read
//     of the series' occurrence events, `deleteEvent` per occurrence (so each
//     occurrence takes its own children with it), then the series' own DELETE —
//     in that order, so a failure part-way leaves a still-linked remainder
//     rather than nameless orphans. Verified against the Entu API source
//     (routes/[db]/entity/[_id]/index.delete.js): a DELETE soft-deletes every
//     property REFERENCING the target, i.e. the children's `_parent` values,
//     while the child entities themselves survive.
//   - `deleteEventSeries` RESOLVES WITH the number of occurrences it deleted
//     (#197 review 2nd pass F2) — the panel announces THAT number, never the
//     client-derived count its list happened to be showing.
//   - `countSeriesOccurrences` is the live figure the panel's two-step confirm
//     shows before arming (#197 review 2nd pass F2): the server's own `count`,
//     not the season-wide list read's client-side tally.
//   - the auth token rides on every request (nothing is anonymous).
//   - non-2xx throws with the status surfaced (fail loud, no silent success)
//     — the panel is what turns that into an inline error. A 403 throws the
//     TAGGED `EntityDeleteForbiddenError` (#197 review F3): Entu's DELETE needs
//     `_owner` on the target, which the panel's `_editor` gate does not imply,
//     and that refusal must not read as "try again".
//
// Namespace import + runtime lookup (not a named import) so the file LOADS even
// while the functions are absent and each test fails with a readable
// "not a function" instead of a module-resolution explosion.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from './entuSeasons';
import { isDeleteForbidden, isEventCascadePartial, isSeriesCascadePartial } from './deleteErrors';
import * as manage from './seasonManage';

type DeleteFn = (cfg: EntuCfg, id: string, fetchImpl?: typeof fetch) => Promise<unknown>;
type CountFn = (cfg: EntuCfg, id: string, fetchImpl?: typeof fetch) => Promise<number>;

const deleteEvent = (manage as unknown as { deleteEvent?: DeleteFn }).deleteEvent;
const deleteEventSeries = (manage as unknown as { deleteEventSeries?: DeleteFn })
	.deleteEventSeries;
const countSeriesOccurrences = (manage as unknown as { countSeriesOccurrences?: CountFn })
	.countSeriesOccurrences;

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

interface Call {
	url: string;
	method: string;
	headers: string;
}

/** `${_type.string}:${_parent.reference}` — how a scoped child read is keyed in
 *  the stub below, i.e. exactly what the cascade asks the server for. */
function scopeKey(href: string): string {
	const params = new URL(href, 'https://stub.invalid/').searchParams;
	return `${params.get('_type.string')}:${params.get('_parent.reference')}`;
}

function entityIdOf(href: string): string {
	return href.slice(href.lastIndexOf('/entity/') + '/entity/'.length);
}

interface StubOpts {
	/** `${type}:${parentId}` → the child ids that scoped read returns. */
	children?: Record<string, string[]>;
	/** `${type}:${parentId}` → a server `count` LARGER than the ids returned,
	 *  faking a result set the capped read could not carry. */
	counts?: Record<string, number>;
	/** `${type}:${parentId}` → non-200 status for that scoped read. */
	lookupStatus?: Record<string, number>;
	/** entity id → non-200 status for its DELETE. */
	deleteStatus?: Record<string, number>;
}

/**
 * One fetch stub for both cascades: every scoped GET answers from `children`
 * (empty by default, with a matching `count`), every DELETE answers 200 unless
 * `deleteStatus` names its entity. Records every call.
 */
function stubFetch(opts: StubOpts = {}) {
	const calls: Call[] = [];
	const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		const method = init?.method ?? 'GET';
		calls.push({ url: href, method, headers: JSON.stringify(init?.headers ?? {}) });

		if (method === 'GET') {
			const key = scopeKey(href);
			const status = opts.lookupStatus?.[key];
			if (status) return json({}, status);
			const ids = opts.children?.[key] ?? [];
			return json({ count: opts.counts?.[key] ?? ids.length, entities: ids.map((_id) => ({ _id })) });
		}

		const status = opts.deleteStatus?.[entityIdOf(href)];
		if (status) return json({ error: 'refused' }, status);
		return json({ deleted: true });
	});
	return { impl, calls };
}

/** Just the DELETE targets, in order — the cascade's observable shape. */
function deleteTargets(calls: Call[]): string[] {
	return calls.filter((c) => c.method === 'DELETE').map((c) => entityIdOf(c.url));
}

/** Just the scoped GETs, in order — which children the cascade looked for. */
function lookupKeys(calls: Call[]): string[] {
	return calls.filter((c) => c.method === 'GET').map((c) => scopeKey(c.url));
}

describe('deleteEvent — the event ENTITY, after its own children', () => {
	it('is exported from seasonManage', () => {
		expect(typeof deleteEvent).toBe('function');
	});

	it('an event with NO children: one scoped read per child type, then ONE DELETE …/polyphony/entity/{eventId} — no /property/ call', async () => {
		const { impl, calls } = stubFetch();
		await deleteEvent!(cfg, 'ev-9', impl);

		expect(lookupKeys(calls)).toEqual(['attendance:ev-9', 'program_item:ev-9']);
		expect(deleteTargets(calls)).toEqual(['ev-9']);
		expect(calls.at(-1)?.url).toContain('/polyphony/entity/ev-9');
		// The endpoint split, pinned: an event id is an ENTITY id — a /property/
		// DELETE here would 404 and leave the event standing.
		expect(calls.every((c) => !c.url.includes('/property/'))).toBe(true);
	});

	// #197 review 2nd pass F1 — the contract that replaced "one DELETE, child
	// cleanup is somebody else's problem" at the EVENT level. Entu soft-deletes
	// the properties REFERENCING a deleted entity, not the referring entities, so
	// a bare event DELETE left every attendance row and every program_item alive
	// with its `_parent` → event value stripped: unreachable rows no screen in
	// the app can list, explain or clean up.
	it('an event WITH children: every attendance and every program_item is DELETEd, and the event LAST', async () => {
		const { impl, calls } = stubFetch({
			children: { 'attendance:ev-9': ['att-1', 'att-2'], 'program_item:ev-9': ['pi-1'] }
		});
		await deleteEvent!(cfg, 'ev-9', impl);

		expect(deleteTargets(calls)).toEqual(['att-1', 'att-2', 'pi-1', 'ev-9']);
	});

	it('sends the auth token on every call (nothing is anonymous)', async () => {
		const { impl, calls } = stubFetch({ children: { 'attendance:ev-9': ['att-1'] } });
		await deleteEvent!(cfg, 'ev-9', impl);

		expect(calls.every((c) => c.headers.includes('jwt'))).toBe(true);
	});

	it('throws on a non-2xx DELETE with the status surfaced — a refused delete must never be silent', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'ev-9': 403 } });
		await expect(deleteEvent!(cfg, 'ev-9', impl)).rejects.toThrow(/403/);
	});

	it('a 500 throws too — not just the auth-shaped refusals', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'ev-9': 500 } });
		await expect(deleteEvent!(cfg, 'ev-9', impl)).rejects.toThrow(/500/);
	});

	// #197 review F3 — a 403 is the ONE refusal the panel's `_editor` rights gate
	// cannot predict (Entu's DELETE wants `_owner` on the target), so it is
	// TAGGED: the panel says "you don't have permission", not "try again".
	it('a 403 rejects with the tagged forbidden error; a 500 does NOT', async () => {
		const forbidden = await deleteEvent!(
			cfg,
			'ev-9',
			stubFetch({ deleteStatus: { 'ev-9': 403 } }).impl
		).catch((e) => e);
		expect(isDeleteForbidden(forbidden)).toBe(true);

		const broken = await deleteEvent!(
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

		const failure = await deleteEvent!(cfg, 'ev-9', impl).catch((e) => e);
		expect(isEventCascadePartial(failure)).toBe(true);
		expect(failure).toMatchObject({ deletedCount: 1, totalCount: 3 });
		// pi-1 is untouched and the EVENT is still there — the remainder keeps its
		// `_parent`, so a retry resumes instead of hunting orphans.
		expect(deleteTargets(calls)).toEqual(['att-1', 'att-2']);
	});

	it('a 403 on a CHILD reads as the same permission story as a 403 on the event', async () => {
		const forbidden = await deleteEvent!(
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
		await expect(deleteEvent!(cfg, 'ev-9', impl)).rejects.toThrow(/500/);
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
		await expect(deleteEvent!(cfg, 'ev-9', impl)).rejects.toThrow(/900/);
		expect(deleteTargets(calls)).toEqual([]);
	});
});

describe('deleteEventSeries — cascade: every occurrence, then the series ENTITY', () => {
	it('is exported from seasonManage', () => {
		expect(typeof deleteEventSeries).toBe('function');
	});

	it('an EMPTY series: one scoped occurrence read, then ONE DELETE …/entity/{seriesId} — no /property/ call', async () => {
		const { impl, calls } = stubFetch();
		await deleteEventSeries!(cfg, 'series-1', impl);

		expect(calls).toHaveLength(2);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toContain('_type.string=event');
		expect(calls[0].url).toContain('_parent.reference=series-1');
		expect(calls[1].method).toBe('DELETE');
		expect(calls[1].url).toContain('/polyphony/entity/series-1');
		// The endpoint split, pinned: a series id is an ENTITY id.
		expect(calls.every((c) => !c.url.includes('/property/'))).toBe(true);
	});

	// #197 review F1 — the contract that replaced "one DELETE, child cleanup is
	// somebody else's problem". Without this the 12 occurrences SURVIVE the
	// series, stripped of their `_parent` reference to it (Entu soft-deletes
	// properties REFERENCING a deleted entity, not the referring entities), and
	// a series occurrence carries no own name/duration/location — so what the
	// agenda is left holding is 12 nameless, 0-duration rows nothing in the app
	// can re-link or explain.
	it('a series WITH occurrences: every occurrence is DELETEd, and the series LAST', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] }
		});
		await deleteEventSeries!(cfg, 'series-1', impl);

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
		await deleteEventSeries!(cfg, 'series-1', impl);

		expect(deleteTargets(calls)).toEqual(['att-1', 'occ-1', 'pi-2', 'occ-2', 'series-1']);
	});

	// #197 review 2nd pass F2 — the panel announces what was DESTROYED, so the
	// cascade has to hand back its own count rather than let the caller quote a
	// list read from some earlier moment.
	it('RESOLVES WITH the number of occurrences deleted', async () => {
		const { impl } = stubFetch({ children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] } });
		await expect(deleteEventSeries!(cfg, 'series-1', impl)).resolves.toBe(3);

		const empty = stubFetch();
		await expect(deleteEventSeries!(cfg, 'series-2', empty.impl)).resolves.toBe(0);
	});

	it('sends the auth token on every call (nothing is anonymous)', async () => {
		const { impl, calls } = stubFetch({ children: { 'event:series-1': ['occ-1'] } });
		await deleteEventSeries!(cfg, 'series-1', impl);

		expect(calls.every((c) => c.headers.includes('jwt'))).toBe(true);
	});

	it('a failed OCCURRENCE delete aborts BEFORE the series delete — the series survives, tagged partial with how many went', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1', 'occ-2', 'occ-3'] },
			deleteStatus: { 'occ-2': 500 }
		});

		const failure = await deleteEventSeries!(cfg, 'series-1', impl).catch((e) => e);
		expect(isSeriesCascadePartial(failure)).toBe(true);
		expect(failure).toMatchObject({ deletedCount: 1, totalCount: 3 });
		// occ-3 is untouched and the SERIES is still there — the remainder keeps
		// its `_parent`, so a retry resumes instead of hunting orphans.
		expect(deleteTargets(calls)).toEqual(['occ-1', 'occ-2']);
	});

	it('a 403 on an OCCURRENCE reads as the same permission story as a 403 on the series', async () => {
		const occForbidden = await deleteEventSeries!(
			cfg,
			'series-1',
			stubFetch({
				children: { 'event:series-1': ['occ-1'] },
				deleteStatus: { 'occ-1': 403 }
			}).impl
		).catch((e) => e);
		expect(isDeleteForbidden(occForbidden)).toBe(true);

		const seriesForbidden = await deleteEventSeries!(
			cfg,
			'series-1',
			stubFetch({ deleteStatus: { 'series-1': 403 } }).impl
		).catch((e) => e);
		expect(isDeleteForbidden(seriesForbidden)).toBe(true);
	});

	// The refusal now nests two deep (series → occurrence → the occurrence's own
	// program_item), which is why `isDeleteForbidden` walks the whole chain.
	it('a 403 on an occurrence’s CHILD is still a permission story, not a retry prompt', async () => {
		const forbidden = await deleteEventSeries!(
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
		await expect(deleteEventSeries!(cfg, 'series-1', impl)).rejects.toThrow(/500/);
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('a series with MORE occurrences than the capped read returned is refused — nothing is deleted', async () => {
		const { impl, calls } = stubFetch({
			children: { 'event:series-1': ['occ-1', 'occ-2'] },
			counts: { 'event:series-1': 900 }
		});
		await expect(deleteEventSeries!(cfg, 'series-1', impl)).rejects.toThrow(/900/);
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('a 403 on the series DELETE itself throws with the status surfaced', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'series-1': 403 } });
		await expect(deleteEventSeries!(cfg, 'series-1', impl)).rejects.toThrow(/403/);
	});

	it('a 500 on the series DELETE throws too', async () => {
		const { impl } = stubFetch({ deleteStatus: { 'series-1': 500 } });
		await expect(deleteEventSeries!(cfg, 'series-1', impl)).rejects.toThrow(/500/);
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

		await expect(countSeriesOccurrences!(cfg, 'series-1', impl)).resolves.toBe(900);
		// A COUNT, not a page of rows: one scoped read, nothing written.
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toContain('_type.string=event');
		expect(calls[0].url).toContain('_parent.reference=series-1');
		expect(deleteTargets(calls)).toEqual([]);
	});

	it('an empty series counts 0, and the token rides along', async () => {
		const { impl, calls } = stubFetch();
		await expect(countSeriesOccurrences!(cfg, 'series-2', impl)).resolves.toBe(0);
		expect(calls[0].headers).toContain('jwt');
	});

	it('a non-2xx read throws with the status surfaced (fail loud)', async () => {
		const { impl } = stubFetch({ lookupStatus: { 'event:series-1': 500 } });
		await expect(countSeriesOccurrences!(cfg, 'series-1', impl)).rejects.toThrow(/500/);
	});
});

// (*MVOX:Tallis* — #197 RED: deleteEvent / deleteEventSeries wire contract)
// (*MVOX:Palestrina* — #197 review F1/F3: series cascade + tagged 403)
// (*MVOX:Palestrina* — #197 review 2nd pass F1/F2: event child cascade,
//  deleted-count return value, live occurrence count)
