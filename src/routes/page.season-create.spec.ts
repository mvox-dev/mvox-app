// @vitest-environment happy-dom
//
// #132/T2 RED — season creation on the ACTUAL agenda route (integration: real
// +page.svelte, real AgendaList, real manageRightsFrom; only the data seams are
// mocked — same harness family as page.roster-create-section-entry.spec.ts and
// page.agenda-error.spec.ts).
//
// WHY (#132): seasons can only be born in Entu's admin UI today. The collective
// admin needs an in-app way to open the NEXT season before the current one runs
// out — a page-level [+ Season] affordance on the agenda, opening an INLINE form
// (no separate route), writing through T1's `createSeason` (entityCreate.ts).
//
// Pinned wiring contract (GREEN must implement):
//
//   DATA
//     - `FullAgendaResult` grows a `seasons: Season[]` field — the FULL season
//       list `listFullAgenda` already fetched (it calls `listSeasons` and today
//       throws the list away after picking the current one). The page derives
//       "an upcoming season exists" = `seasons.some(s => s.startDate > <today
//       ISO date>)` — strictly AFTER today, so the CURRENT (running) season
//       never counts as upcoming. No extra fetch.
//     - rights gate = `manageRightsFrom(seasonOwners, seasonEditors, personId)`
//       on the CURRENT season (the src/routes/+page.svelte:284-292 derivation
//       that already exists — `_owner` subsumes editor). FAIL-CLOSED: a
//       non-editor gets NO control, not a disabled one.
//     - submit calls `createSeason(cfg, { name, orgId, startDate, endDate,
//       conductorRefs })` — orgId from `resolveDatabaseEntityId(cfg, personId)` (NEVER a
//       `_type.string=organization&limit=1` guess — live-verifiably returns the
//       umbrella federation). NO `_sharing`, NO inherit-rights flag anywhere in
//       the UI layer: the create body is entirely T1's business, and T1 pins
//       `_type` + `_parent` + domain props ONLY (rights trusted to Entu's
//       inheritance chain from the org — the #132 design decision).
//     - conductor options come from `loadRoster` (id = personId, label = name),
//       loaded ONCE when the form opens and filtered CLIENT-SIDE by the
//       Autocomplete (review checklist #11 — no per-keystroke fetch).
//     - success → the form closes AND the agenda refreshes (loadFullAgenda is
//       re-invoked, so the new season's emptiness/state is real, not guessed).
//
//   TESTIDS
//     season-create               the [+ Season] button. Renders IFF the viewer
//                                 is a season editor AND no upcoming season
//                                 exists. Page-level: never inside a row/picker.
//     season-create-form          the inline form it opens (same route — no goto)
//     season-create-name          name text input, AUTO-FOCUSED on open
//     season-create-start         start date input, type="date"
//     season-create-end           end date input, type="date"
//     autocomplete-input          the conductor Autocomplete's input (the
//                                 component's own testid — one instance in form)
//     autocomplete-option-<pid>   its options: the collective's persons
//     season-create-conductor-<pid>  one chip per CHOSEN conductor, showing the
//                                 person's name (the parent renders picks — the
//                                 Autocomplete clears itself for the next entry)
//     season-create-submit        fires the createSeason write
//     season-create-cancel        closes the form; nothing written
//     season-create-error         inline validation error, role="alert"
//                                 (name required; end date >= start date)
//
//   BEHAVIOR
//     - Escape ANYWHERE in the form (fired here on the name input, so the
//       Autocomplete's own Escape-closes-dropdown layer is not in play)
//       dismisses the form without creating.
//     - validation runs BEFORE the write: a blank name or an inverted date
//       range shows season-create-error and createSeason is NEVER called
//       (defense in depth — T1 validates too, but a thrown-and-caught write is
//       not a validation UX).
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	createSeasonMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	createSeasonMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
// T1's write layer — the ONE create seam this page may use for seasons.
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: vi.fn(),
	createEvent: vi.fn()
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
// Only the ONE entity-rights round-trip is stubbed (`manageRightsFrom` and every
// other helper stays real): the season-create gate falls back to the ORGANIZATION's
// rights when the collective has no season at all (review F3), and left alone that
// is a live request from a unit test.
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// Supplementary page data, irrelevant here — mocked so no real fetch fires.
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: findMyMemberIdMock,
	listMyRsvps: listMyRsvpsMock,
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue([]),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', () => ({ loadWorksByEventId: vi.fn().mockResolvedValue({}) }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
// The viewer IS a season editor in most cases here, so the page's
// loadManagePickers fires — stub its reads or they hit the network.
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue([]),
	listAllEditions: vi.fn().mockResolvedValue([]),
	listAllCopies: vi.fn().mockResolvedValue([])
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

