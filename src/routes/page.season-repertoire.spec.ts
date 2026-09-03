// @vitest-environment happy-dom
//
// #234 RED — the season-manage panel gains a REPERTOIRE section (integration:
// real +page.svelte, real repertoire data layer, real write actions; the
// network is stubbed at `fetch` — same harness family as
// page.repertoire-manage-wiring.spec.ts, with the panel's non-repertoire reads
// (roster, sections, series/events lists) module-mocked as in
// page.season-manage.spec.ts).
//
// WHY (#234, Mihkel live-gate): "I cant see the programme management on season
// management card." Season repertoire has no season-scoped management home —
// it is only reachable through an unprogrammed event's fallback works line.
//
// Pinned contract (GREEN must implement — the SPIKE-equivalent, settled here
// from research-234.json + Gama's PO ruling on the issue):
//
//   SECTION — the panel gains a `season-manage-repertoire` container: a
//   heading using the NEW key `season_manage_repertoire_label` (sibling of
//   season_manage_series_label / season_manage_events_label, four locales),
//   the managed season's repertoire_items as WorkRow rows (same work +
//   composer + edition labeling the works lines use, retired items INCLUDED —
//   this is the editor surface, the status toggle must stay two-way), each
//   row's remove control, and the existing add-work select + button (#204
//   composer labels via the shared workLabel). RepertoireElement in
//   'repertoire' context drops in (research: prop-driven, fetch-free) — an
//   equivalent renderer is acceptable IF every testid below still holds.
//
//   SEASON/RIGHTS SCOPE — PO ruling (issue #234, last comment): the section
//   scopes to the season THE PANEL MANAGES (`manageableSeasonId`), and rights
//   are the season-repertoire-editor KIND evaluated against THAT season —
//   i.e. the panel's own `manageableSeasonRights` gate, NOT the
//   currentSeasonId-scoped `seasonManageRights` viewer signal. The divergence
//   case (lapsed current season + future season queued: currentSeason picks
//   the lapsed one, manageableSeason the future one) is pinned below: the
//   section lists, excludes-from-add, and WRITES against the PANEL's season.
//   The page-level `seasonRepertoire`/`pickableWorksList` (currentSeasonId-
//   scoped) and the per-event handlers (hardcoded to currentSeasonId +
//   worksByEventId) are therefore NOT reusable verbatim — panel-scoped
//   state/handlers are required, and the divergence tests fail against any
//   implementation that reuses the current-season plumbing.
//
//   SYNC — a repertoire_item is a child of the SEASON, so the same row shows
//   on every event falling back to it. A panel-side remove/add must reflect
//   in the agenda's fallback works rows (optimistic cross-drop or refetch —
//   the world below serves post-write truth, so either passes).
//
//   RESET — a collective switch clears the section's rows: stale rows from
//   the previous collective must not survive into the next panel open
//   (resetManagement/resetSeasonManage must cover any new state).
//
//   TESTIDS — RepertoireElement's row testids (work-row, work-manage-*, …)
//   are NOT per-instance, so the panel section + a simultaneously-expanded
//   agenda fallback line render DUPLICATE testids page-wide. That duplication
//   is ACCEPTED and documented here; the strategy is CONTAINER SCOPING: every
//   assertion in this file queries within [data-testid="season-manage-
//   repertoire"] or explicitly OUTSIDE the panel — never a bare page-wide
//   single-match query for a row-level testid. Existing suites keep their
//   bare queries because their scenarios never render both surfaces at once;
//   new specs must scope. The fail-closed ADMIN_TESTIDS sweep
//   (page.agenda-admin.spec.ts) gains 'season-manage-repertoire'.
//
//   UNTOUCHED — RepertoireElement.spec.ts (incl. the :713 per-surface rights
//   describe), page.repertoire-manage-wiring.spec.ts, AgendaList.spec.ts and
//   the event/[id] specs stay green as-is: the per-event works lines and the
//   'repertoire'-context fallback (an event editor's only entry point) keep
//   byte-identical behavior.
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lenient message mock — structural assertions only; real copy is Comenius's.
vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({} as Record<string, (params?: Record<string, unknown>) => string>, {
		get: (_target, key) => () => `[${String(key)}]`
	})
}));

