// @vitest-environment happy-dom
// The season card on the agenda page.
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('$lib/paraglide/messages.js', async () =>
	(await import('$lib/testing/messageMocks')).echoMessages('bare')
);

const {
	loadRosterMock,
	createSeasonMock,
	createEventSeriesMock,
	createEventMock,
	resolveManageRightsMock,
	listEventSeriesForSeasonMock,
	listEventsForSeasonMock,
	updateSeasonFieldMock,
	addSeasonConductorMock,
	removeSeasonConductorMock,
	getSeriesDefaultsMock,
	deleteEventMock,
	deleteEventSeriesMock,
	countSeriesOccurrencesMock,
	countSeasonScopeMock,
	deleteSeasonMock
} = vi.hoisted(() => ({
	loadRosterMock: vi.fn(),
	createSeasonMock: vi.fn(),
	createEventSeriesMock: vi.fn(),
	createEventMock: vi.fn(),
	resolveManageRightsMock: vi.fn(),
	listEventSeriesForSeasonMock: vi.fn(),
	listEventsForSeasonMock: vi.fn(),
	updateSeasonFieldMock: vi.fn(),
	addSeasonConductorMock: vi.fn(),
	removeSeasonConductorMock: vi.fn(),
	getSeriesDefaultsMock: vi.fn(),
	deleteEventMock: vi.fn(),
	deleteEventSeriesMock: vi.fn(),
	countSeriesOccurrencesMock: vi.fn(),
	countSeasonScopeMock: vi.fn(),
	deleteSeasonMock: vi.fn()
}));

vi.mock('$lib/agenda/agendaData', async () =>
	(await import('$lib/testing/moduleHandles')).agendaDataModule()
);
vi.mock('$lib/entity/entityCreate', () => ({
	createSeason: createSeasonMock,
	createEventSeries: createEventSeriesMock,
	createEvent: createEventMock
}));
vi.mock('$lib/seasons/seasonManage', () => ({
	listEventSeriesForSeason: listEventSeriesForSeasonMock,
	listEventsForSeason: listEventsForSeasonMock,
	updateSeasonField: updateSeasonFieldMock,
	addSeasonConductor: addSeasonConductorMock,
	removeSeasonConductor: removeSeasonConductorMock,
	getSeriesDefaults: getSeriesDefaultsMock,
	deleteEvent: deleteEventMock,
	deleteEventSeries: deleteEventSeriesMock,
	countSeriesOccurrences: countSeriesOccurrencesMock,
	countSeasonScope: countSeasonScopeMock,
	deleteSeason: deleteSeasonMock
}));
vi.mock('$lib/collective/databaseEntity', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).entityIdModule(await importOriginal())
);
vi.mock('$lib/repertoire/repertoireActions', async (importActual) => ({
	...(await importActual<typeof import('$lib/repertoire/repertoireActions')>()),
	resolveManageRights: resolveManageRightsMock
}));
vi.mock('$lib/roster/rosterData', () => ({ loadRoster: loadRosterMock }));
vi.mock('$lib/sections/sectionData', async (importOriginal) =>
	(await import('$lib/testing/moduleHandles')).sectionDataModule(await importOriginal())
);
vi.mock('$lib/collectives/discover', async () =>
	(await import('$lib/testing/routeMocks')).discoverModule()
);
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);
vi.mock('$app/navigation', async () =>
	(await import('$lib/testing/routeMocks')).navigationModule()
);
vi.mock('$lib/rsvp/rsvpData', async () =>
	(await import('$lib/testing/moduleHandles')).rsvpHandlesModule('empty')
);
vi.mock('$lib/attendance/attendanceData', async () =>
	(await import('$lib/testing/moduleStubs')).attendanceModule()
);
vi.mock('$lib/repertoire/workRows', async (importOriginal) =>
	(await import('$lib/testing/moduleStubs')).workRowsModule(await importOriginal())
);
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: vi.fn() }));
vi.mock('$lib/library/libraryData', async () =>
	(await import('$lib/testing/moduleStubs')).libraryDataModule()
);
vi.mock('$lib/repertoire/repertoireData', () => ({
	listRepertoireItems: vi.fn().mockResolvedValue([])
}));

