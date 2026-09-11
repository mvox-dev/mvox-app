// @vitest-environment happy-dom
//
// #324 RED — the season-manage panel's repertoire section: failure reaches
// the user (and success is distinguishable from silence).
//
// The defect (issue #324, delta-verified in research-323-328-delta.json): the
// panel's `panelQueue` (createRepertoireWriteQueue consumer,
// src/routes/+page.svelte) applies add-work / status / remove optimistically,
// and on rejection its `revert()` does ONLY a silent refetch
// (refreshPanelRepertoire + refreshWorksAfterWrite) — no message anywhere. The
// ADJACENT agenda-side `repertoireQueue` on this same page has surfaced
// `manageError` + role="alert" since #91: that wiring is the PRECEDENT this
// section must match, and it stays BYTE-UNTOUCHED (page.repertoire-manage-
// wiring.spec.ts keeps pinning it as-is — a diff touching it is scope creep).
//
// INTEGRATION posture: the REAL +page.svelte, real repertoire data layer,
// real write actions; the network stubbed at `fetch` — the same harness
// family as page.season-repertoire.spec.ts (whose panel-shape pins stay
// green as-is).
//
// CONTRACT (defined HERE, implemented in GREEN):
//
//   FAILURE — inside [data-testid="season-manage-repertoire"]:
//     • [data-testid="repertoire-manage-error"], role="alert", rendering
//       m.repertoire_manage_error() (the existing four-locale key — the
//       agenda precedent's own text family). Absent until a panel write
//       fails; appears for every rejected write kind this section offers
//       (add work / status change / remove).
//     • DISTINCT from the section's READ-failure banner
//       (season-manage-repertoire-error, season_manage_list_load_error) —
//       a rejected WRITE must not masquerade as a failed list load.
//     • The on-screen value after the failure is what the server holds
//       (existing rollback+refetch semantics pinned by VALUE, not mechanism).
//     • A fresh attempt clears the previous failure (agenda precedent).
//
//   SAVED — [data-testid="repertoire-manage-status"], role="status",
//   aria-live="polite", mounted WITH the section (blank until a settle — a
//   live region announces only CHANGES, the #197/#298 rule); on a successful
//   settle it carries m.repertoire_manage_saved() (NEW key; its four-locale
//   pin lives in the sibling suite, page.works-write-failure.spec.ts).
//
//   BOUNDARY + PRIMITIVE (per the task pins, stated once here as in the
//   sibling): #324 owns the two REPERTOIRE queues' signals (this panelQueue +
//   the event page's repertoireQueue); scheduleQueue/editWriteQueue saved
//   cues are #328's. Wiring is PER CALL SITE — RepertoireWriteQueueCallbacks
//   (repertoireActions.ts) is NOT widened; repertoireActions.spec.ts stays
//   green byte-for-byte. RepertoireElement.svelte gains no `failed` prop —
//   the alert is page-authored, exactly like the agenda's own.
//
//   TESTIDS — `repertoire-manage-error` also exists page-wide as the AGENDA
//   surface's alert node (routes/+page.svelte:8197). Accepted duplication,
//   #234's documented strategy: every assertion here scopes WITHIN
//   [data-testid="season-manage-repertoire"].
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
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
	deleteEventMock,
	listEventSeriesForSeasonMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	signFileUrlMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	deleteEventMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