const {
	loadFullAgendaMock,
	discoverMock,
	gotoMock,
	loadRosterMock,
	listSectionsMock,
	signFileUrlMock,
	listEventsForSeasonMock,
	deleteEventMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	signFileUrlMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	deleteEventMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
// $env/dynamic/public is unavailable outside a SvelteKit request context under
// happy-dom; stubbing the base url keeps every real module in play.
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// The panel's NON-repertoire reads — not what is under test here; mocked the
// way page.season-manage.spec.ts mocks them. The repertoire path (repertoireData,
// workRows, libraryData, repertoireActions) stays REAL down to `fetch`.
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: vi.fn().mockResolvedValue([]),
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: vi.fn(),
	addSeasonConductor: vi.fn(),
	removeSeasonConductor: vi.fn(),
	getSeriesDefaults: vi.fn(),
	// Review 2 F1 — the panel-side standalone-event delete is the cheapest
	// `loadForSelected({ keepSeasonManage: true })` trigger there is, and that
	// panel-preserving reload is exactly what the reset pin below needs.
	deleteEvent: deleteEventMock,
	deleteEventSeries: vi.fn(),
	countSeriesOccurrences: vi.fn(),
	countSeasonScope: vi.fn(),
	deleteSeason: vi.fn()
}));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: vi.fn(),
	createEventSeries: vi.fn(),
	createEvent: vi.fn()
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: listSectionsMock
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));
// Supplementary page data, irrelevant here — mocked so no real fetch fires.
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue(null),
	listMyRsvps: vi.fn().mockResolvedValue([]),
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

import Page from './+page.svelte';
import type { Season } from '$lib/seasons/types';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import {
	collectiveState,
	selectedCollectiveDbStore,
	urlCollectiveDbStore
} from '$lib/collectives/store';

// ── fixtures ────────────────────────────────────────────────────────────────────

/** ISO calendar date `offsetDays` from now — keeps the fixtures time-bomb-free. */
function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The ALIGNED shape: one running season — currentSeason and manageableSeason
 *  both pick it, the panel and the agenda fallback manage the SAME season. */
