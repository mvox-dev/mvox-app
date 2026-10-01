// @vitest-environment happy-dom
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('$lib/files/appByteStore', () => ({ getAppByteStore: () => createFakeByteStore() }));
vi.mock('$lib/files/appLabelStore', () => ({
	getAppLabelStore: () => ({ putLabel: async () => {}, labelsFor: async () => new Map(), remove: async () => {} })
}));
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
import { createFakeByteStore } from '$lib/testing/byteStoreFakes';
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

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

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
	repertoireBySeason: Record<string, EntityRaw[]>;
	pendingRepertoireDbs?: string[];
	failRepertoireRead?: boolean;
	holdCreates?: boolean;
	holdRepertoireReads?: () => boolean;
	workCount?: number;
}

function installWorld(options: WorldOptions) {
	const {
		repertoireBySeason,
		pendingRepertoireDbs = [],
		failRepertoireRead = false,
		holdCreates = false,
		holdRepertoireReads = () => false,
		workCount
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
			return json({ _id: url.split('/').pop() });
		}

		if (url.includes('?props=status')) return json({ entity: { status: [{ _id: 'val-status' }] } });
		if (url.includes('?props=edition')) return json({ entity: { edition: [] } });
		if (url.includes('_type.string=entity')) return json({ entities: [{ _id: 'type-ri' }] });
		if (url.includes('_type.string=work'))
			return json(
				workCount === undefined ? { entities: WORKS } : { count: workCount, entities: WORKS }
			);
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

function setAuthed(dbs: string[] = ['sampledb']) {
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

function q(scope: ParentNode, testid: string): HTMLElement | null {
	return scope.querySelector(`[data-testid="${testid}"]`);
}
function qa(scope: ParentNode, testid: string): HTMLElement[] {
	return Array.from(scope.querySelectorAll(`[data-testid="${testid}"]`));
}

function repertoireSection(container: HTMLElement): HTMLElement {
	const section = q(container, 'season-manage-repertoire');
	if (!section) throw new Error('season-manage-repertoire section not in the DOM');
	return section;
}

function agendaWorksExpanded(container: HTMLElement): HTMLElement {
	const panel = q(container, 'season-manage-panel');
	const outside = qa(container, 'works-expanded').filter((el) => !panel?.contains(el));
	if (outside.length !== 1) {
		throw new Error(`expected exactly one agenda-side works-expanded, got ${outside.length}`);
	}
	return outside[0];
}

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

async function openPanel(container: HTMLElement): Promise<HTMLElement> {
	return await openSeasonCardPanel(container);
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
		expect(section.textContent).toContain('[season_manage_repertoire_label]');

		await waitFor(() => {
			expect(qa(section, 'work-row').length).toBe(2);
		});

		const spem = rowByName(section, 'Spem in alium');
		expect(spem, 'Spem in alium row').not.toBeNull();
		expect(q(spem!, 'work-composer')?.textContent?.trim()).toBe('Thomas Tallis');
		expect(q(spem!, 'work-edition')?.textContent?.trim()).toBe('40-part original');
		expect(spem!.getAttribute('data-status')).toBe('active');
		expect(q(spem!, 'work-manage-remove'), 'remove control on the row').not.toBeNull();
		expect(q(spem!, 'work-manage-row')).not.toBeNull();

		const warhorse = rowByName(section, 'Old warhorse');
		expect(warhorse, 'retired row must be listed for the editor').not.toBeNull();
		expect(warhorse!.getAttribute('data-status')).toBe('retired');
		expect(q(warhorse!, 'work-no-edition')).not.toBeNull();
		expect(q(warhorse!, 'work-manage-remove')).not.toBeNull();

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

		const select = addWorkSelect(section);
		const options = Array.from(select.querySelectorAll('option'));
		expect(options.map((o) => o.value)).toEqual(['', 'work-1', 'work-2']);
		expect(options[1].textContent).toBe('Spem in alium - Thomas Tallis');
		expect(options[2].textContent).toBe('Old warhorse');

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

		await waitFor(() => {
			expect(postsTo(fetchMock, '/entity/ri-b1').length).toBe(1);
		});
		const [, init] = postsTo(fetchMock, '/entity/ri-b1')[0];
		expect(JSON.parse(String((init as RequestInit).body))).toEqual([
			{ _id: 'val-status', type: 'status', string: 'learning' }
		]);
	});
});