import Page from './+page.svelte';
import { fullAgendaResult } from '$lib/testing/agendaFixtures';
import { fillTime } from '$lib/testing/timeControls';
import {
	openSeasonCardPanel,
	collapseSeasonCard,
	SEASON_CARD_EXPAND,
	SEASON_CARD_COLLAPSE
} from '$lib/testing/seasonCard';
import type { Season } from '$lib/seasons/types';
import { toListRead, toSeriesRead } from '$lib/testing/listReadFixtures.js';
import { selectedCollectiveDbStore } from '$lib/collectives/store';
import { testCfg } from '$lib/testing/entuFetchKit';
import { resetAppState } from '$lib/testing/appReset';
import { signIn } from '$lib/testing/session';
import { gotoMock, discoverMock } from '$lib/testing/routeMocks';
import {
	findMyMemberIdMock,
	listMyRsvpsMock,
	listSectionsMock,
	loadFullAgendaMock,
	resolveDatabaseEntityIdMock
} from '$lib/testing/moduleHandles';

const ORG_EFK = '69c7f8718489bfcb0e81b065';
const CFG = testCfg('sampledb', 'jwt-abc');
const SEASON_ID = 'season-1';
const CARD = 'agenda-admin-card';

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

function upcomingSeason(): Season {
	return {
		id: 'season-2',
		name: 'Season 2027',
		startDate: isoDate(90),
		endDate: isoDate(200),
		conductors: [],
		owners: [],
		editors: ['person-p']
	};
}

function agendaResult(opts: { editor?: boolean; withUpcomingSeason?: boolean } = {}) {
	const { editor = true, withUpcomingSeason = false } = opts;
	const season = currentSeason(editor);
	return fullAgendaResult({
		seasonId: season.id,
		seasonConductors: season.conductors,
		seasonOwners: season.owners,
		seasonEditors: season.editors,
		seasons: withUpcomingSeason ? [season, upcomingSeason()] : [season]
	});
}

function noSeasonsResult() {
	return fullAgendaResult();
}

function setAuthedWithOneCollective(): void {
	signIn();
}

function setAuthedWithTwoCollectives(): void {
	signIn({
		collectives: [
			{ db: 'sampledb', name: 'Sampledb', personId: 'person-p' },
			{ db: 'org-b', name: 'Org B', personId: 'person-p' }
		]
	});
}

beforeEach(() => {
	loadFullAgendaMock.mockResolvedValue(agendaResult());
	loadRosterMock.mockResolvedValue(toListRead([]));
	listSectionsMock.mockResolvedValue([]);
	createSeasonMock.mockResolvedValue('season-new-1');
	createEventSeriesMock.mockResolvedValue('series-new-1');
	createEventMock.mockResolvedValue('ev-new-1');
	resolveDatabaseEntityIdMock.mockResolvedValue(ORG_EFK);
	resolveManageRightsMock.mockResolvedValue('not-editor');
	findMyMemberIdMock.mockResolvedValue(null);
	listMyRsvpsMock.mockResolvedValue(toListRead([]));
	listEventSeriesForSeasonMock.mockResolvedValue(toSeriesRead([]));
	listEventsForSeasonMock.mockResolvedValue(toListRead([]));
	updateSeasonFieldMock.mockResolvedValue(undefined);
	addSeasonConductorMock.mockResolvedValue(undefined);
	removeSeasonConductorMock.mockResolvedValue(undefined);
	getSeriesDefaultsMock.mockResolvedValue({
		name: '',
		durationMinutes: null,
		defaultLocation: '',
		defaultDescription: ''
	});
	deleteEventMock.mockResolvedValue(undefined);
	deleteEventSeriesMock.mockResolvedValue(0);
	countSeriesOccurrencesMock.mockResolvedValue(0);
	countSeasonScopeMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
	deleteSeasonMock.mockResolvedValue({ series: 3, events: 21, repertoireItems: 6 });
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
	listEventsForSeasonMock.mockReset();
	updateSeasonFieldMock.mockReset();
	addSeasonConductorMock.mockReset();
	removeSeasonConductorMock.mockReset();
	getSeriesDefaultsMock.mockReset();
	deleteEventMock.mockReset();
	deleteEventSeriesMock.mockReset();
	countSeriesOccurrencesMock.mockReset();
	countSeasonScopeMock.mockReset();
	deleteSeasonMock.mockReset();
	resetAppState();
});