function runningSeason(): Season {
	return {
		id: 'season-1',
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

/** The DIVERGENCE shape (#167 mechanics, PO ruling on #234): the current
 *  season has LAPSED with a later one queued. `currentSeason` (ignores
 *  end_date) picks the lapsed season-a; `manageableSeason` picks the future
 *  season-b. The panel manages season-b — so must its repertoire section. */
function lapsedSeason(): Season {
	return {
		id: 'season-a',
		name: 'Season 2025',
		startDate: isoDate(-300),
		endDate: isoDate(-1),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}
function futureSeason(): Season {
	return {
		id: 'season-b',
		name: 'Season 2027',
		startDate: isoDate(30),
		endDate: isoDate(240),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

const futureStart = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
/** One agenda event with NO program_items — its works line renders the season
 *  repertoire fallback ('repertoire' context), the second surface the sync
 *  and scoping pins need on screen simultaneously with the panel. */
const EV_FALLBACK = {
	id: 'ev-1',
	name: 'Rehearsal',
	startDatetime: futureStart,
	durationMinutes: 90,
	location: '',
	conductors: [],
	owners: [],
	editors: []
};

type EntityRaw = Record<string, unknown>;

const WORKS: EntityRaw[] = [
	{
		_id: 'work-1',
		name: [{ string: 'Spem in alium' }],
		composer: [{ string: 'Thomas Tallis' }]
	},
	{ _id: 'work-2', name: [{ string: 'Old warhorse' }] },
	{
		_id: 'work-3',
		name: [{ string: 'Nunc dimittis' }],
		composer: [{ string: 'Arvo Pärt' }]
	}
];

const EDITIONS: EntityRaw[] = [
	{
		_id: 'ed-1',
		name: [{ string: '40-part original' }],
		_parent: [{ reference: 'work-1', entity_type: 'work' }],
		// Review F2 — an edition WITH a score file: the panel row must offer the
		// PDF link and it must actually sign. The original fixture carried no
		// files at all, so a rendered-but-inert button went unnoticed.
		file: [{ _id: 'file-1', filename: 'spem.pdf', filesize: 1024, filetype: 'application/pdf' }]
	},
	{
		_id: 'ed-2',
		name: [{ string: 'Bärenreiter' }],
		_parent: [{ reference: 'work-1', entity_type: 'work' }]
	}
];

const RI_ACTIVE: EntityRaw = {
	_id: 'ri-1',
	name: [{ string: 'Spem in alium' }],
	work: [{ reference: 'work-1' }],
	edition: [{ reference: 'ed-1' }],
	status: [{ string: 'active' }]
};
const RI_RETIRED: EntityRaw = {
	_id: 'ri-2',
	name: [{ string: 'Old warhorse' }],
	work: [{ reference: 'work-2' }],
	status: [{ string: 'retired' }]
};
const RI_B: EntityRaw = {
	_id: 'ri-b1',
	name: [{ string: 'Nunc dimittis' }],
	work: [{ reference: 'work-3' }],
	status: [{ string: 'active' }]
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

interface WorldOptions {
	/** Mutable per-season repertoire_item state, keyed by season id. Writes
	 *  (POST create / DELETE) mutate it, so any refetch serves the post-write
	 *  truth — the sync pins accept optimistic OR refetch mechanics. */
	repertoireBySeason: Record<string, EntityRaw[]>;
	/** Dbs whose repertoire_item GET never resolves — the stale-state trap for
	 *  the collective-switch pin. */
	pendingRepertoireDbs?: string[];
	/** Repertoire_item GET answers 500 — the read-failure pin (review F4). */
	failRepertoireRead?: boolean;
	/** Entity CREATE never settles — the in-flight pin for the panel's own
	 *  add-work pending key (review F3). */
	holdCreates?: boolean;
	/** Consulted on EVERY repertoire_item GET: while it answers true the read
	 *  never settles. Review 2 F1's trap — flipped on after the panel is loaded,
	 *  so whatever the section shows across a panel-preserving reload is exactly
	 *  what the resets left standing, with no refetch to paper over a wipe. */
	holdRepertoireReads?: () => boolean;
}

/** The Entu stand-in, db-aware and stateful. Routed by url + method so an
 *  assertion can say exactly which wire call a tap produced. */
function installWorld(options: WorldOptions) {
	const {
		repertoireBySeason,
		pendingRepertoireDbs = [],
		failRepertoireRead = false,
		holdCreates = false,
		holdRepertoireReads = () => false
	} = options;
	let createSeq = 0;

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const db = url.split('.invalid/')[1]?.split('/')[0] ?? '';

		if (method === 'DELETE') {
			const entityMatch = url.match(/\/entity\/([^/?]+)$/);
			if (entityMatch) {
				for (const seasonId of Object.keys(repertoireBySeason)) {
					repertoireBySeason[seasonId] = repertoireBySeason[seasonId].filter(
						(ri) => ri._id !== entityMatch[1]
					);
				}
			}
			return json({ deleted: true });
		}
		if (method === 'POST') {
			// Entity CREATE (POST .../entity with no id) — parse the props, append
			// the new repertoire_item to its season's list.
			if (/\/entity(\?|$)/.test(url)) {
				if (holdCreates) return new Promise<Response>(() => {});
				const props = JSON.parse(String(init?.body ?? '[]')) as Array<{
					type: string;
					reference?: string;
					string?: string;
				}>;
				const seasonId = props.find((p) => p.type === '_parent')?.reference ?? '';
				const workId = props.find((p) => p.type === 'work')?.reference ?? '';
				const status = props.find((p) => p.type === 'status')?.string ?? 'active';
				const id = `ri-new-${++createSeq}`;
				if (repertoireBySeason[seasonId]) {
					repertoireBySeason[seasonId].push({
						_id: id,
						name: [],
						work: [{ reference: workId }],
						status: [{ string: status }]
					});
				}
				return json({ _id: id });
			}
			// Property write on an existing entity (status replace etc.).
			return json({ _id: url.split('/').pop() });
		}

		// Pre-write value-id lookups (GET → POST → DELETE replace semantics).
		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-ri' }] });
		if (url.includes('_type.string=work')) return json({ entities: WORKS });
		if (url.includes('_type.string=edition')) return json({ entities: EDITIONS });
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: [] });
		if (url.includes('_type.string=repertoire_item')) {
			if (pendingRepertoireDbs.includes(db) || holdRepertoireReads())
				return new Promise<Response>(() => {});
			if (failRepertoireRead) return json({ error: 'boom' }, 500);
			const seasonId = url.match(/_parent\.reference=([^&]+)/)?.[1] ?? '';
			return json({ entities: repertoireBySeason[decodeURIComponent(seasonId)] ?? [] });
		}

		return json({ error: `unrouted: ${url}` }, 404);
	});

	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function setAuthed(dbs: string[] = ['polyphony']) {
	setToken('jwt-abc');
	authStore.set({
		status: 'authenticated',
		personIdByDb: Object.fromEntries(dbs.map((db) => [db, 'person-p'])),
		expMs: Date.now() + 100_000
	});
	collectiveState.set({
		status: 'ready',
		collectives: dbs.map((db) => ({ db, name: db, personId: 'person-p' })),
		erroredDbs: []
	});
	urlCollectiveDbStore.set(null);
	selectedCollectiveDbStore.set(dbs[0]);
}

beforeEach(() => {
	resetTypeIdCache();
	loadRosterMock.mockResolvedValue([]);
	listSectionsMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue([]);
	deleteEventMock.mockResolvedValue(undefined);
	// Never settles: the signing call is what the pin asserts, and letting it
	// resolve would send happy-dom off navigating a stub tab.
	signFileUrlMock.mockReturnValue(new Promise<string>(() => {}));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	signFileUrlMock.mockReset();
	listEventsForSeasonMock.mockReset();
	deleteEventMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── scoped query helpers (the ACCEPTED-duplication strategy) ────────────────────

function q(scope: ParentNode, testid: string): HTMLElement | null {
	return scope.querySelector(`[data-testid="${testid}"]`);
}
function qa(scope: ParentNode, testid: string): HTMLElement[] {
	return Array.from(scope.querySelectorAll(`[data-testid="${testid}"]`));
}

/** The panel's repertoire section — every panel-side assertion scopes to it. */
function repertoireSection(container: HTMLElement): HTMLElement {
	const section = q(container, 'season-manage-repertoire');
	if (!section) throw new Error('season-manage-repertoire section not in the DOM');
	return section;
}

/** The agenda fallback's expanded works region — the works-expanded that is
 *  NOT inside the season-manage panel. */
function agendaWorksExpanded(container: HTMLElement): HTMLElement {
	const panel = q(container, 'season-manage-panel');
	const outside = qa(container, 'works-expanded').filter((el) => !panel?.contains(el));
	if (outside.length !== 1) {
		throw new Error(`expected exactly one agenda-side works-expanded, got ${outside.length}`);
	}
	return outside[0];
}

/** The work-row rendering the named work, WITHIN the given scope only. */
function rowByName(scope: ParentNode, workName: string): HTMLElement | null {
	return (
		qa(scope, 'work-row').find(
			(el) => q(el, 'work-name')?.textContent?.trim() === workName
		) ?? null
	);
}

async function renderAgendaReady(waitTestid: string): Promise<HTMLElement> {
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, waitTestid)).not.toBeNull();
	});
	return container as HTMLElement;
}

/** Click the gear, wait for the panel AND its repertoire section's rows. */
async function openPanel(container: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(q(container, 'season-manage-gear')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-gear') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
	return q(container, 'season-manage-panel') as HTMLElement;
}

function addWorkSelect(section: HTMLElement): HTMLSelectElement {
	const select = q(section, 'work-manage-add-work-select') as HTMLSelectElement | null;
	expect(select, "the section's add-work select must render").not.toBeNull();
	expect(select!.tagName).toBe('SELECT'); // native control — PO standing rule 1
	return select!;
}

function postsTo(fetchMock: ReturnType<typeof installWorld>, fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'POST'
	);
}
function deletesTo(fetchMock: ReturnType<typeof installWorld>, fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === 'DELETE'
	);
}