// The panel's NON-repertoire reads — not under test; mocked the way
// page.season-manage.spec.ts mocks them. The repertoire path (repertoireData,
// workRows, libraryData, repertoireActions) stays REAL down to `fetch`.
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: vi.fn(),
	addSeasonConductor: vi.fn(),
	removeSeasonConductor: vi.fn(),
	getSeriesDefaults: vi.fn(),
	deleteEvent: deleteEventMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock,
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
vi.mock('$lib/rsvp/rsvpData', () => ({
	findMyMemberId: vi.fn().mockResolvedValue(null),
	listMyRsvps: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	rsvpsByEventId: () => ({}),
	createRsvp: vi.fn(),
	updateRsvpStatus: vi.fn(),
	deleteRsvp: vi.fn()
}));
vi.mock('$lib/attendance/attendanceData', () => ({
	listAttendance: vi.fn().mockResolvedValue([]),
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));

import Page from './+page.svelte';
import { openSeasonCardPanel } from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { authStore } from '$lib/auth/session';
import { setToken, clearAll } from '$lib/auth/storage';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
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

/** One running season — the panel manages it, the viewer is its editor. */
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

/** #324 review F1 — a SECOND manageable season, the switch target. Its own
 *  collapsed entry is what `openSeasonManagePanelFor` (and so
 *  `resetSeasonManage`) is reached through. */
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

const RI_ACTIVE: EntityRaw = {
	_id: 'ri-1',
	name: [{ string: 'Spem in alium' }],
	work: [{ reference: 'work-1' }],
	status: [{ string: 'active' }]
};
const RI_RETIRED: EntityRaw = {
	_id: 'ri-2',
	name: [{ string: 'Old warhorse' }],
	work: [{ reference: 'work-2' }],
	status: [{ string: 'retired' }]
};
/** The SECOND season's one row — what makes "the panel is showing the other
 *  season now" readable off the section itself. */
const RI_OTHER_SEASON: EntityRaw = {
	_id: 'ri-9',
	name: [{ string: 'Nunc dimittis' }],
	work: [{ reference: 'work-3' }],
	status: [{ string: 'active' }]
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

interface WorldOptions {
	/** Mutable per-season repertoire_item state, keyed by season id. Successful
	 *  writes mutate it, so any refetch serves the post-write truth; FAILED
	 *  writes mutate nothing, so the revert-path refetch serves the pre-tap
	 *  truth — the value pins ride on that, not on one mechanism. */
	repertoireBySeason: Record<string, EntityRaw[]>;
	/** Consulted per WRITE (create POST / property-replace POST / entity
	 *  DELETE): while true every write answers 500. Reads stay healthy. */
	failWrites?: () => boolean;
}

/** The Entu stand-in, stateful — trimmed from page.season-repertoire.spec.ts
 *  to exactly the roads these write pins travel, plus `failWrites`. */
function installWorld(options: WorldOptions) {
	const { repertoireBySeason, failWrites = () => false } = options;
	let createSeq = 0;

	const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';

		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (method === 'DELETE') {
			if (failWrites()) return json({ error: 'nope' }, 500);
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
			// Entity CREATE (POST .../entity with no id).
			if (/\/entity(\?|$)/.test(url)) {
				if (failWrites()) return json({ error: 'nope' }, 500);
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
			// Property write on an existing entity (status replace).
			if (failWrites()) return json({ error: 'nope' }, 500);
			const id = url.match(/\/entity\/([^/?]+)/)?.[1] ?? '';
			const props = JSON.parse(String(init?.body ?? '[]')) as Array<Record<string, unknown>>;
			for (const rows of Object.values(repertoireBySeason)) {
				for (const ri of rows) {
					if (ri._id !== id) continue;
					const status = props.find((p) => p.type === 'status');
					if (status) ri.status = [{ string: String(status.string) }];
				}
			}
			return json({ _id: id });
		}

		// Pre-write value-id lookups (replaceEntityProperty's GET).
		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-ri' }] });
		if (url.includes('_type.string=work')) return json({ entities: WORKS });
		if (url.includes('_type.string=edition')) return json({ entities: [] });
		if (url.includes('_type.string=copy')) return json({ entities: [] });
		if (url.includes('_type.string=program_item')) return json({ entities: [] });
		if (url.includes('_type.string=repertoire_item')) {
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
	loadRosterMock.mockResolvedValue(toListRead([]));
	listSectionsMock.mockResolvedValue([]);
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	deleteEventMock.mockResolvedValue(undefined);
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	deleteEventSeriesMock.mockResolvedValue(0);
	countSeriesOccurrencesMock.mockResolvedValue(0);
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
	listEventSeriesForSeasonMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	clearAll({ preserveProvider: false });
	authStore.set({ status: 'loading' });
	collectiveState.set({ status: 'loading' });
});

// ── scoped query helpers (the #234 accepted-duplication strategy) ────────────────

function q(scope: ParentNode, testid: string): HTMLElement | null {
	return scope.querySelector(`[data-testid="${testid}"]`);
}
function qa(scope: ParentNode, testid: string): HTMLElement[] {
	return Array.from(scope.querySelectorAll(`[data-testid="${testid}"]`));
}

/** The collapsed entry whose visible text names `seasonName` (#277's shape:
 *  one `season-card-expand` per manageable season, told apart by name). */
function expandFor(container: HTMLElement, seasonName: string): HTMLElement | null {
	return (
		qa(container, 'season-card-expand').find((b) => b.textContent?.includes(seasonName)) ?? null
	);
}

/** Open — or SWITCH — the panel to the named season via its own entry, then
 *  wait until the panel's label names it. The switch runs
 *  `openSeasonManagePanelFor`'s one teardown backbone, `resetSeasonManage`. */
async function openPanelForSeason(container: HTMLElement, seasonName: string): Promise<HTMLElement> {
	await waitFor(() => {
		expect(expandFor(container, seasonName), `an entry for ${seasonName}`).not.toBeNull();
	});
	await fireEvent.click(expandFor(container, seasonName)!);
	await waitFor(() => {
		expect(q(container, 'season-manage-label')?.textContent?.trim()).toBe(seasonName);
	});
	return q(container, 'season-manage-panel')!;
}

/** Two manageable seasons, no panel open yet — the switch pins' starting point. */
async function renderTwoSeasonAgenda(): Promise<HTMLElement> {
	loadFullAgendaMock.mockResolvedValue(
		fullAgendaResult({ seasons: [runningSeason(), upcomingSeason()] })
	);
	setAuthed();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container as HTMLElement;
}

async function openRepertoireSection(): Promise<{
	container: HTMLElement;
	section: HTMLElement;
}> {
	loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
	setAuthed();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	const panel = await openSeasonCardPanel(container as HTMLElement);
	await waitFor(() => {
		expect(q(panel, 'season-manage-repertoire')).not.toBeNull();
	});
	const section = q(panel, 'season-manage-repertoire')!;
	await waitFor(() => {
		expect(qa(section, 'work-row').length).toBe(2);
	});
	return { container: container as HTMLElement, section };
}

function rowByName(scope: ParentNode, workName: string): HTMLElement {
	const row = qa(scope, 'work-row').find(
		(el) => q(el, 'work-name')?.textContent?.trim() === workName
	);
	if (!row) throw new Error(`no work-row named '${workName}'`);
	return row;
}

/** The #324 write-failure alert, scoped INSIDE the panel section — never the
 *  page-wide agenda node of the same name. */
function manageAlert(section: HTMLElement): HTMLElement | null {
	return q(section, 'repertoire-manage-error');
}
function manageStatus(section: HTMLElement): HTMLElement | null {
	return q(section, 'repertoire-manage-status');
}
/** Safe text of the saved region — '' while GREEN has not mounted it yet, so
 *  a RED failure reads as an assertion, never a null-deref. */
function savedText(section: HTMLElement): string {
	return manageStatus(section)?.textContent ?? '';
}

type FetchMock = ReturnType<typeof installWorld>;
function writeAttempts(fetchMock: FetchMock, method: 'POST' | 'DELETE', fragment: string) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			String(url).includes(fragment) && (init as RequestInit | undefined)?.method === method
	);
}
function createAttempts(fetchMock: FetchMock) {
	return fetchMock.mock.calls.filter(
		([url, init]) =>
			/\/entity(\?|$)/.test(String(url)) && (init as RequestInit | undefined)?.method === 'POST'
	);
}
/** The tap really reached the wire — pins that a RED here is "the failure was
 *  swallowed", never "the control was inert in this harness". */
async function expectWriteAttempted(probe: () => number): Promise<void> {
	await waitFor(() => {
		expect(probe(), 'the tap must actually fire the write').toBeGreaterThan(0);
	});
}

async function expectFailureSurfaced(section: HTMLElement): Promise<HTMLElement> {
	await waitFor(() => {
		expect(manageAlert(section), 'the failed panel write must be said out loud').not.toBeNull();
	});
	const alert = manageAlert(section)!;
	expect(alert.getAttribute('role')).toBe('alert');
	expect(alert.textContent).toContain('[repertoire_manage_error]');
	// A rejected WRITE is not a failed list load — the read banner stays away.
	expect(q(section, 'season-manage-repertoire-error')).toBeNull();
	return alert;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — every rejected panel write speaks, and the section shows server truth
// ═════════════════════════════════════════════════════════════════════════════

describe('#324 — season panel: a rejected repertoire write reaches the user', () => {
	it('status change: no alert before, role=alert naming the failure after — and the row shows the status the server still holds', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			failWrites: () => true
		});
		const { section } = await openRepertoireSection();

		expect(manageAlert(section)).toBeNull();

		await fireEvent.click(q(rowByName(section, 'Spem in alium'), 'work-status-retired')!);

		await expectWriteAttempted(() => writeAttempts(fetchMock, 'POST', '/entity/ri-1').length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			const after = rowByName(section, 'Spem in alium');
			expect(after.getAttribute('data-status')).toBe('active');
			expect(q(after, 'work-status-active')?.getAttribute('aria-pressed')).toBe('true');
		});
	});

	it('remove: the rejected delete surfaces the alert and the row stays listed', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			failWrites: () => true
		});
		const { section } = await openRepertoireSection();

		await fireEvent.click(q(rowByName(section, 'Spem in alium'), 'work-manage-remove')!);

		await expectWriteAttempted(() => writeAttempts(fetchMock, 'DELETE', '/entity/ri-1').length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});
		expect(rowByName(section, 'Spem in alium')).not.toBeNull();
	});

	it('add work: the rejected create surfaces the alert, no phantom row, and the work stays pickable', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			failWrites: () => true
		});
		const { section } = await openRepertoireSection();

		const select = q(section, 'work-manage-add-work-select') as HTMLSelectElement;
		expect(select).not.toBeNull();
		await fireEvent.change(select, { target: { value: 'work-3' } });
		await fireEvent.click(q(section, 'work-manage-add-work-button')!);

		await expectWriteAttempted(() => createAttempts(fetchMock).length);
		await expectFailureSurfaced(section);
		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});
		const options = Array.from(
			(q(section, 'work-manage-add-work-select') as HTMLSelectElement).querySelectorAll('option')
		).map((o) => o.value);
		expect(options).toContain('work-3');
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 — saved is distinguishable; a fresh attempt retires the old alert
// ═════════════════════════════════════════════════════════════════════════════