function q(container: HTMLElement, testid: string): HTMLElement | null {
	return container.querySelector(`[data-testid="${testid}"]`);
}

function visibleText(el: HTMLElement): string {
	const clone = el.cloneNode(true) as HTMLElement;
	for (const hidden of clone.querySelectorAll('.sr-only, [aria-hidden="true"]')) hidden.remove();
	return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function renderReady(): Promise<HTMLElement> {
	setAuthedWithOneCollective();
	const { container } = render(Page);
	await waitFor(() => {
		expect(q(container, 'agenda-empty')).not.toBeNull();
	});
	return container;
}

async function fill(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.input(q(container, testid) as HTMLElement, { target: { value } });
}

async function selectValue(container: HTMLElement, testid: string, value: string): Promise<void> {
	await fireEvent.change(q(container, testid) as HTMLElement, { target: { value } });
}

async function startHangingSeriesRun(container: HTMLElement): Promise<Array<(id: string) => void>> {
	const resolvers: Array<(id: string) => void> = [];
	createEventMock.mockImplementation(
		() =>
			new Promise<string>((res) => {
				resolvers.push(res);
			})
	);
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-add-series')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-add-series') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'series-create-form')).not.toBeNull();
	});
	await fill(container, 'series-create-name', 'Monday rehearsals');
	await fill(container, 'series-create-duration', '90');
	await fillTime(container, 'series-create-time', '19:00');
	await fill(container, 'series-create-from', '2026-09-01');
	await fill(container, 'series-create-until', '2026-09-21');
	await selectValue(container, 'series-create-day', '1');
	await fireEvent.click(q(container, 'series-create-submit') as HTMLElement);
	await waitFor(() => {
		expect(resolvers.length).toBe(1);
	});
	return resolvers;
}

type PageOnProgress = (current: number, total: number, kind: string) => void;
type PageScope = { series: number; events: number; repertoireItems: number };
function hangingDeleteSeason() {
	let onProgress: PageOnProgress | undefined;
	let resolveWith!: (scope: PageScope) => void;
	let rejectWith!: (reason: unknown) => void;
	deleteSeasonMock.mockImplementation(
		async (
			_cfg: unknown,
			_seasonId: string,
			_impl: unknown,
			opts?: { onProgress?: PageOnProgress }
		) => {
			onProgress = opts?.onProgress;
			return await new Promise<PageScope>((res, rej) => {
				resolveWith = res;
				rejectWith = rej;
			});
		}
	);
	return {
		tick: (current: number, total: number, kind: string) => onProgress?.(current, total, kind),
		finish: (scope: PageScope) => resolveWith(scope),
		fail: (reason: unknown) => rejectWith(reason)
	};
}

async function armSeasonDelete(container: HTMLElement): Promise<void> {
	await openSeasonCardPanel(container);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season')).not.toBeNull();
	});
	await fireEvent.click(q(container, 'season-manage-delete-season') as HTMLElement);
	await waitFor(() => {
		expect(q(container, 'season-manage-delete-season-confirm')).not.toBeNull();
	});
}

describe('season card #261 — [+ Season] stands above the card as a standalone control', () => {
	it('season-create renders OUTSIDE agenda-admin-card and PRECEDES it in DOM order; testid + min-h-11 + gate unchanged; clicking it opens the season form (integration)', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
			expect(q(container, CARD)).not.toBeNull();
		});

		const create = q(container, 'season-create') as HTMLElement;
		const card = q(container, CARD) as HTMLElement;
		expect(
			create.closest(`[data-testid="${CARD}"]`),
			'#261 — the create trigger no longer lives inside the season card'
		).toBeNull();
		expect(
			create.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
			'#261 — the season card sits BELOW the [+ Season] control'
		).toBeTruthy();
		expect(Array.from(create.classList), '44px floor survives the move').toContain('min-h-11');

		await fireEvent.click(create);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
		expect(gotoMock).not.toHaveBeenCalled();
		expect(createSeasonMock).not.toHaveBeenCalled();
	});

	it('an UPCOMING season: [+ Season] STAYS for an editor (#261 reopen — no upcoming-season suppression) and the card (its expand control) stays too', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: true, withUpcomingSeason: true }));
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
	});
});