// ── the section itself ──────────────────────────────────────────────────────────

describe('#234 — season-manage panel: the repertoire section', () => {
	it('renders inside the panel: heading key, the full unfiltered row list (work + composer + edition labeling, retired included), a remove control per row, and the #204 add-work select', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] } });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(panel, 'season-manage-repertoire')).not.toBeNull();
		});
		const section = repertoireSection(container);
		// The heading follows the sibling-section pattern (season_manage_series_label /
		// season_manage_events_label) with the NEW key.
		expect(section.textContent).toContain('[season_manage_repertoire_label]');

		// Rows appear without any further tap — this is a management section, not
		// a collapsed disclosure.
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});

		// Full row shape, work + edition labeling exactly as the works lines
		// render it (same renderer or byte-equal equivalent).
		const spem = rowByName(section, 'Spem in alium');
		expect(spem, 'Spem in alium row').not.toBeNull();
		expect(q(spem!, 'work-composer')?.textContent?.trim()).toBe('Thomas Tallis');
		expect(q(spem!, 'work-edition')?.textContent?.trim()).toBe('40-part original');
		expect(spem!.getAttribute('data-status')).toBe('active');
		expect(q(spem!, 'work-manage-remove'), 'remove control on the row').not.toBeNull();
		// The editor management row (status controls) renders — the section is an
		// editor surface, same as the 'repertoire' context on the works lines.
		expect(q(spem!, 'work-manage-row')).not.toBeNull();

		// Retired items are LISTED (unfiltered editor read — the status toggle
		// stays two-way), with the no-edition marker for an unpinned row.
		const warhorse = rowByName(section, 'Old warhorse');
		expect(warhorse, 'retired row must be listed for the editor').not.toBeNull();
		expect(warhorse!.getAttribute('data-status')).toBe('retired');
		expect(q(warhorse!, 'work-no-edition')).not.toBeNull();
		expect(q(warhorse!, 'work-manage-remove')).not.toBeNull();

		// The add-work control: native select, prompt option first, then EXACTLY
		// the works not yet in this season's repertoire, labeled by the shared
		// #204 workLabel ("Name - Composer", bare "Name" when composerless).
		const select = addWorkSelect(section);
		const options = Array.from(select.querySelectorAll('option'));
		expect(options.map((o) => o.value)).toEqual(['', 'work-3']);
		expect(options[0].textContent).toBe('[repertoire_add_work_label]');
		expect(options[1].textContent).toBe('Nunc dimittis - Arvo Pärt');
		expect(q(section, 'work-manage-add-work-button')).not.toBeNull();
	});

	it('locale files: season_manage_repertoire_label exists non-empty in en, et, lv and uk', () => {
		for (const locale of ['en', 'et', 'lv', 'uk'] as const) {
			const messages = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			const value = messages['season_manage_repertoire_label'];
			expect(typeof value, `${locale}.json must carry season_manage_repertoire_label`).toBe(
				'string'
			);
			expect((value as string).trim().length, `${locale} value must be non-empty`).toBeGreaterThan(
				0
			);
		}
	});
});

