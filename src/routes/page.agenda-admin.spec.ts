// @vitest-environment happy-dom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', () => ({
	m: new Proxy({}, { get: (_target, key) => () => String(key) })
}));

const {
	loadFullAgendaMock,
	loadRosterMock,
	listSectionsMock,
	createSeasonMock,
	createEventSeriesMock,
	createEventMock,
	resolveDatabaseEntityIdMock,
	resolveManageRightsMock,
	discoverMock,
	gotoMock,
	findMyMemberIdMock,
	listMyRsvpsMock,
	listEventSeriesForSeasonMock,
	listSeriesOptionsForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock
} = vi.hoisted(() => ({
	loadFullAgendaMock: vi.fn(),
	loadRosterMock: vi.fn(),
	listSectionsMock: vi.fn(),
	createSeasonMock: vi.fn(),
	createEventSeriesMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveDatabaseEntityIdMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	discoverMock: vi.fn(),
	gotoMock: vi.fn(),
	findMyMemberIdMock: vi.fn(),
	listMyRsvpsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listSeriesOptionsForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', () => ({ loadFullAgenda: loadFullAgendaMock }));
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: createEventSeriesMock,
	createEvent: createEventMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listSeriesOptionsForSeason: listSeriesOptionsForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/collective/databaseEntity')>();
	return { ...actual, resolveDatabaseEntityId: resolveDatabaseEntityIdMock };
});
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/sections/sectionData')>()),
	listSections: listSectionsMock
}));
vi.mock('$lib/collectives/discover', () => ({ discoverCollectives: discoverMock }));
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
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
	listMyAttendance: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllRsvpsForEvent: vi.fn().mockResolvedValue([]),
	createAttendance: vi.fn(),
	updateAttendanceStatus: vi.fn(),
	deleteAttendance: vi.fn(),
	attendanceByMemberId: () => ({})
}));
vi.mock('$lib/repertoire/workRows', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/repertoire/workRows')>()),
	loadWorksByEventId: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', () => ({
	listWorks: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllEditions: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false }),
	listAllCopies: vi.fn().mockResolvedValue({ items: [], total: 0, truncated: false })
}));
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import {
	openSeasonCardPanel,
	collapseSeasonCard,
	SEASON_CARD_EXPAND,
	SEASON_CARD_COLLAPSE
} from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import type { RosterRow } from '$lib/roster/rosterData';
import { fillDateTime, fillTime } from '$lib/testing/timeControls';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';

function isoDate(offsetDays: number): string {
	return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function currentSeason(viewerIsEditor: boolean): Season {
	return {
		id: SEASON_ID,
		name: 'Season 2026',
		startDate: isoDate(-30),
		endDate: isoDate(60),
		conductors: [],
		owners: [],
		editors: viewerIsEditor ? ['person-p'] : []
	};
}

function agendaResult(opts: { editor?: boolean; conductors?: string[] } = {}) {
	const { editor = true, conductors = [] } = opts;
	const season = { ...currentSeason(editor), conductors };
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: [season]
	});
}

function noSeasonsResult() {
	return fullAgendaResult();
}

function fixtureRows(): RosterRow[] {
	return [
		{
			memberId: 'm-ada',
			personId: 'p-ada',
			name: 'Ada Lovelace',
			email: 'ada@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		},
		{
			memberId: 'm-pete',
			personId: 'person-p',
			name: 'Pete Wilson',
			email: 'pete@x.com',
			sectionIds: [],
			dbEntityId: ORG_EFK
		}
	];
}

function seriesFixture() {
	return [{ id: 'series-1', name: 'Monday rehearsals', eventCount: 12 }];
}

function setAuthedWithOneCollective() {
	signIn();
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead(fixtureRows()));
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventSeriesMock.mockResolvedValue('series-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead(seriesFixture()));
	listSeriesOptionsForSeasonMock.mockResolvedValue(
		seriesFixture().map(({ id, name }) => ({ id, name }))
	);
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	getSeriesDefaultsMock.mockResolvedValue({
		name: 'Monday rehearsals',
		durationMinutes: 90,
		defaultLocation: 'Main hall',
		defaultDescription: null
	});
});