describe('#324 — season panel: a settled write is distinguishable from silence', () => {
	it('the status live region is MOUNTED with the section (role=status, aria-live=polite, blank) and carries the saved message once a status change settles — with no alert', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] } });
		const { section } = await openRepertoireSection();

		const status = manageStatus(section);
		expect(status, 'the saved live region must mount with the section').not.toBeNull();
		expect(status!.getAttribute('role')).toBe('status');
		expect(status!.getAttribute('aria-live')).toBe('polite');
		expect(status!.textContent?.trim()).toBe('');

		await fireEvent.click(q(rowByName(section, 'Spem in alium'), 'work-status-retired')!);

		// The write itself lands (harness evidence, passes today)…
		await waitFor(() => {
			expect(rowByName(section, 'Spem in alium').getAttribute('data-status')).toBe('retired');
		});
		// …and the settle must SAY so (the #324 cue).
		await waitFor(() => {
			expect(savedText(section)).toContain('[repertoire_manage_saved]');
		});
		expect(manageAlert(section)).toBeNull();
	});

	it('a fresh attempt clears the old alert; its success says saved — never a stale alert, never a stale saved beside a failure', async () => {
		let failing = true;
		installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			failWrites: () => failing
		});
		const { section } = await openRepertoireSection();

		await fireEvent.click(q(rowByName(section, 'Spem in alium'), 'work-status-retired')!);
		await expectFailureSurfaced(section);
		expect(savedText(section)).not.toContain('[repertoire_manage_saved]');

		failing = false;
		await waitFor(() => {
			expect(
				(q(rowByName(section, 'Spem in alium'), 'work-status-retired') as HTMLButtonElement)
					.disabled
			).toBe(false);
		});
		await fireEvent.click(q(rowByName(section, 'Spem in alium'), 'work-status-retired')!);

		await waitFor(() => {
			expect(manageAlert(section), 'trying again retires the old alert').toBeNull();
			expect(savedText(section)).toContain('[repertoire_manage_saved]');
		});
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 — the cues belong to the season they were raised over
// ═════════════════════════════════════════════════════════════════════════════
//
// #324 review F1 — both signals are per-SUBJECT claims about the panel's rows,
// so they go down with those rows in `resetSeasonManage`, right beside the
// READ-failure flag (`panelRepertoireError`) and for the same reason #321
// review F1 already legislates for `seasonManagePartial`. A SEASON switch is
// the tightest reach (`openSeasonManagePanelFor`); a collective switch runs the
// identical teardown.