// ── season scope: the PANEL's season, not the viewer's current season ───────────

describe('#234 — divergence (manageable ≠ current): the section tracks the PANEL’s season', () => {
	function installDivergentWorld() {
		return installWorld({
			repertoireBySeason: {
				'season-a': [RI_ACTIVE, RI_RETIRED],
				'season-b': [RI_B]
			}
		});
	}
	function agendaWithLapsedAndFuture() {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({ seasons: [lapsedSeason(), futureSeason()] })
		);
	}

	it('lists season-b’s repertoire (the manageable season), NOT season-a’s (the lapsed current one)', async () => {
		installDivergentWorld();
		agendaWithLapsedAndFuture();
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		const panel = await openPanel(container);

		await waitFor(() => {
			expect(q(panel, 'season-manage-repertoire')).not.toBeNull();
		});
		const section = repertoireSection(container);
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(1);
		});
		expect(rowByName(section, 'Nunc dimittis'), "season-b's row").not.toBeNull();
		// The current (lapsed) season's rows must NOT leak into the panel — an
		// implementation reusing the currentSeasonId-scoped seasonRepertoire /
		// worksByEventId plumbing fails here.
		expect(rowByName(section, 'Spem in alium')).toBeNull();
		expect(rowByName(section, 'Old warhorse')).toBeNull();
	});

	it('the add-work select excludes season-b’s items (not season-a’s), and Add POSTs the repertoire_item under season-b', async () => {
		const fetchMock = installDivergentWorld();
		agendaWithLapsedAndFuture();
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(1);
		});
		const section = repertoireSection(container);

		// Exclusion set = the PANEL season's repertoire: season-b holds work-3,
		// so work-1 and work-2 are pickable and work-3 is not. (The page-level
		// pickableWorksList — excluding season-A's work-1/work-2 — would offer
		// exactly the opposite; that is the divergence this pin exists for.)
		const select = addWorkSelect(section);
		const options = Array.from(select.querySelectorAll('option'));
		expect(options.map((o) => o.value)).toEqual(['', 'work-1', 'work-2']);
		expect(options[1].textContent).toBe('Spem in alium - Thomas Tallis');
		expect(options[2].textContent).toBe('Old warhorse');

		await fireEvent.change(select, { target: { value: 'work-1' } });
		await fireEvent.click(q(section, 'work-manage-add-work-button') as HTMLElement);

		// The create targets THE PANEL's season — full wire shape, verbatim.
		await waitFor(() => {
			expect(postsTo(fetchMock, '/entity').length).toBeGreaterThan(0);
		});
		const [, init] = postsTo(fetchMock, '/entity')[0];
		expect(JSON.parse(String((init as RequestInit).body))).toEqual([
			{ type: '_type', reference: 'type-ri' },
			{ type: '_parent', reference: 'season-b' },
			{ type: 'work', reference: 'work-1' },
			{ type: 'status', string: 'active' }
		]);
	});

	it('a status change on a panel row writes THAT row’s repertoire_item (panel-scoped handlers — the per-event findRow cache cannot see season-b’s rows)', async () => {
		const fetchMock = installDivergentWorld();
		agendaWithLapsedAndFuture();
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(1);
		});
		const section = repertoireSection(container);

		const row = rowByName(section, 'Nunc dimittis')!;
		const learning = q(row, 'work-status-learning');
		expect(learning, 'status control on the panel row').not.toBeNull();
		await fireEvent.click(learning!);

		// The write must actually reach the wire — a control wired to the
		// existing worksByEventId-backed handler silently no-ops here.
		await waitFor(() => {
			expect(postsTo(fetchMock, '/entity/ri-b1').length).toBe(1);
		});
		const [, init] = postsTo(fetchMock, '/entity/ri-b1')[0];
		expect(JSON.parse(String((init as RequestInit).body))).toEqual([
			{ type: 'status', string: 'learning' }
		]);
	});
});

// ── sync with the agenda fallback rows ──────────────────────────────────────────