afterEach(() => {
	cleanup();
	loadFullAgendaMock.mockReset();
	loadRosterMock.mockReset();
	listSectionsMock.mockReset();
	createSeasonMock.mockReset();
	createEventSeriesMock.mockReset();
	createEventMock.mockReset();
	resolveDatabaseEntityIdMock.mockReset();
	resolveManageRightsMock.mockReset();
	discoverMock.mockReset();
	gotoMock.mockReset();
	findMyMemberIdMock.mockReset();
	listMyRsvpsMock.mockReset();
	listEventSeriesForSeasonMock.mockReset();
	listSeriesOptionsForSeasonMock.mockReset();
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

const ADMIN_TESTIDS = [
	'agenda-admin-card', // #222 — the ONE bordered card wrapping header row + panel
	'season-card-expand', // #261 — the collapsed card's whole-card expand button
	'season-card-collapse', // #261 — the opened card's title-row collapse button
	'season-manage-gear', // #261 removed it for EVERYONE — a leak here is doubly wrong
	'season-manage-label', // #236/#238 — the season-name card title
	'season-manage-delete-season', // #261 — the season's red trashcan, on the OPENED title row
	'season-manage-delete-season-confirm', // the armed two-step's halves live on the
	'season-manage-delete-season-cancel', //   opened title row while armed
	'season-manage-panel',
	'season-manage-repertoire', // #234 — the panel's season-repertoire section
	'season-create',
	'season-create-form',
	'event-create',
	'event-create-form',
	'series-create-form'
] as const;

function expectNoAdminControls(container: HTMLElement): void {
	for (const testid of ADMIN_TESTIDS) {
		expect(q(container, testid), `${testid} must be ABSENT from the DOM (fail-closed)`).toBeNull();
	}
}

async function openSeasonForm(container: HTMLElement): Promise<void> {
	await waitFor(() => {
		expect(q(container, 'season-create')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-create') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-create-form')).not.toBeNull();
	});
}

async function openEventFormFromPanel(container: HTMLElement): Promise<void> {
	if (!q(container, 'season-manage-panel')) await openPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-event')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'event-create-form')).not.toBeNull();
	});
}

async function openPanel(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
}

async function openSeriesForm(container: HTMLElement): Promise<void> {
	if (!q(container, 'season-manage-panel')) await openPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

async function addConductorChip(scope: HTMLElement, personId: string): Promise<void> {
	const select = scope.querySelector(
		'select[data-testid$="-conductor-select"]'
	) as HTMLSelectElement;
	expect(select, 'the scope must contain a native conductor select').not.toBeNull();
	await fireEvent.change(select, { target: { value: personId } });
}

async function fillValidSeason(container: HTMLElement): Promise<void> {
	await fill(container, 'season-create-name', 'Autumn 2026');
	await fill(container, 'season-create-start', '2026-09-01');
	await fill(container, 'season-create-end', '2026-12-20');
}

async function fillValidEvent(container: HTMLElement): Promise<void> {
	await selectValue(container, 'event-create-season', SEASON_ID);
	await selectValue(container, 'event-create-type', 'rehearsal');
	await fillDateTime(container, 'event-create-datetime', '2026-09-15', '19:00');
	await fill(container, 'event-create-name', 'Extra rehearsal');
}

async function fillValidSeries(container: HTMLElement): Promise<void> {
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
}

describe('agenda admin — the entry points render together for a season editor (#261: the card + [+ Season])', () => {
	it('the season card (collapsed) + [+ Season] render, each page-level (never inside an agenda row); the page-level [+ Event] is GONE; merely rendering writes NOTHING', async () => {
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();

		for (const testid of [SEASON_CARD_EXPAND, 'season-create']) {
			const control = q(container, testid) as HTMLElement;
			expect(control.closest('[data-testid^="agenda-row-"]'), testid).toBeNull();
			expect(control.closest('[data-testid^="agenda-recent-row-"]'), testid).toBeNull();
		}

		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it('each entry point opens ITS surface: card click → panel (title-row click CLOSES it — no internal close button), [+ Season] → season form — all inline, no navigation, still nothing written', async () => {
		const container = await renderReady();

		await openPanel(container);
		expect(q(container, 'season-manage-close')).toBeNull();
		await collapseSeasonCard(container);

		await openEventFormFromPanel(container);
		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await collapseSeasonCard(container);

		await openSeasonForm(container);
		await fireEvent.click(q(container, 'season-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});

		expect(gotoMock).not.toHaveBeenCalled();
		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(createEventSeriesMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});
});

const CARD = 'agenda-admin-card';

describe('agenda admin — #222/#261: one card — the panel opens inside the card frame', () => {
	it('the card carries THE single border frame; collapsed, the expand button inside it draws no second frame', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, CARD)).not.toBeNull();
		});
		const card = q(container, CARD) as HTMLElement;
		const expand = q(container, SEASON_CARD_EXPAND) as HTMLElement;
		expect(expand, 'collapsed: the expand control lives in the card').not.toBeNull();
		expect(card.contains(expand)).toBe(true);

		const cardClasses = Array.from(card.classList);
		expect(cardClasses, 'the card is the bordered frame').toContain('border');
		expect(cardClasses, 'the frame keeps the rounded look').toContain('rounded-md');
		expect(
			Array.from(expand.classList),
			'no border-in-border: the expand button draws no frame of its own'
		).not.toContain('border');
	});

	it('panel OPEN: season-manage-panel renders inside the card, NEVER inside the title-row collapse button, and draws no second frame', async () => {
		const container = await renderReady();
		await openPanel(container);

		const card = q(container, CARD) as HTMLElement;
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		const panel = q(container, 'season-manage-panel') as HTMLElement;
		expect(card).not.toBeNull();
		expect(collapse).not.toBeNull();
		expect(panel).not.toBeNull();

		expect(card.contains(panel), 'ONE card: the open panel expands INSIDE the frame').toBe(true);
		expect(
			collapse.contains(panel),
			'the panel must never nest inside the title-row button'
		).toBe(false);
		expect(card.contains(collapse), 'the title row lives in the card too').toBe(true);

		expect(
			Array.from(panel.classList),
			'no second stacked frame: the panel draws no border of its own'
		).not.toContain('border');
	});

	it('panel OPEN: the card survives the mid-refresh rights blank — a keepSeasonManage reload never unmounts the open panel while loadFullAgenda is in flight', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container); // #240 — a valid weekly submit needs a day

		let releaseAgenda!: () => void;
		loadFullAgendaMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseAgenda = () => resolve(agendaResult());
				})
		);

		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});

		expect(
			q(container, 'season-create'),
			'non-vacuous: the rights blank really is in effect — [+ Season] is gone'
		).toBeNull();
		const panel = q(container, 'season-manage-panel');
		expect(
			panel,
			'the open panel must NOT be torn down by the transient rights blank of its own refresh'
		).not.toBeNull();

		releaseAgenda();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(
			q(container, 'season-manage-panel'),
			'the panel node survived the whole refresh — not a teardown + remount'
		).toBe(panel);
	});
});