const ORG_EFK = '69c7f8718489bfcb0e81b065'; // live polyphony collective id shape
const CFG = { db: 'polyphony', token: 'jwt-abc' };

/** ISO calendar date `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The CURRENT season: started a month ago, two months still to run. */
function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: 'season-1',
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

/** An UPCOMING season: starts strictly AFTER today. */
function upcomingSeason(): Season {
	return {
		id: 'season-2',
		name: 'Season 2027',
		startDate: isoDate(61),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

/** loadFullAgenda's resolution, incl. the NEW `seasons` field this spec pins. */
function agendaResult(opts: { editor?: boolean; withUpcomingSeason?: boolean } = {}) {
	const { editor = true, withUpcomingSeason = false } = opts;
	const season = currentSeason(editor);
	return {
		upcoming: [],
		recent: [],
		seasonId: season.id,
		seasonConductors: [],
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: withUpcomingSeason ? [season, upcomingSeason()] : [season]
	};
}

/** The collective's persons — the conductor autocomplete's source. The VIEWER
 *  (authenticated personId 'person-p') is Pete. */
function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		},
		{
			memberId: 'm-grace',
			personId: 'p-grace',
			name: 'Grace Hopper',
			email: 'grace@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			orgId: ORG_EFK
		}
	];
}

function setAuthedWithOneCollective() {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: { polyphony: 'person-p' },
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: [{ db: 'polyphony', name: 'Polyphony', personId: 'person-p' }],
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set('polyphony');
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(fixtureRows());
	createSeasonMock.mockResolvedValue('season-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	createSeasonMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

/** Render + wait for the agenda to settle (empty state — no upcoming events in
 *  any fixture; the season affordance must not depend on event rows existing). */
async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function openForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-create-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

/** Pick a conductor through the REAL Autocomplete: type a filter, click the option. */
async function pickConductor(
	container: HTMLElement,
	filter: string,
	personId: string
): Promise<void> {
	const form = q(container, 'season-create-form') as HTMLElement;
	const input = form.querySelector('[data-testid="autocomplete-input"]') as HTMLElement;
	expect(input).not.toBeNull();
	await fireEvent.input(input, { target: { value: filter } });
	await waitFor(() => {
		expect(q(container, `autocomplete-option-${personId}`)).not.toBeNull();
	});
	await fireEvent.click(q(container, `autocomplete-option-${personId}`) as HTMLElement);
}

async function submit(container: HTMLElement): Promise<void> {
	await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
}

// ── the entry point: rights-gated, upcoming-season-gated ────────────────────────

describe('agenda — the [+ Season] entry point (rights + upcoming-season gate)', () => {
	it('season editor + NO upcoming season: season-create renders, at page level (not inside any agenda row), and merely rendering writes nothing', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		const control = q(container, 'season-create') as HTMLElement;
		// Page-level affordance, not buried in a row.
		expect(control.closest('[data-testid^="agenda-row-"]')).toBeNull();
		expect(control.closest('[data-testid^="agenda-recent-row-"]')).toBeNull();

		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(q(container, 'season-create-form')).toBeNull();
	});

	it('NON-editor (no _owner/_editor on the season visible to this caller): season-create does NOT render — fail-closed, same as every other rights gate', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, 'season-create')).toBeNull();
	});

	it('an UPCOMING season already exists (startDate strictly after today): season-create does NOT render, editor or not', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		expect(q(container, 'season-create')).toBeNull();
	});
});

// ── opening the inline form ─────────────────────────────────────────────────────