describe('#234 — panel-side add/remove syncs the agenda fallback works rows', () => {
	function alignedAgendaWithEvent() {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({ seasons: [runningSeason()], upcoming: [EV_FALLBACK] })
		);
	}

	/** Render, expand the agenda event's fallback works line, THEN open the
	 *  panel — both surfaces show the same season's repertoire simultaneously
	 *  (the documented duplicate-testid state; all queries stay scoped). */
	async function bothSurfacesOpen(): Promise<HTMLElement> {
		setAuthed();
		const container = await renderAgendaReady('works-line');
		await fireEvent.click(q(container, 'works-line') as HTMLElement);
		await waitFor(() => {
			expect(qa(agendaWorksExpanded(container), 'work-row').length).toBe(2);
		});
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});
		return container;
	}

	it('remove in the panel deletes the repertoire_item and the row leaves BOTH the section and the agenda fallback line', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] }
		});
		alignedAgendaWithEvent();
		const container = await bothSurfacesOpen();
		const section = repertoireSection(container);

		// The agenda side genuinely shows the row before the panel-side remove.
		expect(rowByName(agendaWorksExpanded(container), 'Spem in alium')).not.toBeNull();

		const spem = rowByName(section, 'Spem in alium')!;
		await fireEvent.click(q(spem, 'work-manage-remove') as HTMLElement);

		await waitFor(() => {
			expect(deletesTo(fetchMock, '/entity/ri-1').length).toBe(1);
		});
		// Both surfaces drop the row (same repertoire_item, child of the season).
		await waitFor(() => {
			expect(rowByName(repertoireSection(container), 'Spem in alium')).toBeNull();
		});
		await waitFor(() => {
			expect(rowByName(agendaWorksExpanded(container), 'Spem in alium')).toBeNull();
		});
		// The fallback surface itself survives — the per-event entry point is
		// untouched (#234 Done-when 3): the other row is still there.
		expect(rowByName(agendaWorksExpanded(container), 'Old warhorse')).not.toBeNull();
	});

	it('add in the panel creates the repertoire_item and the new row reaches BOTH the section and the agenda fallback line', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] }
		});
		alignedAgendaWithEvent();
		const container = await bothSurfacesOpen();
		const section = repertoireSection(container);

		const select = addWorkSelect(section);
		await fireEvent.change(select, { target: { value: 'work-3' } });
		await fireEvent.click(q(section, 'work-manage-add-work-button') as HTMLElement);

		await waitFor(() => {
			expect(postsTo(fetchMock, '/entity').length).toBeGreaterThan(0);
		});
		// No optimistic row for a create (the id is server-assigned): the settle
		// refetch brings the real row — to BOTH surfaces.
		await waitFor(() => {
			expect(rowByName(repertoireSection(container), 'Nunc dimittis')).not.toBeNull();
		});
		await waitFor(() => {
			expect(rowByName(agendaWorksExpanded(container), 'Nunc dimittis')).not.toBeNull();
		});
	});
});

// ── collective switch: no stale rows ────────────────────────────────────────────

describe('#234 — collective switch resets the section’s state', () => {
	it('rows from the previous collective never show in the next collective’s panel', async () => {
		installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			// org-b's repertoire read NEVER resolves: whatever the section shows
			// after the switch is exactly what the reset left behind.
			pendingRepertoireDbs: ['org-b']
		});
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed(['polyphony', 'org-b']);
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});

		selectedCollectiveDbStore.set('org-b');

		// The panel tears down on the switch; reopen it for org-b.
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')).not.toBeNull();
		});
		// org-b's read is still pending, so ANY row here is stale state from
		// polyphony that a reset failed to clear.
		//
		// Asserted on ROWS, not on the section's raw text (review F1): the
		// add-work select is fed by the panel's own works read, which is
		// independent of the repertoire read and DOES resolve for org-b — its
		// options legitimately name the same works. Only rows can be stale.
		const section = repertoireSection(container);
		expect(qa(section, 'work-row')).toEqual([]);
		expect(rowByName(section, 'Spem in alium')).toBeNull();
		expect(rowByName(section, 'Old warhorse')).toBeNull();
	});
});

// ── review round 1 (#234 YELLOW) ────────────────────────────────────────────────

describe('#234 review F1 — the FUTURE-ONLY season: the section is fully usable', () => {
	/** The state the PO ruling names as the whole reason for manageableSeasonId
	 *  scoping: one future season and nothing else. `currentSeason()` returns
	 *  null → the currentSeasonId-scoped picker load (`loadManagePickers`, gated
	 *  on `seasonManageRights === 'editor'` or an event editor) never fires, so
	 *  an implementation borrowing `libraryWorks`/`libraryEditions` renders the
	 *  section list-only: an add-work select holding just its prompt, and rows
	 *  with no composer/edition join. */
	function installFutureOnly() {
		const fetchMock = installWorld({ repertoireBySeason: { 'season-b': [RI_B] } });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [futureSeason()] }));
		setAuthed();
		return fetchMock;
	}

	it('the add-work select offers the pickable works (not just its prompt) and the rows carry their composer', async () => {
		installFutureOnly();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(1);
		});
		const section = repertoireSection(container);

		// The row's work join actually happened — 'Arvo Pärt' lives on work-3,
		// nowhere on the repertoire_item itself.
		const row = rowByName(section, 'Nunc dimittis')!;
		await waitFor(() => {
			expect(q(row, 'work-composer')?.textContent?.trim()).toBe('Arvo Pärt');
		});

		const select = addWorkSelect(section);
		await waitFor(() => {
			expect(Array.from(select.querySelectorAll('option')).map((o) => o.value)).toEqual([
				'',
				'work-1',
				'work-2'
			]);
		});
		expect(Array.from(select.querySelectorAll('option'))[1].textContent).toBe(
			'Spem in alium - Thomas Tallis'
		);
	});

	it('Add works end to end from that state: the create POSTs under the future season', async () => {
		const fetchMock = installFutureOnly();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		const section = repertoireSection(container);
		const select = addWorkSelect(section);
		await waitFor(() => {
			expect(select.querySelectorAll('option').length).toBe(3);
		});

		await fireEvent.change(select, { target: { value: 'work-1' } });
		await fireEvent.click(q(section, 'work-manage-add-work-button') as HTMLElement);

		await waitFor(() => {
			expect(postsTo(fetchMock, '/entity').length).toBeGreaterThan(0);
		});
		const [, init] = postsTo(fetchMock, '/entity')[0];
		expect(JSON.parse(String((init as RequestInit).body))).toEqual([
			{ type: '_type', reference: 'type-ri' },
			{ type: '_parent', reference: 'season-b' },
			{ type: 'work', reference: 'work-1' },
			{ type: 'status', string: 'active' }
		]);
	});
});