describe('agenda admin — #238/#261: create-rights-only (no manageable season)', () => {
	it('[+ Season] renders standalone; NO card, NO expand control, NO trashcan — nothing to manage means no season card at all', async () => {
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, CARD), '#261 — no manageable season, no card').toBeNull();
		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(q(container, 'season-manage-label')).toBeNull();
		expect(q(container, 'season-manage-delete-season')).toBeNull();
	});
});

describe('agenda admin — #238: the season trashcan paints red (SVG on currentColor)', () => {
	it('season-manage-delete-season contains an inline SVG on currentColor and NO emoji glyph; the red classes, testid, aria-label and 44px floor are unchanged (#261: it lives on the OPENED title row now)', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		const trashcan = q(container, 'season-manage-delete-season') as HTMLButtonElement;

		const svgs = trashcan.querySelectorAll('svg');
		expect(svgs, 'exactly one inline SVG inside the button').toHaveLength(1);
		const svg = svgs[0];
		expect(
			svg.getAttribute('data-icon'),
			'the glyph must come from the reusable TrashIcon component'
		).toBe('trash');
		expect(
			svg.getAttribute('aria-hidden'),
			'decorative — the BUTTON carries the accessible name'
		).toBe('true');
		expect(
			svg.outerHTML,
			'the SVG must draw with currentColor so text-red-700 tints it'
		).toContain('currentColor');
		expect(svg.outerHTML, 'no hard-coded fill/stroke colours').not.toMatch(/#[0-9a-fA-F]{3,8}/);

		expect((trashcan.textContent ?? '').trim(), 'icon-only: no text/emoji glyph').toBe('');
		expect(trashcan.innerHTML).not.toMatch(/[\u{1F5D1}\u{FE0E}\u{FE0F}]/u);

		const classes = Array.from(trashcan.classList);
		expect(classes, 'the resting tint').toContain('text-red-700');
		expect(classes, 'the hover tint').toContain('hover:text-red-800');

		expect(trashcan.getAttribute('aria-label')).toBe('season_manage_season_delete');
		expect(classes, '44px height floor survives the restyle').toContain('min-h-11');
		expect(classes, '44px width floor survives the restyle (icon-only)').toContain('min-w-11');
	});
});

