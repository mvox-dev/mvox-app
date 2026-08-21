// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem } from './types';
import type { Season } from '$lib/seasons/types';

// Mock the read helpers (orchestration is tested independently of the queries) and
// T4's selectedCollectiveStore (so loadFullAgenda's db/token-threading is
// observable). Mocking both also severs the transitive entu-config -> $env
// import under happy-dom.
const { listSeasonsMock, listRehearsalsMock, collectiveHolder } = vi.hoisted(() => ({
	listSeasonsMock: vi.fn(),
	listRehearsalsMock: vi.fn(),
	collectiveHolder: {
		store: null as unknown as import('svelte/store').Writable<{ db: string; personId: string } | null>
	}
}));
vi.mock('$lib/seasons/entuSeasons', () => ({
	listSeasons: listSeasonsMock,
	listRehearsals: listRehearsalsMock
}));
vi.mock('$lib/collectives/store', async () => {
	const { writable } = await import('svelte/store');
	collectiveHolder.store = writable<{ db: string; personId: string } | null>(null);
	return { selectedCollectiveStore: collectiveHolder.store };
});

import { listFullAgenda, loadFullAgenda } from './agendaData';
import { setToken } from '$lib/auth/storage';

const cfg = { db: 'polyphony', token: 'jwt' };
const NOW = new Date('2026-09-05T10:00:00.000Z');

function item(id: string, startDatetime: string, conductors: string[] = []): AgendaItem {
	return { id, name: id, startDatetime, durationMinutes: 60, location: '', conductors, owners: [], editors: [] };
}

function season(id: string, startDate: string, endDate: string, conductors: string[] = []): Season {
	return { id, name: `Season ${id}`, startDate, endDate, conductors, owners: [], editors: [] };
}