describe('#324 — the panel’s failure/saved cues do not outlive their season', () => {
	it('a rejected write does not stand over the NEXT season’s rows', async () => {
		installWorld({
			repertoireBySeason: {
				'season-1': [RI_ACTIVE, RI_RETIRED],
				'season-2': [RI_OTHER_SEASON]
			},
			failWrites: () => true
		});
		const container = await renderTwoSeasonAgenda();

		const panelA = await openPanelForSeason(container, 'Season 2026');
		const sectionA = q(panelA, 'season-manage-repertoire')!;
		await waitFor(() => {
			expect(qa(sectionA, 'work-row').length).toBe(2);
		});
		await fireEvent.click(q(rowByName(sectionA, 'Spem in alium'), 'work-status-retired')!);
		await expectFailureSurfaced(sectionA);

		await openPanelForSeason(container, 'Season 2027');
		const sectionB = q(container, 'season-manage-repertoire')!;
		await waitFor(() => {
			expect(qa(sectionB, 'work-row').length).toBe(1);
		});
		expect(q(sectionB, 'work-name')?.textContent?.trim()).toBe('Nunc dimittis');

		expect(manageAlert(sectionB), 'the season being left takes its failure with it').toBeNull();
		expect(savedText(sectionB).trim()).toBe('');
	});

	it('a settled write’s saved cue does not carry onto the next season either', async () => {
		installWorld({
			repertoireBySeason: {
				'season-1': [RI_ACTIVE, RI_RETIRED],
				'season-2': [RI_OTHER_SEASON]
			}
		});
		const container = await renderTwoSeasonAgenda();

		const panelA = await openPanelForSeason(container, 'Season 2026');
		const sectionA = q(panelA, 'season-manage-repertoire')!;
		await waitFor(() => {
			expect(qa(sectionA, 'work-row').length).toBe(2);
		});
		await fireEvent.click(q(rowByName(sectionA, 'Spem in alium'), 'work-status-retired')!);
		await waitFor(() => {
			expect(savedText(sectionA)).toContain('[repertoire_manage_saved]');
		});

		await openPanelForSeason(container, 'Season 2027');
		const sectionB = q(container, 'season-manage-repertoire')!;
		await waitFor(() => {
			expect(qa(sectionB, 'work-row').length).toBe(1);
		});

		expect(
			savedText(sectionB).trim(),
			'the live region must not still read “saved” for the season just left'
		).toBe('');
		expect(manageAlert(sectionB)).toBeNull();
	});
});

// (*MVOX:Tallis* — #324 RED: panelQueue write failure + saved cue in the
// season-manage panel; sibling suite: event/[id]/page.works-write-failure.spec.ts.
// The agenda-side repertoireQueue — the #91 precedent — stays byte-untouched;
// its pins live in page.repertoire-manage-wiring.spec.ts.)