describe('agenda admin — #236: season_manage_panel_label is removed from all four locales (dead key)', () => {
	it('the key is absent in en/et/lv/uk', () => {
		for (const locale of ['en', 'et', 'lv', 'uk'] as const) {
			const msgs = JSON.parse(
				readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
			) as Record<string, string>;
			expect(
				'season_manage_panel_label' in msgs,
				`${locale}.json still carries the unconsumed season_manage_panel_label`
			).toBe(false);
		}
	});
});

describe('agenda admin — the rights gate fails closed across ALL controls', () => {
	it('editor: both entry points present (the affirmative half of the gate) — and the page-level [+ Event] is gone even for an editor', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, 'event-create')).toBeNull();
	});

	it('NON-editor (no _owner/_editor visible to this caller): EVERY admin control is absent from the DOM — not hidden, not disabled', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expectNoAdminControls(container);
		expect(container.querySelector('[data-testid="season-manage-add-series"]')).toBeNull();
		expect(container.querySelector('[data-testid="season-manage-add-event"]')).toBeNull();
	});

	it("a rights read that ERRORS is not a grant: no seasons at all + organization rights resolve to 'error' → every admin control absent", async () => {
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('error');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expectNoAdminControls(container);
	});

	it('a FAILED agenda load (rights unknowable) shows agenda-error and NO admin controls — fail-closed, never fail-open', async () => {
		loadFullAgendaMock.mockRejectedValue(new Error('boom'));
		setAuthedWithOneCollective();
		const { container } = render(Page);

		await waitFor(() => {
			expect(q(container, 'agenda-error')).not.toBeNull();
		});
		expectNoAdminControls(container);
	});
});

describe('agenda admin — creation forms are mutually exclusive', () => {
	it("[+ Season] form open, then the panel's [+ Event] (#213 — the only event entry point left): the event form opens and the season form CLOSES (nothing written)", async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		await openEventFormFromPanel(container);

		expect(q(container, 'event-create-form')).not.toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
		expect(createSeasonMock).not.toHaveBeenCalled();
		expect(createEventMock).not.toHaveBeenCalled();
	});

	it('[+ Event] form open (via the panel), then [+ Season]: the season form opens and the event form CLOSES', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		await openSeasonForm(container);

		expect(q(container, 'season-create-form')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
	});

	it("series form open (in the panel), then the panel's [+ Event]: the event form opens, the series form CLOSES — and the PANEL survives (it is management, not creation)", async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		await openEventFormFromPanel(container);

		expect(q(container, 'event-create-form')).not.toBeNull();
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});

	it('[+ Season] form open, then the panel’s [+ Series]: the series form opens, the season form CLOSES', async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		await openSeriesForm(container);

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
	});

	it('series form open, then [+ Season]: the season form opens, the series form CLOSES, the panel survives', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		await openSeasonForm(container);

		expect(q(container, 'season-create-form')).not.toBeNull();
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});

	it('the panel’s [+ Event] is gone while the event form it opened is up (same gate as the other three entry points)', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});

		expect(q(container, 'season-manage-add-event')).toBeNull();
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
});

async function enableMondayGeneration(container: HTMLElement): Promise<void> {
	await selectValue(container, 'series-create-day', '1');
}

describe('agenda admin — an in-flight create is never torn down by another entry point', () => {
	it('mid bulk-generation run: every other entry point is DISABLED, and clicking one anyway leaves the series form and its run untouched', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		expect(q(container, 'series-create-progress')).not.toBeNull();

		const entryPoints = ['season-create', 'season-manage-add-event'] as const;
		for (const testid of entryPoints) {
			const btn = q(container, testid) as HTMLButtonElement | null;
			expect(btn, `${testid} must still render while the run is in flight`).not.toBeNull();
			expect(
				(btn as HTMLButtonElement).disabled,
				`${testid} must be disabled while a create is in flight`
			).toBe(true);
		}
		for (const testid of entryPoints) {
			await fireEvent.click(q(container, testid) as HTMLElement);
		}

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-progress')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
		expect(createEventMock).toHaveBeenCalledTimes(1); // the loop is untouched

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		resolvers[1]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(3);
		});
		resolvers[2]('ev-new-3');
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect((q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement).disabled).toBe(false);
		});
	});

	it('mid bulk-generation run: the title-row collapse is disabled and cannot unmount the series form the panel hosts', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement;
		expect(
			collapse.disabled,
			'the collapse control must be VISIBLY refused mid-run, not an enabled no-op'
		).toBe(true);
		await fireEvent.click(collapse);

		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(collapse.getAttribute('aria-expanded')).toBe('true');
		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-progress')).not.toBeNull();
	});

	it('mid RESUME run: the stopped run’s remainder survives the interference — the resumed loop still creates exactly the 2 occurrences it owed, on the SAME series', async () => {
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(() => {
			const call = createEventMock.mock.calls.length;
			if (call === 1) return Promise.resolve('ev-new-1');
			if (call === 2) return Promise.reject(new Error('boom'));
			return new Promise<string>((resolve) => {
				resolvers.push(resolve);
			});
		});
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(q(container, 'series-create-resume')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});
		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-resume')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();

		resolvers[0]('ev-new-2');
		await waitFor(() => {
			expect(resolvers.length).toBe(2);
		});
		resolvers[1]('ev-new-3');
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
	});
});