describe('agenda — clicking [+ Season] opens the INLINE creation form', () => {
	it('the form appears IN PLACE (no route change): name auto-focused, start/end are type="date", the conductor Autocomplete is inside the form — nothing written by opening', async () => {
		const container = await renderReady();
		await openForm(container);

		// Inline — same route, no navigation.
		expect(gotoMock).not.toHaveBeenCalled();

		const name = q(container, 'season-create-name') as HTMLInputElement;
		expect(name).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(name);
		});

		const start = q(container, 'season-create-start') as HTMLInputElement;
		const end = q(container, 'season-create-end') as HTMLInputElement;
		expect(start).not.toBeNull();
		expect(end).not.toBeNull();
		expect(start.type).toBe('date');
		expect(end.type).toBe('date');

		const form = q(container, 'season-create-form') as HTMLElement;
		expect(form.querySelector('[data-testid="autocomplete-input"]')).not.toBeNull();

		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('cancel closes the form; nothing written', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');

		await fireEvent.click(q(container, 'season-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('Escape dismisses the form; nothing written (fired on the name input, so the Autocomplete dropdown layer is not involved)', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');

		await fireEvent.keyDown(q(container, 'season-create-name') as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});
});

// ── the conductor autocomplete searches collective persons ──────────────────────

describe('agenda — the conductor autocomplete searches the collective’s persons', () => {
	it("persons come from loadRoster, loaded ONCE on form open and filtered CLIENT-SIDE: typing 'ada' offers only Ada Lovelace, and no second roster fetch fires per keystroke", async () => {
		const container = await renderReady();
		// The agenda visit itself must not pay the roster read — only the form does.
		expect(loadRosterMock).not.toHaveBeenCalled();

		await openForm(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		const form = q(container, 'season-create-form') as HTMLElement;
		const input = form.querySelector('[data-testid="autocomplete-input"]') as HTMLElement;
		await fireEvent.input(input, { target: { value: 'ada' } });

		await waitFor(() => {
			expect(q(container, 'autocomplete-option-p-ada')).not.toBeNull();
		});
		expect(q(container, 'autocomplete-option-p-ada')?.textContent).toContain('Ada Lovelace');
		expect(q(container, 'autocomplete-option-p-grace')).toBeNull();
		expect(q(container, 'autocomplete-option-person-p')).toBeNull();

		// Client-side filtering — still exactly one roster read.
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	// #132/T2 review F1 — `loadRoster` is listActiveMembers + one profile GET per
	// member (1+N; ~117 requests for a 116-member collective). The page already
	// caches it for the attendance panel; the form must read THROUGH that cache,
	// or open/close/re-open costs the whole fan-out again each time.
	it('re-opening the form does NOT re-fetch the roster: the cached list serves every later open', async () => {
		const container = await renderReady();

		await openForm(container);
		await waitFor(() => {
			expect(loadRosterMock).toHaveBeenCalledTimes(1);
		});

		await fireEvent.click(q(container, 'season-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		await openForm(container);

		// The options are still there — served from the cache, not re-read.
		const form = q(container, 'season-create-form') as HTMLElement;
		const input = form.querySelector('[data-testid="autocomplete-input"]') as HTMLElement;
		await fireEvent.input(input, { target: { value: 'ada' } });
		await waitFor(() => {
			expect(q(container, 'autocomplete-option-p-ada')).not.toBeNull();
		});
		expect(loadRosterMock).toHaveBeenCalledTimes(1);
	});

	it('a picked conductor renders as a chip (season-create-conductor-<personId>) showing the person’s name', async () => {
		const container = await renderReady();
		await openForm(container);

		await pickConductor(container, 'ada', 'p-ada');

		await waitFor(() => {
			expect(q(container, 'season-create-conductor-p-ada')).not.toBeNull();
		});
		expect(q(container, 'season-create-conductor-p-ada')?.textContent).toContain('Ada Lovelace');
	});
});

// ── submit: the write, its params, and the after-party ──────────────────────────

describe('agenda — submit calls createSeason and refreshes', () => {
	it("full flow: name + dates + one conductor → createSeason(cfg, { name, orgId: <resolveDatabaseEntityId's answer>, startDate, endDate, conductorRefs }) fires ONCE; the form closes; the agenda REFRESHES (loadFullAgenda re-invoked)", async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await pickConductor(container, 'ada', 'p-ada');
		await submit(container);

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		// FULL param shape (partial assertions hide bugs): the org comes from
		// resolveDatabaseEntityId — never a limit=1 guess, never hardcoded.
		expect(createSeasonMock).toHaveBeenCalledWith(CFG, {
			name: 'Autumn 2026',
			orgId: ORG_EFK,
			startDate: '2026-09-01',
			endDate: '2026-12-20',
			conductorRefs: ['p-ada']
		});
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);

		// Close + refresh: the agenda re-reads the world the write just changed.
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('no conductor picked: conductorRefs is EMPTY (a season without conductors is legal — v4E marks conductor optional)', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		expect(createSeasonMock).toHaveBeenCalledWith(CFG, {
			name: 'Autumn 2026',
			orgId: ORG_EFK,
			startDate: '2026-09-01',
			endDate: '2026-12-20',
			conductorRefs: []
		});
	});
});

// ── validation: BEFORE the write, never instead of it ───────────────────────────

describe('agenda — form validation refuses the write with an inline error', () => {
	it('blank name: season-create-error shows (role="alert"), NO write, the form stays open', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(q(container, 'season-create-error')?.getAttribute('role')).toBe('alert');
		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(q(container, 'season-create-form')).not.toBeNull();
	});

	it('end date BEFORE start date: season-create-error shows, NO write', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-12-01');
		await fill(container, 'season-create-end', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});
});

// ── review F3 — the gate must not require a CURRENT season ──────────────────────
//
// `seasonManageRights` is 'not-editor' whenever no season is running, and the two
// states where none is running are precisely the states where a season needs
// creating. Both are pinned here; the gate stays FAIL-CLOSED in both.

/** loadFullAgenda's resolution with NO current season. */
function noCurrentSeasonResult(seasons: Season[]) {
	return {
		upcoming: [],
		recent: [],
		seasonId: null,
		seasonConductors: [],
		seasonOwners: [],
		seasonEditors: [],
		seasons
	};
}

/** A season that ENDED yesterday — no longer current, never upcoming. */
function lapsedSeason(viewerIsEditor: boolean): Season {
	return {
		id: 'season-0',
		name: 'Season 2025',
		startDate: isoDate(-300),
		endDate: isoDate(-1),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

describe('agenda — [+ Season] survives the states where no season is current', () => {
	it('(G) a collective with NO seasons at all: the gate falls back to the ORGANIZATION’s rights, so the FIRST season is creatable in-app', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([]));
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		// The org came from the person's membership, never a limit=1 guess.
		expect(resolveDatabaseEntityIdMock).toHaveBeenCalledWith(CFG);
		expect(resolveManageRightsMock).toHaveBeenCalledWith(CFG, ORG_EFK, 'person-p');
	});

	it('(G) fail-closed: no seasons AND no organization rights → no season-create', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([]));
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'season-create')).toBeNull();
	});

	it('(G) fail-closed: an ERRORED organization rights read is not a grant', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([]));
		resolveManageRightsMock.mockResolvedValue('error');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'season-create')).toBeNull();
	});

	it('(H) the season LAPSED yesterday and the viewer is one of its editors: season-create renders — no organization round-trip needed, the rights rode along on the season list', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([lapsedSeason(true)]));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		// Zero-fetch: the list read already carried `_owner`/`_editor`.
		expect(resolveManageRightsMock).not.toHaveBeenCalled();
	});

	it('(H) fail-closed: a lapsed season the viewer does NOT edit still hides season-create', async () => {
		loadFullAgendaMock.mockResolvedValue(noCurrentSeasonResult([lapsedSeason(false)]));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		expect(q(container, 'season-create')).toBeNull();
	});
});