describe('#234 — panel-side add/remove syncs the agenda fallback works rows', () => {
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

	it('remove in the panel deletes the repertoire_item and the row leaves BOTH the section and the agenda fallback line', async () => {
		const fetchMock = installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] }
		});
		alignedAgendaWithEvent();
		const container = await bothSurfacesOpen();
		const section = repertoireSection(container);

		expect(rowByName(agendaWorksExpanded(container), 'Spem in alium')).not.toBeNull();

		const spem = rowByName(section, 'Spem in alium')!;
		await fireEvent.click(q(spem, 'work-manage-remove') as HTMLElement);

		await waitFor(() => {
			expect(deletesTo(fetchMock, '/entity/ri-1').length).toBe(1);
		});
		await waitFor(() => {
			expect(rowByName(repertoireSection(container), 'Spem in alium')).toBeNull();
		});
		await waitFor(() => {
			expect(rowByName(agendaWorksExpanded(container), 'Spem in alium')).toBeNull();
		});
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
		await waitFor(() => {
			expect(rowByName(repertoireSection(container), 'Nunc dimittis')).not.toBeNull();
		});
		await waitFor(() => {
			expect(rowByName(agendaWorksExpanded(container), 'Nunc dimittis')).not.toBeNull();
		});
	});
});

describe('#234 — collective switch resets the section’s state', () => {
	it('rows from the previous collective never show in the next collective’s panel', async () => {
		installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			pendingRepertoireDbs: ['org-b']
		});
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed(['sampledb', 'org-b']);
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});

		selectedCollectiveDbStore.set('org-b');

		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-repertoire')).not.toBeNull();
		});
		const section = repertoireSection(container);
		expect(qa(section, 'work-row')).toEqual([]);
		expect(rowByName(section, 'Spem in alium')).toBeNull();
		expect(rowByName(section, 'Old warhorse')).toBeNull();
	});
});

describe('#234 review F1 — the FUTURE-ONLY season: the section is fully usable', () => {
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
	it('renders the score button for a pinned edition carrying a file and opens THAT file in the part viewer on click', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] } });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const openSpy = vi.fn(() => null);
		vi.stubGlobal('open', openSpy);
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
		expect(gotoMock.mock.calls.filter((c) => String(c[0]).startsWith('/part/'))).toEqual([
			[
				'/part/file-1?db=sampledb',
				{
					state: {
						partLabel: {
							work: 'Spem in alium',
							composer: 'Thomas Tallis',
							edition: '40-part original',
							filename: 'spem.pdf'
						}
					}
				}
			]
		]);
		expect(openSpy).not.toHaveBeenCalled();
		expect(signFileUrlMock).not.toHaveBeenCalled();
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

describe('#234 review 2 F1 — a panel-PRESERVING reload leaves the section standing', () => {
	const SERIES_ROW = { id: 'series-9', name: 'Proovid', eventCount: 3, ownerIds: ['person-p'] };

	it('rows and the add-work select survive a series delete, with no repertoire refetch to hide a wipe', async () => {
		const hold = { on: false };
		installWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			holdRepertoireReads: () => hold.on
		});
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		let seriesRows = [SERIES_ROW];
		listEventSeriesForSeasonMock.mockImplementation(async () => ({ items: seriesRows, truncated: false }));
		countSeriesOccurrencesMock.mockResolvedValue(3);
		deleteEventSeriesMock.mockImplementation(async (_cfg: unknown, id: string) => {
			seriesRows = seriesRows.filter((s) => s.id !== id);
			return 3;
		});
		setAuthed();

		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);
		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-series-series-9')).not.toBeNull();
		});

		hold.on = true;

		await fireEvent.click(q(container, 'season-manage-series-delete-series-9') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-manage-series-delete-confirm-series-9')).not.toBeNull();
		});
		await fireEvent.click(
			q(container, 'season-manage-series-delete-confirm-series-9') as HTMLElement
		);

		await waitFor(() => {
			expect(deleteEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();

		const section = repertoireSection(container);
		expect(qa(section, 'work-row').length).toBe(2);
		expect(rowByName(section, 'Spem in alium')).not.toBeNull();
		expect(rowByName(section, 'Old warhorse')).not.toBeNull();
		expect(q(section, 'season-manage-repertoire-error')).toBeNull();

		const options = Array.from(addWorkSelect(section).querySelectorAll('option'));
		expect(options.map((o) => o.value)).toEqual(['', 'work-3']);
	});
});

describe('#234 review 2 F2 — an AGENDA-side repertoire write syncs the panel section', () => {
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
		await waitFor(() => {
			expect(rowByName(repertoireSection(container), 'Spem in alium')).toBeNull();
		});
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
		await waitFor(() => {
			expect(q(repertoireSection(container), 'work-manage-add-work-select')).toBeNull();
		});
	});
});