async function stopBulkRunPartway(container: HTMLElement): Promise<void> {
	createEventMock.mockImplementation(() => {
		const call = createEventMock.mock.calls.length;
		if (call === 1) return Promise.resolve('ev-new-1');
		return Promise.reject(new Error('boom'));
	});
	await openSeriesForm(container);
	await fillValidSeries(container);
	await enableMondayGeneration(container);
	await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-resume')).not.toBeNull();
	});
}

describe('agenda admin — a STOPPED series run still owes work, and the entry points respect that', () => {
	it('nothing on the wire, but a resume record outstanding: the other entry points are still DISABLED, and a click cannot discard it', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		expect((q(container, 'series-create-submit') as HTMLButtonElement).disabled).toBe(false);

		const entryPoints = ['season-create', 'season-manage-add-event'] as const;
		for (const testid of entryPoints) {
			const btn = q(container, testid) as HTMLButtonElement | null;
			expect(btn, `${testid} must still render after a stopped run`).not.toBeNull();
			expect(
				(btn as HTMLButtonElement).disabled,
				`${testid} must be disabled while a stopped run still owes occurrences`
			).toBe(true);
			await fireEvent.click(btn as HTMLElement);
		}

		expect(q(container, 'series-create-form')).not.toBeNull();
		expect(q(container, 'series-create-resume')).not.toBeNull();
		expect(q(container, 'event-create-form')).toBeNull();
		expect(q(container, 'season-create-form')).toBeNull();
	});

	it('the resumed run finishes on the SAME series after the interference — no duplicate series, no re-POST of the occurrence that landed', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await fireEvent.click(q(container, 'season-create') as HTMLElement);

		createEventMock.mockImplementation(() => Promise.resolve('ev-retry'));
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		expect(createEventMock).toHaveBeenCalledTimes(4);
		expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
	});

	it('Cancel is the operator’s explicit exit: dismissing the stopped run frees every other entry point again', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		const cancel = q(container, 'series-create-cancel') as HTMLButtonElement;
		expect(cancel.disabled, 'cancel is live once nothing is on the wire').toBe(false);
		await fireEvent.click(cancel);
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});

		await waitFor(() => {
			for (const testid of ['season-create', 'season-manage-add-event'] as const) {
				const btn = q(container, testid) as HTMLButtonElement | null;
				expect(btn, `${testid} must render again`).not.toBeNull();
				expect(
					(btn as HTMLButtonElement).disabled,
					`${testid} must be live again once the stopped run is dismissed`
				).toBe(false);
			}
			expect((q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement).disabled).toBe(false);
		});
	});

	it('the title-row collapse cannot discard the panel while a resume record is outstanding — the panel is the only surviving explanation for the disabled entry points', async () => {
		const container = await renderReady();
		await stopBulkRunPartway(container);

		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement;
		expect(
			collapse.disabled,
			'the collapse control must be visibly refused while a resume is outstanding'
		).toBe(true);
		await fireEvent.click(collapse);

		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(collapse.getAttribute('aria-expanded')).toBe('true');
		expect(q(container, 'series-create-resume')).not.toBeNull();
	});
});