// ── review F1 — one submit is one season ────────────────────────────────────────

describe('agenda — the submit is guarded against double-firing', () => {
	it('three synchronous clicks while the write is in flight produce exactly ONE createSeason call, and the button reports itself busy', async () => {
		let releaseCreate: (id: string) => void = () => {};
		createSeasonMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					releaseCreate = resolve;
				})
		);

		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');

		// SYNCHRONOUS clicks — no await between them. Awaiting each click (as every
		// other case here does) lets the first submit finish and unmount the button,
		// which is exactly why the suite could not see this.
		const submitBtn = q(container, 'season-create-submit') as HTMLButtonElement;
		submitBtn.click();
		submitBtn.click();
		submitBtn.click();

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		// …and the affordance says so, rather than silently swallowing taps.
		await waitFor(() => {
			expect((q(container, 'season-create-submit') as HTMLButtonElement).disabled).toBe(true);
		});
		expect(q(container, 'season-create-submit')?.getAttribute('aria-busy')).toBe('true');

		releaseCreate('season-new-1');
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).toHaveBeenCalledTimes(1);
	});

	it('a FAILED write releases the guard: the button is submittable again', async () => {
		createSeasonMock.mockRejectedValue(new Error('boom'));
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect((q(container, 'season-create-submit') as HTMLButtonElement).disabled).toBe(false);

		createSeasonMock.mockResolvedValue('season-new-1');
		await submit(container);
		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(2);
		});
	});
});

// ── review F2 — Escape inside the open dropdown must not eat the form ───────────