beforeEach(() => {
	localStorage.clear();
	listSeasonsMock.mockReset();
	listRehearsalsMock.mockReset();
	collectiveHolder.store.set(null);
	// #161 review fix round 2 — every read in this module goes through the mocked
	// helpers, so nothing here may touch the network. Making the global `fetch`
	// throw means an argument-position shift (e.g. a stale 4-arg call sliding
	// `fetchImpl` into the `now` slot) fails loudly instead of falling back.
	vi.stubGlobal(
		'fetch',
		vi.fn(() => {
			throw new Error('unexpected network fetch in agendaData spec');
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// ---- listFullAgenda: upcoming items (same contract as the old listAgenda) ----

// #161 review fix round 2 — arity guard. `personId` was dead weight in position 2
// of a 4-arg signature: dropping it at a call site without dropping it here would
// have slid `now` into `personId` and `fetchImpl` into `now`. Pin the shape so a
// regression to 4 args fails here rather than at runtime.
describe('listFullAgenda — signature', () => {
	it('takes exactly (cfg, now) as required params — no dead personId slot', () => {
		expect(listFullAgenda.length).toBe(2);
	});
});

describe('listFullAgenda — upcoming items (de-fanned to one collective)', () => {
	it('flattens ongoing seasons -> upcoming -> sorted ascending', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s1', '2026-01-01', '2027-05-31')
		]);
		listRehearsalsMock.mockResolvedValue([
			item('late', '2026-09-20T16:00:00.000Z'),
			item('soon', '2026-09-10T16:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.upcoming.map((i) => i.id)).toEqual(['soon', 'late']);
		expect(result.upcoming[0]).toEqual(item('soon', '2026-09-10T16:00:00.000Z'));
	});

	it('queries every season (no end_date pre-filter) -- a past season contributes 0 via the event gate', async () => {
		listSeasonsMock.mockResolvedValue([
			season('old', '2025-09-01', '2026-05-31'),
			season('cur', '2026-09-01', '2027-05-31')
		]);
		listRehearsalsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 'old'
					? [item('old-past', '2026-05-10T18:00:00.000Z')] // before NOW -> filtered out
					: [item('cur-next', '2026-09-10T18:00:00.000Z')] // after NOW -> kept
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledTimes(2);
		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'old', expect.anything());
		expect(result.upcoming.map((i) => i.id)).toEqual(['cur-next']);
	});

	it('fetches a season with a PAST end_date too -- its future rehearsals still appear', async () => {
		listSeasonsMock.mockResolvedValue([
			season('fila', '2025-09-01', '2026-07-28')
		]);
		listRehearsalsMock.mockResolvedValue([item('sept', '2026-09-15T18:00:00.000Z')]);

		const result = await listFullAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'fila', expect.anything());
		expect(result.upcoming.map((i) => i.id)).toEqual(['sept']);
	});

	it('treats an open-ended season (empty endDate) as ongoing -- its rehearsals appear', async () => {
		listSeasonsMock.mockResolvedValue([
			season('open', '2026-09-01', '')
		]);
		listRehearsalsMock.mockResolvedValue([item('future', '2026-09-12T18:00:00.000Z')]);

		const result = await listFullAgenda(cfg, NOW);

		expect(listRehearsalsMock).toHaveBeenCalledWith(cfg, 'open', expect.anything());
		expect(result.upcoming.map((i) => i.id)).toEqual(['future']);
	});

	it('excludes rehearsals earlier than now (this-morning boundary excluded)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s', '2026-09-01', '2027-05-31')
		]);
		listRehearsalsMock.mockResolvedValue([
			item('past', '2026-09-05T07:00:00.000Z'), // before NOW (10:00)
			item('next', '2026-09-05T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);
		expect(result.upcoming.map((i) => i.id)).toEqual(['next']);
	});

	it('returns empty upcoming when the collective has no seasons', async () => {
		listSeasonsMock.mockResolvedValue([]);
		const result = await listFullAgenda(cfg, NOW);
		expect(result.upcoming).toEqual([]);
		expect(listRehearsalsMock).not.toHaveBeenCalled();
	});
});

// ---- listFullAgenda: recent items + season data (the #83 addition) ----

describe('listFullAgenda -- recent items + current season (#83 F1+F2)', () => {
	it('returns the current season\'s PAST events as recent, reverse-chronological', async () => {
		// Season started 2026-09-01, NOW is 2026-09-05T10:00Z -> season is current
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockResolvedValue([
			item('past-old', '2026-09-02T18:00:00.000Z'),
			item('past-new', '2026-09-04T18:00:00.000Z'),
			item('upcoming', '2026-09-10T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent.map((i) => i.id)).toEqual(['past-new', 'past-old']);
		expect(result.upcoming.map((i) => i.id)).toEqual(['upcoming']);
	});

	it('returns seasonId and seasonConductors from the current season', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna', 'p-bert'])
		]);
		listRehearsalsMock.mockResolvedValue([
			item('r1', '2026-09-10T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBe('s-cur');
		expect(result.seasonConductors).toEqual(['p-anna', 'p-bert']);
	});

	// #132/T2 — the season-creation upcoming-season gate reads this straight off
	// the load, no extra fetch.
	it('carries the FULL season list (both past/current and future) as `seasons`', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31'),
			season('s-next', '2027-09-01', '2028-05-31')
		]);
		listRehearsalsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasons.map((s) => s.id)).toEqual(['s-cur', 's-next']);
	});

	it('carries `seasons` even when NO season is current (all future)', async () => {
		listSeasonsMock.mockResolvedValue([season('s-future', '2027-09-01', '2028-05-31')]);
		listRehearsalsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBeNull();
		expect(result.seasons.map((s) => s.id)).toEqual(['s-future']);
	});

	it('returns empty recent + null seasonId when no season has started (all future)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-future', '2027-09-01', '2028-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent).toEqual([]);
		expect(result.seasonId).toBeNull();
		expect(result.seasonConductors).toEqual([]);
	});

	it('scopes recent events to the CURRENT season only (not a past season)', async () => {
		listSeasonsMock.mockResolvedValue([
			season('s-old', '2025-09-01', '2026-05-31'),
			season('s-cur', '2026-09-01', '2027-05-31')
		]);
		listRehearsalsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 's-old'
					? [item('old-past', '2026-05-10T18:00:00.000Z')]
					: [
							item('cur-past', '2026-09-03T18:00:00.000Z'),
							item('cur-upcoming', '2026-09-10T18:00:00.000Z')
						]
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		// Only the current season's past events appear in recent
		expect(result.recent.map((i) => i.id)).toEqual(['cur-past']);
		expect(result.seasonId).toBe('s-cur');
	});

	it('paired.find correctly matches the current season by id', async () => {
		// Two started seasons — currentSeason picks the latest start
		listSeasonsMock.mockResolvedValue([
			season('s-old', '2025-09-01', '2026-05-31'),
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockImplementation((_cfg: unknown, id: string) =>
			Promise.resolve(
				id === 's-old'
					? [item('old-event', '2026-05-10T18:00:00.000Z')]
					: [item('cur-event', '2026-09-03T18:00:00.000Z')]
			)
		);

		const result = await listFullAgenda(cfg, NOW);

		// recent must contain only the current season's events, not the old season's
		expect(result.recent.map((i) => i.id)).toEqual(['cur-event']);
		expect(result.seasonConductors).toEqual(['p-anna']);
	});

	it('returns empty recent when the current season has no past events yet', async () => {
		// Season just started, all events are upcoming
		listSeasonsMock.mockResolvedValue([
			season('s-cur', '2026-09-01', '2027-05-31', ['p-anna'])
		]);
		listRehearsalsMock.mockResolvedValue([
			item('upcoming-1', '2026-09-10T18:00:00.000Z'),
			item('upcoming-2', '2026-09-17T18:00:00.000Z')
		]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.recent).toEqual([]);
		expect(result.seasonId).toBe('s-cur');
		expect(result.seasonConductors).toEqual(['p-anna']);
	});
});

// ---- listFullAgenda: the MANAGEABLE season (#167) ----
//
// #167 RED — the page's event/series creation gates need the season an ADMIN
// manages, which is NOT always the viewer's current season: a just-created
// season with a future start date has no "current" status yet, but it is
// exactly the season the admin must populate with events NOW.
//
// Contract pinned here (GREEN wires conductorLogic's `manageableSeason` into
// `listFullAgenda`): `FullAgendaResult` gains three fields —
//   manageableSeasonId       string | null
//   manageableSeasonOwners   string[]  (the manageable season's visible `_owner` refs)
//   manageableSeasonEditors  string[]  (its visible `_editor` refs)
// When a current season exists these MIRROR seasonId/seasonOwners/seasonEditors.
// When only future seasons exist, they carry the SOONEST-starting future
// season's data, while the VIEWER fields keep their existing semantics
// (`seasonId` stays null, `recent` stays empty — those pins above must keep
// passing untouched).

describe('listFullAgenda — manageable season (#167)', () => {
	function seasonWithRights(
		id: string,
		startDate: string,
		owners: string[],
		editors: string[]
	): Season {
		return { id, name: `Season ${id}`, startDate, endDate: '', conductors: [], owners, editors };
	}

	it('a current season exists → manageable* mirrors the current season fields', async () => {
		listSeasonsMock.mockResolvedValue([
			seasonWithRights('s-cur', '2026-09-01', ['p-owner'], ['p-editor']),
			seasonWithRights('s-next', '2027-09-01', [], [])
		]);
		listRehearsalsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.seasonId).toBe('s-cur');
		expect(result.manageableSeasonId).toBe('s-cur');
		expect(result.manageableSeasonOwners).toEqual(['p-owner']);
		expect(result.manageableSeasonEditors).toEqual(['p-editor']);
	});

	it('FUTURE-only season: seasonId stays null (viewer semantics) but manageable* carries the future season', async () => {
		listSeasonsMock.mockResolvedValue([
			seasonWithRights('s-future', '2027-09-01', ['p-owner'], ['p-editor'])
		]);
		listRehearsalsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		// viewer semantics untouched:
		expect(result.seasonId).toBeNull();
		expect(result.recent).toEqual([]);
		// admin semantics (#167):
		expect(result.manageableSeasonId).toBe('s-future');
		expect(result.manageableSeasonOwners).toEqual(['p-owner']);
		expect(result.manageableSeasonEditors).toEqual(['p-editor']);
	});

	it('several future seasons, none started → the SOONEST-starting one is manageable', async () => {
		listSeasonsMock.mockResolvedValue([
			seasonWithRights('s-2028', '2028-09-01', [], []),
			seasonWithRights('s-2027', '2027-09-01', ['p-owner'], []),
			seasonWithRights('s-2029', '2029-09-01', [], [])
		]);
		listRehearsalsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.manageableSeasonId).toBe('s-2027');
		expect(result.manageableSeasonOwners).toEqual(['p-owner']);
	});

	it('no seasons at all → manageableSeasonId null, rights lists empty', async () => {
		listSeasonsMock.mockResolvedValue([]);

		const result = await listFullAgenda(cfg, NOW);

		expect(result.manageableSeasonId).toBeNull();
		expect(result.manageableSeasonOwners).toEqual([]);
		expect(result.manageableSeasonEditors).toEqual([]);
	});
});