describe('#311 — the panel’s Add Work picker keys hiding off "nothing left to pick once its load COMPLETED SUCCESSFULLY"', () => {
	const ALL_TAKEN = { 'season-1': [RI_ACTIVE, RI_RETIRED, RI_B] };

	function installPanelPickerWorld({
		repertoireBySeason,
		failWorks = false
	}: {
		repertoireBySeason: Record<string, EntityRaw[]>;
		failWorks?: boolean;
	}) {
		const base = installWorld({ repertoireBySeason });
		const held: Array<(r: Response) => void> = [];
		let holdArmed = false;
		const wrapped = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (method === 'GET' && url.includes('_type.string=work')) {
				if (failWorks) return json({ error: 'boom' }, 500);
				if (holdArmed) return new Promise<Response>((resolve) => held.push(resolve));
			}
			return base(input, init);
		});
		vi.stubGlobal('fetch', wrapped);
		return {
			armWorkHold() {
				holdArmed = true;
			},
			heldCount: () => held.length,
			async releaseWorkReads() {
				holdArmed = false;
				for (const resolve of held.splice(0, held.length)) {
					resolve(await base('https://api.entu-test.invalid/sampledb/search?_type.string=work'));
				}
			}
		};
	}

	it('load completes with every work already in the season → the select and button are GONE; rows and section stand', async () => {
		installPanelPickerWorld({ repertoireBySeason: ALL_TAKEN });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);

		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(3);
		});
		const section = repertoireSection(container);
		await waitFor(() => {
			expect(q(section, 'work-manage-add-work-select')).toBeNull();
		});
		expect(q(section, 'work-manage-add-work-button')).toBeNull();
		expect(qa(section, 'work-row').length).toBe(3);
	});

	it('while the panel’s works read is IN FLIGHT the select stays (still loading is not empty), and settles to the real options', async () => {
		const world = installPanelPickerWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] }
		});
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		world.armWorkHold();
		await openPanel(container);

		await waitFor(() => {
			expect(qa(repertoireSection(container), 'work-row').length).toBe(2);
		});
		await waitFor(() => {
			expect(world.heldCount()).toBeGreaterThan(0);
		});
		expect(
			q(repertoireSection(container), 'work-manage-add-work-select'),
			'panel load in flight → the select must not be withheld off a transiently-empty list'
		).not.toBeNull();

		await world.releaseWorkReads();
		await waitFor(() => {
			const select = q(
				repertoireSection(container),
				'work-manage-add-work-select'
			) as HTMLSelectElement | null;
			expect(select).not.toBeNull();
			expect(select!.querySelector('option[value="work-3"]')).not.toBeNull();
		});
	});

	it('the works read FAILS → the error banner shows AND the select stays — a failed load never hides (no invisible picker under a visible error)', async () => {
		installPanelPickerWorld({
			repertoireBySeason: { 'season-1': [RI_ACTIVE, RI_RETIRED] },
			failWorks: true
		});
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);

		const section = repertoireSection(container);
		await waitFor(() => {
			expect(q(section, 'season-manage-repertoire-error')).not.toBeNull();
		});
		expect(
			q(section, 'work-manage-add-work-select'),
			'a FAILED panel load must never hide the control'
		).not.toBeNull();
	});
});

describe('#234/#321 — the panel add-work picker states a truncated library read', () => {
	const WORK_OPTION = 'work-manage-add-work-partial-option';

	it('a truncated panel WORK read puts a trailing disabled option inside the select', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [] }, workCount: 900 });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);

		const section = repertoireSection(container);
		await waitFor(() => {
			expect(q(section, WORK_OPTION)).not.toBeNull();
		});
		const select = addWorkSelect(section);
		const options = Array.from(select.options);
		const last = options[options.length - 1];
		expect(last.getAttribute('data-testid')).toBe(WORK_OPTION);
		expect(last.disabled).toBe(true);
		expect(options.some((o) => o.textContent?.includes('Spem in alium'))).toBe(true);
	});

	it('a complete panel read leaves the option ABSENT from the select', async () => {
		installWorld({ repertoireBySeason: { 'season-1': [] } });
		loadFullAgendaMock.mockResolvedValue(fullAgendaResult({ seasons: [runningSeason()] }));
		setAuthed();
		const container = await renderAgendaReady('agenda-empty');
		await openPanel(container);

		const section = repertoireSection(container);
		await waitFor(() => {
			expect(addWorkSelect(section)).not.toBeNull();
		});
		expect(q(section, WORK_OPTION)).toBeNull();
	});
});