describe('season card #261 — zero seasons: [+ Season] is the ONLY control for an editor', () => {
	it('no card, no second create button: agenda-admin-card is GONE, the onboarding banner presents NO cta of its own (agenda-onboarding-cta retired), season-create stands alone and opens the form', async () => {
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(q(container, 'season-create')).not.toBeNull();
		});
		expect(q(container, CARD), '#261 — no season, no season card').toBeNull();
		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(
			q(container, 'agenda-onboarding-cta'),
			'#261 — the onboarding CTA merges into the standalone [+ Season]'
		).toBeNull();

		await fireEvent.click(q(container, 'season-create') as HTMLElement);
		await waitFor(() => {
			expect(q(container, 'season-create-form')).not.toBeNull();
		});
	});

	it('NON-editor zero-season path byte-untouched: agenda-empty renders, no onboarding, no create control, no card', async () => {
		loadFullAgendaMock.mockResolvedValue(noSeasonsResult());
		resolveManageRightsMock.mockResolvedValue('not-editor');
		const container = await renderReady();

		await waitFor(() => {
			expect(resolveManageRightsMock).toHaveBeenCalled();
		});
		expect(q(container, 'agenda-empty')).not.toBeNull();
		expect(q(container, 'agenda-onboarding')).toBeNull();
		expect(q(container, 'season-create')).toBeNull();
		expect(q(container, CARD)).toBeNull();
	});
});

describe('season card #261 — the collapsed card displays only the season name', () => {
	it('the card text is the season name and NOTHING else — no trashcan, no gear, no plus, no confirm/cancel, no describing words', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, CARD)).not.toBeNull();
		});
		const card = q(container, CARD) as HTMLElement;

		expect(visibleText(card)).toBe('Season 2026');
		expect(card.querySelectorAll('button')).toHaveLength(1);
		expect(q(container, 'season-manage-delete-season'), 'no trashcan collapsed').toBeNull();
		expect(q(container, 'season-manage-gear'), 'the gear is removed').toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).toBeNull();
		expect(
			card.querySelector('[data-testid="season-create"]'),
			'#261 — [+ Season] left the card'
		).toBeNull();
		expect(q(container, 'season-manage-delete-progress')).toBeNull();
		expect(q(container, 'season-manage-delete-error')).toBeNull();
	});

	it('the expand control is a real, keyboard-reachable native button spanning the card: BUTTON/type=button, w-full + min-h-11, aria-expanded=false, NEW accessible-name key; merely rendering writes nothing', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		const expand = q(container, SEASON_CARD_EXPAND) as HTMLButtonElement;

		expect(expand.tagName).toBe('BUTTON');
		expect(expand.getAttribute('type')).toBe('button');
		const classes = Array.from(expand.classList);
		expect(classes, 'whole-card click target (w-full)').toContain('w-full');
		expect(classes, '44px touch-target floor (min-h-11)').toContain('min-h-11');
		expect(expand.getAttribute('tabindex')).not.toBe('-1');
		expect(expand.disabled).toBe(false);
		expect(expand.getAttribute('aria-expanded')).toBe('false');
		expect(expand.hasAttribute('aria-label'), 'no accname-superseding aria-label').toBe(false);
		const expandName = expand.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(expandName, 'the NEW key rides inside as the sr-only verb').toContain(
			'season_manage_expand_label'
		);
		expect(expandName, 'the visible season name is part of the accessible name').toContain(
			'Season 2026'
		);
		expect(
			within(container).getByRole('button', { name: /season_manage_expand_label.*Season 2026/ })
		).toBe(expand);
		const srOnly = expand.querySelector('.sr-only') as HTMLElement;
		expect(srOnly, 'the verb is visually hidden').not.toBeNull();
		expect(srOnly.textContent?.trim()).toBe('season_manage_expand_label');

		expect(classes, 'the #205 group-hover cue harness').toContain('group');
		expect(
			classes.some((c) => c.startsWith('hover:')),
			'a hover affordance on the whole-card target'
		).toBe(true);
		const glyph = expand.querySelector('[aria-hidden="true"]') as HTMLElement;
		expect(glyph, 'a disclosure glyph marks the card as unfoldable').not.toBeNull();
		expect(
			Array.from(glyph.classList).some((c) => c.startsWith('group-hover:')),
			'the glyph emphasises on hover (the #205 ✎ treatment)'
		).toBe(true);

		const heading = expand.closest('h2');
		expect(heading, 'the collapsed card is a heading (H-key / rotor reachable)').not.toBeNull();
		expect(within(container).getByRole('heading', { level: 2, name: /Season 2026/ })).toBe(
			heading
		);

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(listEventSeriesForSeasonMock).not.toHaveBeenCalled();
	});

	it('NON-editor: no card, no expand control, no title row — absent from the DOM, not hidden (fail-closed)', async () => {
		loadFullAgendaMock.mockResolvedValue(agendaResult({ editor: false }));
		const container = await renderReady();

		expect(q(container, CARD)).toBeNull();
		expect(q(container, SEASON_CARD_EXPAND)).toBeNull();
		expect(q(container, SEASON_CARD_COLLAPSE)).toBeNull();
		expect(q(container, 'season-manage-delete-season')).toBeNull();
	});
});