describe('agenda admin — Cancel/Escape is refused while the form’s own create is on the wire', () => {
	it('season create: Cancel is disabled mid-flight, Escape is refused, and the failure still surfaces as a visible error', async () => {
		let rejectCreate!: (err: Error) => void;
		createSeasonMock.mockImplementation(
			() =>
				new Promise<string>((_resolve, reject) => {
					rejectCreate = reject;
				})
		);
		const container = await renderReady();
		await openSeasonForm(container);
		await fillValidSeason(container);
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});

		const cancel = q(container, 'season-create-cancel') as HTMLButtonElement;
		expect(cancel.disabled, 'cancel must be visibly refused, not a dead click').toBe(true);
		await fireEvent.click(cancel);
		expect(q(container, 'season-create-form')).not.toBeNull();

		await fireEvent.keyDown(q(container, 'season-create-form') as HTMLElement, { key: 'Escape' });
		expect(q(container, 'season-create-form')).not.toBeNull();

		expect((q(container, SEASON_CARD_EXPAND) as HTMLButtonElement).disabled).toBe(false);

		rejectCreate(new Error('boom'));
		await waitFor(() => {
			expect(q(container, 'season-create-error')).not.toBeNull();
		});
	});

	it('event create: Cancel is disabled mid-flight, Escape is refused, and the failure still surfaces as a visible error', async () => {
		let rejectCreate!: (err: Error) => void;
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((_resolve, reject) => {
					rejectCreate = reject;
				})
		);
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await fillValidEvent(container);
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});

		const cancel = q(container, 'event-create-cancel') as HTMLButtonElement;
		expect(cancel.disabled, 'cancel must be visibly refused, not a dead click').toBe(true);
		await fireEvent.click(cancel);
		expect(q(container, 'event-create-form')).not.toBeNull();

		await fireEvent.keyDown(q(container, 'event-create-form') as HTMLElement, { key: 'Escape' });
		expect(q(container, 'event-create-form')).not.toBeNull();

		rejectCreate(new Error('boom'));
		await waitFor(() => {
			expect(q(container, 'event-create-error')).not.toBeNull();
		});
	});
});

describe('agenda admin — a collective switch leaves no creation form behind', () => {
	function setAuthedWithTwoCollectives() {
		signIn({ collectives: [{ db: 'org-a', name: 'Org A', personId: 'person-p' }, { db: 'org-b', name: 'Org B', personId: 'person-p' }] });
	}

	it('series form open in A, then a same-route switch to B: re-opening the panel in B does NOT resurrect A’s form', async () => {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});

		await openSeriesForm(container);
		await fill(container, 'series-create-name', 'Monday rehearsals');

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openPanel(container);
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});

	it('a stopped series run does NOT survive a collective switch either (its seriesId belongs to the previous db)', async () => {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await stopBulkRunPartway(container);

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await openPanel(container);
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'series-create-resume')).toBeNull();
		await waitFor(() => {
			expect((q(container, 'season-manage-add-event') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	it('a LIVE bulk run stops issuing POSTs the moment the viewer switches away mid-generation, and writes no outcome into the old form', async () => {
		setAuthedWithTwoCollectives();
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});

		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		resolvers[0]('ev-new-1');
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			createEventMock,
			'the loop must stop at the switch — no further occurrence may land in the db the viewer left'
		).toHaveBeenCalledTimes(1);

		await openPanel(container);
		expect(q(container, 'series-create-form')).toBeNull();
		expect(q(container, 'series-create-resume')).toBeNull();
		await waitFor(() => {
			expect((q(container, 'season-manage-add-event') as HTMLButtonElement).disabled).toBe(false);
		});
	});

	it('a switch away mid-run: the card in the NEW collective still EXPANDS — the close refusal does not travel across collectives', async () => {
		setAuthedWithTwoCollectives();
		const resolvers: Array<(id: string) => void> = [];
		createEventMock.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				})
		);
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
		await waitFor(() => {
			expect(resolvers.length).toBe(1);
		});

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(
			(q(container, SEASON_CARD_EXPAND) as HTMLButtonElement).disabled,
			'with no panel open there is nothing to discard: the card must still expand'
		).toBe(false);
		await openPanel(container);

		resolvers[0]('ev-new-1');
	});
});

describe('agenda admin — the season panel coexists with a panel-born creation form', () => {
	it('panel → [+ Event]: the form opens WITH the panel still up; cancel closes only the form and hands focus back to the panel', async () => {
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-add-event')).not.toBeNull();
		});

		await fireEvent.click(q(container, 'season-manage-add-event') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).not.toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();

		await fireEvent.click(q(container, 'event-create-cancel') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, 'season-manage-panel'));
		});
	});
});