describe('agenda — Escape is layered between the conductor dropdown and the form', () => {
	it('the FIRST Escape (dropdown open) closes only the dropdown: the form and everything typed into it survive', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');

		const form = q(container, 'season-create-form') as HTMLElement;
		const acInput = form.querySelector('[data-testid="autocomplete-input"]') as HTMLElement;
		await fireEvent.input(acInput, { target: { value: 'ada' } });
		await waitFor(() => {
			expect(q(container, 'autocomplete-option-p-ada')).not.toBeNull();
		});

		await fireEvent.keyDown(acInput, { key: 'Escape' });

		await waitFor(() => {
			expect(q(container, 'autocomplete-listbox')).toBeNull();
		});
		// The form is still here, with the work already done still in it.
		expect(q(container, 'season-create-form')).not.toBeNull();
		expect((q(container, 'season-create-name') as HTMLInputElement).value).toBe('Autumn 2026');
		expect((q(container, 'season-create-start') as HTMLInputElement).value).toBe('2026-09-01');
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('a SECOND Escape (dropdown already closed) dismisses the form, as it always did', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');

		const form = q(container, 'season-create-form') as HTMLElement;
		const acInput = form.querySelector('[data-testid="autocomplete-input"]') as HTMLElement;
		await fireEvent.input(acInput, { target: { value: 'ada' } });
		await fireEvent.keyDown(acInput, { key: 'Escape' }); // consumed by the dropdown
		await fireEvent.keyDown(acInput, { key: 'Escape' }); // this one is the form's

		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		expect(createSeasonMock).not.toHaveBeenCalled();
	});
});

// ── review F4/F6 — the error says the right thing, and stops saying it ──────────

describe('agenda — validation messages are honest and transient', () => {
	it('BOTH dates blank reports "dates required", NOT the inverted-range message', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(q(container, 'season-create-error')?.textContent).toContain('season_dates_required');
		expect(q(container, 'season-create-error')?.textContent).not.toContain(
			'season_date_range_invalid'
		);
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('only the END date missing also reports "dates required"', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')?.textContent).toContain('season_dates_required');
		});
	});

	it('an INVERTED range still reports the inverted-range message', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-12-01');
		await fill(container, 'season-create-end', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')?.textContent).toContain(
				'season_date_range_invalid'
			);
		});
	});

	// #132/T2 review F2 — the error must flag the field it is ABOUT. Pointing
	// aria-invalid/aria-describedby at the name input for a DATE error sends a
	// screen-reader user to the one field that is already correct.
	it('an inverted range flags the DATE inputs, not the (perfectly good) name', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-name', 'Autumn 2026');
		await fill(container, 'season-create-start', '2026-12-01');
		await fill(container, 'season-create-end', '2026-09-01');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		const nameEl = q(container, 'season-create-name') as HTMLInputElement;
		expect(nameEl.getAttribute('aria-invalid')).toBeNull();
		expect(nameEl.getAttribute('aria-describedby')).toBeNull();
		for (const testid of ['season-create-start', 'season-create-end']) {
			const dateEl = q(container, testid) as HTMLInputElement;
			expect(dateEl.getAttribute('aria-invalid')).toBe('true');
			expect(dateEl.getAttribute('aria-describedby')).toBe('season-create-error');
		}
		// One visible error node, and it is what the date fields point at.
		expect(q(container, 'season-create-error')?.id).toBe('season-create-error');
	});

	it('a missing NAME flags the name input and leaves the date inputs unflagged', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')?.textContent).toContain('season_name_required');
		});
		expect(q(container, 'season-create-name')?.getAttribute('aria-invalid')).toBe('true');
		expect(q(container, 'season-create-start')?.getAttribute('aria-invalid')).toBeNull();
		expect(q(container, 'season-create-end')?.getAttribute('aria-invalid')).toBeNull();
	});

	it('editing a field clears the error, and the name field stops announcing itself invalid', async () => {
		const container = await renderReady();
		await openForm(container);
		await fill(container, 'season-create-start', '2026-09-01');
		await fill(container, 'season-create-end', '2026-12-20');
		await submit(container);

		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
		expect(q(container, 'season-create-name')?.getAttribute('aria-invalid')).toBe('true');

		await fill(container, 'season-create-name', 'Autumn 2026');

		await waitFor(() => {
			expect(q(container, 'season-create-error')).toBeNull();
		});
		const nameEl = q(container, 'season-create-name') as HTMLInputElement;
		expect(nameEl.getAttribute('aria-invalid')).toBeNull();
		expect(nameEl.getAttribute('aria-describedby')).toBeNull();
	});
});

// (*MVOX:Tallis* — #132/T2 RED: [+ Season] entry point + inline form + conductor autocomplete)
// (*MVOX:Palestrina* — #132/T2 review fixes F1–F7)