describe('season card #261 — clicking the collapsed card expands it', () => {
	it('click → season-manage-panel opens INLINE (no navigation) and the panel loads THIS season’s lists (integration: real route wiring)', async () => {
		const container = await renderReady();
		const panel = await openSeasonCardPanel(container);

		expect(gotoMock).not.toHaveBeenCalled();
		expect(panel.getAttribute('role')).toBe('dialog');
		await waitFor(() => {
			expect(listEventSeriesForSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID);
		});
		expect(listEventsForSeasonMock).not.toHaveBeenCalled();
		expect(q(container, SEASON_CARD_EXPAND), 'expand control is the COLLAPSED face').toBeNull();
	});
});

describe('season card #261 — the opened card’s title row', () => {
	it('the title row is a real collapse button carrying the season name: BUTTON/type=button, min-h-11, aria-expanded=true, aria-controls → the panel, NEW accessible-name key', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement;
		expect(collapse, 'the opened card offers its title row as the collapse target').not.toBeNull();
		expect(collapse.tagName).toBe('BUTTON');
		expect(collapse.getAttribute('type')).toBe('button');
		expect(Array.from(collapse.classList)).toContain('min-h-11');
		expect(collapse.getAttribute('tabindex')).not.toBe('-1');
		expect(collapse.getAttribute('aria-expanded')).toBe('true');
		expect(
			Array.from(collapse.classList),
			'the collapse button fills its heading (w-full), as the expand control fills the card'
		).toContain('w-full');
		const collapseRowHeading = collapse.closest('h2') as HTMLElement;
		expect(
			Array.from(collapseRowHeading.classList),
			'the heading absorbs the row’s free space (flex-1) so the target reaches the trashcan'
		).toContain('flex-1');
		const collapseRow = collapseRowHeading.parentElement as HTMLElement;
		const collapseRowClasses = Array.from(collapseRow.classList);
		expect(collapseRowClasses, 'the title row is a flex row').toContain('flex');
		expect(
			collapseRowClasses,
			'the long lv/uk locales must be allowed to wrap at 375px, not overflow the card'
		).toContain('flex-wrap');
		expect(
			collapseRowClasses,
			'w-fit hugs the content and leaves the trashcan’s ml-auto nothing to push against'
		).not.toContain('w-fit');
		expect(collapse.hasAttribute('aria-label'), 'no accname-superseding aria-label').toBe(false);
		const collapseName = collapse.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		expect(collapseName).toContain('season_manage_collapse_label');
		expect(collapseName).toContain('Season 2026');
		expect(
			within(container).getByRole('button', { name: /season_manage_collapse_label.*Season 2026/ })
		).toBe(collapse);
		const collapseClasses = Array.from(collapse.classList);
		expect(collapseClasses, 'the #205 group-hover cue harness').toContain('group');
		expect(
			collapseClasses.some((c) => c.startsWith('hover:')),
			'a hover affordance on the title-row target'
		).toBe(true);
		expect(
			collapse.querySelector('[aria-hidden="true"]'),
			'a disclosure glyph marks the title row as foldable'
		).not.toBeNull();
		const collapseHeading = collapse.closest('h2');
		expect(collapseHeading, 'the opened title row is a heading').not.toBeNull();
		expect(within(container).getByRole('heading', { level: 2, name: /Season 2026/ })).toBe(
			collapseHeading
		);
		expect(
			collapseHeading?.contains(q(container, 'season-manage-delete-season')),
			'the destructive control is not inside the heading'
		).toBe(false);
		const controlsId = collapse.getAttribute('aria-controls');
		expect(controlsId, 'the collapse control declares aria-controls').toBeTruthy();
		const target = container.querySelector(`[id="${controlsId}"]`);
		expect((target as HTMLElement | null)?.getAttribute('data-testid')).toBe(
			'season-manage-panel'
		);
	});

	it('the red trashcan rides the OPENED title row, right-aligned (ml-auto, last button of the row), never inside the panel — TrashIcon substance pins survive', async () => {
		const container = await renderReady();
		const panel = await openSeasonCardPanel(container);

		const trashcan = q(container, 'season-manage-delete-season') as HTMLButtonElement;
		expect(trashcan, 'opened: the trashcan exists').not.toBeNull();
		expect(panel.contains(trashcan), 'title row, not panel internals').toBe(false);
		expect((q(container, CARD) as HTMLElement).contains(trashcan)).toBe(true);

		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		const row = trashcan.parentElement as HTMLElement;
		expect(row.contains(collapse), 'trashcan and title text share ONE row').toBe(true);
		expect(
			collapse.compareDocumentPosition(trashcan) & Node.DOCUMENT_POSITION_FOLLOWING,
			'the name leads, the trashcan trails'
		).toBeTruthy();
		expect(
			Array.from(trashcan.classList),
			'right-aligned via ml-auto (the retired gear’s slot)'
		).toContain('ml-auto');
		const rowButtons = Array.from(row.querySelectorAll<HTMLButtonElement>('button'));
		expect(rowButtons[rowButtons.length - 1]).toBe(trashcan);

		const svgs = trashcan.querySelectorAll('svg');
		expect(svgs).toHaveLength(1);
		expect(svgs[0].getAttribute('data-icon')).toBe('trash');
		expect(svgs[0].getAttribute('aria-hidden')).toBe('true');
		expect(svgs[0].outerHTML).toContain('currentColor');
		expect((trashcan.textContent ?? '').trim(), 'icon-only').toBe('');
		const classes = Array.from(trashcan.classList);
		expect(classes).toContain('text-red-700');
		expect(classes).toContain('hover:text-red-800');
		expect(classes).toContain('min-h-11');
		expect(classes).toContain('min-w-11');
		expect(trashcan.getAttribute('aria-label')).toContain('season_manage_season_delete');
	});

	it('clicking the title row collapses the card back to the name-only face; nothing was written by open + close', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await collapseSeasonCard(container);

		expect(q(container, 'season-manage-panel')).toBeNull();
		expect(q(container, SEASON_CARD_COLLAPSE)).toBeNull();
		expect(q(container, 'season-manage-delete-season'), 'the trashcan folds away').toBeNull();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});
		expect(visibleText(q(container, CARD) as HTMLElement)).toBe('Season 2026');
		expect(updateSeasonFieldMock).not.toHaveBeenCalled();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});
});