// ---- loadFullAgenda (threads the T4 selected db + token) ----

describe('loadFullAgenda (threads the T4 selected db + token)', () => {
	it('resolves db from selectedCollectiveStore and token from storage — personId is never threaded', async () => {
		collectiveHolder.store.set({ db: 'polyphony', personId: 'person-123' });
		setToken('jwt-live');
		listSeasonsMock.mockResolvedValue([]);

		await loadFullAgenda(NOW);

		// #161 review fix round 2 — `listSeasons` is db-scoped, not person-scoped:
		// `listFullAgenda` no longer threads personId into the call.
		expect(listSeasonsMock).toHaveBeenCalledWith(
			{ db: 'polyphony', token: 'jwt-live' },
			expect.anything()
		);
	});

	// #167 — the empty shape carries the manageable* fields too (full-shape
	// toEqual, so a partial NO_SEASON object fails here rather than as an
	// `undefined` leaking into the page's gates).
	it('returns empty result without reading when no collective is selected', async () => {
		setToken('jwt-live'); // token present, but no collective
		const result = await loadFullAgenda(NOW);
		expect(result).toEqual({
			upcoming: [],
			recent: [],
			seasons: [],
			seasonId: null,
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: [],
			manageableSeasonId: null,
			manageableSeasonOwners: [],
			manageableSeasonEditors: []
		});
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});

	it('returns empty result without reading when there is no token', async () => {
		collectiveHolder.store.set({ db: 'polyphony', personId: 'person-123' }); // collective present, but no token
		const result = await loadFullAgenda(NOW);
		expect(result).toEqual({
			upcoming: [],
			recent: [],
			seasons: [],
			seasonId: null,
			seasonConductors: [],
			seasonOwners: [],
			seasonEditors: [],
			manageableSeasonId: null,
			manageableSeasonOwners: [],
			manageableSeasonEditors: []
		});
		expect(listSeasonsMock).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