describe('#234 review F2 — the panel row’s PDF link is wired', () => {
	it('renders the score button for a pinned edition carrying a file and signs THAT file on click', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] } });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		vi.stubGlobal('open', vi.fn(() => null));
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});
		const section = repertoireSection(container);

		const spem = rowByName(section, 'Spem in alium')!;
		const pdf = await waitFor(() => {
			const el = q(spem, 'work-link-pdf');
			expect(el, 'the PDF button on the panel row').not.toBeNull();
			return el as HTMLElement;
		});

		await fireEvent.click(pdf);
		// An unwired onpdfclick renders the same button and does nothing.
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(signFileUrlMock.mock.calls[0][1]).toBe('file-1');
	});
});

describe('#234 review F3 — the panel’s add-work sentinel reaches the control', () => {
	it('disables the section’s select and Add button while its create is in flight', async () => {
		installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			holdCreates: true
		});
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});
		const section = repertoireSection(container);
		const select = addWorkSelect(section);
		const button = q(section, 'work-manage-add-work-button') as HTMLButtonElement;

		await fireEvent.change(select, { target: { value: 'work-3' } });
		expect(button.disabled).toBe(false);
		await fireEvent.click(button);

		// The create never settles, so the pending key stays set — the section
		// must SHOW it. A key the component never receives leaves both enabled.
		await waitFor(() => {
			expect(button.disabled).toBe(true);
		});
		expect(select.disabled).toBe(true);
	});
});

describe('#234 review F4 — a failed panel read says so', () => {
	it('surfaces the shared list-load error instead of rendering an empty section', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [RI_ACTIVE] }, failRepertoireRead: true });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);

		const section = repertoireSection(container);
		await waitFor(() => {
			const error = q(section, 'season-manage-repertoire-error');
			expect(error, 'the read failure must be visible').not.toBeNull();
			expect(error!.getAttribute('role')).toBe('alert');
			expect(error!.textContent).toContain('[season_manage_list_load_error]');
		});
		// And no rows pretending the season is simply empty.
		expect(qa(section, 'work-row')).toEqual([]);
	});

	it('a clean read leaves the error line absent', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [RI_ACTIVE] } });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(1);
		});
		expect(q(repertoireSection(container), 'season-manage-repertoire-error')).toBeNull();
	});
});

// ── review round 2 (#234 YELLOW) ────────────────────────────────────────────────