describe('season card #261 — arming the season delete lives on the opened title row', () => {
	it('arming renders confirm/cancel ADJACENT on the title row: the season name STAYS visible, the collapse control stays mounted, the panel stays open', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		const confirm = q(container, 'season-manage-delete-season-confirm') as HTMLElement;
		const cancel = q(container, 'season-manage-delete-season-cancel') as HTMLElement;
		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLElement;
		expect(collapse, 'arming must NOT replace the title row').not.toBeNull();
		expect(collapse.textContent?.trim(), 'the season name never leaves the row').toContain(
			'Season 2026'
		);
		const row = confirm.parentElement as HTMLElement;
		expect(row.contains(cancel)).toBe(true);
		expect(row.contains(collapse), 'confirm/cancel render beside the name, not instead').toBe(
			true
		);
		expect(q(container, 'season-manage-panel'), 'arming does not collapse the card').not.toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});

	it('while COLLAPSED there is nothing to arm: no trashcan, no armed pair — the #236 collapsed-arming flow is retired', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND)).not.toBeNull();
		});

		expect(q(container, 'season-manage-delete-season')).toBeNull();
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(q(container, 'season-manage-delete-season-cancel')).toBeNull();
		expect(countSeasonScopeMock).not.toHaveBeenCalled();
	});

	it('collapsing while armed disarms (existing close contract): re-expanding shows the idle trashcan, not a live confirm', async () => {
		const container = await renderReady();
		await armSeasonDelete(container);

		await collapseSeasonCard(container);
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();

		await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-season')).not.toBeNull();
		});
		expect(q(container, 'season-manage-delete-season-confirm')).toBeNull();
		expect(deleteSeasonMock).not.toHaveBeenCalled();
	});
});