describe('agenda admin — every successful create refreshes the agenda', () => {
	it('season create → loadFullAgenda re-invoked (full call shape held to T2’s pin)', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openSeasonForm(container);
		await fillValidSeason(container);
		await fireEvent.click(q(container, 'season-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createSeasonMock).toHaveBeenCalledTimes(1);
		});
		expect(createSeasonMock).toHaveBeenCalledWith(CFG, {
			name: 'Autumn 2026',
			dbEntityId: ORG_EFK,
			startDate: '2026-09-01',
			endDate: '2026-12-20',
			conductorRefs: []
		});
		await waitFor(() => {
			expect(q(container, 'season-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('event create → loadFullAgenda re-invoked (full call shape held to T4’s pin: Tallinn wall clock → UTC instant)', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openEventFormFromPanel(container);
		await fillValidEvent(container);
		await fireEvent.click(q(container, 'event-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(1);
		});
		expect(createEventMock).toHaveBeenCalledWith(CFG, {
			dbEntityId: ORG_EFK,
			extraParentIds: [SEASON_ID],
			eventType: 'rehearsal',
			startDatetime: '2026-09-15T16:00:00.000Z', // 19:00 EEST (+3)
			name: 'Extra rehearsal'
		});
		await waitFor(() => {
			expect(q(container, 'event-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
	});

	it('series create → loadFullAgenda re-invoked TOO — the refresh discipline is uniform — and the panel it was born in survives the refresh (#240: every series create bulk-creates its occurrences)', async () => {
		const container = await renderReady();
		expect(loadFullAgendaMock).toHaveBeenCalledTimes(1);

		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);

		await waitFor(() => {
			expect(createEventSeriesMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(createEventMock).toHaveBeenCalledTimes(3);
		});
		await waitFor(() => {
			expect(q(container, 'series-create-form')).toBeNull();
		});
		await waitFor(() => {
			expect(loadFullAgendaMock).toHaveBeenCalledTimes(2);
		});
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
});

function expectTouchTarget(
	container: HTMLElement,
	testid: string,
	opts: { iconOnly?: boolean } = {}
): void {
	const found = q(container, testid);
	expect(found, `${testid} must be in the DOM`).not.toBeNull();
	const classes = Array.from((found as HTMLElement).classList);
	expect(classes, `${testid} must reserve a 44px-tall touch target (min-h-11)`).toContain('min-h-11');
	if (opts.iconOnly) {
		expect(classes, `${testid} is icon-only — it must also floor its width (min-w-11)`).toContain(
			'min-w-11'
		);
	}
}

describe('agenda admin — every admin control is a 44x44px touch target', () => {
	it('page-level entry points (#261): the collapsed card’s expand button and [+ Season]', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
			expect(q(container, 'season-create')).not.toBeNull();
		});

		expectTouchTarget(container, SEASON_CARD_EXPAND);
		expectTouchTarget(container, 'season-create');
		expect(q(container, 'season-manage-delete-season')).toBeNull();
	});

	it('opened title row (#261): the collapse control, and the 🗑 (icon-only: height AND width)', async () => {
		const container = await renderReady();
		await openPanel(container);

		expectTouchTarget(container, SEASON_CARD_COLLAPSE);
		expectTouchTarget(container, 'season-manage-delete-season', { iconOnly: true });
	});

	it('panel controls (#213: the internal close × is gone): [+ Series], [+ Event]', async () => {
		const container = await renderReady();
		await openPanel(container);

		expectTouchTarget(container, 'season-manage-add-series');
		expectTouchTarget(container, 'season-manage-add-event');
	});

	it('season form: submit + cancel', async () => {
		const container = await renderReady();
		await openSeasonForm(container);

		expectTouchTarget(container, 'season-create-submit');
		expectTouchTarget(container, 'season-create-cancel');
	});

	it('event form: submit + cancel', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);

		expectTouchTarget(container, 'event-create-submit');
		expectTouchTarget(container, 'event-create-cancel');
	});

	it('series form: submit + cancel', async () => {
		const container = await renderReady();
		await openSeriesForm(container);

		expectTouchTarget(container, 'series-create-submit');
		expectTouchTarget(container, 'series-create-cancel');
	});

	it('panel inline-edit activators (#205 — whole-field now, no icon-only width floor: name, start date, end date)', async () => {
		const container = await renderReady();
		await openPanel(container);

		expectTouchTarget(container, 'season-edit-btn-name');
		expectTouchTarget(container, 'season-edit-btn-start_date');
		expectTouchTarget(container, 'season-edit-btn-end_date');
	});

	it('panel conductor chip × (icon-only)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ conductors: ['p-ada'] }));
		const container = await renderReady();
		await openPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-conductor-remove-p-ada')).not.toBeNull();
		});

		expectTouchTarget(container, 'season-manage-conductor-remove-p-ada', { iconOnly: true });
	});

	it('season form conductor chip × (icon-only)', async () => {
		const container = await renderReady();
		await openSeasonForm(container);
		await addConductorChip(q(container, 'season-create-form') as HTMLElement, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'season-create-conductor-remove-p-ada')).not.toBeNull();
		});

		expectTouchTarget(container, 'season-create-conductor-remove-p-ada', { iconOnly: true });
	});

	it('event form conductor chip × (icon-only)', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		await addConductorChip(q(container, 'event-create-conductors-field') as HTMLElement, 'p-ada');
		await waitFor(() => {
			expect(q(container, 'event-create-conductor-remove-p-ada')).not.toBeNull();
		});

		expectTouchTarget(container, 'event-create-conductor-remove-p-ada', { iconOnly: true });
	});

	it('#215 series preview date-toggle chips: every chip carries the FULL 44x44 floor (min-h-11 AND min-w-11 — a tap target, not a text link), skipped or not; the retired skip-add/skip-remove controls are gone', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		await fillValidSeries(container);
		await enableMondayGeneration(container);
		await waitFor(() => {
			expect(q(container, 'series-create-date-2026-09-07')).not.toBeNull();
		});

		for (const iso of ['2026-09-07', '2026-09-14', '2026-09-21']) {
			expectTouchTarget(container, `series-create-date-${iso}`, { iconOnly: true });
		}

		await fireEvent.click(q(container, 'series-create-date-2026-09-14') as HTMLElement);
		await waitFor(() => {
			expect(
				q(container, 'series-create-date-2026-09-14')?.getAttribute('aria-pressed')
			).toBe('false');
		});
		expectTouchTarget(container, 'series-create-date-2026-09-14', { iconOnly: true });

		expect(q(container, 'series-create-skip-add')).toBeNull();
		expect(q(container, 'series-create-skip-date')).toBeNull();
		expect(container.querySelector('[data-testid^="series-create-skip-remove-"]')).toBeNull();
	});

});