describe('#234 review 2 F1 — a panel-PRESERVING reload leaves the section standing', () => {
	/** `loadForSelected({ keepSeasonManage: true })` is the reload every
	 *  panel-born write issues (series/standalone-event delete, panel-born event
	 *  create, series create, event convert): the panel deliberately stays open
	 *  across it. The section's state must survive it too — resetting it on that
	 *  path blanked the rows (reading as "this season has no repertoire") and
	 *  emptied the add-work select down to its prompt, killing Done-when 2 until
	 *  the editor closed and re-opened the gear.
	 *
	 *  Driven through the cheapest such reload there is: a panel-side standalone-
	 *  event delete (`refreshAfterSeasonManageDelete`). */
	const EV_ROW = { id: 'ev-9', name: 'Proov', startDatetime: '2027-05-01T17:00:00.000Z' };

	it('rows and the add-work select survive a standalone-event delete, with no repertoire refetch to hide a wipe', async () => {
		// The trap: from the moment the delete fires, every repertoire_item read
		// hangs. Whatever the section shows afterwards is what the resets left.
		const hold = { on: false };
		installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			holdRepertoireReads: () => hold.on
		});
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		let standaloneEvents = [EV_ROW];
		listEventsForSeasonMock.mockImplementation(async () => standaloneEvents);
		deleteEventMock.mockImplementation(async (_cfg: unknown, id: string) => {
			standaloneEvents = standaloneEvents.filter((e) => e.id !== id);
		});
		setAuthed();

		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-event-ev-9')).not.toBeNull();
		});

		hold.on = true;

		// Two-tap delete (#197 review F2) — only the confirm writes.
		await fireEvent.click(q(container, 'season-manage-event-delete-ev-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-event-delete-confirm-ev-9')).not.toBeNull();
		});
		await fireEvent.click(q(container, 'season-manage-event-delete-confirm-ev-9') as HTMLElement);

		await waitFor(() => {
			expect(deleteEventMock).toHaveBeenCalledTimes(1);
		});
		// The panel-preserving reload has actually run (a second agenda read).
		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
		// …and the panel is still open, which is the whole point of that reload.
		expect(q(container, 'season-manage-panel')).not.toBeNull();

		const section = repertoireSection(container);
		expect(qa(section, 'work-row').length).toBe(2);
		expect(rowByName(section, 'Spem in alium')).not.toBeNull();
		expect(rowByName(section, 'Old warhorse')).not.toBeNull();
		// No false "nothing here" either — an empty section with no error line is
		// exactly the misreading this pin exists for.
		expect(q(section, 'season-manage-repertoire-error')).toBeNull();

		// Done-when 2 is still alive: the add-work select still offers a work.
		const options = Array.from(addWorkSelect(section).querySelectorAll('option'));
		expect(options.map((o) => o.value)).toEqual(['', 'work-3']);
	});
});

describe('#234 review 2 F2 — an AGENDA-side repertoire write syncs the panel section', () => {
	/** The mirror of the panel→agenda sync above. Both surfaces render the SAME
	 *  season's repertoire_items whenever the panel's season is the current one
	 *  (`manageableSeasonId === currentSeasonId` — the common, aligned case), but
	 *  they now hold SEPARATE copies of those rows. Before #234 they shared one
	 *  `seasonRepertoire` and could not diverge. */
	function alignedAgendaWithEvent() {
		loadFullAgendaMock.mockResolvedValue(
			fullAgendaResult({ seasons: [runningSeason()], upcoming: [EV_FALLBACK] })
		);
	}

	async function bothSurfacesOpen(): Promise<HTMLElement> {
		setAuthed();
		const container = await renderAgendaReady('works-line');
		await fireEvent.click(q(container, 'works-line') as HTMLElement);
		await waitFor(() => {
			expect(qa(agendaWorksExpanded(container), 'work-row').length).toBe(2);
		});
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});
		return container;
	}

	function panelAddOptions(container: HTMLElement): string[] {
		return Array.from(
			addWorkSelect(repertoireSection(container)).querySelectorAll('option')
		).map((o) => o.value);
	}

	it('remove on the agenda fallback line drops the row from the panel section AND gives the work back to its add-work select', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] }
		});
		alignedAgendaWithEvent();
		const container = await bothSurfacesOpen();
		expect(panelAddOptions(container)).toEqual(['', 'work-3']);

		const spem = rowByName(agendaWorksExpanded(container), 'Spem in alium')!;
		await fireEvent.click(q(spem, 'work-manage-remove') as HTMLElement);

		await waitFor(() => {
			expect(deletesTo(fetchMock, '/entity/ri-1').length).toBe(1);
		});
		// A row left standing here is a DELETE waiting to be fired at a
		// repertoire_item the server no longer has.
		await waitFor(() => {
			expect(rowByName(repertoireSection(container), 'Spem in alium')).toBeNull();
		});
		// …and the exclusion set the panel's add-work select derives from is the
		// same stale copy, so it has to move too.
		await waitFor(() => {
			expect(panelAddOptions(container)).toEqual(['', 'work-1', 'work-3']);
		});
	});

	it('add on the agenda fallback line reaches the panel section AND leaves its add-work select, so a second Add cannot duplicate the item', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] }
		});
		alignedAgendaWithEvent();
		const container = await bothSurfacesOpen();

		const agenda = agendaWorksExpanded(container);
		const agendaSelect = q(agenda, 'work-manage-add-work-select') as HTMLSelectElement;
		expect(agendaSelect, "the agenda fallback line's add-work select").not.toBeNull();
		await fireEvent.change(agendaSelect, { target: { value: 'work-3' } });
		await fireEvent.click(q(agenda, 'work-manage-add-work-button') as HTMLElement);

		await waitFor(() => {
			expect(postsTo(fetchMock, '/entity').length).toBeGreaterThan(0);
		});
		await waitFor(() => {
			expect(rowByName(repertoireSection(container), 'Nunc dimittis')).not.toBeNull();
		});
		// The work is in the season now: still offering it from the panel invites
		// a DUPLICATE repertoire_item for the same season.
		await waitFor(() => {
			expect(panelAddOptions(container)).toEqual(['']);
		});
	});
});

// (*MVOX:Tallis*)