describe('season card #261 — the gear is gone, and its close-refusal moved to the title row', () => {
	it('season-manage-gear exists in NO state (collapsed, opened, armed) and the gear-label copy feeds nothing', async () => {
		const container = await renderReady();
		await waitFor(() => {
			expect(q(container, CARD)).not.toBeNull();
		});
		expect(q(container, 'season-manage-gear')).toBeNull();

		await openSeasonCardPanel(container);
		expect(q(container, 'season-manage-gear')).toBeNull();

		await armSeasonDelete(container);
		expect(q(container, 'season-manage-gear')).toBeNull();
		expect(container.innerHTML).not.toContain('season_manage_gear_label');
	});

	it('role="toolbar" and the roving tabindex retire with it: no toolbar role inside the card, and the title-row buttons are plain tab stops', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		const card = q(container, CARD) as HTMLElement;
		expect(card.querySelector('[role="toolbar"]'), '#261 — no toolbar frame left').toBeNull();
		expect(container.innerHTML).not.toContain('agenda_admin_toolbar_label');
		expect(
			(q(container, SEASON_CARD_COLLAPSE) as HTMLElement).getAttribute('tabindex')
		).not.toBe('-1');
		expect(
			(q(container, 'season-manage-delete-season') as HTMLElement).getAttribute('tabindex')
		).not.toBe('-1');
	});

	it('mid bulk-series run the title-row collapse is VISIBLY refused (disabled), a click cannot discard the panel, Escape is refused too — and the refusal lifts when the run finishes', async () => {
		const container = await renderReady();
		const resolvers = await startHangingSeriesRun(container);

		const collapse = q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement;
		expect(
			collapse.disabled,
			'the close control must be visibly refused mid-run, not an enabled no-op'
		).toBe(true);
		await fireEvent.click(collapse);
		expect(q(container, 'season-manage-panel')).not.toBeNull();
		expect(q(container, 'series-create-form')).not.toBeNull();

		await fireEvent.keyDown(q(container, 'season-manage-panel') as HTMLElement, {
			key: 'Escape'
		});
		expect(q(container, 'season-manage-panel'), 'Escape honours the same refusal').not.toBeNull();

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
			expect(
				(q(container, SEASON_CARD_COLLAPSE) as HTMLButtonElement).disabled
			).toBe(false);
		});
		await collapseSeasonCard(container);
	});
});

describe('season card #261 — closing returns focus to the collapsed card’s expand control', () => {
	it('title-row collapse: focus lands on season-card-expand (the collapse control unmounts; a keyboard user is not dropped at <body>)', async () => {
		const container = await renderReady();
		await openSeasonCardPanel(container);

		await collapseSeasonCard(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
		});
	});

	it('Escape at the focused panel still closes (the panel keydown route survives) and focus lands on the expand control', async () => {
		const container = await renderReady();
		const panel = await openSeasonCardPanel(container);
		await waitFor(() => {
			expect(document.activeElement).toBe(panel);
		});

		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		expect(document.activeElement).toBe(q(container, SEASON_CARD_EXPAND));
	});
});

describe('season card #261 — a collective switch resets the expand/collapse state', () => {
	it('open in A, switch to B: B renders the COLLAPSED card (expand control, no panel), and expanding it opens B’s own fresh panel', async () => {
		setAuthedWithTwoCollectives();
		const { container } = render(Page);
		await waitFor(() => {
			expect(q(container, 'agenda-empty')).not.toBeNull();
		});
		await openSeasonCardPanel(container);

		selectedCollectiveDbStore.set('org-b');
		await waitFor(() => {
			expect(q(container, 'season-manage-panel')).toBeNull();
		});
		await waitFor(() => {
			expect(q(container, SEASON_CARD_EXPAND), 'B starts collapsed').not.toBeNull();
		});
		expect(q(container, SEASON_CARD_COLLAPSE)).toBeNull();

		await openSeasonCardPanel(container);
		expect(q(container, 'season-manage-panel')).not.toBeNull();
	});
});