function expectFormFluid(container: HTMLElement, formTestid: string): void {
	const form = q(container, formTestid) as HTMLElement;
	expect(form, formTestid).not.toBeNull();

	const fields = form.querySelectorAll<HTMLElement>('input, select, textarea');
	expect(fields.length, `${formTestid} should contain fields`).toBeGreaterThan(0);
	for (const field of fields) {
		if (field.getAttribute('type') === 'checkbox') continue;
		const classes = Array.from(field.classList);
		const fluid =
			classes.includes('w-full') || classes.includes('flex-1') || classes.includes('min-w-0');
		const label =
			field.getAttribute('data-testid') ?? field.getAttribute('aria-label') ?? field.tagName;
		expect(
			fluid,
			`${formTestid} › ${label} must be fluid (w-full | flex-1 | min-w-0) — an intrinsic-width field forces horizontal scroll at 375px`
		).toBe(true);
	}

	for (const el of Array.from(form.querySelectorAll<HTMLElement>('*'))) {
		for (const cls of Array.from(el.classList)) {
			const fixedPx = /^w-\[(\d+(?:\.\d+)?)px\]$/.exec(cls);
			if (fixedPx) {
				expect(
					Number(fixedPx[1]),
					`${formTestid} contains a fixed width ${cls} — wider than a 375px viewport's usable ~343px`
				).toBeLessThan(344);
			}
		}
	}
}

describe('agenda admin — creation forms stay inside a 375px viewport (class contract)', () => {
	it('season form: every field fluid, no oversized fixed widths', async () => {
		const container = await renderReady();
		await openSeasonForm(container);
		expectFormFluid(container, 'season-create-form');
	});

	it('event form: every field fluid (the datetime-local control is the notorious offender), no oversized fixed widths', async () => {
		const container = await renderReady();
		await openEventFormFromPanel(container);
		expectFormFluid(container, 'event-create-form');
	});

	it('series form: every field fluid, no oversized fixed widths', async () => {
		const container = await renderReady();
		await openSeriesForm(container);
		expectFormFluid(container, 'series-create-form');
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina*)

// (*MVOX:Tallis*)