describe('season card #261 — transient cascade state still shows while collapsed', () => {
	it('a season cascade started from the OPENED row keeps its card-level counter through a mid-cascade collapse: name + counter visible, no controls beyond the expand target', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await armSeasonDelete(container);
		await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalledWith(CFG, SEASON_ID, undefined, {
				onProgress: expect.any(Function)
			});
		});

		run.tick(2, 5, 'event');
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).not.toBeNull();
		});

		await collapseSeasonCard(container);

		const progress = q(container, 'season-manage-delete-progress') as HTMLElement;
		expect(progress, 'the RUNNING counter survives the collapse').not.toBeNull();
		expect(progress.getAttribute('role')).toBe('status');
		const card = q(container, CARD) as HTMLElement;
		expect(card.contains(progress), 'card level — visible while collapsed').toBe(true);
		expect(card.textContent, 'the name stays alongside the counter').toContain('Season 2026');
		expect(q(container, 'season-manage-delete-season'), 'still no collapsed trashcan').toBeNull();

		run.finish({ series: 3, events: 21, repertoireItems: 6 });
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-progress')).toBeNull();
		});
	});

	it('a cascade that FAILS after the collapse lands its season-branch error at card level, visible on the collapsed card', async () => {
		const run = hangingDeleteSeason();
		const container = await renderReady();
		await armSeasonDelete(container);
		await fireEvent.click(q(container, 'season-manage-delete-season-confirm') as HTMLElement);
		await waitFor(() => {
			expect(deleteSeasonMock).toHaveBeenCalled();
		});
		await collapseSeasonCard(container);

		run.fail({
			code: 'season-cascade-partial',
			seasonId: SEASON_ID,
			deletedCount: 2,
			totalCount: 6,
			failure: new Error('boom')
		});
		await waitFor(() => {
			expect(q(container, 'season-manage-delete-error')).not.toBeNull();
		});
		const alert = q(container, 'season-manage-delete-error') as HTMLElement;
		expect(alert.getAttribute('role')).toBe('alert');
		expect((q(container, CARD) as HTMLElement).contains(alert)).toBe(true);
		expect(q(container, 'season-manage-panel'), 'still collapsed').toBeNull();
	});
});

describe('season card #261 — i18n: the new accessible-name keys exist, the gear/toolbar keys are gone', () => {
	type MessageFile = Record<string, string>;
	function readLocale(locale: string): MessageFile {
		return JSON.parse(
			readFileSync(resolve(process.cwd(), `messages/${locale}.json`), 'utf-8')
		) as MessageFile;
	}

	it('season_manage_expand_label / season_manage_collapse_label carry the proposed copy in en/et/lv/uk (Comenius may refine wording — the keys and their presence are the contract)', () => {
		const expected = {
			en: { expand: 'Open season card', collapse: 'Close season card' },
			et: { expand: 'Ava hooaja kaart', collapse: 'Sulge hooaja kaart' },
			lv: { expand: 'Atvērt sezonas karti', collapse: 'Aizvērt sezonas karti' },
			uk: { expand: 'Відкрити картку сезону', collapse: 'Закрити картку сезону' }
		} as const;
		for (const [locale, copy] of Object.entries(expected)) {
			const msgs = readLocale(locale);
			expect(msgs.season_manage_expand_label, `${locale}.json season_manage_expand_label`).toBe(
				copy.expand
			);
			expect(
				msgs.season_manage_collapse_label,
				`${locale}.json season_manage_collapse_label`
			).toBe(copy.collapse);
		}
	});

	it('season_manage_gear_label, agenda_admin_toolbar_label and agenda_onboarding_cta are REMOVED from all four locales (dead keys — the #236 season_manage_panel_label discipline)', () => {
		const dead = [
			'season_manage_gear_label',
			'agenda_admin_toolbar_label',
			'agenda_onboarding_cta'
		] as const;
		for (const locale of ['en', 'et', 'lv', 'uk'] as const) {
			const msgs = readLocale(locale);
			for (const key of dead) {
				expect(key in msgs, `${locale}.json still carries the unconsumed ${key}`).toBe(false);
			}
		}
	});
});

// (*MVOX:Tallis*)
